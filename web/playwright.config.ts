import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3111);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./artifacts/verification-qa/test-results",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: "./artifacts/verification-qa/playwright-report",
        open: "never",
      },
    ],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command:
      process.env.E2E_SKIP_BUILD === "1"
        ? "pnpm run start"
        : "pnpm run build && pnpm run start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      E2E_HARNESS: "1",
      MONGODB_URI:
        process.env.E2E_MONGODB_URI ?? "mongodb://127.0.0.1:27017/olio_e2e",
      SUMSUB_MODE: "live",
      SUMSUB_APP_TOKEN: "sbx:e2e-token",
      SUMSUB_SECRET_KEY: "e2e-secret",
      SUMSUB_WEBHOOK_SECRET: "e2e-webhook-secret",
      SUMSUB_INDIVIDUAL_LEVEL: "olio-individual",
      SUMSUB_COMPANY_LEVEL: "olio-company",
      VERIFICATION_WORKER_ENABLED: "false",
      NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
    },
  },
  globalSetup: "./e2e/globalSetup.ts",
  globalTeardown: "./e2e/globalTeardown.ts",
});
