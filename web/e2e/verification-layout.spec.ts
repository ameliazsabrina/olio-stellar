import {
  credential,
  expect,
  identity,
  scenario,
  status,
  stubProviderSdk,
  stubTrpc,
  test,
} from "./fixtures/verification";
import { PUBLISHED_PUBLIC_ID } from "./globalSetup";

const approvedScenario = () =>
  scenario({
    status: status({
      eligibility: "approved",
      nextAction: "done",
      providerStage: "completed",
      canStart: false,
      credential: credential(),
      userMessage: "Identity verified.",
    }),
    identity: identity({ credential: credential(), publishable: true }),
  });

async function noHorizontalOverflow(page: Parameters<typeof stubTrpc>[0]) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth <= doc.clientWidth + 1;
  });
}

test.describe("bento layout", () => {
  test("renders the verification tiles without horizontal overflow", async ({
    page,
  }, testInfo) => {
    await stubTrpc(page, scenario());
    await stubProviderSdk(page);
    await page.goto("/e2e-harness");
    await expect(
      page.getByRole("heading", { name: "Verification", exact: true }),
    ).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
    await testInfo.attach(`verification-${testInfo.project.name}.png`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });

  test("renders the passport tiles without horizontal overflow", async ({
    page,
  }, testInfo) => {
    await stubTrpc(page, approvedScenario());
    await stubProviderSdk(page);
    await page.goto("/e2e-harness?screen=passport");
    await expect(
      page.getByRole("heading", { name: "Passport", exact: true }),
    ).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
    await testInfo.attach(`passport-${testInfo.project.name}.png`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });

  test("uses the shared tile shell, radius and typography", async ({
    page,
  }) => {
    await stubTrpc(page, scenario());
    await stubProviderSdk(page);
    await page.goto("/e2e-harness");
    const tiles = page.locator(".dashboard-tile");
    await expect(tiles.first()).toBeVisible();
    expect(await tiles.count()).toBeGreaterThanOrEqual(4);
    const radius = await tiles
      .first()
      .evaluate((node) => getComputedStyle(node).borderTopLeftRadius);
    expect(radius).toBe("36px");
    const headingFont = await page
      .getByRole("heading", { name: "Verification status" })
      .evaluate((node) => getComputedStyle(node).fontFamily);
    const pageTitleFont = await page
      .getByRole("heading", { name: "Verification", exact: true })
      .evaluate((node) => getComputedStyle(node).fontFamily);
    expect(headingFont).toBe(pageTitleFont);
  });

  test("keeps every tile inside the page gutter", async ({ page }) => {
    await stubTrpc(page, approvedScenario());
    await stubProviderSdk(page);
    await page.goto("/e2e-harness?screen=passport");
    const viewport = page.viewportSize();
    const boxes = await page.locator(".dashboard-tile").evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      }),
    );
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(8);
      expect(box.right).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
    }
  });

  test("uses restrained iconography on the verification screen", async ({
    page,
  }) => {
    await stubTrpc(page, scenario());
    await stubProviderSdk(page);
    await page.goto("/e2e-harness");
    const icons = await page.locator("main svg").count();
    const tiles = await page.locator(".dashboard-tile").count();
    expect(icons).toBeLessThanOrEqual(tiles + 6);
  });
});

test.describe("keyboard and assistive technology", () => {
  test("labels every tile region on both screens", async ({ page }) => {
    await stubTrpc(page, approvedScenario());
    await stubProviderSdk(page);
    await page.goto("/e2e-harness");
    for (const name of [
      "Verification status",
      "How it works",
      "What stays private",
    ]) {
      await expect(page.getByRole("region", { name })).toBeVisible();
    }
    await page.goto("/e2e-harness?screen=passport");
    for (const name of [
      "Identity claim",
      "Who can see it",
      "What this badge means",
    ]) {
      await expect(page.getByRole("region", { name })).toBeVisible();
    }
  });

  test("gives icon-only controls an accessible name", async ({ page }) => {
    await stubTrpc(
      page,
      scenario({
        identity: identity({
          credential: credential({ published: true }),
          publishable: true,
          publicPath: "/business/pub_e2e_individual",
        }),
      }),
    );
    await stubProviderSdk(page);
    await page.goto("/e2e-harness?screen=passport");
    await expect(
      page.getByRole("button", { name: "Copy public link" }),
    ).toBeVisible();
    const unnamed = await page
      .locator("button:not([aria-label])")
      .evaluateAll(
        (nodes) =>
          nodes.filter((node) => (node.textContent ?? "").trim().length === 0)
            .length,
      );
    expect(unnamed).toBe(0);
  });

  test("reaches the primary action by keyboard and activates it", async ({
    page,
  }) => {
    const state = scenario();
    await stubTrpc(page, state);
    await stubProviderSdk(page);
    await page.goto("/e2e-harness");
    const start = page.getByRole("button", { name: "Start verification" });
    await start.focus();
    await expect(start).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("sumsub-sdk-frame")).toBeVisible();
  });

  test("keeps status changes available as text, not colour alone", async ({
    page,
  }) => {
    await stubTrpc(
      page,
      scenario({
        status: status({
          eligibility: "needs_information",
          nextAction: "resubmit",
          userMessage: "Something in your submission needs another look.",
        }),
      }),
    );
    await stubProviderSdk(page);
    await page.goto("/e2e-harness");
    await expect(
      page.getByText("Action needed", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("status-message")).toContainText(
      "needs another look",
    );
  });
});

test.describe("existing dashboard regressions", () => {
  test("public pages still render and log no console errors", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const failed: string[] = [];
    page.on("requestfailed", (request) => failed.push(request.url()));

    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
    await page.goto(`/business/${PUBLISHED_PUBLIC_ID}`);
    await expect(page.getByTestId("identity-badge")).toBeVisible();

    const relevantErrors = errors.filter(
      (text) => !text.includes("privy") && !text.includes("favicon"),
    );
    expect(relevantErrors, relevantErrors.join("\n")).toEqual([]);
    expect(failed.filter((url) => url.includes("/_next/"))).toEqual([]);
  });

  test("the withdraw route shows no balances to an unauthenticated visitor", async ({
    page,
  }) => {
    await page.goto("/withdraw");
    await expect(page.locator("body")).toBeVisible();
    const text = await page.locator("body").innerText();
    expect(text).not.toContain("USDC available");
    expect(page.getByRole("button", { name: /Withdraw/ })).toHaveCount(0);
  });
});
