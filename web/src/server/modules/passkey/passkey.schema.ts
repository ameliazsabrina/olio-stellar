import { z } from "zod";

const contractId = z.string().regex(/^C[A-Z2-7]{55}$/, "invalid contract id");
const credentialId = z.string().min(1); // base64url WebAuthn credential id
const hexBytes = z.string().regex(/^[0-9a-fA-F]+$/, "expected hex");
const hexBlob = hexBytes
  .refine((h) => h.length % 2 === 0, "odd-length hex")
  .refine((h) => h.length > 0, "empty");
const kdfParams = z.object({
  m: z.number().int().positive(),
  t: z.number().int().positive(),
  p: z.number().int().positive(),
});

export const deployInput = z.object({ xdr: z.string().min(1) });

export const relayInput = z.object({
  func: z.string().min(1),
  auth: z.array(z.string()).default([]),
});

export const saveWalletInput = z.object({
  contractId,
  credentialId,
  secp256r1PubKeyHex: hexBytes.optional(),
});

export const walletByCredentialInput = z.object({ credentialId });

export const saveEscrowInput = z.object({
  contractId,
  credentialId,
  encryptedMasterHex: hexBlob,
  masterSaltHex: hexBlob,
  kdfParams,
});

export const getEscrowInput = z.object({ credentialId });

export const escrowOutput = z
  .object({
    encryptedMasterHex: z.string(),
    masterSaltHex: z.string(),
    kdfParams,
  })
  .nullable();

export const relayResultOutput = z.object({
  hash: z.string(),
  status: z.string().nullable(),
});

export const walletOutput = z
  .object({ contractId: z.string(), credentialId: z.string() })
  .nullable();

export type DeployInput = z.infer<typeof deployInput>;
export type RelayInput = z.infer<typeof relayInput>;
export type SaveWalletInput = z.infer<typeof saveWalletInput>;
export type WalletOutput = z.infer<typeof walletOutput>;
export type SaveEscrowInput = z.infer<typeof saveEscrowInput>;
export type EscrowOutput = z.infer<typeof escrowOutput>;
