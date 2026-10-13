import { describe, expect, it } from "vitest";
import {
  CCTP_CHAIN_DOMAIN,
  CCTP_SOURCE_DOMAINS,
  CCTP_STELLAR_DOMAIN,
  EVM_CHAIN_KEYS,
  EVM_SOURCES,
  SOLANA_SRC_DOMAIN,
} from "../src/lib/cctp";
import { sourceDomainSchema } from "../src/server/modules/cctp/cctp.config";

describe("CCTP source registry", () => {
  const sources = Object.values(EVM_SOURCES);

  it("keys each EVM source by its own domain", () => {
    for (const [domain, source] of Object.entries(EVM_SOURCES)) {
      expect(source.domain).toBe(Number(domain));
    }
  });

  it("gives every source a unique chain id and chain key", () => {
    expect(new Set(sources.map((s) => s.chainId)).size).toBe(sources.length);
    expect(new Set(sources.map((s) => s.key)).size).toBe(sources.length);
    expect(sources.map((s) => s.key).sort()).toEqual(
      [...EVM_CHAIN_KEYS].sort(),
    );
  });

  it("pins every chain choice to its domain", () => {
    expect(CCTP_CHAIN_DOMAIN.solana).toBe(SOLANA_SRC_DOMAIN);
    for (const source of sources) {
      expect(CCTP_CHAIN_DOMAIN[source.key]).toBe(source.domain);
    }
  });

  it("accepts exactly the registered domains on the server", () => {
    for (const domain of CCTP_SOURCE_DOMAINS) {
      expect(sourceDomainSchema.safeParse(domain).success).toBe(true);
    }
    // Noble is CCTP V1 only; Stellar is the destination, never a source.
    for (const domain of [4, CCTP_STELLAR_DOMAIN, 999]) {
      expect(sourceDomainSchema.safeParse(domain).success).toBe(false);
    }
  });
});
