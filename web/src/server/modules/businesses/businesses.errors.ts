export class BusinessNotFoundError extends Error {
  constructor() {
    super("No business profile is available for this account.");
    this.name = "BusinessNotFoundError";
  }
}

export class BusinessForbiddenError extends Error {
  constructor() {
    super("You do not have permission to manage this business.");
    this.name = "BusinessForbiddenError";
  }
}

export class BusinessBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessBindingError";
  }
}

export class BusinessStoreError extends Error {
  constructor(message = "The business profile could not be saved.") {
    super(message);
    this.name = "BusinessStoreError";
  }
}
