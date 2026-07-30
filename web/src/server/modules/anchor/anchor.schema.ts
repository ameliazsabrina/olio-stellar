import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";

export const signClientChallengeInput = z
  .object({
    transactionXdr: z.string().min(1).max(100_000),
    bridgePublicKey: z
      .string()
      .refine(
        StrKey.isValidEd25519PublicKey,
        "expected a Stellar G-account public key",
      ),
  })
  .strict();

export const signClientChallengeOutput = z
  .object({
    signedTransactionXdr: z.string().min(1),
  })
  .strict();

export type SignClientChallengeInput = z.infer<typeof signClientChallengeInput>;
export type SignClientChallengeOutput = z.infer<
  typeof signClientChallengeOutput
>;
