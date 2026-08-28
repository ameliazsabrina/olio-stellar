import {
  Keypair,
  Networks,
  TransactionBuilder,
  WebAuth,
} from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  operationsCall: vi.fn(),
  tomlResolve: vi.fn(),
  currentWallet: vi.fn(),
}));

vi.mock("../src/server/modules/wallets/wallets.service", () => ({
  currentWallet: mocks.currentWallet,
}));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: vi.fn(() => ({
        operations: () => ({
          forAccount: () => ({
            order: () => ({
              limit: () => ({ call: mocks.operationsCall }),
            }),
          }),
        }),
      })),
    },
    StellarToml: {
      ...actual.StellarToml,
      Resolver: { resolve: mocks.tomlResolve },
    },
  };
});

import {
  AnchorBridgeError,
  AnchorConfigError,
} from "../src/server/modules/anchor/anchor.errors";
import { signClientChallenge } from "../src/server/modules/anchor/anchor.service";

const anchorDomain = "previewstellar.moneygram.com";
const clientDomain = "preview.olio.example";
const webAuthDomain = "previewstellar.moneygram.com";

let anchor: Keypair;
let bridge: Keypair;
let client: Keypair;
let sponsor: Keypair;

function signedChallenge(networkPassphrase = Networks.PUBLIC): string {
  const challenge = WebAuth.buildChallengeTx(
    anchor,
    bridge.publicKey(),
    anchorDomain,
    300,
    networkPassphrase,
    webAuthDomain,
    null,
    clientDomain,
    client.publicKey(),
  );
  const tx = TransactionBuilder.fromXDR(challenge, networkPassphrase);
  tx.sign(bridge);
  return tx.toXDR();
}

beforeEach(() => {
  vi.clearAllMocks();
  anchor = Keypair.random();
  bridge = Keypair.random();
  client = Keypair.random();
  sponsor = Keypair.random();
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
  process.env.NEXT_PUBLIC_SEP24_ANCHOR_URL = `https://${anchorDomain}`;
  process.env.NEXT_PUBLIC_SEP10_CLIENT_DOMAIN = clientDomain;
  process.env.SEP10_CLIENT_SIGNING_SECRET = client.secret();
  process.env.BRIDGE_SPONSOR_SECRET = sponsor.secret();
  mocks.tomlResolve.mockResolvedValue({
    NETWORK_PASSPHRASE: Networks.PUBLIC,
    SIGNING_KEY: anchor.publicKey(),
    WEB_AUTH_ENDPOINT: `https://${webAuthDomain}/auth`,
  });
  mocks.operationsCall.mockResolvedValue({
    records: [
      {
        type: "create_account",
        account: bridge.publicKey(),
        source_account: sponsor.publicKey(),
      },
    ],
  });
  mocks.currentWallet.mockResolvedValue({
    privyWalletAddress: bridge.publicKey(),
  });
});

describe("signClientChallenge", () => {
  it("adds the configured client-domain signature to a valid bridge challenge", async () => {
    const result = await signClientChallenge({
      transactionXdr: signedChallenge(),
      accountPublicKey: bridge.publicKey(),
      accountKind: "cash-out",
    });

    expect(
      WebAuth.verifyChallengeTxSigners(
        result.signedTransactionXdr,
        anchor.publicKey(),
        Networks.PUBLIC,
        [bridge.publicKey()],
        [anchorDomain],
        webAuthDomain,
      ),
    ).toEqual([bridge.publicKey()]);
    expect(mocks.operationsCall).toHaveBeenCalledTimes(1);
  });

  it("rejects payout accounts not created by the configured sponsor", async () => {
    mocks.operationsCall.mockResolvedValueOnce({
      records: [
        {
          type: "create_account",
          account: bridge.publicKey(),
          source_account: Keypair.random().publicKey(),
        },
      ],
    });

    await expect(
      signClientChallenge({
        transactionXdr: signedChallenge(),
        accountPublicKey: bridge.publicKey(),
        accountKind: "cash-out",
      }),
    ).rejects.toEqual(
      new AnchorBridgeError(
        "The payout account was not created by Olio's sponsor.",
      ),
    );
  });

  it("signs testnet challenges without requiring a sponsor-created account", async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET;
    process.env.BRIDGE_SPONSOR_SECRET = "";
    mocks.tomlResolve.mockResolvedValueOnce({
      NETWORK_PASSPHRASE: Networks.TESTNET,
      SIGNING_KEY: anchor.publicKey(),
      WEB_AUTH_ENDPOINT: `https://${webAuthDomain}/auth`,
    });

    const result = await signClientChallenge({
      transactionXdr: signedChallenge(Networks.TESTNET),
      accountPublicKey: bridge.publicKey(),
      accountKind: "cash-out",
    });

    expect(
      WebAuth.verifyChallengeTxSigners(
        result.signedTransactionXdr,
        anchor.publicKey(),
        Networks.TESTNET,
        [bridge.publicKey()],
        [anchorDomain],
        webAuthDomain,
      ),
    ).toEqual([bridge.publicKey()]);
    expect(mocks.operationsCall).not.toHaveBeenCalled();
  });

  it("requires a supported network and a valid server-only signing key", async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = "unsupported";
    await expect(
      signClientChallenge({
        transactionXdr: signedChallenge(),
        accountPublicKey: bridge.publicKey(),
        accountKind: "cash-out",
      }),
    ).rejects.toBeInstanceOf(AnchorConfigError);

    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;
    process.env.SEP10_CLIENT_SIGNING_SECRET = "not-a-secret";
    await expect(
      signClientChallenge({
        transactionXdr: signedChallenge(),
        accountPublicKey: bridge.publicKey(),
        accountKind: "cash-out",
      }),
    ).rejects.toEqual(
      new AnchorConfigError("SEP10_CLIENT_SIGNING_SECRET is malformed."),
    );
  });

  it("rejects a challenge without the bridge account signature", async () => {
    const challenge = WebAuth.buildChallengeTx(
      anchor,
      bridge.publicKey(),
      anchorDomain,
      300,
      Networks.PUBLIC,
      webAuthDomain,
      null,
      clientDomain,
      client.publicKey(),
    );

    await expect(
      signClientChallenge({
        transactionXdr: challenge,
        accountPublicKey: bridge.publicKey(),
        accountKind: "cash-out",
      }),
    ).rejects.toThrow(
      "SEP-10 challenge does not have the expected payout-account signature.",
    );
  });

  it("allows cash-in only for the authenticated user's stored Privy wallet", async () => {
    const result = await signClientChallenge(
      {
        transactionXdr: signedChallenge(),
        accountPublicKey: bridge.publicKey(),
        accountKind: "cash-in",
      },
      "did:privy:user",
    );
    expect(result.signedTransactionXdr).toBeTruthy();
    expect(mocks.currentWallet).toHaveBeenCalledWith("did:privy:user");
    expect(mocks.operationsCall).not.toHaveBeenCalled();

    mocks.currentWallet.mockResolvedValueOnce({
      privyWalletAddress: Keypair.random().publicKey(),
    });
    await expect(
      signClientChallenge(
        {
          transactionXdr: signedChallenge(),
          accountPublicKey: bridge.publicKey(),
          accountKind: "cash-in",
        },
        "did:privy:user",
      ),
    ).rejects.toThrow("not the authenticated user's Privy wallet");
  });
});
