"use client";

import {
  Asset,
  Horizon,
  type Keypair,
  Memo,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { env } from "../env";
import { isMainnet, networkPassphrase } from "./stellar";

export const horizonUrl = env.NEXT_PUBLIC_STELLAR_HORIZON_URL;
export const friendbotUrl =
  env.NEXT_PUBLIC_FRIENDBOT_URL ??
  (isMainnet ? "" : "https://friendbot.stellar.org");
export const horizon = new Horizon.Server(horizonUrl, {
  allowHttp: horizonUrl.startsWith("http://"),
});
export function offRampAsset(): Asset {
  return new Asset("USDC", env.NEXT_PUBLIC_USDC_ISSUER || "");
}

export function buildMemoFrom(
  value?: string,
  type?: "text" | "id" | "hash",
): Memo | undefined {
  if (!value) return undefined;
  switch (type) {
    case "id":
      return Memo.id(value);
    case "hash":
      return Memo.hash(Buffer.from(value, "base64"));
    default:
      return Memo.text(value);
  }
}

export async function sendUsdcPayment(
  bridge: Keypair,
  {
    destination,
    amount,
    memo,
  }: { destination: string; amount: string; memo?: Memo },
): Promise<string> {
  const source = await horizon.loadAccount(bridge.publicKey());
  const fee = (await horizon.fetchBaseFee()).toString();
  const builder = new TransactionBuilder(source, {
    fee,
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: offRampAsset(),
        amount,
      }),
    )
    .setTimeout(120);
  if (memo) builder.addMemo(memo);
  const payment = builder.build();
  payment.sign(bridge);
  const res = await horizon.submitTransaction(payment);
  return res.hash;
}
