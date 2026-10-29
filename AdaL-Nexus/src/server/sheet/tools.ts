import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import ExcelJS from "exceljs";
import type { Tool, ToolContext, ToolResult } from "../agent/types.js";
import type { ResearchRecord } from "../research/types.js";
import {
  REQUIRED_HEADERS,
  type SheetVerifyInput,
  type SheetVerifyOutput,
  type SheetWriteInput,
  type SheetWriteOutput,
} from "./types.js";

const OUTPUT_DIR = resolve(process.cwd(), "output");

export function getOutputDir(): string {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  return OUTPUT_DIR;
}

/**
 * Validates and safely resolves an output path strictly inside output/.
 * Rejects path traversal, separators, or paths attempting to escape output/.
 */
export function resolveSafeOutputPath(rawFileName?: string): string {
  const dir = getOutputDir();
  if (!rawFileName) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return resolve(dir, `ai-startups-research-${timestamp}.xlsx`);
  }
  const clean = rawFileName.trim();
  if (clean.includes("..") || clean.includes("/") || clean.includes("\\")) {
    throw new Error(`Path traversal denied: invalid fileName "${rawFileName}"`);
  }
  const finalName = clean.toLowerCase().endsWith(".xlsx") ? clean : `${clean}.xlsx`;
  const resolved = resolve(dir, finalName);
  if (!resolved.startsWith(dir + sep)) {
    throw new Error(`Path escape denied: "${resolved}" is outside output directory`);
  }
  return resolved;
}

/**
 * Validates and safely resolves a file path for verification strictly inside output/.
 */
export function resolveSafeVerifyPath(rawFilePath: string): string {
  const dir = getOutputDir();
  if (!rawFilePath || typeof rawFilePath !== "string") {
    throw new Error("filePath must be a non-empty string");
  }
  const clean = rawFilePath.trim();
  if (clean.includes("..")) {
    throw new Error(`Path traversal denied: invalid filePath "${rawFilePath}"`);
  }
  const resolved = isAbsolute(clean) ? resolve(clean) : resolve(dir, clean);
  if (!resolved.startsWith(dir + sep) && resolved !== dir) {
    throw new Error(`Path escape denied: "${resolved}" is outside output directory`);
  }
  return resolved;
}

function field(input: unknown, key: string): unknown {
  return input && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
}

export function formatPlanDetails(r: ResearchRecord): string {
  if (r.pricing?.plans && r.pricing.plans.length > 0) {
    return r.pricing.plans
      .map((p) => {
        const per = p.per ? `${p.per}/` : "";
        const period = p.period ? `/${per}${p.period}` : "";
        const billing = p.billing ? ` (billed ${p.billing})` : "";
        return `${p.plan}: ${p.price}${period}${billing}`;
      })
      .join("; ");
  }
  return "Unavailable";
}

export function formatFieldReasons(r: ResearchRecord): string {
  const reasons: string[] = [];
  if (r.error) reasons.push(`error: ${r.error}`);
  if (r.pricing?.reason) reasons.push(`pricing: ${r.pricing.reason}`);
  if (r.pricing?.ambiguousPlans?.length) {
    r.pricing.ambiguousPlans.forEach((a) => reasons.push(`${a.plan}: ${a.reason}`));
  }
  return reasons.length > 0 ? reasons.join("; ") : "None";
}

export function formatEvidenceQuotes(r: ResearchRecord): string {
  const quotes: string[] = [];
  r.name?.evidence?.forEach((e) => quotes.push(`[Name (${e.kind})]: "${e.quote}"`));
  r.product?.evidence?.forEach((e) => quotes.push(`[Product (${e.kind})]: "${e.quote}"`));
  r.targetMarket?.evidence?.forEach((e) => quotes.push(`[TargetMarket (${e.kind})]: "${e.quote}"`));
  r.pricing?.evidence?.forEach((e) => quotes.push(`[Pricing (${e.kind})]: "${e.quote}"`));
  if (quotes.length > 0) return quotes.join("\n");
  return r.status === "failed" ? "Unavailable (research failed)" : "Unavailable (no quotes found)";
}

