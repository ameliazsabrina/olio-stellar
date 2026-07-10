import { z } from "zod";

const contractId = z.string().regex(/^C[A-Z2-7]{55}$/, "invalid contract id");
const credentialId = z.string().min(1); // base64url WebAuthn credential id
const hexBytes = z.string().regex(/^[0-9a-fA-F]+$/, "expected hex");

// Relay the smart-wallet deploy: a complete signed transaction envelope (XDR).
export const deployInput = z.object({ xdr: z.string().min(1) });

// Relay a func+auth invocation whose auth entries were signed by the passkey.
export const relayInput = z.object({
  func: z.string().min(1),
  auth: z.array(z.string()).default([]),
});

// Record a freshly-deployed smart wallet in the off-chain mirror. The passkey
// public key is optional (recoverable on-chain via getSigners); credentialId ->
// contractId is the mapping reconnect needs.
export const saveWalletInput = z.object({
  contractId,
  credentialId,
  secp256r1PubKeyHex: hexBytes.optional(),
});

export const walletByCredentialInput = z.object({ credentialId });

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
