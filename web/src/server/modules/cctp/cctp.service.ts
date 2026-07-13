// CCTP V2 relay: turns a cross-chain USDC burn into a shielded-pool deposit.
//
// The payer (any source chain) burns USDC naming our intake account as the
// mintRecipient. Given the attested message, this relay: (1) submits
// receive_message so CCTP mints the USDC to intake, (2) encrypts a note to the
// payee's PUBLIC viewing key from the registry, and (3) deposits into the pool
// from intake. It needs no payee secret and stores nothing — the deposit→payee
// link exists only for the duration of this call (preserves the Mongo mirror
// invariant). Replay is prevented on-chain by the transmitter's nonce set.

import "server-only";
import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  nativeToScVal,
  Operation,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { cctpIntakeAddress, cctpStellar, irisBaseUrl } from "../../../lib/cctp";
import {
  commitment,
  encryptNote,
  fromBaseUnits,
  fromBE,
  randomFieldElement,
  toBE32,
} from "../../../lib/crypto";
import {
  networkPassphrase,
  poolId,
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

const usdcIssuer = process.env.NEXT_PUBLIC_USDC_ISSUER || "";
const horizonUrl =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ||
  "https://horizon-testnet.stellar.org";
const friendbotUrl =
  process.env.NEXT_PUBLIC_FRIENDBOT_URL || "https://friendbot.stellar.org";
const horizon = new Horizon.Server(horizonUrl, {
  allowHttp: horizonUrl.startsWith("http://"),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stripHex = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
const scAddr = (s: string) => new Address(s).toScVal();
const scBytes = (b: Uint8Array) => xdr.ScVal.scvBytes(b as unknown as Buffer);
const scBytesHex = (h: string) =>
  xdr.ScVal.scvBytes(Buffer.from(stripHex(h), "hex"));
const scI128 = (v: bigint) => nativeToScVal(v, { type: "i128" });

// --- Circle Iris attestation -------------------------------------------------

export async function fetchAttestation(
  sourceDomain: number,
  txHash: string,
): Promise<AttestationOutput> {
  const url = `${irisBaseUrl}/v2/messages/${sourceDomain}?transactionHash=${txHash}`;
  const apiKey = process.env.CIRCLE_API_KEY;
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

// --- server-signed Soroban invocation (intake is the tx source) --------------

function intakeKeypair(): Keypair {
  const secret = process.env.CCTP_INTAKE_SECRET;
  if (!secret) {
    throw new CctpConfigError("CCTP_INTAKE_SECRET is not configured.");
  }
  const kp = Keypair.fromSecret(secret);
  if (cctpIntakeAddress && kp.publicKey() !== cctpIntakeAddress) {
    throw new CctpConfigError(
      "CCTP_INTAKE_SECRET does not match NEXT_PUBLIC_CCTP_INTAKE_ADDRESS.",
    );
  }
  return kp;
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

// One-time provisioning: testnet friendbot + a USDC trustline so the SAC mint
// can credit the classic balance the pool deposit later pulls.
async function ensureIntakeProvisioned(kp: Keypair): Promise<void> {
  let account: Awaited<ReturnType<typeof horizon.loadAccount>> | null = null;
  try {
    account = await horizon.loadAccount(kp.publicKey());
  } catch {
    await fetch(`${friendbotUrl}?addr=${encodeURIComponent(kp.publicKey())}`);
    account = await horizon.loadAccount(kp.publicKey());
  }
  const asset = new Asset("USDC", usdcIssuer);
  const hasTrustline = account.balances.some(
    (b) =>
      "asset_code" in b &&
      b.asset_code === asset.code &&
      b.asset_issuer === asset.issuer,
  );
  if (hasTrustline) return;
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(120)
    .build();
  tx.sign(kp);
  await horizon.submitTransaction(tx);
}

// --- relay -------------------------------------------------------------------

// Serialize relays: the deposit amount is read as the intake balance delta
// around receive_message, which is only correct if one relay runs at a time.
let relayChain: Promise<unknown> = Promise.resolve();

export async function relayDeposit(input: RelayInput): Promise<RelayOutput> {
  const run = relayChain.then(() => doRelayDeposit(input));
  relayChain = run.catch(() => undefined);
  return run;
}

async function doRelayDeposit(input: RelayInput): Promise<RelayOutput> {
  const payee = await resolveUsernameOnChain(input.username);
  if (!payee) throw new CctpPayeeError(input.username);

  const kp = intakeKeypair();
  await ensureIntakeProvisioned(kp);

  const before = await intakeUsdcBalance(kp.publicKey());

  // Mint the bridged USDC to intake. Reverts if the message was already used.
  await invokeAsSource(kp, cctpStellar.messageTransmitter, "receive_message", [
    scAddr(kp.publicKey()),
    scBytesHex(input.message),
    scBytesHex(input.attestation),
  ]);

  const after = await intakeUsdcBalance(kp.publicKey());
  const amount = after - before;
  if (amount <= 0n) {
    throw new CctpRelayError(
      "No USDC was minted to intake — check the mintRecipient and asset.",
    );
  }

  // Build a note owned by the payee (public note key) and encrypted to their
  // public viewing key, then deposit from intake.
  const salt = randomFieldElement();
  const ownerPkField = fromBE(payee.note_pubkey);
  const commitmentBytes = toBE32(await commitment(amount, ownerPkField, salt));
  const { ephemeralPk, ciphertext } = encryptNote(
    payee.view_pubkey,
    amount,
    salt,
  );

  const { value, txHash } = await invokeAsSource(kp, poolId, "deposit", [
    scAddr(kp.publicKey()),
    scBytes(commitmentBytes),
    scI128(amount),
    scBytes(ephemeralPk),
    scBytes(ciphertext),
  ]);

  return { leafIndex: Number(value), amount: fromBaseUnits(amount), txHash };
}
