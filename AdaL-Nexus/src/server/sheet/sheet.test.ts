import assert from "node:assert/strict";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import test, { describe } from "node:test";
import ExcelJS from "exceljs";
import { Controller } from "../agent/controller.js";
import { PolicyEngine } from "../agent/policy.js";
import { ToolRegistry } from "../agent/registry.js";
import type { ToolContext } from "../agent/types.js";
import type { ResearchRecord } from "../research/types.js";
import { REQUIRED_HEADERS } from "./types.js";
import {
  createSheetTools,
  getOutputDir,
  resolveSafeOutputPath,
  resolveSafeVerifyPath,
} from "./tools.js";

const dummyCtx: ToolContext = {
  signal: new AbortController().signal,
  progress: () => {},
};

// Clearly labelled test-only fixture records
const TEST_ONLY_RECORDS: ResearchRecord[] = [
  {
    candidateUrl: "https://test-startup-one.example/",
    origin: "search",
    status: "ok",
    researchedAt: "2026-10-28T12:00:00.000Z",
    name: {
      value: "Test Startup One",
      evidence: [
        {
          kind: "title",
          quote: "Test Startup One | Next Gen AI",
          sourceUrl: "https://test-startup-one.example/",
        },
      ],
    },
    product: {
      value: "Test Startup One provides enterprise AI agents for automated coding workflows.",
      evidence: [
        {
          kind: "meta",
          quote: "Test Startup One provides enterprise AI agents for automated coding workflows.",
          sourceUrl: "https://test-startup-one.example/",
        },
      ],
    },
    targetMarket: {
      value: "enterprises",
      evidence: [
        {
          kind: "page_text",
          quote: "Built for enterprises scaling modern developer infrastructure.",
          sourceUrl: "https://test-startup-one.example/about",
        },
      ],
    },
    pricing: {
      value: "Pro: $49/month; Enterprise: $199/user/month",
      status: "found",
      prices: ["$49", "$199"],
      plans: [
        {
          plan: "Pro",
          price: "$49",
          period: "month",
          quote: "Pro $49 per month for developers",
        },
        {
          plan: "Enterprise",
          price: "$199",
          period: "month",
          per: "user",
          quote: "Enterprise $199 /month per user billed annually",
        },
      ],
      evidence: [
        {
          kind: "page_text",
          quote: "[Pricing]: Pro $49 per month; Enterprise $199 /month per user",
          sourceUrl: "https://test-startup-one.example/pricing",
        },
      ],
    },
    pages: [
      { url: "https://test-startup-one.example/", role: "home", title: "Test Startup One", status: 200 },
      { url: "https://test-startup-one.example/pricing", role: "pricing", title: "Pricing", status: 200 },
      { url: "https://test-startup-one.example/about", role: "about", title: "About", status: 200 },
    ],
  },
  {
    candidateUrl: "https://test-startup-two.example/",
    origin: "fallback",
    status: "partial",
    researchedAt: "2026-10-28T12:05:00.000Z",
    name: {
      value: "Test Startup Two",
      evidence: [
        {
          kind: "title",
          quote: "Test Startup Two – Scalable LLM Hosting",
          sourceUrl: "https://test-startup-two.example/",
        },
      ],
    },
    product: {
      value: "Cloud infrastructure for hosting open-source generative AI models.",
      evidence: [
        {
          kind: "meta",
          quote: "Cloud infrastructure for hosting open-source generative AI models.",
          sourceUrl: "https://test-startup-two.example/",
        },
      ],
    },
    targetMarket: {
      value: "Unavailable",
      evidence: [],
    },
    pricing: {
      value: "Unavailable (usage-based pricing)",
      status: "usage_based",
      prices: ["$0.0005/token"],
      reason: "only usage-based token rates found, not subscription plans",
      evidence: [
        {
          kind: "page_text",
          quote: "Pricing is $0.0005 per token consumed",
          sourceUrl: "https://test-startup-two.example/pricing",
        },
      ],
    },
    pages: [
      { url: "https://test-startup-two.example/", role: "home", title: "Test Startup Two", status: 200 },
      { url: "https://test-startup-two.example/pricing", role: "pricing", title: "Pricing", status: 200 },
    ],
  },
];

