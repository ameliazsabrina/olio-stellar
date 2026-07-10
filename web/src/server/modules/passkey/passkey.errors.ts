export class PasskeyWalletNotFoundError extends Error {
  constructor() {
    super("no smart wallet found for that passkey credential");
    this.name = "PasskeyWalletNotFoundError";
  }
}
