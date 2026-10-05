import { test as base, expect, type Page, type Route } from "@playwright/test";

export type Eligibility =
  | "not_started"
  | "pending"
  | "needs_information"
  | "manual_review"
  | "approved"
  | "declined";

export type NextAction =
  | "create_business"
  | "start"
  | "continue"
  | "wait"
  | "resubmit"
  | "contact_support"
  | "done";

export type Scenario = {
  businesses: Business[];
  status: Status | null;
  identity: Identity | null;
  failures: Partial<Record<Procedure, { code: string; message: string }>>;
  tokenExpiresAfter: number;
};

export type Procedure =
  | "businesses.mine"
  | "businesses.create"
  | "businesses.bindAccount"
  | "verification.status"
  | "verification.start"
  | "verification.sdkToken"
  | "verification.refresh"
  | "passport.identity"
  | "passport.setVisibility";

export type Business = {
  businessId: string;
  publicId: string;
  type: "individual" | "company";
  lifecycle: "active" | "suspended" | "closed";
  displayName: string | null;
  username: string | null;
  accountBound: boolean;
  role: "owner" | "admin" | "member";
  createdAt: string;
  updatedAt: string;
};

export type Status = {
  businessId: string;
  type: "individual" | "company";
  environment: "sandbox" | "live" | null;
  mode: "off" | "sandbox" | "live";
  eligibility: Eligibility;
  providerStage: string;
  userMessage: string | null;
  nextAction: NextAction;
  checkedAt: string | null;
  lastEventAt: string | null;
  policyVersion: number;
  credential: Credential | null;
  canStart: boolean;
};

export type Credential = {
  status: "active" | "suspended" | "expired";
  issuer: "olio";
  policyVersion: number;
  checkedAt: string;
  validUntil: string;
  published: boolean;
  environment: "sandbox" | "live";
};

export type Identity = {
  businessId: string;
  publicId: string;
  displayName: string | null;
  type: "individual" | "company";
  credential: Credential | null;
  publishable: boolean;
  publicPath: string | null;
};

export const BUSINESS: Business = {
  businessId: "biz_e2e_individual",
  publicId: "pub_e2e_individual",
  type: "individual",
  lifecycle: "active",
  displayName: "Ayu Pratama",
  username: "ayu",
  accountBound: true,
  role: "owner",
  createdAt: "2026-09-20T09:00:00.000Z",
  updatedAt: "2026-09-20T09:00:00.000Z",
};

export const COMPANY: Business = {
  ...BUSINESS,
  businessId: "biz_e2e_company",
  publicId: "pub_e2e_company",
  type: "company",
  displayName: "Kopi Kenangan Sejati",
};

export function credential(overrides: Partial<Credential> = {}): Credential {
  return {
    status: "active",
    issuer: "olio",
    policyVersion: 1,
    checkedAt: "2026-09-21T09:00:00.000Z",
    validUntil: "2027-09-21T09:00:00.000Z",
    published: false,
    environment: "live",
    ...overrides,
  };
}

export function status(overrides: Partial<Status> = {}): Status {
  return {
    businessId: BUSINESS.businessId,
    type: "individual",
    environment: "live",
    mode: "live",
    eligibility: "not_started",
    providerStage: "not_started",
    userMessage: null,
    nextAction: "start",
    checkedAt: null,
    lastEventAt: null,
    policyVersion: 1,
    credential: null,
    canStart: true,
    ...overrides,
  };
}

export function identity(overrides: Partial<Identity> = {}): Identity {
  return {
    businessId: BUSINESS.businessId,
    publicId: BUSINESS.publicId,
    displayName: BUSINESS.displayName,
    type: "individual",
    credential: null,
    publishable: false,
    publicPath: null,
    ...overrides,
  };
}

export function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    businesses: [BUSINESS],
    status: status(),
    identity: identity(),
    failures: {},
    tokenExpiresAfter: 0,
    ...overrides,
  };
}

const ERROR_CODES: Record<string, number> = {
  UNAUTHORIZED: -32001,
  FORBIDDEN: -32003,
  NOT_FOUND: -32004,
  TOO_MANY_REQUESTS: -32029,
  PRECONDITION_FAILED: -32012,
  BAD_GATEWAY: -32603,
  CONFLICT: -32009,
};

function resultFor(
  state: Scenario,
  procedure: string,
  input: unknown,
): { data: unknown } | { error: { code: string; message: string } } {
  const failure = state.failures[procedure as Procedure];
  if (failure) return { error: failure };
  switch (procedure) {
    case "businesses.mine":
      return { data: state.businesses };
    case "businesses.create": {
      const created: Business = {
        ...BUSINESS,
        type: (input as { type: "individual" | "company" }).type,
        displayName: (input as { displayName: string | null }).displayName,
      };
      state.businesses = [created];
      state.status = status({
        businessId: created.businessId,
        type: created.type,
      });
      state.identity = identity({ type: created.type });
      return { data: created };
    }
    case "businesses.bindAccount": {
      const bound = {
        ...state.businesses[0],
        accountBound: true,
        username: "ayu",
      };
      state.businesses = [bound];
      if (state.status) state.status = { ...state.status, canStart: true };
      return { data: { business: bound, changed: true } };
    }
    case "verification.status":
      return { data: state.status };
    case "verification.start": {
      state.status = status({
        ...state.status,
        eligibility: "not_started",
        providerStage: "in_progress",
        nextAction: "continue",
        userMessage: null,
      });
      return { data: state.status };
    }
    case "verification.sdkToken":
      return { data: { token: "e2e-sdk-token", expiresInSeconds: 600 } };
    case "verification.refresh":
      return { data: { status: state.status, reconciled: true } };
    case "passport.identity":
      return { data: state.identity };
    case "passport.setVisibility": {
      const published = (input as { published: boolean }).published;
      const current = state.identity;
      if (!current?.credential || !current.publishable) {
        return {
          error: {
            code: "PRECONDITION_FAILED",
            message:
              "Your identity badge can be published once verification is approved and current.",
          },
        };
      }
      state.identity = {
        ...current,
        credential: { ...current.credential, published },
        publicPath: published ? `/business/${current.publicId}` : null,
      };
      return { data: state.identity };
    }
    default:
      return {
        error: { code: "NOT_FOUND", message: `No stub for ${procedure}` },
      };
  }
}

function inputsFrom(url: URL, body: string | null): Record<string, unknown> {
  const raw = url.searchParams.get("input") ?? body;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function stubTrpc(page: Page, state: Scenario): Promise<void> {
  await page.route("**/api/trpc/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/trpc\//, "");
    const procedures = path.split(",");
    const inputs = inputsFrom(url, request.postData());
    const payload = procedures.map((procedure, index) => {
      const input =
        (inputs as Record<string, unknown>)[String(index)] ?? inputs;
      const outcome = resultFor(state, procedure, input);
      if ("error" in outcome) {
        return {
          error: {
            message: outcome.error.message,
            code: ERROR_CODES[outcome.error.code] ?? -32603,
            data: {
              code: outcome.error.code,
              httpStatus: 400,
              path: procedure,
            },
          },
        };
      }
      return { result: { data: outcome.data } };
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });
}

export async function stubProviderSdk(page: Page): Promise<void> {
  await page.route("**/static.sumsub.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "window.snsWebSdk = { init: () => ({ withConf: () => ({ withOptions: () => ({ on: () => ({ onMessage: () => ({ build: () => ({ launch: () => {} }) }) }) }) }) }) };",
    }),
  );
  await page.route("**/api.sumsub.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
}

export const test = base;

export { expect };
