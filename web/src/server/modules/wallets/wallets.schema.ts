import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";

export const stellarPublicKey = z
  .string()
  .refine(
    (value) => StrKey.isValidEd25519PublicKey(value),
    "invalid Stellar public key",
  );
export const contractId = z
  .string()
  .refine(
    (value) => StrKey.isValidContract(value),
    "invalid Olio contract address",
  );
const walletId = z.string().min(1).max(256);
const exactHexBytes = (bytes: number, label: string) =>
  z
    .string()
    .length(bytes * 2, `${label} must be ${bytes} bytes`)
    .regex(/^[0-9a-fA-F]+$/, `${label} must be hexadecimal`);

// v1 is nonce(12) || encrypted master(32) || AES-GCM tag(16).
const encryptedMasterHex = exactHexBytes(60, "encrypted master");
const masterSaltHex = exactHexBytes(16, "master salt");
const kdfParams = z
  .object({
    m: z.number().int().min(8).max(262_144),
    t: z.number().int().min(1).max(10),
    p: z.number().int().min(1).max(16),
  })
  .strict();
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const expectedRevision = revision.max(Number.MAX_SAFE_INTEGER - 1);

export const privyWalletInput = z.object({
  privyWalletId: walletId,
  privyWalletAddress: stellarPublicKey,
});

export const walletOutput = z.object({
  contractId,
  privyWalletId: walletId,
  privyWalletAddress: stellarPublicKey,
});
export const optionalWalletOutput = walletOutput.nullable();

export const saveEscrowInput = z
  .object({ encryptedMasterHex, masterSaltHex, kdfParams })
  .strict();

export const escrowOutput = saveEscrowInput.extend({ revision }).nullable();
export const rotateEscrowInput = z
  .object({ expectedRevision, escrow: saveEscrowInput })
  .strict();
export const rotateEscrowOutput = z.object({ revision }).strict();

export type PrivyWalletInput = z.infer<typeof privyWalletInput>;
export type SaveEscrowInput = z.infer<typeof saveEscrowInput>;
export type RotateEscrowInput = z.infer<typeof rotateEscrowInput>;
export type RotateEscrowOutput = z.infer<typeof rotateEscrowOutput>;
export type WalletOutput = z.infer<typeof walletOutput>;
export type EscrowOutput = z.infer<typeof escrowOutput>;
