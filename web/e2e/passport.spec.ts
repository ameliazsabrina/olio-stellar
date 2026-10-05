import {
  credential,
  expect,
  identity,
  type Scenario,
  scenario,
  status,
  stubProviderSdk,
  stubTrpc,
  test,
} from "./fixtures/verification";
import {
  PUBLISHED_PUBLIC_ID,
  SANDBOX_PUBLIC_ID,
  STALE_PUBLIC_ID,
  SUSPENDED_PUBLIC_ID,
  UNPUBLISHED_PUBLIC_ID,
} from "./globalSetup";

const HARNESS = "/e2e-harness?screen=passport";

async function open(page: Parameters<typeof stubTrpc>[0], state: Scenario) {
  await stubTrpc(page, state);
  await stubProviderSdk(page);
  await page.goto(HARNESS);
}

test.describe("private passport", () => {
  test("keeps an approved badge private until it is published", async ({
    page,
  }) => {
    const state = scenario({
      status: status({
        eligibility: "approved",
        nextAction: "done",
        credential: credential(),
      }),
      identity: identity({ credential: credential(), publishable: true }),
    });
    await open(page, state);

    await expect(page.getByTestId("identity-badge")).toHaveAttribute(
      "data-state",
      "verified",
    );
    await expect(page.getByText(/Your badge is private/)).toBeVisible();
    await expect(page.getByTestId("public-identity-url")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Publish badge" }),
    ).toBeEnabled();
  });

  test("publishes and then hides the badge on explicit action", async ({
    page,
  }) => {
    const state = scenario({
      status: status({
        eligibility: "approved",
        nextAction: "done",
        credential: credential(),
      }),
      identity: identity({ credential: credential(), publishable: true }),
    });
    await open(page, state);

    await page.getByRole("button", { name: "Publish badge" }).click();
    await expect(page.getByText("Badge published")).toBeVisible();
    await expect(page.getByTestId("public-identity-url")).toContainText(
      "/business/pub_e2e_individual",
    );

    await page.getByRole("button", { name: "Hide badge" }).click();
    await expect(page.getByText("Badge hidden")).toBeVisible();
    await expect(page.getByTestId("public-identity-url")).toBeHidden();
  });

  test("refuses publication while verification is not approved", async ({
    page,
  }) => {
    const state = scenario({
      status: status({ eligibility: "pending", nextAction: "wait" }),
      identity: identity({ credential: null, publishable: false }),
    });
    await open(page, state);
    await expect(
      page.getByRole("button", { name: "Publish badge" }),
    ).toBeDisabled();
    await expect(
      page.getByText(/Publishing unlocks once verification is approved/),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Go to verification" }),
    ).toBeVisible();
  });

  test("shows a suspended badge as suspended and blocks publishing", async ({
    page,
  }) => {
    const state = scenario({
      status: status({
        eligibility: "manual_review",
        nextAction: "wait",
        credential: credential({ status: "suspended" }),
      }),
      identity: identity({
        credential: credential({ status: "suspended" }),
        publishable: false,
      }),
    });
    await open(page, state);
    await expect(page.getByTestId("identity-badge")).toHaveAttribute(
      "data-state",
      "suspended",
    );
    await expect(
      page.getByRole("button", { name: "Publish badge" }),
    ).toBeDisabled();
  });

  test("shows an expired badge as expired", async ({ page }) => {
    const expired = credential({ status: "expired" });
    await open(
      page,
      scenario({
        status: status({
          eligibility: "approved",
          nextAction: "done",
          credential: expired,
        }),
        identity: identity({ credential: expired, publishable: false }),
      }),
    );
    await expect(page.getByTestId("identity-badge")).toHaveAttribute(
      "data-state",
      "expired",
    );
  });

  test("states the scope of the claim", async ({ page }) => {
    await open(
      page,
      scenario({
        identity: identity({ credential: credential(), publishable: true }),
      }),
    );
    const scope = page.getByRole("region", { name: "What this badge means" });
    await expect(scope).toContainText("identity documents and checks passed");
    await expect(scope).toContainText("revenue");
    await expect(scope).toContainText("creditworthiness");
  });

  test("surfaces a server refusal to publish", async ({ page }) => {
    const state = scenario({
      identity: identity({ credential: credential(), publishable: true }),
      failures: {
        "passport.setVisibility": {
          code: "PRECONDITION_FAILED",
          message:
            "Your identity badge can be published once verification is approved and current.",
        },
      },
    });
    await open(page, state);
    await page.getByRole("button", { name: "Publish badge" }).click();
    await expect(
      page.getByText(
        "Your identity badge can be published once verification is approved and current.",
      ),
    ).toBeVisible();
  });
});

