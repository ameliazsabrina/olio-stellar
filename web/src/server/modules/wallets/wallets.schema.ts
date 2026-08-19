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
const hexBlob = z
  .string()
  .regex(/^[0-9a-fA-F]+$/, "expected hex")
  .refine(
    (value) => value.length > 0 && value.length % 2 === 0,
    "invalid hex blob",
  );
const kdfParams = z.object({
  m: z.number().int().positive(),
  t: z.number().int().positive(),
  p: z.number().int().positive(),
});

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

export const saveEscrowInput = z.object({
  encryptedMasterHex: hexBlob,
  masterSaltHex: hexBlob,
  kdfParams,
});

export const escrowOutput = saveEscrowInput.nullable();

export type PrivyWalletInput = z.infer<typeof privyWalletInput>;
export type SaveEscrowInput = z.infer<typeof saveEscrowInput>;
export type WalletOutput = z.infer<typeof walletOutput>;
export type EscrowOutput = z.infer<typeof escrowOutput>;
