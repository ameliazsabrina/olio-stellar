#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const CASES = [
  "CFG-01",
  "CFG-02",
  "DB-01",
  "DIR-01",
  "DIR-02",
  "DIR-03",
  "DIR-04",
  "DIR-05",
  "DIR-06",
  "SEC-01",
  "SEC-02",
  "SEC-03",
  "WDR-01",
  "WDR-02",
  "CCTP-01",
  "CCTP-02",
  "CCTP-03",
  "CCTP-04",
  "CCTP-05",
  "MG-01",
  "MG-02",
  "MG-03",
  "MG-04",
  "MG-05",
  "IDX-01",
  "GOV-01",
  "UX-01",
  "ROL-01",
];
const STATUSES = new Set(["PASS", "FAIL", "BLOCKED", "NOT RUN"]);
const args = process.argv.slice(2);
const command = args[0];
const option = (name) => {
  const value = args.find((candidate) => candidate.startsWith(`${name}=`));
  return value?.slice(name.length + 1);
};
const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

function validateRunId(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$/.test(value ?? "")) {
    fail("Run ID must contain 3-64 letters, numbers, underscores, or hyphens.");
  }
}

function runDirectory() {
  const explicit = option("--run-dir");
  if (explicit) return path.resolve(explicit);
  const runId = option("--run-id");
  validateRunId(runId);
  return path.resolve("artifacts/testnet-certification", runId);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function assertSanitized(value, trail = []) {
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (
        /(secret|private|token|jwt|salt|ciphertext|kyc|interactive.?url)/i.test(
          key,
        )
      ) {
        fail(
          `Evidence contains prohibited confidential field: ${[...trail, key].join(".")}`,
        );
      }
      assertSanitized(child, [...trail, key]);
    }
  } else if (typeof value === "string") {
    if (/^S[A-Z2-7]{55}$/.test(value) || /^eyJ[A-Za-z0-9_-]+\./.test(value)) {
      fail(`Evidence appears to contain a secret at ${trail.join(".")}.`);
    }
  }
}

function assertAccounting(evidence) {
  if (!evidence.accounting) return;
  const { principal, feeBps, fee, gross } = evidence.accounting;
  const p = BigInt(principal);
  const f = BigInt(fee);
  const g = BigInt(gross);
  const bps = BigInt(feeBps);
  if (![200n, 500n].includes(bps)) fail("Evidence feeBps must be 200 or 500.");
  if ((p * bps) / 10_000n !== f || p + f !== g) {
    fail(
      "Evidence violates fee=floor(principal*bps/10000) or gross=principal+fee.",
    );
  }
  if (evidence.channel === "cctp" && g % 10n !== 0n) {
    fail("CCTP gross is not representable at the six-decimal source boundary.");
  }
}

function assertPassEvidence(evidence) {
  if (
    !Array.isArray(evidence.transactionHashes) ||
    evidence.transactionHashes.length === 0 ||
    !evidence.transactionHashes.every(
      (hash) => typeof hash === "string" && /^[a-fA-F0-9]{64}$/.test(hash),
    )
  ) {
    fail(
      "PASS evidence must include at least one 64-character transaction hash.",
    );
  }
  if (
    !evidence.expectedVsActual ||
    typeof evidence.expectedVsActual !== "object" ||
    Array.isArray(evidence.expectedVsActual) ||
    Object.keys(evidence.expectedVsActual).length === 0
  ) {
    fail(
      "PASS evidence must include non-empty expected-versus-actual evidence.",
    );
  }
}

function writeReport(directory, cases) {
  const counts = Object.fromEntries([...STATUSES].map((status) => [status, 0]));
  for (const item of cases) counts[item.status] += 1;
  const lines = [
    "# Testnet certification report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `PASS ${counts.PASS} · FAIL ${counts.FAIL} · BLOCKED ${counts.BLOCKED} · NOT RUN ${counts["NOT RUN"]}`,
    "",
    "| Case | Status | Summary | Evidence |",
    "|---|---|---|---|",
    ...cases.map(
      (item) =>
        `| ${item.id} | ${item.status} | ${item.summary || ""} | ${(item.evidenceFiles ?? []).join(", ")} |`,
    ),
    "",
    counts.FAIL || counts.BLOCKED || counts["NOT RUN"]
      ? "Release gate: NOT CERTIFIED. Resolve every mandatory enabled-path case before claiming certification."
      : "Release gate: matrix complete. Perform the documented human evidence review before release.",
    "",
  ];
  fs.writeFileSync(path.join(directory, "report.md"), lines.join("\n"));
}

