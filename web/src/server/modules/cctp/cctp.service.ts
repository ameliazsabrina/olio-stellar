// CCTP V2 relay: turns a cross-chain USDC burn into a shielded-pool deposit.
//
// The payer (any source chain) burns USDC naming our intake **contract** as the
// mintRecipient (Circle's Stellar minter always mints to a contract address).
// Given the attested message, this relay: (1) submits receive_message as the
// operator so CCTP mints the USDC into the intake contract's balance, (2)
// encrypts a note to the payee's PUBLIC viewing key from the registry, and (3)
// calls the intake contract's admin-only deposit_to_pool, which forwards its
// balance into the pool as that note. The operator is only the tx source / fee
// payer / admin — never the mint recipient. It needs no payee secret and stores
// nothing — the deposit→payee link exists only for the duration of this call
// (preserves the Mongo mirror invariant). Replay is prevented on-chain by the
// transmitter's nonce set.

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
import {
  cctpBinding,
  cctpIntakeContract,
  cctpStellar,
  irisBaseUrl,
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
const bytesEqual = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
// USDC is 6 decimals in CCTP's canonical message, 7 on Stellar; Circle's minter
// (cctp-utils decimal_converter::to_local_amount) scales canonical→local by ×10.
const EVM_TO_STELLAR_SCALE = 10n;
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
  const url = `${irisBaseUrl}/v2/messages/${sourceDomain}?transactionHash=${encodeURIComponent(txHash)}`;
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

// --- server-signed Soroban invocation (operator is the tx source) ------------

// The operator account signs every relay tx: it is the fee payer, the
// receive_message caller, and the intake contract's admin (whose require_auth
// gates deposit_to_pool). It never holds USDC — the intake *contract* does.
function operatorKeypair(): Keypair {
  const secret = process.env.CCTP_OPERATOR_SECRET;
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

// One-time provisioning: the operator only needs to exist + hold XLM for fees
// (testnet friendbot). No USDC trustline — the intake *contract* holds the
// bridged USDC as a SAC balance, which contracts hold without a trustline.
async function ensureOperatorFunded(kp: Keypair): Promise<void> {
  try {
    await horizon.loadAccount(kp.publicKey());
  } catch {
    await fetch(`${friendbotUrl}?addr=${encodeURIComponent(kp.publicKey())}`);
    await horizon.loadAccount(kp.publicKey());
  }
}

// --- relay -------------------------------------------------------------------

// Serialize relays: receive_message + the balance-delta assertion below assume
// one relay mutates the intake contract's balance at a time.
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

  // Parse and authorize the attested burn against the resolved payee. The
  // message + attestation are public, so caller-supplied intent (username) is
  // untrusted — these checks are what bind the burn to this payee.
  const msg = parseCctpMessage(input.message);

  // (1) The burn must actually mint to *our* intake contract. Circle's Stellar
  // minter treats mintRecipient as a 32-byte contract id, so compare against the
  // decoded C-address, not an ed25519 account key.
  const intakeRaw = StrKey.decodeContract(cctpIntakeContract);
  if (!bytesEqual(msg.mintRecipient, intakeRaw)) {
    throw new CctpRelayError("Burn does not target the intake contract.");
  }

  // (2) hookData must equal keccak256(payee.note_pubkey ‖ nonce). A front-runner
  // relaying a victim's burn under their own username fails here — they cannot
  // forge a nonce that maps their note key to the message's fixed commitment.
  const binding = cctpBinding(payee.note_pubkey, hexToBytes(input.nonce));
  if (!bytesEqual(msg.hookData, binding)) {
    throw new CctpRelayError("Burn is not bound to this payee.");
  }

  // (3) Amount comes from the signed message, not a live balance read: canonical
  // 6-dec → Stellar 7-dec local units.
  const amount = msg.amount * EVM_TO_STELLAR_SCALE;
  if (amount <= 0n) {
    throw new CctpRelayError("Burn amount is zero.");
  }

  await ensureOperatorFunded(operator);
  const before = await intakeUsdcBalance(cctpIntakeContract);

  // Mint the bridged USDC into the intake contract. The operator is only the
  // caller / fee payer; the burn's destinationCaller=0 lets any caller relay.
  // Reverts if the message was already used.
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

  // Fail-safe: the mint must credit exactly the message amount to the intake
  // contract. A mismatch means stranded balance or concurrent movement — reject
  // rather than mis-attribute.
  const minted = (await intakeUsdcBalance(cctpIntakeContract)) - before;
  if (minted !== amount) {
    throw new CctpRelayError(
      `Minted ${minted} != expected ${amount} — refusing to deposit.`,
    );
  }

  // Build a note owned by the payee (public note key) and encrypted to their
  // public viewing key, then have the intake contract forward its balance into
  // the pool as that note. The operator signs, satisfying the contract's
  // admin.require_auth(); the pool pull is `from = intake contract`.
  const salt = randomFieldElement();
  const ownerPkField = fromBE(payee.note_pubkey);
  const commitmentBytes = toBE32(await commitment(amount, ownerPkField, salt));
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
      scBytes(ephemeralPk),
      scBytes(ciphertext),
    ],
  );

  return { leafIndex: Number(value), amount: fromBaseUnits(amount), txHash };
}
