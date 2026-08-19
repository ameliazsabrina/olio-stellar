export class BadPinError extends Error {
  constructor() {
    super("Incorrect PIN");
    this.name = "BadPinError";
  }
}
