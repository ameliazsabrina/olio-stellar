import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
const vitestRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(vitestRequire.resolve("vite"));
const { default: react } = await import(
  require.resolve("@vitejs/plugin-react")
);
const { chromium } = require("@playwright/test");
const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = path.join(root, "e2e/onboarding-harness/state.tsx");
const output = path.join(root, "artifacts/verification-onboarding");
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: false,
  root,
  plugins: [react()],
  css: {
    postcss: {
      plugins: [
        require("@tailwindcss/postcss")({ base: path.join(root, "src") }),
      ],
    },
  },
  optimizeDeps: { entries: ["e2e/onboarding-harness/index.html"] },
  resolve: {
    alias: [
      { find: /.*\/WalletProvider$/, replacement: fixture },
      { find: /.*\/trpc\/react$/, replacement: fixture },
      { find: /^\.\/SumsubVerification$/, replacement: fixture },
      { find: /.*\/DashboardBackground$/, replacement: fixture },
      { find: /^next\/image$/, replacement: fixture },
      { find: "@", replacement: path.join(root, "src") },
    ],
  },
  server: { host: "127.0.0.1", port: 3127, strictPort: true },
});
await server.listen();
console.log("Fixture server ready; launching Chromium");
const browser = await chromium.launch({
  headless: true,
  channel: "chromium",
  timeout: 15000,
});
console.log("Chromium ready");
try {
  for (const [name, width, height] of [
    ["desktop", 1280, 900],
    ["mobile", 390, 844],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => console.error(error.message));
    console.log(`${name}: opening fixture`);
    await page.goto("http://127.0.0.1:3127/e2e/onboarding-harness/index.html", {
      waitUntil: "commit",
      timeout: 15000,
    });
    console.log(`${name}: fixture loaded`);
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Tab");
    const focusInside = await page
      .getByRole("dialog")
      .evaluate((el) => el.contains(document.activeElement));
    if (!focusInside)
      throw new Error("Keyboard focus escaped the required dialog");
    await page.mouse.click(2, 2);
    if (!(await page.getByRole("dialog").isVisible()))
      throw new Error("Backdrop dismissed required dialog");
    const animation = await page
      .getByRole("dialog")
      .evaluate((el) => getComputedStyle(el).animationDuration);
    if (animation.split(",").some((value) => parseFloat(value) > 0))
      throw new Error("Reduced motion was not respected");
    await page.keyboard.press("Escape");
    if (!(await page.getByRole("dialog").isVisible()))
      throw new Error("Required modal dismissed");
    await page.getByLabel("Display name (optional)").fill("Ayu Pratama");
    await page.screenshot({ path: path.join(output, `${name}-profile.png`) });
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByText(/government-issued ID/).waitFor();
    await page.screenshot({ path: path.join(output, `${name}-prepare.png`) });
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page
      .getByRole("button", { name: "Submit provider documents" })
      .waitFor();
    const overflow = await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    if (overflow) throw new Error(`${name}: dialog has horizontal overflow`);
    await page.screenshot({ path: path.join(output, `${name}-sdk.png`) });
    await page
      .getByRole("button", { name: "Submit provider documents" })
      .click();
    await page.getByText(/Confirming submission/).waitFor();
    if (await page.getByText("Dashboard is available").count())
      throw new Error("SDK callback unlocked access");
    await page.evaluate(() => window.verificationQA.confirm());
    await page.getByRole("button", { name: "Continue to dashboard" }).waitFor();
    await page.screenshot({ path: path.join(output, `${name}-submitted.png`) });
    await page.getByRole("button", { name: "Continue to dashboard" }).click();
    await page.getByRole("button", { name: /Notifications/ }).click();
    await page.getByText("Notifications", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `${name}-inbox.png`) });
    await page.getByRole("button", { name: "Mark all as read" }).click();
    await page
      .getByRole("button", { name: "Notifications", exact: true })
      .waitFor();
    await page.close();
    console.log(
      `${name}: dismissal, SDK confirmation, responsive layout and inbox passed`,
    );
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  server.httpServer?.closeAllConnections();
  await Promise.race([
    Promise.all([browser.close(), server.close()]),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  process.exit(process.exitCode ?? 0);
}
