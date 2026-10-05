import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import {
  BusinessBindingError,
  BusinessForbiddenError,
  BusinessNotFoundError,
  BusinessStoreError,
} from "./businesses.errors";
import {
  bindAccountOutput,
  businessIdInput,
  businessOutput,
  createBusinessInput,
  updateBusinessProfileInput,
} from "./businesses.schema";
import {
  bindAccount,
  createBusiness,
  listMine,
  updateProfile,
} from "./businesses.service";

export function mapBusinessError(error: unknown): never {
  if (error instanceof BusinessNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (error instanceof BusinessForbiddenError) {
    throw new TRPCError({ code: "FORBIDDEN", message: error.message });
  }
  if (error instanceof BusinessBindingError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
    });
  }
  if (error instanceof BusinessStoreError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  throw error;
}

export const businessesRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createBusinessInput)
    .output(businessOutput)
    .mutation(({ ctx, input }) =>
      createBusiness(ctx.privyUserId, input).catch(mapBusinessError),
    ),
  mine: protectedProcedure
    .output(businessOutput.array())
    .query(({ ctx }) => listMine(ctx.privyUserId).catch(mapBusinessError)),
  updateProfile: protectedProcedure
    .input(updateBusinessProfileInput)
    .output(businessOutput)
    .mutation(({ ctx, input }) =>
      updateProfile(ctx.privyUserId, input).catch(mapBusinessError),
    ),
  bindAccount: protectedProcedure
    .input(businessIdInput)
    .output(bindAccountOutput)
    .mutation(({ ctx, input }) =>
      bindAccount(ctx.privyUserId, input.businessId).catch(mapBusinessError),
    ),
});