if (command === "init") {
  const directory = runDirectory();
  if (fs.existsSync(directory))
    fail("Run directory already exists; use a new run ID.");
  fs.mkdirSync(directory, { recursive: true });
  writeJson(path.join(directory, "manifest.json"), {
    schemaVersion: 1,
    runId: path.basename(directory),
    network: "testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
    createdAt: new Date().toISOString(),
    applicationRevision: option("--revision") ?? null,
    diffHash: option("--diff-hash") ?? null,
    contracts: { registry: null, pool: null, intake: null, usdcSac: null },
    enabledChannels: [],
  });
  const cases = CASES.map((id) => ({
    id,
    status: "NOT RUN",
    summary: "",
    evidenceFiles: [],
  }));
  writeJson(path.join(directory, "cases.json"), cases);
  writeReport(directory, cases);
  process.stdout.write(`${directory}\n`);
} else if (command === "record") {
  const directory = runDirectory();
  const caseId = option("--case");
  const status = option("--status");
  const evidenceFile = option("--evidence");
  if (!CASES.includes(caseId)) fail("Unknown certification case ID.");
  if (!STATUSES.has(status))
    fail("Status must be PASS, FAIL, BLOCKED, or NOT RUN.");
  if (!evidenceFile) fail("--evidence=PATH is required.");
  const evidence = readJson(path.resolve(evidenceFile));
  assertSanitized(evidence);
  assertAccounting(evidence);
  if (status === "PASS") assertPassEvidence(evidence);
  const casesPath = path.join(directory, "cases.json");
  const cases = readJson(casesPath);
  const item = cases.find(({ id }) => id === caseId);
  if (!item) fail("Certification case file is malformed or incomplete.");
  item.status = status;
  item.summary = String(evidence.summary ?? "").slice(0, 240);
  item.evidenceFiles = [path.relative(directory, path.resolve(evidenceFile))];
  item.updatedAt = new Date().toISOString();
  writeJson(casesPath, cases);
  writeReport(directory, cases);
} else if (command === "report") {
  const directory = runDirectory();
  writeReport(directory, readJson(path.join(directory, "cases.json")));
} else if (command === "certify-routes") {
  const directory = runDirectory();
  const envFile = option("--env-file");
  if (!envFile) fail("--env-file=PATH is required.");
  const cases = readJson(path.join(directory, "cases.json"));
  const failing = cases.filter(
    ({ id, status }) => id.startsWith("CCTP-") && status !== "PASS",
  );
  if (failing.length > 0) {
    fail(
      `Route certification requires every CCTP case to PASS; pending: ${failing.map(({ id }) => id).join(", ")}.`,
    );
  }
  const resolvedEnvFile = path.resolve(envFile);
  const lines = fs.readFileSync(resolvedEnvFile, "utf8").split("\n");
  const index = lines.findIndex((line) => line.startsWith("CCTP_ROUTE_MANIFEST="));
  if (index < 0) fail("CCTP_ROUTE_MANIFEST is not present in the environment file; run deploy-testnet.sh first.");
  const raw = lines[index].slice("CCTP_ROUTE_MANIFEST=".length).replace(/^['"]|['"]$/g, "");
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    fail("CCTP_ROUTE_MANIFEST is not valid JSON.");
  }
  const runManifest = readJson(path.join(directory, "manifest.json"));
  if (runManifest.contracts?.pool && runManifest.contracts.pool !== manifest.pool) {
    fail("Certification run pool does not match the environment manifest pool.");
  }
  if (runManifest.contracts?.intake && runManifest.contracts.intake !== manifest.intake) {
    fail("Certification run intake does not match the environment manifest intake.");
  }
  const requested = option("--domains");
  const domains = requested
    ? requested.split(",").map((value) => Number(value.trim()))
    : manifest.routes.filter((route) => route.eligible).map((route) => route.domain);
  for (const domain of domains) {
    const route = manifest.routes.find((candidate) => candidate.domain === domain);
    if (!route) fail(`Domain ${domain} is not present in the route manifest.`);
    if (!route.eligible) fail(`Domain ${domain} is not eligible and cannot be certified.`);
    route.certified = true;
  }
  manifest.evidence = path.basename(directory);
  const line = `CCTP_ROUTE_MANIFEST='${JSON.stringify(manifest)}'`;
  lines[index] = line;
  fs.writeFileSync(resolvedEnvFile, lines.join("\n"));
  process.stdout.write(
    [
      `Certified domains ${domains.join(", ")} for pool ${manifest.pool}.`,
      "",
      "Paste into .env.production on the VPS, then `docker compose up -d web cctp-settlement`:",
      "",
      line,
      "CCTP_WORKER_ENABLED=true",
      "",
      "CCTP_SESSION_KEY on the VPS is deployment-specific; generate it there with `openssl rand -hex 32` and never reuse the local key.",
      "",
    ].join("\n"),
  );
} else {
  fail("Usage: certify-testnet.mjs <init|record|report|certify-routes> --run-id=ID [options]");
}
