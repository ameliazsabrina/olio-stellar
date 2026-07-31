import { Networks } from "@stellar/stellar-sdk";

export type MoneyGramRampStatus = "whitelisting" | "sandbox" | "live";

function parseStatus(value: string | undefined): MoneyGramRampStatus {
  switch (value?.trim().toLowerCase()) {
    case "sandbox":
      return "sandbox";
    case "live":
      return "live";
    default:
      return "whitelisting";
  }
}

export const moneyGramRampStatus = parseStatus(
  process.env.NEXT_PUBLIC_MONEYGRAM_RAMP_STATUS,
);

const networkPassphrase =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;

export const moneyGramCashOutStatusEnabled =
  (moneyGramRampStatus === "sandbox" &&
    networkPassphrase === Networks.TESTNET) ||
  (moneyGramRampStatus === "live" && networkPassphrase === Networks.PUBLIC);

export const moneyGramBannerCopy =
  moneyGramRampStatus === "whitelisting"
    ? "MoneyGram cash-out is coming to Olio. Sandbox access is being reviewed. Stellar wallet withdrawals remain available."
    : moneyGramRampStatus === "sandbox"
      ? "MoneyGram sandbox testing is active. Testnet funds only. Stellar wallet withdrawals remain available."
      : null;

export const showMoneyGramStatusBanner = moneyGramBannerCopy !== null;
