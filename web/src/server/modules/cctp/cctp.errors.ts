export class CctpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CctpConfigError";
  }
}

export class CctpPayeeError extends Error {
  constructor(username: string) {
    super(`no Olio account resolves for @${username}`);
    this.name = "CctpPayeeError";
  }
}

export class CctpAttestationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CctpAttestationError";
  }
}

export class CctpRelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CctpRelayError";
  }
}
