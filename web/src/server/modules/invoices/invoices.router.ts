import { TRPCError } from "@trpc/server";
import { rateLimit } from "../../lib/rateLimit";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../../trpc";
import { mapBusinessError } from "../businesses/businesses.router";
import {
  InvoiceConfigError,
  InvoiceConflictError,
  InvoiceNotFoundError,
  InvoiceStateError,
} from "./invoices.errors";
import {
  createInvoiceInput,
  invoiceDetailOutput,
  invoiceIdInput,
  invoiceListOutput,
  invoiceSummaryOutput,
  issueInvoiceInput,
  listInvoicesInput,
  publicInvoiceOutput,
  reviseInvoiceInput,
} from "./invoices.schema";
import {
  cancelInvoice,
  createInvoice,
  eraseInvoice,
  getInvoice,
  issueInvoice,
  listInvoices,
  publicInvoiceView,
  reviseInvoice,
} from "./invoices.service";

export function mapInvoiceError(error: unknown): never {
  if (error instanceof InvoiceNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (error instanceof InvoiceStateError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
    });
  }
  if (error instanceof InvoiceConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error instanceof InvoiceConfigError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
    });
  }
  return mapBusinessError(error);
}

export const invoicesRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createInvoiceInput)
    .output(invoiceSummaryOutput)
    .mutation(({ ctx, input }) =>
      createInvoice(ctx.privyUserId, input).catch(mapInvoiceError),
    ),
  revise: protectedProcedure
    .input(reviseInvoiceInput)
    .output(invoiceSummaryOutput)
    .mutation(({ ctx, input }) =>
      reviseInvoice(ctx.privyUserId, input).catch(mapInvoiceError),
    ),
  issue: protectedProcedure
    .input(issueInvoiceInput)
    .output(invoiceSummaryOutput)
    .mutation(({ ctx, input }) =>
      issueInvoice(ctx.privyUserId, input).catch(mapInvoiceError),
    ),
  cancel: protectedProcedure
    .input(invoiceIdInput)
    .output(invoiceSummaryOutput)
    .mutation(({ ctx, input }) =>
      cancelInvoice(ctx.privyUserId, input.invoiceId).catch(mapInvoiceError),
    ),
  erase: protectedProcedure
    .input(invoiceIdInput)
    .output(invoiceSummaryOutput)
    .mutation(({ ctx, input }) =>
      eraseInvoice(ctx.privyUserId, input.invoiceId).catch(mapInvoiceError),
    ),
  list: protectedProcedure
    .input(listInvoicesInput)
    .output(invoiceListOutput)
    .query(({ ctx, input }) =>
      listInvoices(ctx.privyUserId, input).catch(mapInvoiceError),
    ),
  get: protectedProcedure
    .input(invoiceIdInput)
    .output(invoiceDetailOutput)
    .query(({ ctx, input }) =>
      getInvoice(ctx.privyUserId, input.invoiceId).catch(mapInvoiceError),
    ),
  publicView: publicProcedure
    .input(invoiceIdInput)
    .output(publicInvoiceOutput)
    .query(({ ctx, input }) => {
      const { ok, retryAfterMs } = rateLimit(
        `invoices:public:${ctx.ip ?? "unknown"}`,
        120,
        60_000,
      );
      if (!ok) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many requests. Retry in ${Math.ceil(retryAfterMs / 1000)}s.`,
        });
      }
      return publicInvoiceView(input.invoiceId).catch(mapInvoiceError);
    }),
});
