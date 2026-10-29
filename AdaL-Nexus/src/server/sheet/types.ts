import type { ResearchRecord } from "../research/types.js";

export const REQUIRED_HEADERS = [
  "Startup Name",
  "Candidate URL",
  "Origin",
  "Status",
  "Product Summary",
  "Target Market",
  "Pricing Summary",
  "Pricing Status",
  "Plan Details",
  "Field Reasons",
  "Evidence Quotes",
  "Source URLs",
  "Researched At",
] as const;

export type RequiredHeader = (typeof REQUIRED_HEADERS)[number];

export interface SheetWriteInput {
  records: ResearchRecord[];
  fileName?: string;
  sheetName?: string;
}

export interface SheetWriteOutput {
  filePath: string;
  fileName: string;
  rowCount: number;
  fileSizeBytes: number;
  sha256: string;
  sheetName: string;
  createdAt: string;
}

export interface SheetVerifyInput {
  filePath: string;
  expectedRowCount?: number;
  sheetName?: string;
}

export interface SheetVerifyOutput {
  filePath: string;
  fileName: string;
  rowCount: number;
  headers: string[];
  pricingCounts: {
    verifiedPlans: number;
    unavailable: number;
  };
  integrity: {
    fileReadable: boolean;
    allRequiredHeadersPresent: boolean;
    noBlankRequiredFields: boolean;
    allClaimsHaveEvidence: boolean;
    allSubscriptionPricesHavePlansAndQuotes: boolean;
  };
  verifiedAt: string;
}
