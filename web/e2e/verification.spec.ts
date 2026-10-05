import {
  BUSINESS,
  COMPANY,
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

const HARNESS = "/e2e-harness";

async function open(page: Parameters<typeof stubTrpc>[0], state: Scenario) {
  await stubTrpc(page, state);
  await stubProviderSdk(page);
  await page.goto(HARNESS);
}

test.describe("individual onboarding", () => {
  test("creates a profile, starts verification and opens the provider session", async ({
    page,
  }) => {
    const state = scenario({ businesses: [], status: null, identity: null });
    await open(page, state);

    await expect(
      page.getByRole("heading", { name: "Who is being verified?" }),
    ).toBeVisible();
    await page.getByText("Just me").click();
    await page.getByLabel("Display name (optional)").fill("Ayu Pratama");
    await page.getByRole("button", { name: "Create profile" }).click();

    await expect(
      page.getByRole("heading", { name: /Individual profile/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Start verification" }).click();

    await expect(page.getByTestId("sumsub-sdk-frame")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Secure verification session" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /Documents and selfies are collected by our verification partner/,
      ),
    ).toBeVisible();
  });

  test("resumes an interrupted session without creating a second applicant", async ({
    page,
  }) => {
    const state = scenario({
      status: status({
        eligibility: "not_started",
        providerStage: "in_progress",
        nextAction: "continue",
      }),
    });
    await open(page, state);
    await page.getByRole("button", { name: "Continue verification" }).click();
    await expect(page.getByTestId("sumsub-sdk-frame")).toBeVisible();
    await page.getByRole("button", { name: "Close session" }).click();
    await expect(page.getByTestId("sumsub-sdk-frame")).toBeHidden();
    await page.getByRole("button", { name: "Continue verification" }).click();
    await expect(page.getByTestId("sumsub-sdk-frame")).toBeVisible();
  });

  test("refuses to start until the Olio account is linked", async ({
    page,
  }) => {
    const state = scenario({
      businesses: [{ ...BUSINESS, accountBound: false, username: null }],
      status: status({ canStart: false }),
    });
    await open(page, state);
    await expect(
      page.getByRole("button", { name: "Start verification" }),
    ).toBeHidden();
    await expect(
      page.getByText("Link your Olio account to start."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Link my account" }).click();
    await expect(page.getByText("Not linked")).toBeHidden();
  });
});

test.describe("company onboarding", () => {
  test("shows the company profile and waits on owner checks", async ({
    page,
  }) => {
    const state = scenario({
      businesses: [COMPANY],
      status: status({
        businessId: COMPANY.businessId,
        type: "company",
        eligibility: "pending",
        providerStage: "submitted",
        nextAction: "wait",
        userMessage:
          "Your details are being checked. This usually takes a few minutes.",
        canStart: true,
      }),
    });
    await open(page, state);
    await expect(
      page.getByRole("heading", { name: "Company profile" }),
    ).toBeVisible();
    await expect(page.getByText("In review")).toBeVisible();
    await expect(page.getByTestId("status-headline")).toHaveText(
      "Your details are being checked",
    );
    await expect(
      page.getByRole("button", { name: "Check status" }),
    ).toBeVisible();
  });
});

test.describe("status states", () => {
  const cases = [
    {
      name: "needs information",
      status: status({
        eligibility: "needs_information",
        nextAction: "resubmit",
        providerStage: "in_progress",
        userMessage:
          "Something in your submission needs another look. Continue verification to resubmit.",
      }),
      badge: "Action needed",
      headline: "One more step is needed",
      action: "Resubmit details",
    },
    {
      name: "manual review",
      status: status({
        eligibility: "manual_review",
        nextAction: "wait",
        providerStage: "on_hold",
        userMessage: "Your verification is under review.",
      }),
      badge: "Under review",
      headline: "A reviewer is taking a look",
      action: null,
    },
    {
      name: "declined",
      status: status({
        eligibility: "declined",
        nextAction: "contact_support",
        providerStage: "completed",
        canStart: false,
        userMessage: "Verification could not be completed for this business.",
      }),
      badge: "Not approved",
      headline: "Verification was not approved",
      action: null,
    },
    {
      name: "approved",
      status: status({
        eligibility: "approved",
        nextAction: "done",
        providerStage: "completed",
        canStart: false,
        credential: credential(),
        userMessage: "Identity verified.",
      }),
      badge: "Verified",
      headline: "Your identity is verified",
      action: null,
    },
  ];

  for (const entry of cases) {
    test(`renders the ${entry.name} state`, async ({ page }) => {
      await open(page, scenario({ status: entry.status }));
      await expect(page.getByText(entry.badge, { exact: true })).toBeVisible();
      await expect(page.getByTestId("status-headline")).toHaveText(
        entry.headline,
      );
      await expect(page.getByTestId("status-message")).toContainText(
        entry.status.userMessage ?? "",
      );
      if (entry.action) {
        await expect(
          page.getByRole("button", { name: entry.action }),
        ).toBeVisible();
      }
      await expect(page.getByTestId("sumsub-sdk-frame")).toBeHidden();
    });
  }

  test("offers the passport once approved", async ({ page }) => {
    await open(
      page,
      scenario({
        status: status({
          eligibility: "approved",
          nextAction: "done",
          canStart: false,
          credential: credential(),
        }),
        identity: identity({ credential: credential(), publishable: true }),
      }),
    );
    const link = page.getByRole("link", { name: "Open passport" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/passport");
  });
});

test.describe("failure handling", () => {
  test("shows a readable error when the provider is unreachable", async ({
    page,
  }) => {
    const state = scenario({
      failures: {
        "verification.start": {
          code: "BAD_GATEWAY",
          message:
            "Identity verification is briefly unavailable. Try again shortly.",
        },
      },
    });
    await open(page, state);
    await page.getByRole("button", { name: "Start verification" }).click();
    await expect(
      page.getByText(
        "Identity verification is briefly unavailable. Try again shortly.",
      ),
    ).toBeVisible();
    await expect(page.getByTestId("sumsub-sdk-frame")).toBeHidden();
  });

  test("reports a rate limit without opening a session", async ({ page }) => {
    const state = scenario({
      failures: {
        "verification.start": {
          code: "TOO_MANY_REQUESTS",
          message: "Too many requests. Retry in 42s.",
        },
      },
    });
    await open(page, state);
    await page.getByRole("button", { name: "Start verification" }).click();
    await expect(
      page.getByText("Too many requests. Retry in 42s."),
    ).toBeVisible();
    await expect(page.getByTestId("sumsub-sdk-frame")).toBeHidden();
  });

  test("keeps repeated submit clicks to a single session", async ({ page }) => {
    const tokenRequests: string[] = [];
    await stubTrpc(page, scenario());
    await stubProviderSdk(page);
    page.on("request", (request) => {
      if (request.url().includes("verification.sdkToken")) {
        tokenRequests.push(request.url());
      }
    });
    await page.goto(HARNESS);
    await page.getByRole("button", { name: "Start verification" }).click();
    await expect(page.getByTestId("sumsub-sdk-frame")).toBeVisible();
    await page.waitForTimeout(3000);
    await expect(page.locator('[data-testid="sumsub-sdk-frame"]')).toHaveCount(
      1,
    );
    expect(tokenRequests.length, tokenRequests.join("\n")).toBeLessThanOrEqual(
      2,
    );
  });

  test("surfaces a failing SDK token as a retryable session error", async ({
    page,
  }) => {
    const state = scenario({
      status: status({ nextAction: "continue", providerStage: "in_progress" }),
      failures: {
        "verification.sdkToken": {
          code: "PRECONDITION_FAILED",
          message: "Start verification before requesting a session.",
        },
      },
    });
    await open(page, state);
    await page.getByRole("button", { name: "Continue verification" }).click();
    await expect(
      page.getByText("The verification session could not be opened."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});

test.describe("client cannot grant approval", () => {
  test("a client-side submission leaves the server status unchanged", async ({
    page,
  }) => {
    const state = scenario({
      status: status({
        eligibility: "not_started",
        providerStage: "in_progress",
        nextAction: "continue",
      }),
    });
    await open(page, state);
    await page.getByRole("button", { name: "Continue verification" }).click();
    await expect(page.getByTestId("sumsub-sdk-frame")).toBeVisible();

    await page.evaluate(() => {
      window.postMessage(
        { type: "idCheck.onApplicantSubmitted", payload: {} },
        "*",
      );
    });

    await expect(page.getByText("Verified", { exact: true })).toBeHidden();
    await expect(page.getByTestId("status-headline")).not.toHaveText(
      "Your identity is verified",
    );
  });

  test("the refresh action reflects only what the server returns", async ({
    page,
  }) => {
    const state = scenario({
      status: status({
        eligibility: "pending",
        nextAction: "wait",
        userMessage:
          "Your details are being checked. This usually takes a few minutes.",
      }),
    });
    await open(page, state);
    await page.getByRole("button", { name: "Check status" }).click();
    await expect(page.getByText("Status refreshed")).toBeVisible();
    await expect(page.getByText("In review")).toBeVisible();
    await expect(page.getByText("Verified", { exact: true })).toBeHidden();
  });
});
