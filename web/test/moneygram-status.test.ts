import { Networks } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

async function loadStatus(
  status: string | undefined,
  networkPassphrase: string,
) {
  vi.stubEnv("NEXT_PUBLIC_MONEYGRAM_RAMP_STATUS", status);
  vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE", networkPassphrase);
  return import("../src/lib/moneygram-status");
}

describe("MoneyGram ramp status", () => {
  it("defaults missing or invalid configuration to disabled whitelisting", async () => {
    const missing = await loadStatus(undefined, Networks.TESTNET);
    expect(missing.moneyGramRampStatus).toBe("whitelisting");
    expect(missing.moneyGramCashOutStatusEnabled).toBe(false);
    expect(missing.showMoneyGramStatusBanner).toBe(true);
    expect(missing.moneyGramBannerCopy).not.toContain("—");

    vi.resetModules();
    const invalid = await loadStatus("unknown", Networks.TESTNET);
    expect(invalid.moneyGramRampStatus).toBe("whitelisting");
    expect(invalid.moneyGramCashOutStatusEnabled).toBe(false);
  });

  it("enables sandbox only on testnet", async () => {
    const testnet = await loadStatus("sandbox", Networks.TESTNET);
    expect(testnet.moneyGramCashOutStatusEnabled).toBe(true);
    expect(testnet.moneyGramCashInEnabled).toBe(true);
    expect(testnet.showMoneyGramStatusBanner).toBe(true);
    expect(testnet.moneyGramBannerCopy).not.toContain("—");

    vi.resetModules();
    const mainnet = await loadStatus("sandbox", Networks.PUBLIC);
    expect(mainnet.moneyGramCashOutStatusEnabled).toBe(false);
    expect(mainnet.moneyGramCashInEnabled).toBe(false);
  });

  it("enables live only on mainnet and removes the banner", async () => {
    const mainnet = await loadStatus("live", Networks.PUBLIC);
    expect(mainnet.moneyGramCashOutStatusEnabled).toBe(true);
    expect(mainnet.moneyGramCashInEnabled).toBe(true);
    expect(mainnet.showMoneyGramStatusBanner).toBe(false);

    vi.resetModules();
    const testnet = await loadStatus("live", Networks.TESTNET);
    expect(testnet.moneyGramCashOutStatusEnabled).toBe(false);
  });
});
