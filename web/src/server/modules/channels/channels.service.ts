import "server-only";
import {
  ChannelsClient,
  type ChannelsTransactionResponse,
  PluginExecutionError,
  PluginTransportError,
} from "@openzeppelin/relayer-plugin-channels";
import {
  ChannelsNoHashError,
  ChannelsNotConfiguredError,
  ChannelsRelayRejectedError,
  ChannelsRelayUnreachableError,
} from "./channels.errors";

const API_KEY = process.env.CHANNELS_API_KEY || "";
// OpenZeppelin's managed Channels service. Testnet by default; override for
// mainnet ("https://channels.openzeppelin.com") or a self-hosted relayer.
const BASE_URL =
  process.env.CHANNELS_BASE_URL || "https://channels.openzeppelin.com/testnet";

export const channelsConfigured = Boolean(API_KEY);

let client: ChannelsClient | null = null;
function getClient(): ChannelsClient {
  if (!client) {
    client = new ChannelsClient({ baseUrl: BASE_URL, apiKey: API_KEY });
  }
  return client;
}

export type RelayResult = { hash: string; status: string | null };

// Relay a Soroban invocation (host function + signed auth entries) through the
// Channels service. A channel account is the transaction source and the fund
// relayer pays the fee, so the end user needs no XLM. Throws domain errors; the
// router maps them to tRPC codes.
export async function relaySoroban(
  func: string,
  auth: string[],
): Promise<RelayResult> {
  if (!channelsConfigured) throw new ChannelsNotConfiguredError();

  let res: ChannelsTransactionResponse;
  try {
    res = await getClient().submitSorobanTransaction({ func, auth });
  } catch (err) {
    if (err instanceof PluginExecutionError) {
      throw new ChannelsRelayRejectedError(err.message);
    }
    if (err instanceof PluginTransportError) {
      throw new ChannelsRelayUnreachableError(err.message);
    }
    throw err;
  }

  if (!res.hash) throw new ChannelsNoHashError(res.status);
  return { hash: res.hash, status: res.status };
}

// Relay a complete, signed transaction envelope (fee-bumped by the relayer).
// Used for the passkey smart-wallet deploy, which is a CreateContract tx signed
// by the passkey-kit launcher account rather than a func+auth invocation.
export async function relayXdr(xdr: string): Promise<RelayResult> {
  if (!channelsConfigured) throw new ChannelsNotConfiguredError();

  let res: ChannelsTransactionResponse;
  try {
    res = await getClient().submitTransaction({ xdr });
  } catch (err) {
    if (err instanceof PluginExecutionError) {
      throw new ChannelsRelayRejectedError(err.message);
    }
    if (err instanceof PluginTransportError) {
      throw new ChannelsRelayUnreachableError(err.message);
    }
    throw err;
  }

  if (!res.hash) throw new ChannelsNoHashError(res.status);
  return { hash: res.hash, status: res.status };
}
