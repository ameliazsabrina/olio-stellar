import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  rpc,
  scValToNative,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { MongoClient } from "mongodb";

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const owner = argument("owner");
const feeBps = Number(argument("fee-bps"));
const state = argument("state") ?? "active";
const reason = argument("reason");
const updatedBy = argument("updated-by");
if (
  !owner ||
  ![200, 500].includes(feeBps) ||
  !["active", "disabled"].includes(state) ||
  !reason ||
  !updatedBy
) {
  throw new Error(
    "Usage: pnpm fee-policy:set -- --owner C... --fee-bps 500 --state active --reason ticket --updated-by operator",
  );
}
new Address(owner);
const registry = process.env.NEXT_PUBLIC_OLIO_REGISTRY_ID;
const mongoUri = process.env.MONGODB_URI;
if (!registry || !mongoUri)
  throw new Error("Registry and Mongo configuration are required.");
const passphrase =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const server = new rpc.Server(
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ??
    "https://soroban-testnet.stellar.org",
);
const source = new Account(Keypair.random().publicKey(), "0");
const tx = new TransactionBuilder(source, {
  fee: BASE_FEE,
  networkPassphrase: passphrase,
})
  .addOperation(
    new Contract(registry).call("username_of", new Address(owner).toScVal()),
  )
  .setTimeout(30)
  .build();
const simulation = await server.simulateTransaction(tx);
if (rpc.Api.isSimulationError(simulation) || !simulation.result?.retval) {
  throw new Error(
    "Owner could not be verified against the configured registry.",
  );
}
const username = scValToNative(simulation.result.retval);
if (!username)
  throw new Error("Owner does not have a registered Olio username.");

const client = new MongoClient(mongoUri);
await client.connect();
try {
  await client
    .db()
    .collection("client_fee_policies")
    .updateOne(
      { _id: owner },
      {
        $set: {
          feeBps,
          state,
          effectiveAt: new Date(),
          expiresAt: null,
          reason,
          updatedAt: new Date(),
          updatedBy,
        },
      },
      { upsert: true, writeConcern: { w: "majority", j: true } },
    );
  console.log(`Updated fee policy for verified owner of @${username}.`);
} finally {
  await client.close();
}
