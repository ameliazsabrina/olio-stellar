import "server-only";

import {
  Asset,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { env } from "../../../env";
import { getServerEnv } from "../../../env.server";
import { networkPassphrase } from "../../../lib/stellar";
import { BridgeConfigError, BridgeFundError } from "./bridge.errors";
import type { FundBridgeInput, FundBridgeOutput } from "./bridge.schema";

const horizonUrl = env.NEXT_PUBLIC_STELLAR_HORIZON_URL;
const horizon = new Horizon.Server(horizonUrl, {
  allowHttp: horizonUrl.startsWith("http://"),
});

export const BRIDGE_FUNDING_XLM = getServerEnv().BRIDGE_FUNDING_XLM;

type ResultCodes = {
  transaction?: string;
  operations?: string[];
};

function sponsorKeypair(): Keypair {
  const secret = getServerEnv().BRIDGE_SPONSOR_SECRET;
  if (!secret) {
    throw new BridgeConfigError("BRIDGE_SPONSOR_SECRET is not configured.");
  }
  try {
    return Keypair.fromSecret(secret);
  } catch {
    throw new BridgeConfigError("BRIDGE_SPONSOR_SECRET is malformed.");
  }
}

export function validateBridgeFundingAmount(value: string): string {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(value) || Number(value) <= 0) {
    throw new BridgeConfigError(
      "BRIDGE_FUNDING_XLM must be a positive Stellar amount.",
    );
  }
  return value;
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === "object"
    ? (error as Record<string, unknown>)
    : {};
}

function resultCodes(error: unknown): ResultCodes {
  const root = errorRecord(error);
  const response = errorRecord(root.response);
  const data = errorRecord(response.data);
  const extras = errorRecord(data.extras);
  const codes = errorRecord(extras.result_codes);
  return {
    transaction:
      typeof codes.transaction === "string" ? codes.transaction : undefined,
    operations: Array.isArray(codes.operations)
      ? codes.operations.filter(
          (code): code is string => typeof code === "string",
        )
      : undefined,
  };
}

function horizonMessage(error: unknown): string {
  const root = errorRecord(error);
  const response = errorRecord(root.response);
  const data = errorRecord(response.data);
  if (typeof data.detail === "string") return data.detail;
  if (typeof data.title === "string") return data.title;
  if (error instanceof Error && error.message) return error.message;
  return "Horizon rejected the bridge funding transaction.";
}

function hasOperationCode(codes: ResultCodes, code: string): boolean {
  return codes.operations?.includes(code) ?? false;
}

async function doFundBridge(
  bridgePublicKey: string,
): Promise<FundBridgeOutput> {
  const sponsor = sponsorKeypair();
  const amount = validateBridgeFundingAmount(BRIDGE_FUNDING_XLM);

  const submit = async (): Promise<FundBridgeOutput> => {
    const account = await horizon.loadAccount(sponsor.publicKey());
    const fee = String(await horizon.fetchBaseFee());
    const tx = new TransactionBuilder(account, {
      fee,
      networkPassphrase,
    })
      .addOperation(
        Operation.createAccount({
          destination: bridgePublicKey,
          startingBalance: amount,
        }),
      )
      .setTimeout(120)
      .build();
    tx.sign(sponsor);
    const submitted = await horizon.submitTransaction(tx);
    return { funded: true, txHash: submitted.hash };
  };

  try {
    return await submit();
  } catch (error) {
    let fundingError = error;
    let codes = resultCodes(error);
    if (hasOperationCode(codes, "op_already_exists")) {
      return { funded: false, txHash: null };
    }
    if (codes.transaction === "tx_bad_seq") {
      try {
        return await submit();
      } catch (retryError) {
        fundingError = retryError;
        codes = resultCodes(retryError);
        if (hasOperationCode(codes, "op_already_exists")) {
          return { funded: false, txHash: null };
        }
      }
    }

    const message = horizonMessage(fundingError);
    if (
      hasOperationCode(codes, "op_underfunded") ||
      /underfunded|insufficient balance/i.test(message)
    ) {
      throw new BridgeFundError(
        "Payouts are temporarily unavailable because the funding account needs a refill.",
      );
    }
    throw new BridgeFundError(message);
  }
}

let fundChain: Promise<unknown> = Promise.resolve();

export async function fundBridge(
  input: FundBridgeInput,
): Promise<FundBridgeOutput> {
  const run = fundChain.then(() => doFundBridge(input.bridgePublicKey));
  fundChain = run.catch(() => undefined);
  return run;
}

async function doFundUserWallet(
  walletPublicKey: string,
): Promise<FundBridgeOutput> {
  const target = Number(validateBridgeFundingAmount(BRIDGE_FUNDING_XLM));
  try {
    const wallet = await horizon.loadAccount(walletPublicKey);
    const native = wallet.balances.find(
      (balance) => balance.asset_type === "native",
    );
    const current = Number(native?.balance ?? "0");
    if (current >= target) return { funded: false, txHash: null };
    const sponsor = sponsorKeypair();
    const source = await horizon.loadAccount(sponsor.publicKey());
    const fee = String(await horizon.fetchBaseFee());
    const tx = new TransactionBuilder(source, { fee, networkPassphrase })
      .addOperation(
        Operation.payment({
          destination: walletPublicKey,
          asset: Asset.native(),
          amount: (target - current).toFixed(7),
        }),
      )
      .setTimeout(120)
      .build();
    tx.sign(sponsor);
    const submitted = await horizon.submitTransaction(tx);
    return { funded: true, txHash: submitted.hash };
  } catch (error) {
    const status = errorRecord(errorRecord(error).response).status;
    if (status === 404) return doFundBridge(walletPublicKey);
    throw error;
  }
}

export async function fundUserWallet(
  input: FundBridgeInput,
): Promise<FundBridgeOutput> {
  const run = fundChain.then(() => doFundUserWallet(input.bridgePublicKey));
  fundChain = run.catch(() => undefined);
  return run;
}
