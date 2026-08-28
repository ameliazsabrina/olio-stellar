import { Networks } from "@stellar/stellar-sdk";
import { env } from "../env";

export type MoneyGramRampStatus = "whitelisting" | "sandbox" | "live";

export const moneyGramRampStatus = env.NEXT_PUBLIC_MONEYGRAM_RAMP_STATUS;

const networkPassphrase =
  env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;

export const moneyGramCashOutStatusEnabled =
  (moneyGramRampStatus === "sandbox" &&
    networkPassphrase === Networks.TESTNET) ||
  (moneyGramRampStatus === "live" && networkPassphrase === Networks.PUBLIC);

export const moneyGramCashInEnabled =
  (moneyGramRampStatus === "sandbox" &&
    networkPassphrase === Networks.TESTNET) ||
  (moneyGramRampStatus === "live" && networkPassphrase === Networks.PUBLIC);

export const moneyGramCashInUnavailableReason = moneyGramCashInEnabled
  ? null
  : moneyGramRampStatus === "whitelisting"
    ? "MoneyGram cash-in is awaiting KYB and certification approval."
    : "MoneyGram cash-in is unavailable on this Stellar network.";

export const moneyGramBannerCopy =
  moneyGramRampStatus === "whitelisting"
    ? "MoneyGram cash-out is coming to Olio. Sandbox access is being reviewed. Stellar wallet withdrawals remain available."
    : moneyGramRampStatus === "sandbox"
      ? "MoneyGram and Durianpay sandbox testing is active. Testnet funds only. Stellar wallet withdrawals remain available."
      : null;

export const showMoneyGramStatusBanner = moneyGramBannerCopy !== null;
