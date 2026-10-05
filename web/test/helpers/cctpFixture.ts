import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { cctpBinding, cctpStellar, EVM_SOURCES } from "../../src/lib/cctp";
import { commitment, toBE32 } from "../../src/lib/crypto";
import { type SignedFeeQuote, serializeFeeQuoteEnvelope, signFeeQuote, stellarNetworkId } from "../../src/lib/fee-quote";
export const fixturePool = StrKey.encodeContract(Buffer.alloc(32, 9));
export const fixtureIntake = StrKey.encodeContract(Buffer.alloc(32, 8));
export const fixtureOwner = StrKey.encodeContract(Buffer.alloc(32, 6));
export const fixtureSigner = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
export const fixtureNetwork = "Test SDF Network ; September 2015";
export async function cctpFixture() {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const quote: SignedFeeQuote = { formatVersion: 1, policyVersion: 2, quoteId: new Uint8Array(32).fill(1), networkId: stellarNetworkId(fixtureNetwork), pool: fixturePool, depositor: fixtureIntake,
    commitment: toBE32(await commitment(1_000_000_000n, 11n, 13n)), paymentAmount: 1_000_000_000n, feeBps: 200, feeAmount: 20_000_000n, totalAmount: 1_020_000_000n, channel: "cctp", sourceDomain: 0,
    sourcePayer: new Uint8Array([...new Uint8Array(12), ...new Uint8Array(20).fill(17)]), issuedAt: now - 60n, expiresAt: now + 3600n };
  const envelope = serializeFeeQuoteEnvelope({ quote, signature: signFeeQuote(quote, fixtureSigner) });
  return { quote, envelope, salt: Buffer.from(toBE32(13n)).toString("hex"), hash: `0x${"ab".repeat(32)}`, message: fixtureMessage(quote) };
}
export function fixtureMessage(quote: SignedFeeQuote) {
  const buffer = Buffer.alloc(408);
  buffer.writeUInt32BE(1, 0); buffer.writeUInt32BE(quote.sourceDomain, 4); buffer.writeUInt32BE(27, 8);
  buffer.fill(42, 12, 44); Buffer.from(EVM_SOURCES[quote.sourceDomain].tokenMessenger.slice(2).padStart(64, "0"), "hex").copy(buffer, 44);
  Buffer.from(StrKey.decodeContract(cctpStellar.tokenMessengerMinter)).copy(buffer, 76);
  buffer.writeUInt32BE(2000, 140); buffer.writeUInt32BE(2000, 144); buffer.writeUInt32BE(1, 148);
  Buffer.from(EVM_SOURCES[quote.sourceDomain].usdc.slice(2).padStart(64, "0"), "hex").copy(buffer, 152);
  Buffer.from(StrKey.decodeContract(fixtureIntake)).copy(buffer, 184);
  Buffer.from(toBE32(quote.totalAmount / 10n)).copy(buffer, 216);
  Buffer.from(quote.sourcePayer).copy(buffer, 248); Buffer.from(cctpBinding(quote)).copy(buffer, 376);
  return `0x${buffer.toString("hex")}`;
}