test.describe("public identity page", () => {
  test("shows the verified claim for a published badge", async ({ page }) => {
    await page.goto(`/business/${PUBLISHED_PUBLIC_ID}`);
    await expect(
      page.getByRole("heading", { name: "Identity verified by Olio" }),
    ).toBeVisible();
    const badge = page.getByTestId("identity-badge");
    await expect(badge).toHaveAttribute("data-state", "verified");
    await expect(badge).toContainText("Warung Verified");
    await expect(badge).toContainText("Company");
    await expect(page.getByText("Identity only")).toBeVisible();
  });

  test("never exposes internal identifiers or contact details", async ({
    page,
  }) => {
    await page.goto(`/business/${PUBLISHED_PUBLIC_ID}`);
    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const secret of [
      "biz_e2e_published",
      "cred_biz_e2e_published",
      "case_biz_e2e_published",
      "ce2eaccount",
      "did:privy",
      "app_",
    ]) {
      expect(body).not.toContain(secret.toLowerCase());
    }
  });

  test("hides an unpublished badge", async ({ page }) => {
    await page.goto(`/business/${UNPUBLISHED_PUBLIC_ID}`);
    await expect(page.getByTestId("public-identity-empty")).toBeVisible();
    await expect(page.getByTestId("identity-badge")).toBeHidden();
  });

  test("hides a suspended badge", async ({ page }) => {
    await page.goto(`/business/${SUSPENDED_PUBLIC_ID}`);
    await expect(page.getByTestId("public-identity-empty")).toBeVisible();
  });

  test("hides a badge whose evidence has gone stale", async ({ page }) => {
    await page.goto(`/business/${STALE_PUBLIC_ID}`);
    await expect(page.getByTestId("public-identity-empty")).toBeVisible();
  });

  test("never publishes a sandbox credential from this production runtime", async ({
    page,
  }) => {
    await page.goto(`/business/${SANDBOX_PUBLIC_ID}`);
    await expect(page.getByTestId("public-identity-empty")).toBeVisible();
    await expect(page.getByTestId("identity-badge")).toBeHidden();
  });

  test("returns nothing for an unknown or malformed public id", async ({
    page,
  }) => {
    await page.goto("/business/pub_does_not_exist");
    await expect(page.getByTestId("public-identity-empty")).toBeVisible();
    await page.goto("/business/not%20a%20valid%20id");
    await expect(page.getByTestId("public-identity-empty")).toBeVisible();
  });

  test("states what the badge does not cover", async ({ page }) => {
    await page.goto(`/business/${PUBLISHED_PUBLIC_ID}`);
    await expect(
      page.getByText(/does not verify revenue, customers, creditworthiness/),
    ).toBeVisible();
  });
});

test.describe("authenticated route protection", () => {
  test("shows no verification content to an unauthenticated visitor", async ({
    page,
  }) => {
    for (const [path, label] of [
      ["/verification", "Loading verification"],
      ["/passport", "Loading passport"],
    ]) {
      await page.goto(path);
      await expect(page.getByRole("status", { name: label })).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Verification status" }),
      ).toBeHidden();
      await expect(page.getByTestId("identity-badge")).toBeHidden();
      await expect(page.getByTestId("public-identity-url")).toBeHidden();
    }
  });

  test("returns 404 for the private tRPC procedures without a session", async ({
    request,
  }) => {
    const response = await request.get(
      "/api/trpc/verification.status?input=" +
        encodeURIComponent(JSON.stringify({ businessId: "biz_e2e_published" })),
    );
    const body = await response.text();
    expect(body).toContain("UNAUTHORIZED");
    expect(body).not.toContain('biz_e2e_published":{"eligibility');
  });

  test("refuses an unsigned provider webhook", async ({ request }) => {
    const response = await request.post("/api/sumsub/webhook", {
      data: {
        type: "applicantReviewed",
        applicantId: "app_forged",
        externalUserId: "olio-sandbox-forged",
        reviewStatus: "completed",
        reviewResult: { reviewAnswer: "GREEN" },
      },
    });
    expect(response.status()).toBe(401);
  });

  test("refuses a webhook signed with the wrong algorithm", async ({
    request,
  }) => {
    const response = await request.post("/api/sumsub/webhook", {
      headers: {
        "x-payload-digest-alg": "HMAC_SHA1_HEX",
        "x-payload-digest": "00".repeat(20),
      },
      data: { type: "applicantReviewed" },
    });
    expect(response.status()).toBe(401);
  });

  test("refuses the reconciliation cron without the shared secret", async ({
    request,
  }) => {
    const response = await request.post(
      "/api/cron/verification-reconciliation",
    );
    expect(response.status()).toBe(401);
  });

  test("keeps applicant details out of the health endpoint", async ({
    request,
  }) => {
    const response = await request.get("/api/health/verification");
    const body = await response.text();
    expect(body).toContain("checkedAt");
    expect(body).not.toContain("applicantId");
    expect(body).not.toContain("externalUserId");
    expect(body).not.toContain("rejectLabels");
  });
});
