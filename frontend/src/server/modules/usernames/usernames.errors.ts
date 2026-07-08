export class RegistryLookupFailedError extends Error {
  constructor() {
    super("registry lookup failed and no cached entry to fall back to");
    this.name = "RegistryLookupFailedError";
  }
}
