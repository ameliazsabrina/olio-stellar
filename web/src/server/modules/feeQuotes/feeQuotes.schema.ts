import { z } from "zod";

const amount = z.string().regex(/^\d{1,20}$/, "expected base-unit integer");
const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_-]{3,32}$/);
const address = z.string().trim().min(2).max(64);
const bytes32 = z.string().regex(/^[0-9a-fA-F]{64}$/, "expected 32-byte hex");

export const previewInput = z
  .object({
    username,
    paymentAmount: amount,
    channel: z.enum(["direct", "cctp"]),
  })
  .strict();

export const previewOutput = z
  .object({
    paymentAmount: amount,
    feeBps: z.union([z.literal(200), z.literal(500)]),
    feeAmount: amount,
    totalAmount: amount,
    policyVersion: z.literal(2),
  })
  .strict();

const issueCommon = {
  username,
  paymentAmount: amount,
  depositor: address,
  commitment: bytes32,
  salt: bytes32,
};

export const issueInput = z.discriminatedUnion("channel", [
  z.object({ ...issueCommon, channel: z.literal("direct") }).strict(),
  z
    .object({
      ...issueCommon,
      channel: z.literal("cctp"),
      sourceDomain: z.number().int().min(0).max(0xffff_ffff),
      sourcePayer: bytes32,
    })
    .strict(),
]);

export const serializedQuote = z
  .object({
    formatVersion: z.literal(1),
    policyVersion: z.literal(2),
    quoteId: bytes32,
    networkId: bytes32,
    pool: address,
    depositor: address,
    commitment: bytes32,
    paymentAmount: amount,
    feeBps: z.union([z.literal(200), z.literal(500)]),
    feeAmount: amount,
    totalAmount: amount,
    channel: z.enum(["direct", "cctp"]),
    sourceDomain: z.number().int().min(0).max(0xffff_ffff),
    sourcePayer: bytes32,
    issuedAt: amount,
    expiresAt: amount,
  })
  .strict();

export const issueOutput = z
  .object({
    quote: serializedQuote,
    signature: z.string().regex(/^[0-9a-fA-F]{128}$/),
  })
  .strict();

export type PreviewInput = z.infer<typeof previewInput>;
export type PreviewOutput = z.infer<typeof previewOutput>;
export type IssueInput = z.infer<typeof issueInput>;
export type IssueOutput = z.infer<typeof issueOutput>;
