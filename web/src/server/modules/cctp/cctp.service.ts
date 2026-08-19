import "server-only";
import {
  Address,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  nativeToScVal,
  rpc,
  StrKey,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { env } from "../../../env";
import { getServerEnv } from "../../../env.server";
import {
  cctpBinding,
  cctpIntakeContract,
  cctpStellar,
} from "../../../lib/cctp";
import { parseCctpMessage } from "../../../lib/cctpMessage";
import {
  commitment,
  encryptNote,
  fromBaseUnits,
  fromBE,
  hexToBytes,
  randomFieldElement,
  toBE32,
} from "../../../lib/crypto";
import { proveDeposit, type RawProof } from "../../../lib/prover";
import {
  networkPassphrase,
  resolveUsernameOnChain,
  server,
  simulateRead,
  usdcSacId,
} from "../../../lib/stellar";
import {
  CctpAttestationError,
  CctpConfigError,
  CctpPayeeError,
  CctpRelayError,
} from "./cctp.errors";
import type { AttestationOutput, RelayInput, RelayOutput } from "./cctp.schema";

const horizonUrl = env.NEXT_PUBLIC_STELLAR_HORIZON_URL;
const friendbotUrl =
  env.NEXT_PUBLIC_FRIENDBOT_URL || "https://friendbot.stellar.org";
const horizon = new Horizon.Server(horizonUrl, {
  allowHttp: horizonUrl.startsWith("http://"),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stripHex = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
const bytesEqual = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
const scProof = (proof: RawProof) => {
  const entry = (key: string, value: Uint8Array) =>
    new xdr.ScMapEntry({
      key: nativeToScVal(key, { type: "symbol" }),
      val: scBytes(value),
    });
  return xdr.ScVal.scvMap([
    entry("a", proof.a),
    entry("b", proof.b),
    entry("c", proof.c),
  ]);
};
const EVM_TO_STELLAR_SCALE = 10n;
const scAddr = (s: string) => new Address(s).toScVal();
const scBytes = (b: Uint8Array) => xdr.ScVal.scvBytes(b as unknown as Buffer);
const scBytesHex = (h: string) =>
  xdr.ScVal.scvBytes(Buffer.from(stripHex(h), "hex"));
const scI128 = (v: bigint) => nativeToScVal(v, { type: "i128" });

export async function fetchAttestation(
  sourceDomain: number,
  txHash: string,
): Promise<AttestationOutput> {
  const { CIRCLE_API_KEY: apiKey, CIRCLE_IRIS_URL } = getServerEnv();
  const irisBaseUrl = CIRCLE_IRIS_URL.replace(/\/+$/, "");
  const url = `${irisBaseUrl}/v2/messages/${sourceDomain}?transactionHash=${encodeURIComponent(txHash)}`;
  const res = await fetch(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  if (res.status === 404) {
    return { status: "pending", message: null, attestation: null };
  }
  if (!res.ok) {
    throw new CctpAttestationError(`Iris returned ${res.status}.`);
  }
  const json = (await res.json()) as {
    messages?: { message?: string; attestation?: string; status?: string }[];
  };
  const msg = json.messages?.[0];
  if (
    !msg?.attestation ||
    msg.attestation === "PENDING" ||
    msg.status !== "complete" ||
    !msg.message
  ) {
    return {
      status: "pending",
      message: msg?.message ?? null,
      attestation: null,
    };
  }
  return {
    status: "complete",
    message: msg.message,
    attestation: msg.attestation,
  };
}

function operatorKeypair(): Keypair {
  const secret = getServerEnv().CCTP_OPERATOR_SECRET;
  if (!secret) {
    throw new CctpConfigError("CCTP_OPERATOR_SECRET is not configured.");
  }
  if (!cctpIntakeContract) {
    throw new CctpConfigError(
      "NEXT_PUBLIC_CCTP_INTAKE_CONTRACT is not configured.",
    );
  }
  return Keypair.fromSecret(secret);
}

async function invokeAsSource(
  kp: Keypair,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<{ value: unknown; txHash: string }> {
  const account = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(120)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new CctpRelayError(sim.error);
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(kp);

  const send = await server.sendTransaction(prepared);
  if (send.status === "ERROR") {
    throw new CctpRelayError(
      `submit failed: ${JSON.stringify(send.errorResult)}`,
    );
  }
  let got = await server.getTransaction(send.hash);
  for (
    let i = 0;
    got.status === rpc.Api.GetTransactionStatus.NOT_FOUND && i < 40;
    i += 1
  ) {
    await sleep(1000);
    got = await server.getTransaction(send.hash);
  }
  if (got.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new CctpRelayError(`transaction ${got.status}`);
  }
  return {
    value: got.returnValue ? scValToNative(got.returnValue) : null,
    txHash: send.hash,
  };
}

async function intakeUsdcBalance(address: string): Promise<bigint> {
  try {
    return BigInt(
      (await simulateRead(usdcSacId, "balance", [scAddr(address)])) as bigint,
    );
  } catch {
    return 0n;
  }
}

async function ensureOperatorFunded(kp: Keypair): Promise<void> {
  try {
    await horizon.loadAccount(kp.publicKey());
  } catch {
    await fetch(`${friendbotUrl}?addr=${encodeURIComponent(kp.publicKey())}`);
    await horizon.loadAccount(kp.publicKey());
  }
}

let relayChain: Promise<unknown> = Promise.resolve();

export async function relayDeposit(input: RelayInput): Promise<RelayOutput> {
  const run = relayChain.then(() => doRelayDeposit(input));
  relayChain = run.catch(() => undefined);
  return run;
}

async function doRelayDeposit(input: RelayInput): Promise<RelayOutput> {
  const payee = await resolveUsernameOnChain(input.username);
  if (!payee) throw new CctpPayeeError(input.username);

  const operator = operatorKeypair();

  const msg = parseCctpMessage(input.message);

  const intakeRaw = StrKey.decodeContract(cctpIntakeContract);
  if (!bytesEqual(msg.mintRecipient, intakeRaw)) {
    throw new CctpRelayError("Burn does not target the intake contract.");
  }

  const binding = cctpBinding(payee.note_pubkey, hexToBytes(input.nonce));
  if (!bytesEqual(msg.hookData, binding)) {
    throw new CctpRelayError("Burn is not bound to this payee.");
  }

  const amount = msg.amount * EVM_TO_STELLAR_SCALE;
  if (amount <= 0n) {
    throw new CctpRelayError("Burn amount is zero.");
  }

  await ensureOperatorFunded(operator);
  const before = await intakeUsdcBalance(cctpIntakeContract);

  await invokeAsSource(
    operator,
    cctpStellar.messageTransmitter,
    "receive_message",
    [
      scAddr(operator.publicKey()),
      scBytesHex(input.message),
      scBytesHex(input.attestation),
    ],
  );

  const minted = (await intakeUsdcBalance(cctpIntakeContract)) - before;
  if (minted !== amount) {
    throw new CctpRelayError(
      `Minted ${minted} != expected ${amount} — refusing to deposit.`,
    );
  }

  const salt = randomFieldElement();
  const ownerPkField = fromBE(payee.note_pubkey);
  const commitmentBytes = toBE32(await commitment(amount, ownerPkField, salt));
  const { proof } = await proveDeposit(
    {
      commitment: fromBE(commitmentBytes).toString(),
      amount: amount.toString(),
      ownerPk: ownerPkField.toString(),
      salt: salt.toString(),
    },
    `${process.cwd()}/public/zk`,
  );
  const { ephemeralPk, ciphertext } = encryptNote(
    payee.view_pubkey,
    amount,
    salt,
  );

  const { value, txHash } = await invokeAsSource(
    operator,
    cctpIntakeContract,
    "deposit_to_pool",
    [
      scBytes(commitmentBytes),
      scI128(amount),
      scProof(proof),
      scBytes(ephemeralPk),
      scBytes(ciphertext),
    ],
  );

  return { leafIndex: Number(value), amount: fromBaseUnits(amount), txHash };
}
