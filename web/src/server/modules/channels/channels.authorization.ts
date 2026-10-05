import "server-only";
import { Address, Keypair, scValToNative, xdr } from "@stellar/stellar-sdk";
import { TRPCError } from "@trpc/server";
import { getServerEnv } from "../../../env.server";
import {
  poolId,
  registryId,
  usdcSacId,
  networkPassphrase,
} from "../../../lib/stellar";
import {
  feeQuoteScVal,
  stellarNetworkId,
  verifyFeeQuoteSignature,
  type SignedFeeQuote,
} from "../../../lib/fee-quote";
import { currentWallet } from "../wallets/wallets.service";
import { requireSubmission } from "../verification/verification.submission";
const forbidden = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message: "Unsupported or unauthorized relay operation.",
  });
export async function authorizeRelay(func: string, user: string | null) {
  let call: xdr.InvokeContractArgs;
  try {
    call = xdr.HostFunction.fromXDR(func, "base64").invokeContract();
  } catch {
    throw forbidden();
  }
  const contract = Address.fromScAddress(call.contractAddress()).toString();
  const operation = call.functionName().toString();
  const args = call.args();
  const wallet = user ? await currentWallet(user) : null;
  if (contract === poolId && operation === "deposit") {
    // Public payers may relay only a precisely bound, server-signed deposit.
    try {
      if (args.length !== 8) throw forbidden();
      const q = scValToNative(args[3]);
      const quote: SignedFeeQuote = {
        formatVersion: q.format_version,
        policyVersion: q.policy_version,
        quoteId: q.quote_id,
        networkId: q.network_id,
        pool: q.pool,
        depositor: q.depositor,
        commitment: q.commitment,
        paymentAmount: q.payment_amount,
        feeBps: q.fee_bps,
        feeAmount: q.fee_amount,
        totalAmount: q.total_amount,
        channel: q.channel[0] === "Direct" ? "direct" : "cctp",
        sourceDomain: q.source_domain,
        sourcePayer: q.source_payer,
        issuedAt: q.issued_at,
        expiresAt: q.expires_at,
      };
      const secret = getServerEnv().FEE_QUOTE_SIGNING_SECRET;
      if (
        !secret ||
        quote.channel !== "direct" ||
        quote.pool !== poolId ||
        quote.depositor !== scValToNative(args[0]) ||
        quote.paymentAmount !== scValToNative(args[2]) ||
        !Buffer.from(quote.commitment).equals(
          Buffer.from(scValToNative(args[1])),
        ) ||
        !Buffer.from(quote.networkId).equals(
          Buffer.from(stellarNetworkId(networkPassphrase)),
        ) ||
        quote.expiresAt <= BigInt(Math.floor(Date.now() / 1000)) ||
        !feeQuoteScVal(quote).toXDR().equals(args[3].toXDR()) ||
        !verifyFeeQuoteSignature(
          quote,
          scValToNative(args[4]),
          Keypair.fromSecret(secret).rawPublicKey(),
        )
      )
        throw forbidden();
      // An Olio account depositing its own funds is an account payment operation.
      if (quote.depositor.startsWith("C")) {
        if (!user || wallet?.contractId !== quote.depositor) throw forbidden();
        await requireSubmission(user);
      }
      return;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw forbidden();
    }
  }
  if (!user || !wallet) throw forbidden();
  if (
    contract === registryId &&
    ["register", "set_pubkey"].includes(operation) &&
    scValToNative(args[0]) === wallet.contractId
  )
    return;
  if (contract === wallet.contractId && operation === "set_owner") return;
  const payment =
    (contract === poolId && ["withdraw", "transfer"].includes(operation)) ||
    (contract === usdcSacId &&
      operation === "transfer" &&
      scValToNative(args[0]) === wallet.contractId);
  if (!payment) throw forbidden();
  await requireSubmission(user);
}
