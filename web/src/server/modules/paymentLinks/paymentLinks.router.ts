import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../../trpc";
import {
  PaymentLinkSlugUnavailableError,
  PaymentLinkStoreError,
  PaymentLinkUnauthorizedError,
} from "./paymentLinks.errors";
import {
  archiveLinkInput,
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
  throw e;
}

export const paymentLinksRouter = createTRPCRouter({
  create: publicProcedure
    .input(createLinkInput)
    .output(createLinkResult)
    .mutation(({ input }) => createLink(input).catch(mapError)),

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

  update: publicProcedure
    .input(updateLinkInput)
    .output(linkOutput)
    .mutation(({ input }) => updateLink(input).catch(mapError)),

  setArchived: publicProcedure
    .input(archiveLinkInput)
    .output(linkOutput)
    .mutation(({ input }) => setLinkArchived(input).catch(mapError)),

  delete: publicProcedure
    .input(deleteLinkInput)
    .output(z.boolean())
    .mutation(({ input }) => deleteLink(input).catch(mapError)),
});
