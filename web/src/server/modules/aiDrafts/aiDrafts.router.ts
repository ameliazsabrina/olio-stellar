import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { draftInput, generateDraft } from "./aiDrafts.service";

// Bound concurrent inference per app process; this prototype is disabled by default.
let busy = false;
export const aiDraftsRouter = createTRPCRouter({
  generate: protectedProcedure.input(draftInput).mutation(async ({ input }) => {
    if (busy)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "AI is busy. Try again shortly.",
      });
    busy = true;
    try {
      return await generateDraft(input.text);
    } catch {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message:
          "AI drafting is unavailable. You can still fill out the link manually.",
      });
    } finally {
      busy = false;
    }
  }),
});
