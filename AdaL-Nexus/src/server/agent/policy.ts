import type { PlanStep, Tool } from "./types.js";

export type PolicyDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | { kind: "require_approval"; reason: string };

export interface ToolLookup {
  get(name: string): Tool | undefined;
}

export interface Policy {
  evaluate(step: PlanStep): PolicyDecision;
}

const SENSITIVE_KEYWORDS = [
  "submit",
  "purchase",
  "buy",
  "checkout",
  "pay",
  "payment",
  "publish",
  "delete",
  "password",
  "billing",
  "account setting",
  "settings",
  "credit card",
  "confirm order",
  "place order",
];

export function isSensitiveAction(step: PlanStep): string | null {
  const input = step.input && typeof step.input === "object" ? (step.input as Record<string, unknown>) : {};
  if (input.isFormSubmit === true) {
    return "Action submits a form, which requires explicit user approval.";
  }
  if (input.isSensitive === true) {
    return "Action is marked as sensitive and requires explicit user approval.";
  }

  // Check description, text, selector, or action title for sensitive operations
  const candidateTexts = [
    step.title,
    typeof input.description === "string" ? input.description : "",
    typeof input.text === "string" ? input.text : "",
    typeof input.selector === "string" ? input.selector : "",
    typeof input.placeholder === "string" ? input.placeholder : "",
  ].join(" ").toLowerCase();

  for (const kw of SENSITIVE_KEYWORDS) {
    if (candidateTexts.includes(kw)) {
      // Exclude harmless search actions (e.g. typing a search query into search box)
      const isSearchField =
        input.placeholder?.toString().toLowerCase().includes("search") ||
        input.selector?.toString().toLowerCase().includes("search") ||
        step.title.toLowerCase().includes("search");
      if (step.tool === "browser.type" && !input.isSensitive && isSearchField) {
        continue;
      }
      return `Action involves "${kw}" (submitting forms, making purchases, publishing content, or modifying account settings requires explicit user approval).`;
    }
  }

  return null;
}

/**
 * Decides whether a step may run. Deliberately independent of the controller:
 * it only sees a step and the tool lookup.
 */
export class PolicyEngine implements Policy {
  constructor(private tools: ToolLookup) {}

  evaluate(step: PlanStep): PolicyDecision {
    const tool = this.tools.get(step.tool);
    if (!tool) return { kind: "deny", reason: `tool "${step.tool}" is not registered` };
    if (tool.sensitive) {
      return { kind: "require_approval", reason: `tool "${tool.name}" is sensitive` };
    }
    if (step.requiresApproval) {
      return { kind: "require_approval", reason: "plan marked this step as requiring approval" };
    }
    const sensitiveReason = isSensitiveAction(step);
    if (sensitiveReason) {
      return { kind: "require_approval", reason: sensitiveReason };
    }
    return { kind: "allow" };
  }
}
