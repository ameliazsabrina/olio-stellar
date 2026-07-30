export class AnchorConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorConfigError";
  }
}

export class AnchorChallengeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorChallengeError";
  }
}

export class AnchorBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorBridgeError";
  }
}