describe("Milestone 6: Excel Workbook Generation and Verification", () => {
  const [writeTool, verifyTool] = createSheetTools();
  const cleanupFiles: string[] = [];

  function registerForCleanup(filePath: string) {
    cleanupFiles.push(filePath);
  }

  test.after(() => {
    for (const f of cleanupFiles) {
      try {
        if (existsSync(f)) unlinkSync(f);
      } catch {
        /* best-effort test cleanup */
      }
    }
  });

  test("valid workbook round-trip: write and verify succeed with exact row counts and sha256", async () => {
    const testFileName = "test-roundtrip-valid";
    const writeRes = await writeTool.run(
      {
        records: TEST_ONLY_RECORDS,
        fileName: testFileName,
      },
      dummyCtx,
    );

    assert.ok(writeRes.output && typeof writeRes.output === "object");
    const writeOut = writeRes.output as { filePath: string; rowCount: number; sha256: string; fileSizeBytes: number };
    assert.equal(writeOut.rowCount, 2);
    assert.ok(existsSync(writeOut.filePath));
    assert.ok(writeOut.fileSizeBytes > 0);
    assert.match(writeOut.sha256, /^[a-f0-9]{64}$/);
    registerForCleanup(writeOut.filePath);

    // Verify independently
    const verifyRes = await verifyTool.run(
      {
        filePath: writeOut.filePath,
        expectedRowCount: 2,
      },
      dummyCtx,
    );

    assert.equal(verifyRes.verification, "verified");
    const verifyOut = verifyRes.output as {
      rowCount: number;
      integrity: { allRequiredHeadersPresent: boolean; allClaimsHaveEvidence: boolean };
      pricingCounts: { verifiedPlans: number; unavailable: number };
    };
    assert.equal(verifyOut.rowCount, 2);
    assert.equal(verifyOut.pricingCounts.verifiedPlans, 1);
    assert.equal(verifyOut.pricingCounts.unavailable, 1);
    assert.equal(verifyOut.integrity.allRequiredHeadersPresent, true);
    assert.equal(verifyOut.integrity.allClaimsHaveEvidence, true);
  });

  test("rejects missing required columns during verification", async () => {
    const outPath = resolveSafeOutputPath("test-missing-headers");
    registerForCleanup(outPath);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    // Row 1 has only a subset of headers
    ws.addRow(["Startup Name", "Candidate URL", "Product Summary"]);
    ws.addRow(["Foo", "https://foo.com", "Foo product"]);
    await wb.xlsx.writeFile(outPath);

    const res = await verifyTool.run({ filePath: outPath }, dummyCtx);
    assert.equal(res.verification, "failed");
    assert.match(res.note ?? "", /missing required column header/i);
  });

  test("rejects incorrect row count during verification", async () => {
    const testFileName = "test-row-count-mismatch";
    const writeRes = await writeTool.run(
      {
        records: TEST_ONLY_RECORDS,
        fileName: testFileName,
      },
      dummyCtx,
    );
    const writeOut = writeRes.output as { filePath: string };
    registerForCleanup(writeOut.filePath);

    // Expected 5 rows, but actual is 2
    const res = await verifyTool.run(
      {
        filePath: writeOut.filePath,
        expectedRowCount: 5,
      },
      dummyCtx,
    );
    assert.equal(res.verification, "failed");
    assert.match(res.note ?? "", /row count mismatch/i);
  });

  test("rejects row with missing source URL", async () => {
    const outPath = resolveSafeOutputPath("test-missing-source-url");
    registerForCleanup(outPath);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("AI Startups");
    ws.addRow(REQUIRED_HEADERS);
    // Missing Source URLs
    ws.addRow([
      "Test Name",
      "https://example.com/",
      "search",
      "ok",
      "Valid product",
      "Unavailable",
      "Unavailable",
      "unavailable",
      "Unavailable",
      "None",
      "[Name (title)]: quote",
      "", // Source URLs is EMPTY
      new Date().toISOString(),
    ]);
    await wb.xlsx.writeFile(outPath);

    const res = await verifyTool.run({ filePath: outPath }, dummyCtx);
    assert.equal(res.verification, "failed");
    assert.match(res.note ?? "", /"Source URLs" is empty/i);
  });

  test("rejects row with missing evidence quotes", async () => {
    const outPath = resolveSafeOutputPath("test-missing-evidence-quote");
    registerForCleanup(outPath);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("AI Startups");
    ws.addRow(REQUIRED_HEADERS);
    ws.addRow([
      "Test Name",
      "https://example.com/",
      "search",
      "ok",
      "Valid product",
      "Unavailable",
      "Unavailable",
      "unavailable",
      "Unavailable",
      "None",
      "", // Evidence Quotes is EMPTY
      "https://example.com/",
      new Date().toISOString(),
    ]);
    await wb.xlsx.writeFile(outPath);

    const res = await verifyTool.run({ filePath: outPath }, dummyCtx);
    assert.equal(res.verification, "failed");
    assert.match(res.note ?? "", /"Evidence Quotes" is empty/i);
  });

  test("rejects claimed price with unsupported status or without pricing quote", async () => {
    const outPath = resolveSafeOutputPath("test-unsupported-price-claim");
    registerForCleanup(outPath);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("AI Startups");
    ws.addRow(REQUIRED_HEADERS);
    // Claimed price "$49/month", but status is "ambiguous"
    ws.addRow([
      "Test Name",
      "https://example.com/",
      "search",
      "ok",
      "Valid product",
      "Unavailable",
      "$49/month", // Claimed price
      "ambiguous", // Conflict: claimed price with ambiguous status
      "Pro: $49/month",
      "ambiguous prices",
      "[Name (title)]: test",
      "https://example.com/",
      new Date().toISOString(),
    ]);
    await wb.xlsx.writeFile(outPath);

    const res = await verifyTool.run({ filePath: outPath }, dummyCtx);
    assert.equal(res.verification, "failed");
    assert.match(res.note ?? "", /pricing status is "ambiguous"/i);
  });

  test("rejects blank cells where explicit Unavailable is required", async () => {
    const outPath = resolveSafeOutputPath("test-blank-cell");
    registerForCleanup(outPath);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("AI Startups");
    ws.addRow(REQUIRED_HEADERS);
    ws.addRow([
      "Test Name",
      "https://example.com/",
      "search",
      "ok",
      "Valid product",
      "", // BLANK Target Market (must be explicit "Unavailable")
      "Unavailable",
      "unavailable",
      "Unavailable",
      "None",
      "[Name (title)]: quote",
      "https://example.com/",
      new Date().toISOString(),
    ]);
    await wb.xlsx.writeFile(outPath);

    const res = await verifyTool.run({ filePath: outPath }, dummyCtx);
    assert.equal(res.verification, "failed");
    assert.match(res.note ?? "", /"Target Market" is blank/i);
  });

  test("rejects claimed target market without target market quote in evidence", async () => {
    const outPath = resolveSafeOutputPath("test-missing-tm-quote");
    registerForCleanup(outPath);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("AI Startups");
    ws.addRow(REQUIRED_HEADERS);
    ws.addRow([
      "Test Name",
      "https://example.com/",
      "search",
      "ok",
      "Valid product",
      "enterprises", // Claimed target market
      "Unavailable",
      "unavailable",
      "Unavailable",
      "None",
      "[Product (meta)]: Valid product", // Has product quote, but MISSING target market quote
      "https://example.com/",
      new Date().toISOString(),
    ]);
    await wb.xlsx.writeFile(outPath);

    const res = await verifyTool.run({ filePath: outPath }, dummyCtx);
    assert.equal(res.verification, "failed");
    assert.match(res.note ?? "", /has no corresponding target market evidence quote/i);
  });

  test("rejects claimed product summary without product quote in evidence", async () => {
    const outPath = resolveSafeOutputPath("test-missing-prod-quote");
    registerForCleanup(outPath);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("AI Startups");
    ws.addRow(REQUIRED_HEADERS);
    ws.addRow([
      "Test Name",
      "https://example.com/",
      "search",
      "ok",
      "Unquoted product claim", // Claimed product summary
      "Unavailable",
      "Unavailable",
      "unavailable",
      "Unavailable",
      "None",
      "[Name (title)]: Test Name", // Missing [Product quote
      "https://example.com/",
      new Date().toISOString(),
    ]);
    await wb.xlsx.writeFile(outPath);

    const res = await verifyTool.run({ filePath: outPath }, dummyCtx);
    assert.equal(res.verification, "failed");
    assert.match(res.note ?? "", /has no corresponding product evidence quote/i);
  });

  test("handles missing, 0-byte, and corrupt files honestly", async () => {
    // Missing file
    const missingRes = await verifyTool.run({ filePath: "does-not-exist.xlsx" }, dummyCtx);
    assert.equal(missingRes.verification, "failed");
    assert.match(missingRes.note ?? "", /does not exist on disk/i);

    // 0-byte file
    const emptyPath = resolve(getOutputDir(), "test-zero-byte.xlsx");
    registerForCleanup(emptyPath);
    writeFileSync(emptyPath, Buffer.alloc(0));
    const emptyRes = await verifyTool.run({ filePath: emptyPath }, dummyCtx);
    assert.equal(emptyRes.verification, "failed");
    assert.match(emptyRes.note ?? "", /0 bytes/i);

    // Corrupted file (not a zip/xlsx)
    const corruptPath = resolve(getOutputDir(), "test-corrupted.xlsx");
    registerForCleanup(corruptPath);
    writeFileSync(corruptPath, "this is definitely not a zip file header");
    const corruptRes = await verifyTool.run({ filePath: corruptPath }, dummyCtx);
    assert.equal(corruptRes.verification, "failed");
    assert.match(corruptRes.note ?? "", /could not be parsed as valid Excel/i);
  });

  test("path traversal prevention in sheet.write, sheet.verify, and path helpers", async () => {
    assert.throws(() => resolveSafeOutputPath("../traversal.xlsx"), /path traversal denied/i);
    assert.throws(() => resolveSafeOutputPath("foo/bar.xlsx"), /path traversal denied/i);
    assert.throws(() => resolveSafeOutputPath("..\\traversal.xlsx"), /path traversal denied/i);

    assert.throws(() => resolveSafeVerifyPath("../../../etc/passwd"), /path traversal denied/i);
    assert.throws(() => resolveSafeVerifyPath("C:\\Windows\\system32\\calc.exe"), /path escape denied/i);

    await assert.rejects(
      async () =>
        writeTool.run(
          {
            records: TEST_ONLY_RECORDS,
            fileName: "../../escape",
          },
          dummyCtx,
        ),
      /path traversal denied/i,
    );

    await assert.rejects(
      async () =>
        verifyTool.run(
          {
            filePath: "../../escaped.xlsx",
          },
          dummyCtx,
        ),
      /path traversal denied/i,
    );
  });
});

