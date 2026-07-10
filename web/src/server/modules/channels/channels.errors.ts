export class ChannelsNotConfiguredError extends Error {
  constructor() {
    super("channels relayer not configured — CHANNELS_API_KEY is unset");
    this.name = "ChannelsNotConfiguredError";
  }
}

export class ChannelsRelayRejectedError extends Error {
  constructor(reason: string) {
    super(`channels relay rejected the transaction: ${reason}`);
    this.name = "ChannelsRelayRejectedError";
  }
}

export class ChannelsRelayUnreachableError extends Error {
  constructor(reason: string) {
    super(`channels relay is unreachable: ${reason}`);
    this.name = "ChannelsRelayUnreachableError";
  }
}

export class ChannelsNoHashError extends Error {
  constructor(status: string | null) {
    super(
      `channels relay returned no tx hash (status: ${status ?? "unknown"})`,
    );
    this.name = "ChannelsNoHashError";
  }
}
