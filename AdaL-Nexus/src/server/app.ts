import { createReadStream, existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import express, { type Response } from "express";
import { Controller, ControllerError } from "./agent/controller.js";
import { PolicyEngine } from "./agent/policy.js";
import type { ToolRegistry } from "./agent/registry.js";
import { addClient, clientCount } from "./events.js";
import type { BrowserDriver } from "./browser/types.js";
import type { LLMProvider } from "./llm/types.js";
import { Planner, PlannerError } from "./planner/planner.js";
import { getOutputDir } from "./sheet/tools.js";
import { IntegrationService } from "./social/integrationService.js";
import { createSocialRouter } from "./social/routes.js";

export interface AppDeps {
  controller: Controller;
  registry: ToolRegistry;
  llm: LLMProvider;
  browser?: BrowserDriver;
  integrationService?: IntegrationService;
}

const STATUS = { invalid: 400, not_found: 404, conflict: 409 } as const;

const PLANNER_STATUS: Record<PlannerError["code"], number> = {
  invalid_task: 400,
  busy: 409,
  invalid_plan: 422,
  invalid_response: 422,
  not_configured: 503,
  rate_limited: 429,
  quota_exhausted: 429,
  timeout: 504,
  auth: 502,
  api_error: 502,
};

function respond(res: Response, fn: () => unknown, okStatus = 200): void {
  try {
    res.status(okStatus).json(fn());
  } catch (err) {
    if (err instanceof ControllerError) {
      res.status(STATUS[err.code]).json({ error: err.message, code: err.code });
    } else {
      res.status(500).json({ error: err instanceof Error ? err.message : "internal error" });
    }
  }
}

export function createApp({ controller, registry, llm, browser, integrationService }: AppDeps) {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  const planner = new Planner(llm, registry, new PolicyEngine(registry));
  app.use("/api/social", createSocialRouter(llm, integrationService));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      time: new Date().toISOString(),
      llm: { provider: llm.name, model: llm.model ?? null, configured: llm.configured },
      browser: browser?.status() ?? { launched: false, url: null },
      eventClients: clientCount(),
    });
  });

  // Configuration status only. Never includes the key or any part of it.
  app.get("/api/llm/status", (_req, res) => {
    res.json({ provider: llm.name, model: llm.model ?? null, configured: llm.configured });
  });

  app.get("/api/events", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    addClient(res);
    res.write(
      `data: ${JSON.stringify({ type: "system", message: "event stream connected", time: new Date().toISOString() })}\n\n`,
    );
    const ping = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => clearInterval(ping));
  });

  app.get("/api/tools", (_req, res) => res.json(registry.list()));

  // Secure download route restricted strictly to output/ directory
  app.get("/api/downloads/:fileName", (req, res) => {
    const rawName = req.params.fileName;
    if (!rawName || typeof rawName !== "string") {
      return res.status(400).json({ error: "fileName parameter is required" });
    }
    // Reject path traversal, directory separators, null bytes
    if (rawName.includes("..") || rawName.includes("/") || rawName.includes("\\") || rawName.includes("\0")) {
      return res.status(400).json({ error: "Invalid fileName: path traversal denied" });
    }
    const outputDir = getOutputDir();
    const filePath = resolve(outputDir, rawName);
    if (!filePath.startsWith(outputDir + sep)) {
      return res.status(400).json({ error: "Access denied" });
    }
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: `File "${rawName}" not found` });
    }
    res.setHeader("Content-Disposition", `attachment; filename="${rawName}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const stream = createReadStream(filePath);
    stream.pipe(res);
  });

  app.get("/api/run", (_req, res) => res.json(controller.current() ?? { snapshot: null, events: [] }));

  // ---- LLM planning: produces a reviewable DRAFT only. Nothing executes until /start. ----
  app.post("/api/plans", async (req, res) => {
    try {
      res.status(201).json(await planner.draft(req.body?.task));
    } catch (err) {
      if (err instanceof PlannerError) {
        res.status(PLANNER_STATUS[err.code]).json({ error: err.message, code: err.code, details: err.details });
      } else {
        res.status(500).json({ error: "internal error", code: "api_error" });
      }
    }
  });

  app.post("/api/plans/:planId/start", (req, res) =>
    respond(res, () => {
      const draft = planner.get(req.params.planId);
      if (!draft) throw new ControllerError("not_found", `unknown or already started plan "${req.params.planId}"`);
      // The controller re-validates the plan against the registry and policy before running.
      const snapshot = controller.start(draft.plan);
      planner.discard(draft.planId);
      return snapshot;
    }, 201),
  );

  // Direct plan submission (used by the built-in demo and tests). Still fully policy-checked.
  app.post("/api/runs", (req, res) => respond(res, () => controller.start(req.body), 201));
  app.post("/api/runs/:runId/cancel", (req, res) => respond(res, () => controller.cancel(req.params.runId)));
  app.post("/api/runs/:runId/pause", (req, res) => respond(res, () => controller.pause(req.params.runId)));
  app.post("/api/runs/:runId/resume", (req, res) => respond(res, () => controller.resume(req.params.runId)));
  app.post("/api/runs/:runId/steps/:stepId/approve", (req, res) =>
    respond(res, () => controller.approve(req.params.runId, req.params.stepId)),
  );
  app.post("/api/runs/:runId/steps/:stepId/reject", (req, res) =>
    respond(res, () => controller.reject(req.params.runId, req.params.stepId)),
  );

  // Live DuckDuckGo Search API for real-time web search results
  app.get("/api/browser/search", async (req, res) => {
    const query = req.query.q;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ ok: false, error: "Missing query 'q' parameter", results: [] });
    }

    try {
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.trim())}`;
      const resp = await fetch(ddgUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      const html = await resp.text();
      const results: Array<{ title: string; url: string; snippet: string; domain: string }> = [];

      const resultBlocks = [
        ...html.matchAll(
          /class="result\s+results_links[^"]*"[\s\S]*?class="result__title"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g,
        ),
      ];

      for (const block of resultBlocks) {
        const rawHref = block[1];
        let actualUrl = rawHref;
        try {
          const u = new URL(rawHref, "https://duckduckgo.com");
          const uddg = u.searchParams.get("uddg");
          if (uddg) actualUrl = decodeURIComponent(uddg);
        } catch {}

        const title = block[2].replace(/<[^>]+>/g, "").trim();
        const snippet = block[3].replace(/<[^>]+>/g, "").trim();
        let domain = "";
        try {
          domain = new URL(actualUrl).hostname;
        } catch {}

        if (
          title &&
          actualUrl.startsWith("http") &&
          !actualUrl.includes("/y.js?") &&
          !actualUrl.includes("bing.com/aclick")
        ) {
          results.push({ title, url: actualUrl, snippet, domain });
        }
      }

      res.json({ ok: true, query: query.trim(), count: results.length, results });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err), results: [] });
    }
  });

  // Web Mode Browser Proxy Gateway: Enables live searching and website browsing in localhost web mode
  // by removing X-Frame-Options and Content-Security-Policy headers and resolving relative references.
  app.get("/api/browser/proxy", async (req, res) => {
    const rawTarget = req.query.url;
    if (!rawTarget || typeof rawTarget !== "string") {
      return res.status(400).send("Missing target 'url' parameter.");
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawTarget);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return res.status(400).send("Only http and https protocols are supported by the browser gateway.");
      }
      // Prevent loopback recursion into our own dev servers
      const host = parsedUrl.hostname.toLowerCase();
      if (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        parsedUrl.port === "5173" ||
        parsedUrl.port === "3001"
      ) {
        return res.status(403).send("Recursive loopback proxying is prohibited.");
      }
    } catch {
      return res.status(400).send("Invalid target URL provided.");
    }

    try {
      const abortCtrl = new AbortController();
      const timeout = setTimeout(() => abortCtrl.abort(), 12000);

      const response = await fetch(parsedUrl.href, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: abortCtrl.signal,
        redirect: "follow",
      });

      clearTimeout(timeout);

      const contentType = response.headers.get("content-type") || "text/html";
      res.setHeader("Content-Type", contentType);

      if (contentType.includes("text/html")) {
        let html = await response.text();
        const baseTag = `<base href="${response.url}">`;
        const clickInterceptScript = `
<script>
  (function() {
    window.addEventListener('click', function(e) {
      var a = e.target.closest('a');
      if (a && a.href && !a.href.startsWith('javascript:')) {
        e.preventDefault();
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'adal-browser-navigate', url: a.href }, '*');
            return;
          }
        } catch (err) {}
        window.location.href = '/api/browser/proxy?url=' + encodeURIComponent(a.href);
      }
    }, true);
  })();
</script>`;

        if (html.includes("<head>")) {
          html = html.replace("<head>", `<head>${baseTag}${clickInterceptScript}`);
        } else if (html.includes("<HEAD>")) {
          html = html.replace("<HEAD>", `<HEAD>${baseTag}${clickInterceptScript}`);
        } else {
          html = `${baseTag}${clickInterceptScript}${html}`;
        }

        res.send(html);
      } else {
        const arrayBuf = await response.arrayBuffer();
        res.send(Buffer.from(arrayBuf));
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        return res.status(504).send(`Website request to ${parsedUrl.hostname} timed out.`);
      }
      return res.status(502).send(`Unable to load website through gateway: ${err.message || String(err)}`);
    }
  });

  // One-click launch for native desktop browser window from web client
  app.post("/api/desktop/launch", (_req, res) => {
    try {
      import("node:child_process").then(({ spawn }) => {
        const proc = spawn("npx", ["electron", "."], {
          detached: true,
          stdio: "ignore",
          shell: true,
        });
        proc.unref();
        res.json({ ok: true, message: "Desktop browser launched successfully" });
      }).catch((err) => {
        res.status(500).json({ error: String(err) });
      });
    } catch (err: any) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return app;
}
