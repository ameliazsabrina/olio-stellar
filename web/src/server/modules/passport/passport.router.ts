import { TRPCError } from "@trpc/server";
import { rateLimit } from "../../lib/rateLimit";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../../trpc";
import { businessIdInput } from "../businesses/businesses.schema";
import { mapVerificationError } from "../verification/verification.router";
import {
  identityPreviewOutput,
  publicIdentityInput,
  publicIdentityOutput,
  setVisibilityInput,
} from "./passport.schema";
import {
  identityPreview,
  publicIdentity,
  setVisibility,
} from "./passport.service";

export const passportRouter = createTRPCRouter({
  identity: protectedProcedure
    .input(businessIdInput)
    .output(identityPreviewOutput)
    .query(({ ctx, input }) =>
      identityPreview(ctx.privyUserId, input.businessId).catch(
        mapVerificationError,
      ),
    ),
  setVisibility: protectedProcedure
    .input(setVisibilityInput)
    .output(identityPreviewOutput)
    .mutation(({ ctx, input }) =>
      setVisibility(ctx.privyUserId, input.businessId, input.published).catch(
        mapVerificationError,
      ),
    ),
  publicIdentity: publicProcedure
    .input(publicIdentityInput)
    .output(publicIdentityOutput)
    .query(({ ctx, input }) => {
      const { ok, retryAfterMs } = rateLimit(
        `passport:public:${ctx.ip ?? "unknown"}`,
        120,
        60_000,
      );
      if (!ok) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many requests. Retry in ${Math.ceil(retryAfterMs / 1000)}s.`,
        });
      }
      return publicIdentity(input.publicId);
    }),
});