describe("Milestone 6: Controller Integration with $ref Data Flow", () => {
  test("complete flow: records -> sheet.write -> sheet.verify completes successfully", async () => {
    const registry = new ToolRegistry();
    const [writeTool, verifyTool] = createSheetTools();
    registry.register(writeTool);
    registry.register(verifyTool);

    // Mock research provider tool that outputs records
    registry.register({
      name: "test.research",
      description: "Outputs test-only research records",
      async run() {
        return { output: { records: TEST_ONLY_RECORDS } };
      },
    });

    const controller = new Controller(registry, new PolicyEngine(registry));

    const plan = {
      goal: "Test Controller Excel Pipeline",
      steps: [
        {
          id: "research",
          title: "Research startups",
          tool: "test.research",
        },
        {
          id: "write",
          title: "Write Excel workbook",
          tool: "sheet.write",
          input: {
            records: { $ref: "research.records" },
            fileName: "test-controller-pipeline",
          },
        },
        {
          id: "verify",
          title: "Verify Excel workbook",
          tool: "sheet.verify",
          input: {
            filePath: { $ref: "write.filePath" },
            expectedRowCount: 2,
          },
        },
      ],
    };

    const snap = controller.start(plan);
    assert.ok(snap.status === "pending" || snap.status === "running");

    // Wait for run completion
    let current = controller.current()?.snapshot;
    while (current && current.status !== "completed" && current.status !== "failed") {
      await new Promise((r) => setTimeout(r, 20));
      current = controller.current()?.snapshot;
    }

    assert.equal(current?.status, "completed");
    const writeStep = current?.steps.find((s) => s.id === "write");
    const verifyStep = current?.steps.find((s) => s.id === "verify");

    assert.equal(writeStep?.status, "completed");
    assert.equal(verifyStep?.status, "completed");

    const writeOut = writeStep?.output as { filePath: string };
    if (writeOut?.filePath && existsSync(writeOut.filePath)) {
      try {
        unlinkSync(writeOut.filePath);
      } catch {
        /* best-effort */
      }
    }
  });

  test("controller marks task as failed if verification fails", async () => {
    const registry = new ToolRegistry();
    const [writeTool, verifyTool] = createSheetTools();
    registry.register(writeTool);
    registry.register(verifyTool);

    registry.register({
      name: "test.research",
      description: "Outputs test-only research records",
      async run() {
        return { output: { records: TEST_ONLY_RECORDS } }; // Has 2 records
      },
    });

    const controller = new Controller(registry, new PolicyEngine(registry));

    const plan = {
      goal: "Test Controller Excel Verification Failure",
      steps: [
        {
          id: "research",
          title: "Research startups",
          tool: "test.research",
        },
        {
          id: "write",
          title: "Write Excel workbook",
          tool: "sheet.write",
          input: {
            records: { $ref: "research.records" },
            fileName: "test-controller-fail",
          },
        },
        {
          id: "verify",
          title: "Verify Excel workbook",
          tool: "sheet.verify",
          input: {
            filePath: { $ref: "write.filePath" },
            expectedRowCount: 10, // Expects 10, but only 2 records -> Verification FAILS
          },
        },
      ],
    };

    controller.start(plan);

    let current = controller.current()?.snapshot;
    while (current && current.status !== "completed" && current.status !== "failed") {
      await new Promise((r) => setTimeout(r, 20));
      current = controller.current()?.snapshot;
    }

    assert.equal(current?.status, "failed");
    const verifyStep = current?.steps.find((s) => s.id === "verify");
    assert.equal(verifyStep?.status, "failed");
    assert.match(verifyStep?.reason ?? "", /row count mismatch/i);

    const writeStep = current?.steps.find((s) => s.id === "write");
    const writeOut = writeStep?.output as { filePath: string };
    if (writeOut?.filePath && existsSync(writeOut.filePath)) {
      try {
        unlinkSync(writeOut.filePath);
      } catch {
        /* best-effort */
      }
    }
  });
});
