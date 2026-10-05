import { sha256 } from "@noble/hashes/sha2.js";
import {
  Address,
  Keypair,
  nativeToScVal,
  StrKey,
  xdr,
} from "@stellar/stellar-sdk";
import { bytesToHex, hexToBytes } from "./crypto";
import type {
  FeeBps,
  OLIO_FEE_POLICY_VERSION,
  OLIO_FEE_QUOTE_FORMAT_VERSION,
} from "./fees";

const PAYMENT_DOMAIN = new TextEncoder().encode("OLIO_FEE_PAYMENT_V1");
const AUTH_DOMAIN = new TextEncoder().encode("OLIO_FEE_AUTH_V1");

export type FeeChannel = "direct" | "cctp";

export type SignedFeeQuote = {
  formatVersion: typeof OLIO_FEE_QUOTE_FORMAT_VERSION;
  policyVersion: typeof OLIO_FEE_POLICY_VERSION;
  quoteId: Uint8Array;
  networkId: Uint8Array;
  pool: string;
  depositor: string;
  commitment: Uint8Array;
  paymentAmount: bigint;
  feeBps: FeeBps;
  feeAmount: bigint;
  totalAmount: bigint;
  channel: FeeChannel;
  sourceDomain: number;
  sourcePayer: Uint8Array;
  issuedAt: bigint;
  expiresAt: bigint;
};

export type FeeQuoteEnvelope = {
  quote: SignedFeeQuote;
  signature: Uint8Array;
};

export type SerializedFeeQuoteEnvelope = {
  quote: {
    formatVersion: typeof OLIO_FEE_QUOTE_FORMAT_VERSION;
    policyVersion: typeof OLIO_FEE_POLICY_VERSION;
    quoteId: string;
    networkId: string;
    pool: string;
    depositor: string;
    commitment: string;
    paymentAmount: string;
    feeBps: FeeBps;
    feeAmount: string;
    totalAmount: string;
    channel: FeeChannel;
    sourceDomain: number;
    sourcePayer: string;
    issuedAt: string;
    expiresAt: string;
  };
  signature: string;
};

const scSymbol = (value: string) => nativeToScVal(value, { type: "symbol" });
const scBytes = (value: Uint8Array) =>
  xdr.ScVal.scvBytes(value as unknown as Buffer);
const scU32 = (value: number) => nativeToScVal(value, { type: "u32" });
const scU64 = (value: bigint) => nativeToScVal(value, { type: "u64" });
const scI128 = (value: bigint) => nativeToScVal(value, { type: "i128" });

function mapEntry(key: string, value: xdr.ScVal): xdr.ScMapEntry {
  return new xdr.ScMapEntry({ key: scSymbol(key), val: value });
}

function channelScVal(channel: FeeChannel): xdr.ScVal {
  if (channel !== "direct" && channel !== "cctp") {
    throw new Error("Unsupported fee channel.");
  }
  const variant = channel === "direct" ? "Direct" : "Cctp";
  return xdr.ScVal.scvVec([scSymbol(variant)]);
}

/** Contracttype structs are encoded as symbol-keyed maps in lexical key order. */
export function paymentBindingScVal(quote: SignedFeeQuote): xdr.ScVal {
  return xdr.ScVal.scvMap([
    mapEntry("channel", channelScVal(quote.channel)),
    mapEntry("commitment", scBytes(quote.commitment)),
    mapEntry("depositor", new Address(quote.depositor).toScVal()),
    mapEntry("fee_amount", scI128(quote.feeAmount)),
    mapEntry("fee_bps", scU32(quote.feeBps)),
    mapEntry("format_version", scU32(quote.formatVersion)),
    mapEntry("network_id", scBytes(quote.networkId)),
    mapEntry("payment_amount", scI128(quote.paymentAmount)),
    mapEntry("policy_version", scU32(quote.policyVersion)),
    mapEntry("pool", new Address(quote.pool).toScVal()),
    mapEntry("quote_id", scBytes(quote.quoteId)),
    mapEntry("source_domain", scU32(quote.sourceDomain)),
    mapEntry("source_payer", scBytes(quote.sourcePayer)),
    mapEntry("total_amount", scI128(quote.totalAmount)),
  ]);
}

