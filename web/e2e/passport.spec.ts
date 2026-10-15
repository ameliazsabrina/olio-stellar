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
  REVOKED_STATEMENT_ID,
  SANDBOX_PUBLIC_ID,
  STALE_PUBLIC_ID,
  STATEMENT_DIGEST,
  SUSPENDED_PUBLIC_ID,
  UNPUBLISHED_PUBLIC_ID,
  VALID_STATEMENT_ID,
} from "./globalSetup";

const HARNESS = "/e2e-harness?screen=passport";

async function open(page: Parameters<typeof stubTrpc>[0], state: Scenario) {
  await stubTrpc(page, state);
  await stubProviderSdk(page);
  await page.goto(HARNESS);
}

test.describe("passport settings", () => {
  test("offers no badge publishing controls", async ({ page }) => {
    await open(
      page,
      scenario({
        status: status({
          eligibility: "approved",
          nextAction: "done",
          credential: credential(),
        }),
        identity: identity({ credential: credential() }),
      }),
    );
    await expect(
      page.getByRole("region", { name: "Payment statement" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Publish badge/ }),
    ).toHaveCount(0);
    await expect(page.getByTestId("identity-badge")).toHaveCount(0);
    await expect(page.getByTestId("public-identity-url")).toHaveCount(0);
  });
});

