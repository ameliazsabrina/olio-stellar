export class WalletConflictError extends Error {
  constructor(
    message = "This Privy identity or wallet is already linked to another Olio account.",
  ) {
    super(message);
    this.name = "WalletConflictError";
  }
}

export class WalletDeploymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletDeploymentError";
  }
}

export class WalletMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletMigrationError";
  }
}

export class WalletEscrowClobberError extends Error {
  constructor() {
    super("Encrypted account data already belongs to another Privy identity.");
    this.name = "WalletEscrowClobberError";
  }
}

export class WalletEscrowAlreadyInitializedError extends Error {
  constructor() {
    super("Recovery is already configured for this account.");
    this.name = "WalletEscrowAlreadyInitializedError";
  }
}

export class WalletEscrowMissingError extends Error {
  constructor() {
    super("Recovery is not configured for this account.");
    this.name = "WalletEscrowMissingError";
  }
}

export class WalletEscrowRevisionConflictError extends Error {
  constructor() {
    super(
      "The recovery PIN was changed elsewhere. Start again with the current PIN.",
    );
    this.name = "WalletEscrowRevisionConflictError";
  }
}