export function formatSourceUrls(r: ResearchRecord): string {
  const urls = new Set<string>();
  if (r.candidateUrl) urls.add(r.candidateUrl);
  r.pages?.forEach((p) => urls.add(p.url));
  r.name?.evidence?.forEach((e) => urls.add(e.sourceUrl));
  r.product?.evidence?.forEach((e) => urls.add(e.sourceUrl));
  r.targetMarket?.evidence?.forEach((e) => urls.add(e.sourceUrl));
  r.pricing?.evidence?.forEach((e) => urls.add(e.sourceUrl));
  return Array.from(urls).join(", ");
}

export function createSheetTools(): Tool[] {
  // ---------------------------------------------------------------- sheet.write
  const writeTool: Tool = {
    name: "sheet.write",
    description:
      'Generates a real .xlsx workbook in the sandboxed output/ directory from research records. Input: {"records": ResearchRecord[] (normally {"$ref":"consolidate.records"}), "fileName"?: string, "sheetName"?: string}. Returns file details with SHA-256 hash.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      if (ctx.signal.aborted) throw new Error("cancelled");

      const rawRecords = field(input, "records");
      if (!Array.isArray(rawRecords) || rawRecords.length === 0) {
        throw new Error("sheet.write requires a non-empty records array in input.records");
      }
      if (rawRecords.length > 100) {
        throw new Error("sheet.write records array exceeds maximum limit of 100 entries");
      }

      const records = rawRecords as ResearchRecord[];
      // Validate that entries are record-like objects
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (!r || typeof r !== "object" || !r.candidateUrl) {
          throw new Error(`sheet.write record at index ${i} is missing candidateUrl`);
        }
      }

      const rawFileName = field(input, "fileName");
      const fileNameStr = typeof rawFileName === "string" ? rawFileName : undefined;
      const targetPath = resolveSafeOutputPath(fileNameStr);

      const rawSheetName = field(input, "sheetName");
      const sheetTitle = typeof rawSheetName === "string" && rawSheetName.trim() ? rawSheetName.trim().slice(0, 31) : "AI Startups";

      ctx.progress(`Creating Excel workbook for ${records.length} records at ${basename(targetPath)}`);

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "AdaL-Nexus Research Agent";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet(sheetTitle, {
        views: [{ state: "frozen", ySplit: 1 }],
      });

      // Define columns
      worksheet.columns = REQUIRED_HEADERS.map((h) => ({
        header: h,
        key: h,
        width: 25,
      }));

      // Style header row
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1F4E79" }, // Dark Navy Blue
      };
      headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
      headerRow.height = 28;

      // Add rows
      for (const r of records) {
        const nameVal = r.name?.value || "Unavailable";
        const prodVal = r.product?.value || "Unavailable";
        const tmVal = r.targetMarket?.value || "Unavailable";
        const pricingVal = r.pricing?.value || "Unavailable";
        const pricingStatus = r.pricing?.status || "unavailable";
        const planDetails = formatPlanDetails(r);
        const fieldReasons = formatFieldReasons(r);
        const quotes = formatEvidenceQuotes(r);
        const sourceUrls = formatSourceUrls(r);

        const row = worksheet.addRow({
          "Startup Name": nameVal,
          "Candidate URL": r.candidateUrl,
          Origin: r.origin || "search",
          Status: r.status || "ok",
          "Product Summary": prodVal,
          "Target Market": tmVal,
          "Pricing Summary": pricingVal,
          "Pricing Status": pricingStatus,
          "Plan Details": planDetails,
          "Field Reasons": fieldReasons,
          "Evidence Quotes": quotes,
          "Source URLs": sourceUrls,
          "Researched At": r.researchedAt || new Date().toISOString(),
        });

        row.alignment = { vertical: "top", wrapText: true };
      }

      // Auto-fit column widths with sane bounds
      worksheet.columns.forEach((column) => {
        let maxLen = 12;
        if (column.header) maxLen = Math.max(maxLen, String(column.header).length);
        column.eachCell?.({ includeEmpty: false }, (cell, rowNum) => {
          if (rowNum > 1 && cell.value) {
            const lines = String(cell.value).split("\n");
            for (const line of lines) {
              maxLen = Math.max(maxLen, Math.min(line.length, 60));
            }
          }
        });
        column.width = Math.min(Math.max(maxLen + 3, 15), 65);
      });

      // Write to disk
      await workbook.xlsx.writeFile(targetPath);

      const stats = statSync(targetPath);
      const fileBytes = stats.size;
      const hasher = createHash("sha256");
      hasher.update(Buffer.from(await workbook.xlsx.writeBuffer()));
      const sha256 = hasher.digest("hex");

      const output: SheetWriteOutput = {
        filePath: targetPath,
        fileName: basename(targetPath),
        rowCount: records.length,
        fileSizeBytes: fileBytes,
        sha256,
        sheetName: sheetTitle,
        createdAt: new Date().toISOString(),
      };

      ctx.progress(`Workbook written successfully: ${output.fileName} (${output.rowCount} rows, ${output.fileSizeBytes} bytes)`);

      return {
        output,
        note: `Generated Excel workbook "${output.fileName}" with ${output.rowCount} startup records.`,
      };
    },
  };

  // ---------------------------------------------------------------- sheet.verify
  const verifyTool: Tool = {
    name: "sheet.verify",
    description:
      'Reopens a saved .xlsx file from disk independently and verifies required columns, exact row counts, non-empty cells, evidence quotes, and plan/billing integrity. Input: {"filePath": string (normally {"$ref":"write.filePath"}), "expectedRowCount"?: number, "sheetName"?: string}. Fails if integrity checks fail.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      if (ctx.signal.aborted) throw new Error("cancelled");

      const rawFilePath = field(input, "filePath");
      if (typeof rawFilePath !== "string" || !rawFilePath.trim()) {
        throw new Error("sheet.verify requires a non-empty string in input.filePath");
      }

      const rawExpected = field(input, "expectedRowCount");
      const expectedRowCount = typeof rawExpected === "number" && Number.isInteger(rawExpected) && rawExpected > 0 ? rawExpected : undefined;

      const targetPath = resolveSafeVerifyPath(rawFilePath);

      if (!existsSync(targetPath)) {
        return {
          verification: "failed",
          note: `Verification failed: workbook file "${rawFilePath}" does not exist on disk.`,
          output: { filePath: targetPath, error: "file_not_found" },
        };
      }

      const fileStats = statSync(targetPath);
      if (fileStats.size === 0) {
        return {
          verification: "failed",
          note: `Verification failed: workbook file "${basename(targetPath)}" is 0 bytes (empty/truncated).`,
          output: { filePath: targetPath, error: "empty_file" },
        };
      }

      ctx.progress(`Reopening workbook ${basename(targetPath)} for independent verification`);

      const workbook = new ExcelJS.Workbook();
      try {
        await workbook.xlsx.readFile(targetPath);
      } catch (err) {
        return {
          verification: "failed",
          note: `Verification failed: workbook file could not be parsed as valid Excel (.xlsx): ${err instanceof Error ? err.message : String(err)}`,
          output: { filePath: targetPath, error: "parse_error" },
        };
      }

      if (workbook.worksheets.length === 0) {
        return {
          verification: "failed",
          note: "Verification failed: workbook contains no worksheets.",
          output: { filePath: targetPath, error: "no_worksheets" },
        };
      }

      const rawSheetName = field(input, "sheetName");
      const targetSheet = typeof rawSheetName === "string" && rawSheetName.trim() ? workbook.getWorksheet(rawSheetName.trim()) : workbook.worksheets[0];

      if (!targetSheet) {
        return {
          verification: "failed",
          note: `Verification failed: worksheet "${rawSheetName}" not found in workbook.`,
          output: { filePath: targetPath, error: "sheet_not_found" },
        };
      }

      // Check header row (row 1)
      const headerRow = targetSheet.getRow(1);
      const actualHeaders: string[] = [];
      headerRow.eachCell({ includeEmpty: false }, (cell) => {
        actualHeaders.push(String(cell.value || "").trim());
      });

      const missingHeaders = REQUIRED_HEADERS.filter((h) => !actualHeaders.includes(h));
      if (missingHeaders.length > 0) {
        return {
          verification: "failed",
          note: `Verification failed: missing required column header(s): ${missingHeaders.join(", ")}`,
          output: { filePath: targetPath, error: "missing_headers", missingHeaders },
        };
      }

      // Map header column indices (1-based)
      const colIndex = new Map<string, number>();
      headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        colIndex.set(String(cell.value || "").trim(), colNumber);
      });

      const dataRowCount = targetSheet.rowCount - 1;

      if (dataRowCount <= 0) {
        return {
          verification: "failed",
          note: "Verification failed: workbook contains 0 data rows.",
          output: { filePath: targetPath, error: "no_data_rows" },
        };
      }

      if (expectedRowCount !== undefined && dataRowCount !== expectedRowCount) {
        return {
          verification: "failed",
          note: `Verification failed: row count mismatch. Expected ${expectedRowCount} rows, but workbook contains ${dataRowCount} data rows.`,
          output: { filePath: targetPath, error: "row_count_mismatch", expectedRowCount, actualRowCount: dataRowCount },
        };
      }

      let verifiedPlanCount = 0;
      let unavailablePricingCount = 0;

      // Validate each row for evidence and integrity
      for (let rNum = 2; rNum <= targetSheet.rowCount; rNum++) {
        const row = targetSheet.getRow(rNum);
        const getCell = (colName: string): string => {
          const idx = colIndex.get(colName);
          if (!idx) return "";
          const val = row.getCell(idx).value;
          return String(val ?? "").trim();
        };

        const startupName = getCell("Startup Name");
        const candidateUrl = getCell("Candidate URL");
        const productSummary = getCell("Product Summary");
        const targetMarket = getCell("Target Market");
        const pricingSummary = getCell("Pricing Summary");
        const pricingStatus = getCell("Pricing Status");
        const planDetails = getCell("Plan Details");
        const evidenceQuotes = getCell("Evidence Quotes");
        const sourceUrls = getCell("Source URLs");

        // Required non-empty cells
        if (!startupName) {
          return {
            verification: "failed",
            note: `Verification failed at row ${rNum}: "Startup Name" is empty.`,
            output: { filePath: targetPath, error: "empty_cell", row: rNum, column: "Startup Name" },
          };
        }
        if (!candidateUrl) {
          return {
            verification: "failed",
            note: `Verification failed at row ${rNum}: "Candidate URL" is empty.`,
            output: { filePath: targetPath, error: "empty_cell", row: rNum, column: "Candidate URL" },
          };
        }
        if (!productSummary) {
          return {
            verification: "failed",
            note: `Verification failed at row ${rNum}: "Product Summary" is empty.`,
            output: { filePath: targetPath, error: "empty_cell", row: rNum, column: "Product Summary" },
          };
        }
        if (!sourceUrls) {
          return {
            verification: "failed",
            note: `Verification failed at row ${rNum}: "Source URLs" is empty. Every row must have a verifiable source URL.`,
            output: { filePath: targetPath, error: "missing_source_urls", row: rNum },
          };
        }
        if (!evidenceQuotes) {
          return {
            verification: "failed",
            note: `Verification failed at row ${rNum}: "Evidence Quotes" is empty. Every claim must have evidence quotes or an explicit Unavailable note.`,
            output: { filePath: targetPath, error: "missing_evidence_quotes", row: rNum },
          };
        }

        // Must not be blank: if unknown, must explicitly be "Unavailable"
        if (!targetMarket) {
          return {
            verification: "failed",
            note: `Verification failed at row ${rNum}: "Target Market" is blank. Unsupported claims must be marked "Unavailable", never left blank.`,
            output: { filePath: targetPath, error: "blank_target_market", row: rNum },
          };
        }
        if (!pricingSummary) {
          return {
            verification: "failed",
            note: `Verification failed at row ${rNum}: "Pricing Summary" is blank. Unsupported pricing must be marked "Unavailable", never left blank.`,
            output: { filePath: targetPath, error: "blank_pricing_summary", row: rNum },
          };
        }

        // Factual pricing verification:
        // A price must not be presented as a verified plan price unless the record has supporting evidence and valid plan/billing association
        const isUnavailablePricing = pricingSummary.startsWith("Unavailable");
        if (!isUnavailablePricing) {
          verifiedPlanCount++;
          if (pricingStatus === "ambiguous" || pricingStatus === "usage_based" || pricingStatus === "unavailable") {
            return {
              verification: "failed",
              note: `Verification failed at row ${rNum} (${startupName}): pricing is presented as "${pricingSummary}", but pricing status is "${pricingStatus}". Ambiguous or usage-based pricing must be Unavailable.`,
              output: { filePath: targetPath, error: "unsupported_price_status", row: rNum, startup: startupName },
            };
          }
          if (planDetails === "Unavailable" || !planDetails) {
            return {
              verification: "failed",
              note: `Verification failed at row ${rNum} (${startupName}): verified pricing reported without plan/billing details.`,
              output: { filePath: targetPath, error: "missing_plan_details", row: rNum, startup: startupName },
            };
          }
          if (!evidenceQuotes.includes("[Pricing") && !evidenceQuotes.includes("$") && !evidenceQuotes.includes("€") && !evidenceQuotes.includes("£")) {
            return {
              verification: "failed",
              note: `Verification failed at row ${rNum} (${startupName}): price "${pricingSummary}" has no corresponding pricing evidence quote.`,
              output: { filePath: targetPath, error: "missing_pricing_quote", row: rNum, startup: startupName },
            };
          }
        } else {
          unavailablePricingCount++;
        }

        // Factual target market claim verification:
        // A specific target market must have corresponding evidence quotes
        const isUnavailableTargetMarket = targetMarket === "Unavailable" || targetMarket.startsWith("Unavailable");
        if (!isUnavailableTargetMarket) {
          if (!evidenceQuotes.includes("[TargetMarket") && !evidenceQuotes.toLowerCase().includes(targetMarket.toLowerCase())) {
            return {
              verification: "failed",
              note: `Verification failed at row ${rNum} (${startupName}): target market "${targetMarket}" has no corresponding target market evidence quote.`,
              output: { filePath: targetPath, error: "missing_target_market_quote", row: rNum, startup: startupName },
            };
          }
        }

        // Factual product summary verification:
        // A specific product summary must have corresponding evidence quotes
        const isUnavailableProduct = productSummary === "Unavailable" || productSummary.startsWith("Unavailable");
        if (!isUnavailableProduct) {
          if (!evidenceQuotes.includes("[Product") && !evidenceQuotes.includes(productSummary.slice(0, 20))) {
            return {
              verification: "failed",
              note: `Verification failed at row ${rNum} (${startupName}): product summary has no corresponding product evidence quote.`,
              output: { filePath: targetPath, error: "missing_product_quote", row: rNum, startup: startupName },
            };
          }
        }
      }

      const output: SheetVerifyOutput = {
        filePath: targetPath,
        fileName: basename(targetPath),
        rowCount: dataRowCount,
        headers: actualHeaders,
        pricingCounts: {
          verifiedPlans: verifiedPlanCount,
          unavailable: unavailablePricingCount,
        },
        integrity: {
          fileReadable: true,
          allRequiredHeadersPresent: true,
          noBlankRequiredFields: true,
          allClaimsHaveEvidence: true,
          allSubscriptionPricesHavePlansAndQuotes: true,
        },
        verifiedAt: new Date().toISOString(),
      };

      ctx.progress(`Workbook verified: ${output.fileName} (${output.rowCount} rows, ${verifiedPlanCount} verified plan prices, all integrity checks passed)`);

      return {
        output,
        verification: "verified",
        note: `Verified workbook "${output.fileName}": ${output.rowCount} data rows match schema, required columns present, evidence quotes verified.`,
      };
    },
  };

  return [writeTool, verifyTool];
}
