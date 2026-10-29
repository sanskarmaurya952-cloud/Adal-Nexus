import { randomUUID } from "node:crypto";
import type { Plan, PlanStep } from "./types.js";
import type { PlanDraft } from "../planner/planner.js";
import { taskContext } from "./taskContext.js";

interface ParsedCommand {
  tool: string;
  title: string;
  input: Record<string, unknown>;
  requiresApproval?: boolean;
}

const COMMON_SITES: Record<string, string> = {
  youtube: "https://www.youtube.com",
  flipkart: "https://www.flipkart.com",
  google: "https://www.google.com",
  github: "https://github.com",
  duckduckgo: "https://duckduckgo.com",
  wikipedia: "https://www.wikipedia.org",
  twitter: "https://twitter.com",
  x: "https://x.com",
  linkedin: "https://www.linkedin.com",
  instagram: "https://www.instagram.com",
  reddit: "https://www.reddit.com",
  amazon: "https://www.amazon.com",
};

/**
 * Normalizes input text by removing accents, extra spaces, and basic punctuation.
 */
function clean(input: string): string {
  return input
    .toLowerCase()
    .replace(/[।.,!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parses an individual single-intent phrase into a structured browser action.
 */
function parseSingleIntent(rawPhrase: string): ParsedCommand | null {
  const text = clean(rawPhrase);
  if (!text) return null;

  // 1. YouTube Playback: "YouTube par Arijit Singh ka song play karo" / "play Arijit Singh song on YouTube"
  if (
    (text.includes("youtube") || text.includes("yt") || text.includes("gana") || text.includes("song") || text.includes("video")) &&
    (text.includes("play") || text.includes("bajao") || text.includes("chalao") || text.includes("sunao") || text.includes("start"))
  ) {
    let query = text;
    // Strip common filler words
    query = query
      .replace(/\b(youtube|yt)\b/gi, "")
      .replace(/\b(par|pe|mein|in|on)\b/gi, "")
      .replace(/\b(ka|ki|ke|ko|se)\b/gi, "")
      .replace(/\b(song|gana|gaana|video|track|music)\b/gi, "")
      .replace(/\b(play|karo|chalao|bajao|sunao|start|dekho|laga|lagao)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    const displayQuery = query || "trending music";
    return {
      tool: "browser.play_youtube_video",
      title: `Play "${displayQuery}" on YouTube`,
      input: { query: displayQuery },
    };
  }

  // 2. Pause Media: "video pause karo", "gana roko", "pause media"
  if (
    text.includes("pause") ||
    text.includes("roko") ||
    text.includes("ruk jao") ||
    text.includes("stop media") ||
    text.includes("stop playback")
  ) {
    return {
      tool: "browser.pause_media",
      title: "Pause media playback",
      input: {},
    };
  }

  // 3. New Tab: "naya tab kholo", "new tab kholo", "open new tab"
  if (
    text.includes("naya tab") ||
    text.includes("new tab") ||
    text.includes("ek aur tab") ||
    text.includes("create tab") ||
    text.includes("open a new tab")
  ) {
    // Check if target website is mentioned with the new tab
    for (const [siteKey, siteUrl] of Object.entries(COMMON_SITES)) {
      if (siteKey.length > 1 && new RegExp(`\\b${siteKey}\\b`, "i").test(text)) {
        return {
          tool: "browser.new_tab",
          title: `Open new tab with ${siteKey.toUpperCase()}`,
          input: { url: siteUrl },
        };
      }
    }
    return {
      tool: "browser.new_tab",
      title: "Open new browser tab",
      input: {},
    };
  }

  // 4. Switch Tab: "pichhle tab par jao", "previous tab", "agla tab", "next tab"
  if (
    text.includes("pichhle tab") ||
    text.includes("pichle tab") ||
    text.includes("previous tab") ||
    text.includes("piche wale tab") ||
    text.includes("last tab")
  ) {
    return {
      tool: "browser.switch_tab",
      title: "Switch to previous browser tab",
      input: { target: "previous" },
    };
  }
  if (
    text.includes("agla tab") ||
    text.includes("next tab") ||
    text.includes("aage wale tab")
  ) {
    return {
      tool: "browser.switch_tab",
      title: "Switch to next browser tab",
      input: { target: "next" },
    };
  }

  // 5. Close Tab: "tab close karo", "tab band karo", "ye tab band karo"
  if (
    (text.includes("tab") && (text.includes("close") || text.includes("band") || text.includes("hatao"))) ||
    text === "close tab" ||
    text === "band karo"
  ) {
    return {
      tool: "browser.close_tab",
      title: "Close browser tab",
      input: {},
    };
  }

  // 6. Get Tabs: "saare tabs dikhao", "tabs dikhao", "list tabs", "show tabs"
  if (
    text.includes("tabs dikhao") ||
    text.includes("saare tabs") ||
    text.includes("all tabs") ||
    text.includes("list tabs") ||
    text.includes("show tabs") ||
    text.includes("tab overview")
  ) {
    return {
      tool: "browser.get_tabs",
      title: "List open browser tabs",
      input: {},
    };
  }

  // 7. Refresh / Reload: "is website ko refresh karo", "page reload karo", "refresh karo"
  if (
    text.includes("refresh") ||
    text.includes("reload") ||
    text.includes("dobara load")
  ) {
    return {
      tool: "browser.refresh",
      title: "Refresh current page",
      input: {},
    };
  }

  // 8. History Navigation (Back / Forward): "peeche jao", "back jao", "aage jao", "forward jao"
  if (text.includes("peeche jao") || text.includes("back jao") || text.includes("go back") || text === "back") {
    return {
      tool: "browser.back",
      title: "Navigate back in browser history",
      input: {},
    };
  }
  if (text.includes("aage jao") || text.includes("forward jao") || text.includes("go forward") || text === "forward") {
    return {
      tool: "browser.forward",
      title: "Navigate forward in browser history",
      input: {},
    };
  }

  // 9. Web Search: "Google par Python tutorials search karo" / "search Python tutorials on Google"
  if (text.includes("search") || text.includes("dhundo") || text.includes("khojo")) {
    let query = text;
    let engine = "duckduckgo";
    if (text.includes("google")) engine = "google";

    query = query
      .replace(/\b(google|duckduckgo|ddg|bing)\b/gi, "")
      .replace(/\b(par|pe|mein|in|on)\b/gi, "")
      .replace(/\b(search|karo|dhundo|khojo|find|look up)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    if (query) {
      if (engine === "google") {
        return {
          tool: "browser.open_url",
          title: `Search Google for "${query}"`,
          input: { url: `https://www.google.com/search?q=${encodeURIComponent(query)}` },
        };
      }
      return {
        tool: "browser.search",
        title: `Search DuckDuckGo for "${query}"`,
        input: { query, maxResults: 8 },
      };
    }
  }

  // 10. Open Social Media Demo: "Adal Nexus mein social media demo kholo"
  if (text.includes("social") || text.includes("demo post") || text.includes("autopilot")) {
    return {
      tool: "system.note",
      title: "Open Social Media Demo Mode",
      input: { text: "Opening Social Media Demo presentation workspace." },
    };
  }

  // 11. Open Specific Site: "YouTube kholo" / "Flipkart kholo" / "open youtube" / "open flipkart"
  const hasOpenVerb = /\b(kholo|open|visit|launch|chalao|go to|jao)\b/i.test(text);
  for (const [siteKey, siteUrl] of Object.entries(COMMON_SITES)) {
    const siteRegex = new RegExp(`\\b${siteKey}(?:\\.com)?\\b`, "i");
    if (siteRegex.test(text)) {
      const isJustSite = siteKey.length > 1 && (text === siteKey || text === `${siteKey}.com`);
      if (hasOpenVerb || isJustSite) {
        return {
          tool: "browser.open_url",
          title: `Open ${siteKey.toUpperCase()} (${siteUrl})`,
          input: { url: siteUrl },
        };
      }
    }
  }

  // 12. Direct URL: e.g. "open https://example.com" or "visit example.com"
  if (hasOpenVerb || /^https?:\/\//i.test(text)) {
    const urlMatch = text.match(/(https?:\/\/[^\s]+|[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s]*)?)/i);
    if (urlMatch) {
      const rawUrl = urlMatch[1];
      const canonical = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
      return {
        tool: "browser.open_url",
        title: `Open ${canonical}`,
        input: { url: canonical },
      };
    }
  }

  // 13. Current Page Info / Inspection: "ye kaunsi website hai", "current page kya hai", "inspect page"
  if (
    text.includes("current page") ||
    text.includes("kaunsi website") ||
    text.includes("kaunsa page") ||
    text.includes("page info") ||
    text.includes("inspect page") ||
    text.includes("what page is this") ||
    text.includes("where am i")
  ) {
    return {
      tool: "browser.get_current_page",
      title: "Inspect current browser webpage",
      input: {},
    };
  }

  // 14. Cancel previous running task: "pehle task cancel kar do", "cancel previous task"
  if (
    (/\b(cancel|roko|stop)\b/i.test(text) && /\b(task|mission|kaam|pehle|previous)\b/i.test(text)) ||
    text === "cancel task" ||
    text === "task cancel karo"
  ) {
    return {
      tool: "system.note",
      title: "Cancel running task execution",
      input: { text: "Previous task execution cancelled upon user instruction." },
    };
  }

  return null;
}

/**
 * Splits multi-intent requests and compiles them into a PlanDraft.
 * Supports Hindi/Hinglish connectors: "aur", "and", "then", "fir", "phir", commas.
 * Also handles rich multi-step domain workflows (Research, Research-to-Excel, Draft creation, and Cancellation).
 */
export function parseLocalCommand(rawTask: string): PlanDraft | null {
  const trimmed = rawTask.trim();
  if (!trimmed) return null;

  const cleaned = clean(trimmed);

  // =========================================================================
  // 1. Task Cancellation Intent: "Pehle task cancel kar do", "cancel task"
  // =========================================================================
  if (
    (/\b(cancel|roko|stop)\b/i.test(cleaned) && /\b(task|mission|kaam|pehle|previous)\b/i.test(cleaned)) ||
    cleaned === "cancel task" ||
    cleaned === "task cancel karo" ||
    cleaned === "task roko"
  ) {
    const planId = randomUUID();
    const plan: Plan = {
      goal: "Cancel running task execution",
      steps: [
        {
          id: "step_1",
          title: "Cancel running task execution",
          tool: "system.note",
          input: { text: "Previous task execution cancelled upon user instruction." },
        },
      ],
    };
    return {
      planId,
      task: trimmed,
      plan,
      limitations: [],
      approvalStepIds: [],
      provider: "local-intent-engine",
      model: "desktop-command-parser",
      createdAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // 2. Draft Creation Intent: "Meri post ka draft taiyar karo", "Meri LinkedIn post ka draft taiyar karo"
  // =========================================================================
  if (
    cleaned.includes("draft") ||
    (cleaned.includes("post") &&
      (cleaned.includes("taiyar") ||
        cleaned.includes("prepare") ||
        cleaned.includes("likho") ||
        cleaned.includes("banao")))
  ) {
    let platform: "linkedin" | "twitter" | "instagram" = "linkedin";
    if (
      cleaned.includes("twitter") ||
      cleaned.includes(" x ") ||
      cleaned.startsWith("x ") ||
      cleaned.includes("tweet")
    ) {
      platform = "twitter";
    } else if (cleaned.includes("instagram") || cleaned.includes("insta")) {
      platform = "instagram";
    }

    let topic = cleaned
      .replace(/\b(meri|mera|my|hamari)\b/gi, "")
      .replace(/\b(linkedin|twitter|instagram|insta|x|social)\b/gi, "")
      .replace(/\b(post|tweet|caption)\b/gi, "")
      .replace(/\b(ka|ki|ke|ko|par|pe|mein|on|for|about)\b/gi, "")
      .replace(/\b(draft|outline)\b/gi, "")
      .replace(/\b(taiyar|ready|prepare|create|banao|bana|do|karo|likho)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!topic) {
      topic = taskContext.getLastTopic() || "";
    }

    if (!topic) {
      topic = "Autonomous AI Agent Workflows and Future of Intelligent Software";
    }

    const planId = randomUUID();
    const input = { topic, platform, tone: "professional" };
    const plan: Plan = {
      goal: `Prepare editable ${platform.toUpperCase()} post draft on "${topic}"`,
      steps: [
        {
          id: "step_1",
          title: `Generate editable ${platform.toUpperCase()} draft`,
          tool: "draft.create",
          input,
        },
      ],
    };

    return {
      planId,
      task: trimmed,
      plan,
      limitations: [],
      approvalStepIds: [],
      provider: "local-intent-engine",
      model: "desktop-command-parser",
      createdAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // 3. Research-to-Excel Intent: "Research ka Excel bana do", "Google par recent AI agent frameworks compare karo aur Excel report banao"
  // =========================================================================
  const hasExcelKeyword = /\b(excel|spreadsheet|xlsx|sheet|report)\b/i.test(cleaned);
  const hasResearchKeyword = /\b(research|compare|chhaan-been|khoj|startups|frameworks)\b/i.test(cleaned);

  if (hasExcelKeyword && hasResearchKeyword) {
    let topic = cleaned
      .replace(/\b(google|duckduckgo|ddg|bing)\b/gi, "")
      .replace(/\b(par|pe|mein|in|on)\b/gi, "")
      .replace(/\b(recent|naye|latest)\b/gi, "")
      .replace(/\b(compare|tulna)\b/gi, "")
      .replace(/\b(karo|aur|and|then|fir|phir)\b/gi, "")
      .replace(/\b(excel|spreadsheet|sheet|report|file|xlsx)\b/gi, "")
      .replace(/\b(banao|bana|do|banayein|export|generate|create)\b/gi, "")
      .replace(/\b(research|chhaan-been|khoj|ki|ka|ke|karke)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!topic) {
      topic = taskContext.getLastTopic() || "";
    }

    if (!topic) {
      // Topic missing: ask clarifying question per requirement 6!
      const planId = randomUUID();
      const plan: Plan = {
        goal: "Clarification Needed: Research topic missing for Excel generation",
        steps: [
          {
            id: "step_1",
            title: "Request clarifying research topic",
            tool: "system.note",
            input: {
              text: "Kripya research ka topic batayein jiska Excel report banana hai (e.g. 'AI Agent Frameworks' ya 'Machine Learning Startups').",
              isClarification: true,
            },
          },
        ],
      };
      return {
        planId,
        task: trimmed,
        plan,
        limitations: ["Research topic was not specified. Please provide the topic to research and export."],
        approvalStepIds: [],
        provider: "local-intent-engine",
        model: "desktop-command-parser",
        createdAt: new Date().toISOString(),
      };
    }

    // Save topic in taskContext
    taskContext.setLastTopic(topic);
    const safeTopicSlug = topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .slice(0, 30);
    const fileName = `${safeTopicSlug}_research.xlsx`;

    const planId = randomUUID();
    const plan: Plan = {
      goal: `Research "${topic}" and export verified report to Excel`,
      steps: [
        {
          id: "find",
          title: `Find source URLs for "${topic}"`,
          tool: "research.find_sources",
          input: { query: topic, maxSources: 12 },
        },
        {
          id: "collect",
          title: "Open sources and extract key details, products, and evidence",
          tool: "research.collect",
          input: { sources: { $ref: "find.sources" }, maxStartups: 8 },
        },
        {
          id: "consolidate",
          title: "Consolidate and normalize research findings",
          tool: "research.consolidate",
          input: { records: { $ref: "collect.records" }, expectedCount: 8 },
        },
        {
          id: "write",
          title: `Generate verified Excel workbook (${fileName})`,
          tool: "sheet.write",
          input: { records: { $ref: "consolidate.records" }, fileName, sheetName: "Research Findings" },
        },
        {
          id: "verify",
          title: "Independently reopen and verify workbook integrity",
          tool: "sheet.verify",
          input: { filePath: { $ref: "write.filePath" }, expectedRowCount: 8 },
        },
      ],
    };

    return {
      planId,
      task: trimmed,
      plan,
      limitations: [],
      approvalStepIds: [],
      provider: "local-intent-engine",
      model: "desktop-command-parser",
      createdAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // 4. Multi-Step Research Intent (without Excel): "Machine learning par research karo"
  // =========================================================================
  if (
    (cleaned.includes("research") || cleaned.includes("chhaan-been") || cleaned.includes("khoj")) &&
    !cleaned.includes("excel") &&
    !cleaned.includes("spreadsheet")
  ) {
    let topic = cleaned
      .replace(/\b(par|pe|mein|in|on|about)\b/gi, "")
      .replace(/\b(research|chhaan-been|khoj|study|investigate)\b/gi, "")
      .replace(/\b(karo|karein|do|start|chalao)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!topic) {
      topic = taskContext.getLastTopic() || "Machine Learning";
    }

    taskContext.setLastTopic(topic);

    const planId = randomUUID();
    const plan: Plan = {
      goal: `Perform multi-step research on "${topic}"`,
      steps: [
        {
          id: "find",
          title: `Find evidence sources for "${topic}"`,
          tool: "research.find_sources",
          input: { query: topic, maxSources: 10 },
        },
        {
          id: "collect",
          title: "Collect claims, products, and source evidence",
          tool: "research.collect",
          input: { sources: { $ref: "find.sources" }, maxStartups: 8 },
        },
        {
          id: "consolidate",
          title: "Consolidate facts, citations, and findings",
          tool: "research.consolidate",
          input: { records: { $ref: "collect.records" }, expectedCount: 8 },
        },
      ],
    };

    return {
      planId,
      task: trimmed,
      plan,
      limitations: [],
      approvalStepIds: [],
      provider: "local-intent-engine",
      model: "desktop-command-parser",
      createdAt: new Date().toISOString(),
    };
  }

  // =========================================================================
  // 5. Clause splitting for multi-step browser & navigation requests
  // =========================================================================
  const clauses = trimmed
    .split(/\s*(?:\baur\b|\band\b|\bthen\b|\bfir\b|\bphir\b|;|,(?!\w))\s*/i)
    .map((c) => c.trim())
    .filter(Boolean);

  if (clauses.length === 0) return null;

  const parsedCommands: ParsedCommand[] = [];
  for (const clause of clauses) {
    const parsed = parseSingleIntent(clause);
    if (parsed) {
      parsedCommands.push(parsed);
    }
  }

  if (parsedCommands.length === 0) {
    return null;
  }

  const steps: PlanStep[] = parsedCommands.map((cmd, idx) => ({
    id: `step_${idx + 1}`,
    title: cmd.title,
    tool: cmd.tool,
    input: cmd.input,
  }));

  const plan: Plan = {
    goal: `Execute voice/desktop command: "${trimmed}"`,
    steps,
  };

  const planId = randomUUID();

  return {
    planId,
    task: trimmed,
    plan,
    limitations: [],
    approvalStepIds: [],
    provider: "local-rule-parser",
    model: "desktop-voice-engine",
    createdAt: new Date().toISOString(),
  };
}
