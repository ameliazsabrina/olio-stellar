import { z } from "zod";

export const relayInput = z.object({
  func: z.string().min(1),
  auth: z.array(z.string()).default([]),
});

export const relayResultOutput = z.object({
  hash: z.string().min(1),
  status: z.string().nullable(),
});
