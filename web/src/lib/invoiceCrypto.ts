import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes } from "@noble/hashes/utils.js";
import { bytesToHex, hexToBytes } from "./crypto";

const utf8 = (value: string) => new TextEncoder().encode(value);

export const INVOICE_DOMAIN = "olio.invoice.v1";
export const INTENT_DOMAIN = "olio.intent.v1";
export const INVOICE_KEY_BYTES = 32;
export const MAX_INVOICE_PLAINTEXT_BYTES = 16_384;

export type InvoiceLineItem = {
  description: string;
  quantity: number;
  unitPrice: string;
};

export type InvoiceContent = {
  customer: {
    name: string;
    email: string | null;
    address: string | null;
  };
  lineItems: InvoiceLineItem[];
  notes: string | null;
  salt: string;
};

export type InvoiceCommitmentFields = {
  businessId: string;
  invoiceId: string;
  version: number;
  network: string;
  poolId: string;
  asset: string;
  amountDue: bigint;
  issuedAt: Date;
  dueAt: Date | null;
  contentCommitment: string;
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function canonicalJson(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

export function newInvoiceSalt(): string {
  return bytesToHex(randomBytes(32));
}

export function newInvoiceKey(): Uint8Array {
  return randomBytes(INVOICE_KEY_BYTES);
}

export function invoiceTotal(lineItems: InvoiceLineItem[]): bigint {
  return lineItems.reduce(
    (sum, item) => sum + BigInt(item.quantity) * BigInt(item.unitPrice),
    0n,
  );
}

function contentWithoutSalt(content: InvoiceContent): Json {
  return {
    customer: {
      name: content.customer.name,
      email: content.customer.email,
      address: content.customer.address,
    },
    lineItems: content.lineItems.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    })),
    notes: content.notes,
  };
}

export function contentCommitment(content: InvoiceContent): string {
  const salt = hexToBytes(content.salt);
  if (salt.length !== 32) throw new Error("Invoice salt must be 32 bytes.");
  return bytesToHex(
    sha256(concatBytes(utf8(canonicalJson(contentWithoutSalt(content))), salt)),
  );
}

function lengthPrefixed(parts: Uint8Array[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, part.length, false);
    chunks.push(length, part);
  }
  return concatBytes(...chunks);
}

const unixSeconds = (date: Date | null) =>
  date ? Math.floor(date.getTime() / 1000).toString() : "0";

export function invoiceCommitment(fields: InvoiceCommitmentFields): string {
  const contentBytes = hexToBytes(fields.contentCommitment);
  if (contentBytes.length !== 32)
    throw new Error("Content commitment must be 32 bytes.");
  const digest = sha256(
    lengthPrefixed([
      utf8(INVOICE_DOMAIN),
      utf8(fields.businessId),
      utf8(fields.invoiceId),
      utf8(fields.version.toString()),
      utf8(fields.network),
      utf8(fields.poolId),
      utf8(fields.asset),
      utf8(fields.amountDue.toString()),
      utf8(unixSeconds(fields.issuedAt)),
      utf8(unixSeconds(fields.dueAt)),
      contentBytes,
    ]),
  );
  digest[0] &= 0x1f;
  return bytesToHex(digest);
}

export function intentQuoteId(
  invoiceCommitmentHex: string,
  intentNonce: Uint8Array,
): Uint8Array {
  const commitmentBytes = hexToBytes(invoiceCommitmentHex);
  if (commitmentBytes.length !== 32 || intentNonce.length !== 32)
    throw new Error("Intent inputs must be 32 bytes.");
  return sha256(concatBytes(utf8(INTENT_DOMAIN), commitmentBytes, intentNonce));
}

export function encryptInvoice(
  content: InvoiceContent,
  key: Uint8Array,
): string {
  const plaintext = utf8(JSON.stringify(content));
  if (plaintext.length > MAX_INVOICE_PLAINTEXT_BYTES)
    throw new Error("Invoice details are too long.");
  const nonce = randomBytes(24);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext);
  return bytesToHex(concatBytes(nonce, ciphertext));
}

function isLineItem(value: unknown): value is InvoiceLineItem {
  const item = value as InvoiceLineItem;
  return (
    typeof item?.description === "string" &&
    Number.isInteger(item.quantity) &&
    item.quantity > 0 &&
    typeof item.unitPrice === "string" &&
    /^\d{1,20}$/.test(item.unitPrice)
  );
}

function isInvoiceContent(value: unknown): value is InvoiceContent {
  const content = value as InvoiceContent;
  const nullableString = (v: unknown) => v === null || typeof v === "string";
  return (
    typeof content?.customer?.name === "string" &&
    nullableString(content.customer.email) &&
    nullableString(content.customer.address) &&
    Array.isArray(content.lineItems) &&
    content.lineItems.every(isLineItem) &&
    nullableString(content.notes) &&
    typeof content.salt === "string" &&
    /^[0-9a-f]{64}$/.test(content.salt)
  );
}

export function decryptInvoice(
  encryptedHex: string,
  key: Uint8Array,
): InvoiceContent {
  const bytes = hexToBytes(encryptedHex);
  const plaintext = xchacha20poly1305(key, bytes.slice(0, 24)).decrypt(
    bytes.slice(24),
  );
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
  if (!isInvoiceContent(parsed))
    throw new Error("Invoice details are malformed.");
  return parsed;
}

export function wrapKeyToView(key: Uint8Array, viewPubkey: Uint8Array): string {
  const ephemeralSk = x25519.utils.randomSecretKey();
  const ephemeralPk = x25519.getPublicKey(ephemeralSk);
  const wrappingKey = sha256(x25519.getSharedSecret(ephemeralSk, viewPubkey));
  const nonce = randomBytes(24);
  const sealed = xchacha20poly1305(wrappingKey, nonce).encrypt(key);
  return bytesToHex(concatBytes(ephemeralPk, nonce, sealed));
}

export function unwrapKey(wrappedHex: string, viewSk: Uint8Array): Uint8Array {
  const bytes = hexToBytes(wrappedHex);
  const ephemeralPk = bytes.slice(0, 32);
  const nonce = bytes.slice(32, 56);
  const wrappingKey = sha256(x25519.getSharedSecret(viewSk, ephemeralPk));
  return xchacha20poly1305(wrappingKey, nonce).decrypt(bytes.slice(56));
}

export function keyToFragment(key: Uint8Array): string {
  let binary = "";
  for (const byte of key) binary += String.fromCharCode(byte);
  return `k=${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
}

export function keyFromFragment(hash: string): Uint8Array | null {
  const match = /(?:^#?|&)k=([A-Za-z0-9_-]{43})(?:&|$)/.exec(hash);
  if (!match) return null;
  const base64 = `${match[1].replaceAll("-", "+").replaceAll("_", "/")}=`;
  const binary = atob(base64);
  const key = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) key[i] = binary.charCodeAt(i);
  return key.length === INVOICE_KEY_BYTES ? key : null;
}

export function invoiceNumberLabel(number: number): string {
  return `INV-${number.toString().padStart(4, "0")}`;
}
