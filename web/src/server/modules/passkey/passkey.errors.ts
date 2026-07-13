export class PasskeyWalletNotFoundError extends Error {
  constructor() {
    super("no smart wallet found for that passkey credential");
    this.name = "PasskeyWalletNotFoundError";
  }
}

export class EscrowClobberError extends Error {
  constructor() {
    super("an escrow already exists for a different passkey credential");
    this.name = "EscrowClobberError";
  }
}
