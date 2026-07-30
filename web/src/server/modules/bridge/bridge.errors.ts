export class BridgeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeConfigError";
  }
}

export class BridgeFundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeFundError";
  }
}