test.describe("passport PDF", () => {
  const verified = () =>
    scenario({
      status: status({
        eligibility: "approved",
        nextAction: "done",
        credential: credential(),
      }),
      identity: identity({ credential: credential() }),
    });

  test("downloads a monthly summary and lists it", async ({ page }) => {
    await open(page, verified());
    const tile = page.getByRole("region", { name: "Payment statement" });
    await expect(tile).toContainText("Only people you send this file to");
    await tile.getByRole("button", { name: "Download" }).click();

    const dialog = page.getByRole("dialog", { name: "Download payment statement" });
    await expect(
      dialog.getByRole("button", { name: "Monthly summary" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      dialog.getByRole("button", { name: "12 months" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByText("Payer addresses")).toBeHidden();

    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download PDF" }).click();
    expect((await download).suggestedFilename()).toMatch(
      /^OlioStatement-.*\d{4}-\d{2}-\d{2}\.pdf$/,
    );
    await expect(page.getByText("Payment statement downloaded")).toBeVisible();
    await expect(page.getByTestId("passport-statement")).toHaveCount(1);
  });

  test("offers payer address options only for a full list", async ({
    page,
  }) => {
    await open(page, verified());
    await page
      .getByRole("region", { name: "Payment statement" })
      .getByRole("button", { name: "Download" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Download payment statement" });
    await dialog.getByRole("button", { name: "Full payment list" }).click();
    await expect(
      dialog.getByRole("button", { name: "Masked" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByText(/GABC…WXYZ/)).toBeVisible();
  });

  test("revokes a statement after confirmation", async ({ page }) => {
    await open(page, verified());
    await page
      .getByRole("region", { name: "Payment statement" })
      .getByRole("button", { name: "Download" })
      .click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF" }).click();
    await download;
    await page.getByRole("button", { name: /^Revoke statement/ }).click();
    await page.getByRole("button", { name: "Confirm revoke" }).click();
    await expect(page.getByText("Statement revoked")).toBeVisible();
    await expect(page.getByTestId("passport-statement")).toContainText(
      "Revoked",
    );
  });

  test("hides the PDF until the badge is verified", async ({ page }) => {
    await open(
      page,
      scenario({
        status: status({ eligibility: "pending", nextAction: "wait" }),
        identity: identity({ credential: null }),
      }),
    );
    await expect(
      page.getByRole("region", { name: "Payment statement" }),
    ).toBeHidden();
    await expect(
      page.getByText(/available once identity verification is approved/),
    ).toBeVisible();
  });

  test("explains that recent payments are still syncing", async ({ page }) => {
    await open(
      page,
      scenario({
        ...verified(),
        failures: {
          "passport.issueStatement": {
            code: "PRECONDITION_FAILED",
            message:
              "Payments after 2026-10-15 14:02 UTC are still syncing. Try again in a few minutes.",
          },
        },
      }),
    );
    await page
      .getByRole("region", { name: "Payment statement" })
      .getByRole("button", { name: "Download" })
      .click();
    await page.getByRole("button", { name: "Download PDF" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Payments after 2026-10-15 14:02 UTC are still syncing",
    );
  });
});

test.describe("statement verify page", () => {
  test("confirms a valid statement and shows its digest", async ({ page }) => {
    await page.goto(`/verify/${VALID_STATEMENT_ID}`);
    await expect(
      page.getByRole("heading", { name: "Statement verified by Olio" }),
    ).toBeVisible();
    await expect(page.getByTestId("statement-status")).toHaveAttribute(
      "data-status",
      "valid",
    );
    await expect(
      page.getByText(/Issued by Olio on .* for Warung Verified/),
    ).toBeVisible();
    await expect(page.getByText("1,234.50 USDC")).toBeVisible();
    await expect(page.getByTestId("statement-digest")).toHaveText(
      STATEMENT_DIGEST,
    );
  });

  test("reports a revoked statement", async ({ page }) => {
    await page.goto(`/verify/${REVOKED_STATEMENT_ID}`);
    await expect(
      page.getByRole("heading", { name: "Statement revoked" }),
    ).toBeVisible();
    await expect(page.getByTestId("statement-status")).toHaveAttribute(
      "data-status",
      "revoked",
    );
  });

  test("never exposes internal identifiers", async ({ page }) => {
    await page.goto(`/verify/${VALID_STATEMENT_ID}`);
    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const secret of ["biz_e2e_published", "did:privy", "ce2eaccount"]) {
      expect(body).not.toContain(secret);
    }
  });

  test("returns nothing for an unknown or malformed id", async ({ page }) => {
    await page.goto("/verify/pst_doesNotExist0000000000");
    await expect(page.getByTestId("statement-not-found")).toBeVisible();
    await page.goto("/verify/not-a-statement");
    await expect(page.getByTestId("statement-not-found")).toBeVisible();
  });
});

test.describe("retired public identity page", () => {
  test("shows no badge for a business that had published one", async ({
    page,
  }) => {
    await page.goto(`/business/${PUBLISHED_PUBLIC_ID}`);
    await expect(
      page.getByRole("heading", { name: "Identity badges are retired" }),
    ).toBeVisible();
    await expect(page.getByTestId("public-identity-retired")).toContainText(
      "payment statement",
    );
    await expect(page.getByTestId("identity-badge")).toHaveCount(0);
  });

  test("never exposes business details, payments or internal identifiers", async ({
    page,
  }) => {
    await page.goto(`/business/${PUBLISHED_PUBLIC_ID}`);
    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const secret of [
      "warung verified",
      "usdc",
      "biz_e2e_published",
      "cred_biz_e2e_published",
      "case_biz_e2e_published",
      "ce2eaccount",
      "did:privy",
      "app_",
    ]) {
      expect(body).not.toContain(secret);
    }
  });

  test("answers every link the same way", async ({ page }) => {
    for (const publicId of [
      UNPUBLISHED_PUBLIC_ID,
      SUSPENDED_PUBLIC_ID,
      STALE_PUBLIC_ID,
      SANDBOX_PUBLIC_ID,
      "pub_does_not_exist",
      "not%20a%20valid%20id",
    ]) {
      await page.goto(`/business/${publicId}`);
      await expect(page.getByTestId("public-identity-retired")).toBeVisible();
      await expect(page.getByTestId("identity-badge")).toHaveCount(0);
    }
  });
});

test.describe("authenticated route protection", () => {
  test("shows no verification content to an unauthenticated visitor", async ({
    page,
  }) => {
    // Without Privy cookies the middleware sends every protected route to
    // sign-in before any page renders.
    for (const path of [
      "/verification",
      "/dashboard?verification=1",
      "/settings",
    ]) {
      const response = await page.request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      expect(response.headers().location).toBe("/");

      await page.goto(path);
      await expect(page).toHaveURL("/");
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
