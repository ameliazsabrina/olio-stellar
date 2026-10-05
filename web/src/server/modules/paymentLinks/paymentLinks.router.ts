import { requireSubmission } from "../verification/verification.submission";
import { usernameByOwner } from "../usernames/usernames.service";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../../trpc";
import { mapBusinessError } from "../businesses/businesses.router";
import {
  PaymentLinkBusinessMismatchError,
  PaymentLinkSlugUnavailableError,
  PaymentLinkStoreError,
  PaymentLinkUnauthorizedError,
} from "./paymentLinks.errors";
import {
  archiveLinkInput,
  claimLinkInput,
  createLinkInput,
  createLinkResult,
  deleteLinkInput,
  getLinkInput,
  linkOutput,
  listByOwnerInput,
  resolveLinkInput,
  updateLinkInput,
} from "./paymentLinks.schema";
import {
  claimLinkForBusiness,
  createLink,
  deleteLink,
  getLink,
  listLinksByOwner,
  resolveLink,
  setLinkArchived,
  updateLink,
} from "./paymentLinks.service";

function mapError(e: unknown): never {
  if (e instanceof PaymentLinkSlugUnavailableError) {
    throw new TRPCError({ code: "CONFLICT", message: e.message });
  }
  if (e instanceof PaymentLinkStoreError) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e.message });
  }
  if (e instanceof PaymentLinkUnauthorizedError) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: e.message });
  }
  if (e instanceof PaymentLinkBusinessMismatchError) {
    throw new TRPCError({ code: "FORBIDDEN", message: e.message });
  }
  return mapBusinessError(e);
}

async function authorizeLink(
  user: string,
  input: { username?: string; id?: string },
) {
  const wallet = await requireSubmission(user);
  const username = await usernameByOwner(wallet.contractId);
  const owner =
    input.username ?? (input.id ? (await getLink(input.id))?.owner : null);
  if (!username || owner !== username)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This payment link belongs to another account.",
    });
}

export const paymentLinksRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createLinkInput)
    .output(createLinkResult)
    .mutation(async ({ ctx, input }) => {
      await authorizeLink(ctx.privyUserId, input);
      return createLink(input).catch(mapError);
    }),

  get: publicProcedure
    .input(getLinkInput)
    .output(linkOutput.nullable())
    .query(({ input }) => getLink(input.id).catch(mapError)),

  listByOwner: publicProcedure
    .input(listByOwnerInput)
    .output(linkOutput.array())
    .query(({ input }) => listLinksByOwner(input).catch(mapError)),

  resolve: publicProcedure
    .input(resolveLinkInput)
    .output(linkOutput.nullable())
    .query(({ input }) => resolveLink(input).catch(mapError)),

  update: protectedProcedure
    .input(updateLinkInput)
    .output(linkOutput)
    .mutation(async ({ ctx, input }) => {
      await authorizeLink(ctx.privyUserId, input);
      return updateLink(input).catch(mapError);
    }),

  setArchived: protectedProcedure
    .input(archiveLinkInput)
    .output(linkOutput)
    .mutation(async ({ ctx, input }) => {
      await authorizeLink(ctx.privyUserId, input);
      return setLinkArchived(input).catch(mapError);
    }),

  delete: protectedProcedure
    .input(deleteLinkInput)
    .output(z.boolean())
    .mutation(async ({ ctx, input }) => {
      await authorizeLink(ctx.privyUserId, input);
      return deleteLink(input).catch(mapError);
    }),

  claimForBusiness: protectedProcedure
    .input(claimLinkInput)
    .output(linkOutput)
    .mutation(async ({ ctx, input }) => {
      await authorizeLink(ctx.privyUserId, input);
      return claimLinkForBusiness(ctx.privyUserId, input).catch(mapError);
    }),
});
