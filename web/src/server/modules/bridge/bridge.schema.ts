import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";

export const fundBridgeInput = z
  .object({
    bridgePublicKey: z
      .string()
      .refine(
        StrKey.isValidEd25519PublicKey,
        "expected a Stellar G-account public key",
      ),
  })
  .strict();

export const fundBridgeOutput = z
  .object({
    funded: z.boolean(),
    txHash: z.string().nullable(),
  })
  .strict();

export type FundBridgeInput = z.infer<typeof fundBridgeInput>;
export type FundBridgeOutput = z.infer<typeof fundBridgeOutput>;
