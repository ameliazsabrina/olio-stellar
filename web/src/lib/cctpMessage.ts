// CCTP V2 message parser (hex → authorized fields); absolute byte offsets below.
// Verified against circlefin/stellar-cctp: body starts at 148, burn-body indices are relative.
//   header  version@0, sourceDomain@4, destinationDomain@8, nonce@12, sender@44,
//           recipient@76, destinationCaller@108, minFinality@140, finalityExecuted@144, body@148
//   body    version@148, burnToken@152, mintRecipient@184, amount(u256)@216,
//           messageSender@248, maxFee@280, feeExecuted@312, expirationBlock@344, hookData@376..end

const MESSAGE_BODY_INDEX = 148;
const SOURCE_DOMAIN_INDEX = 4;
const MINT_RECIPIENT_INDEX = MESSAGE_BODY_INDEX + 36; // 184
const AMOUNT_INDEX = MESSAGE_BODY_INDEX + 68; // 216
const HOOK_DATA_INDEX = MESSAGE_BODY_INDEX + 228; // 376

export type CctpMessage = {
  sourceDomain: number;
  mintRecipient: Uint8Array; // 32 bytes
  amount: bigint; // canonical 6-decimal USDC base units
  hookData: Uint8Array;
};

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error("CCTP message is not valid hex.");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function readU32BE(b: Uint8Array, at: number): number {
  return (
    (b[at] * 2 ** 24 + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3]) >>> 0
  );
}

function readUintBE(b: Uint8Array, at: number, len: number): bigint {
  let v = 0n;
  for (let i = 0; i < len; i += 1) v = (v << 8n) | BigInt(b[at + i]);
  return v;
}

export function parseCctpMessage(hex: string): CctpMessage {
  const bytes = hexToBytes(hex);
  // Must reach at least the start of hookData; hookData itself may be empty.
  if (bytes.length < HOOK_DATA_INDEX) {
    throw new Error("CCTP message is too short to be a V2 burn message.");
  }
  return {
    sourceDomain: readU32BE(bytes, SOURCE_DOMAIN_INDEX),
    mintRecipient: bytes.slice(MINT_RECIPIENT_INDEX, MINT_RECIPIENT_INDEX + 32),
    amount: readUintBE(bytes, AMOUNT_INDEX, 32),
    hookData: bytes.slice(HOOK_DATA_INDEX),
  };
}
