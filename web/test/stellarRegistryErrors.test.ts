import { describe, expect, it } from "vitest";
import { registryContractErrorCode } from "../src/lib/stellar";

describe("registryContractErrorCode", () => {
  it("extracts a contract code from a Stellar HostError diagnostic", () => {
    const error = new Error(
      'HostError: Error(Contract, #3) Event log: data:"escalating Ok(ScErrorType::Contract) frame-exit to Err"',
    );

    expect(registryContractErrorCode(error)).toBe(3);
  });

  it("does not misclassify wallet and transport errors", () => {
    expect(registryContractErrorCode(new Error("User rejected signing"))).toBe(
      null,
    );
  });
});