export function feeQuoteScVal(quote: SignedFeeQuote): xdr.ScVal {
  return xdr.ScVal.scvMap([
    mapEntry("channel", channelScVal(quote.channel)),
    mapEntry("commitment", scBytes(quote.commitment)),
    mapEntry("depositor", new Address(quote.depositor).toScVal()),
    mapEntry("expires_at", scU64(quote.expiresAt)),
    mapEntry("fee_amount", scI128(quote.feeAmount)),
    mapEntry("fee_bps", scU32(quote.feeBps)),
    mapEntry("format_version", scU32(quote.formatVersion)),
    mapEntry("issued_at", scU64(quote.issuedAt)),
    mapEntry("network_id", scBytes(quote.networkId)),
    mapEntry("payment_amount", scI128(quote.paymentAmount)),
    mapEntry("policy_version", scU32(quote.policyVersion)),
    mapEntry("pool", new Address(quote.pool).toScVal()),
    mapEntry("quote_id", scBytes(quote.quoteId)),
    mapEntry("source_domain", scU32(quote.sourceDomain)),
    mapEntry("source_payer", scBytes(quote.sourcePayer)),
    mapEntry("total_amount", scI128(quote.totalAmount)),
  ]);
}

export function paymentBindingBytes(quote: SignedFeeQuote): Uint8Array {
  return new Uint8Array(
    xdr.ScVal.scvVec([
      scBytes(PAYMENT_DOMAIN),
      paymentBindingScVal(quote),
    ]).toXDR(),
  );
}

export function paymentBindingDigest(quote: SignedFeeQuote): Uint8Array {
  return sha256(paymentBindingBytes(quote));
}

export function authorizationBytes(quote: SignedFeeQuote): Uint8Array {
  return new Uint8Array(
    xdr.ScVal.scvVec([
      scBytes(AUTH_DOMAIN),
      scBytes(paymentBindingDigest(quote)),
      scU64(quote.issuedAt),
      scU64(quote.expiresAt),
    ]).toXDR(),
  );
}

export function authorizationDigest(quote: SignedFeeQuote): Uint8Array {
  return sha256(authorizationBytes(quote));
}

export function stellarNetworkId(passphrase: string): Uint8Array {
  return sha256(new TextEncoder().encode(passphrase));
}

export function signFeeQuote(
  quote: SignedFeeQuote,
  signer: Keypair,
): Uint8Array {
  return new Uint8Array(signer.sign(Buffer.from(authorizationDigest(quote))));
}

export function verifyFeeQuoteSignature(
  quote: SignedFeeQuote,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  if (signature.length !== 64 || publicKey.length !== 32) return false;
  const strkey = StrKey.encodeEd25519PublicKey(Buffer.from(publicKey));
  return Keypair.fromPublicKey(strkey).verify(
    Buffer.from(authorizationDigest(quote)),
    Buffer.from(signature),
  );
}

export function serializeFeeQuoteEnvelope(
  envelope: FeeQuoteEnvelope,
): SerializedFeeQuoteEnvelope {
  const { quote } = envelope;
  return {
    quote: {
      ...quote,
      quoteId: bytesToHex(quote.quoteId),
      networkId: bytesToHex(quote.networkId),
      commitment: bytesToHex(quote.commitment),
      paymentAmount: quote.paymentAmount.toString(),
      feeAmount: quote.feeAmount.toString(),
      totalAmount: quote.totalAmount.toString(),
      sourcePayer: bytesToHex(quote.sourcePayer),
      issuedAt: quote.issuedAt.toString(),
      expiresAt: quote.expiresAt.toString(),
    },
    signature: bytesToHex(envelope.signature),
  };
}

export function deserializeFeeQuoteEnvelope(
  envelope: SerializedFeeQuoteEnvelope,
): FeeQuoteEnvelope {
  return {
    quote: {
      ...envelope.quote,
      quoteId: hexToBytes(envelope.quote.quoteId),
      networkId: hexToBytes(envelope.quote.networkId),
      commitment: hexToBytes(envelope.quote.commitment),
      paymentAmount: BigInt(envelope.quote.paymentAmount),
      feeAmount: BigInt(envelope.quote.feeAmount),
      totalAmount: BigInt(envelope.quote.totalAmount),
      sourcePayer: hexToBytes(envelope.quote.sourcePayer),
      issuedAt: BigInt(envelope.quote.issuedAt),
      expiresAt: BigInt(envelope.quote.expiresAt),
    },
    signature: hexToBytes(envelope.signature),
  };
}
