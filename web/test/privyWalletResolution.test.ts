// @vitest-environment node

import type { User } from "@privy-io/react-auth";
import { Keypair } from "@stellar/stellar-sdk";
import { resolvePrivyStellarWallet } from "../src/lib/privy-wallet";

describe("resolvePrivyStellarWallet", () => {
  it("reuses a linked Stellar wallet with distinct publicKey metadata", async () => {
    const address = Keypair.random().publicKey();
    const createWallet = vi.fn();
    const user = {
      linkedAccounts: [
        {
          type: "wallet",
          id: "wallet-1",
          address,
          publicKey: `02${"ab".repeat(32)}`,
          chainType: "stellar",
          delegated: false,
        },
      ],
    } as unknown as User;

    await expect(
      resolvePrivyStellarWallet(user, createWallet),
    ).resolves.toEqual({ id: "wallet-1", address });
    expect(createWallet).not.toHaveBeenCalled();
  });
});
