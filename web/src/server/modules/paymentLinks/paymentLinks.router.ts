import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../../trpc";
import { PaymentLinkStoreError } from "./paymentLinks.errors";
import {
  createLinkInput,
  getLinkInput,
  linkOutput,
  listByOwnerInput,
} from "./paymentLinks.schema";
import { createLink, getLink, listLinksByOwner } from "./paymentLinks.service";

function mapError(e: unknown): never {
  if (e instanceof PaymentLinkStoreError) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e.message });
  }
  throw e;
}

export const paymentLinksRouter = createTRPCRouter({
  create: publicProcedure
    .input(createLinkInput)
    .output(linkOutput)
    .mutation(({ input }) => createLink(input).catch(mapError)),

  get: publicProcedure
    .input(getLinkInput)
    .output(linkOutput.nullable())
    .query(({ input }) => getLink(input.id).catch(mapError)),

  listByOwner: publicProcedure
    .input(listByOwnerInput)
    .output(linkOutput.array())
    .query(({ input }) => listLinksByOwner(input).catch(mapError)),
});
