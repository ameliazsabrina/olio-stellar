export class RegistryLookupFailedError extends Error {
  constructor() {
    super("registry lookup failed and no cached entry to fall back to");
    this.name = "RegistryLookupFailedError";
  }
}

export class UsernameNotOnChainError extends Error {
  constructor() {
    super("username is not registered on-chain yet — the register tx may not have confirmed");
    this.name = "UsernameNotOnChainError";
  }
}
