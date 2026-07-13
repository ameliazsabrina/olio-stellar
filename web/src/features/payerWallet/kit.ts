import { networkPassphrase } from "../../lib/stellar";

type Kit = typeof import("@creit.tech/stellar-wallets-kit").StellarWalletsKit;

let kitPromise: Promise<Kit> | null = null;

async function getKit(): Promise<Kit> {
  if (!kitPromise) {
    kitPromise = (async () => {
      const { StellarWalletsKit, Networks } =
        await import("@creit.tech/stellar-wallets-kit");
      const [
        { FreighterModule },
        { xBullModule },
        { LobstrModule },
        { AlbedoModule },
        { RabetModule },
      ] = await Promise.all([
        import("@creit.tech/stellar-wallets-kit/modules/freighter"),
        import("@creit.tech/stellar-wallets-kit/modules/xbull"),
        import("@creit.tech/stellar-wallets-kit/modules/lobstr"),
        import("@creit.tech/stellar-wallets-kit/modules/albedo"),
        import("@creit.tech/stellar-wallets-kit/modules/rabet"),
      ]);
      StellarWalletsKit.init({
        network:
          networkPassphrase === Networks.PUBLIC
            ? Networks.PUBLIC
            : Networks.TESTNET,
        modules: [
          new FreighterModule(),
          new xBullModule(),
          new LobstrModule(),
          new AlbedoModule(),
          new RabetModule(),
        ],
      });
      return StellarWalletsKit;
    })();
  }
  return kitPromise;
}

// Open the wallet-selection modal, connect, and return the payer's G-address.
export async function connectPayerWallet(): Promise<string> {
  const kit = await getKit();
  const { address } = await kit.authModal();
  return address;
}

export async function disconnectPayerWallet(): Promise<void> {
  const kit = await getKit();
  await kit.disconnect();
}

export async function signPayerAuthEntry(
  entryXdr: string,
  address: string,
): Promise<string> {
  const kit = await getKit();
  const { signedAuthEntry } = await kit.signAuthEntry(entryXdr, { address });
  if (!signedAuthEntry) throw new Error("Wallet did not return a signature.");
  return signedAuthEntry;
}
