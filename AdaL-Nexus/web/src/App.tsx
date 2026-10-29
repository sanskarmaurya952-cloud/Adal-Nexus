import { useCallback, useEffect, useRef, useState } from "react";
import type { RunEvent, RunSnapshot } from "../../src/server/agent/types";
import type { Bookmark, BrowserTab, HistoryEntry } from "./types/browser";
import { resolveAddressBarInput } from "../../src/desktop/urlPolicy";
import { BrowserChrome } from "./components/browser/BrowserChrome";
import { BrowserSidebar, type SidebarTab } from "./components/browser/BrowserSidebar";
import { BrowserViewport } from "./components/browser/BrowserViewport";
import { AIAgentPanel } from "./components/browser/AIAgentPanel";
import { BookmarksModal } from "./components/browser/BookmarksModal";
import { HistoryModal } from "./components/browser/HistoryModal";
import { DownloadsModal } from "./components/browser/DownloadsModal";
import { ExtensionsModal } from "./components/browser/ExtensionsModal";
import { SettingsView } from "./components/SettingsView";
import { SocialWorkspace } from "./components/social/SocialWorkspace";
import { InstagramIcon, SettingsIcon, XIcon } from "./components/Icons";

interface Health {
  ok: boolean;
  time: string;
  llm: { provider: string; model?: string | null; configured: boolean };
  browser?: { launched: boolean; url: string | null };
}

interface Draft {
  planId: string;
  plan: { goal: string; steps: { id: string; title: string; tool: string; input?: unknown }[] };
  limitations: string[];
  approvalStepIds: string[];
  provider: string;
  model?: string;
}

interface LogLine {
  key: string;
  type: string;
  message: string;
  time: string;
}

const TERMINAL = ["completed", "failed", "cancelled", "unverified"];

// Controller demo: uses ONLY harmless system tools.
const DEMO_PLAN = {
  goal: "Controller demo (system tools only; no external browsing)",
  steps: [
    { id: "note", title: "Record a note", tool: "system.note", input: { text: "demo started" } },
    { id: "wait1", title: "Wait 2 s", tool: "system.wait", input: { ms: 2000 } },
    {
      id: "checkpoint",
      title: "Approval-gated checkpoint (no external action)",
      tool: "system.checkpoint",
      input: { action: "demo checkpoint" },
    },
    { id: "done", title: "Record a closing note", tool: "system.note", input: { text: "demo finished" } },
  ],
};

// 5-step research & verified Excel export plan: search -> collect -> consolidate -> write .xlsx -> verify.
function researchPlan(query: string) {
  return {
    goal: `Research AI startups and export to Excel: ${query}`,
    steps: [
      { id: "find", title: "Find source URLs (search; labelled seed-list fallback)", tool: "research.find_sources", input: { query, maxSources: 15 } },
      { id: "collect", title: "Open sites and extract name, product, target market, pricing", tool: "research.collect", input: { sources: { $ref: "find.sources" }, maxStartups: 10 } },
      { id: "consolidate", title: "Validate and consolidate records", tool: "research.consolidate", input: { records: { $ref: "collect.records" }, expectedCount: 10 } },
      { id: "write", title: "Generate verified Excel workbook (.xlsx)", tool: "sheet.write", input: { records: { $ref: "consolidate.records" } } },
      { id: "verify", title: "Independently reopen and verify workbook", tool: "sheet.verify", input: { filePath: { $ref: "write.filePath" }, expectedRowCount: 10 } },
    ],
  };
}

function toLine(e: RunEvent): LogLine {
  return { key: `${e.runId}:${e.seq}`, type: e.type, message: e.message, time: e.time };
}

async function post(url: string, body?: unknown): Promise<string | null> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.error ?? `HTTP ${r.status}`;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function postJson<T>(url: string, body?: unknown): Promise<{ data?: T; error?: string }> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    if (r.ok) return { data: j as T };
    const details = Array.isArray(j?.details) && j.details.length ? ` (${j.details.join("; ")})` : "";
    return { error: `${j?.error ?? `HTTP ${r.status}`}${details}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function App() {
  // Prevent recursive self-embedding when running in an iframe
  if (typeof window !== "undefined" && window.self !== window.top) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "#64748b", fontFamily: "sans-serif" }}>
        <h3>Embedded Session Prevented</h3>
        <p>The AdaL-Nexus browser shell cannot be nested inside another frame.</p>
      </div>
    );
  }

  // Backend & System Health state
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [task, setTask] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [planning, setPlanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  // Desktop Browser state
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([]);
  const [activeBrowserTabId, setActiveBrowserTabId] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [browserHistory, setBrowserHistory] = useState<HistoryEntry[]>([]);
  const [downloadStatus, setDownloadStatus] = useState<{
    filename: string;
    state: "progressing" | "completed" | "cancelled" | "interrupted";
    percent?: number;
  } | null>(null);

  // Shell Layout & Modal state
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("home");
  const [isAIAgentOpen, setIsAIAgentOpen] = useState(false);
  const [isBookmarksOpen, setIsBookmarksOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isDownloadsOpen, setIsDownloadsOpen] = useState(false);
  const [isExtensionsOpen, setIsExtensionsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSocialOpen, setIsSocialOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);

  const seen = useRef(new Set<string>());
  const lastSeq = useRef<{ runId: string; seq: number } | null>(null);

  const addLog = useCallback((lines: LogLine[]) => {
    const fresh = lines.filter((l) => !seen.current.has(l.key));
    fresh.forEach((l) => seen.current.add(l.key));
    if (fresh.length) setLog((prev) => [...prev, ...fresh].slice(-500));
  }, []);

  const applyEvent = useCallback((e: RunEvent) => {
    const last = lastSeq.current;
    if (last && last.runId === e.runId && e.seq <= last.seq) return;
    lastSeq.current = { runId: e.runId, seq: e.seq };
    setRun(e.snapshot);
  }, []);

  const hydrate = useCallback(() => {
    fetch("/api/run")
      .then((r) => r.json())
      .then((d: { snapshot: RunSnapshot | null; events: RunEvent[] }) => {
        if (!d.snapshot) return;
        const last = d.events[d.events.length - 1];
        if (last) lastSeq.current = { runId: last.runId, seq: last.seq };
        setRun(d.snapshot);
        addLog(d.events.map(toLine));
      })
      .catch(() => {});
  }, [addLog]);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setHealth)
      .catch((e) => setHealthError(String(e.message ?? e)));

    const es = new EventSource("/api/events");
    es.onopen = () => {
      setConnected(true);
      hydrate();
    };
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      try {
        const data = JSON.parse(m.data);
        if (data.snapshot) {
          applyEvent(data as RunEvent);
          addLog([toLine(data as RunEvent)]);
        } else {
          addLog([{ key: `sys:${data.time}:${data.message}`, type: data.type, message: data.message, time: data.time }]);
        }
      } catch {}
    };
    return () => es.close();
  }, [addLog, applyEvent, hydrate]);

  // Keep health fresh
  const runStatus = run?.status;
  const currentStepId = run?.currentStepId;
  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((h) => h && setHealth(h))
      .catch(() => {});
  }, [runStatus, currentStepId]);

  const isAnyModalOpen =
    isBookmarksOpen ||
    isHistoryOpen ||
    isDownloadsOpen ||
    isExtensionsOpen ||
    isSettingsOpen ||
    isSocialOpen;

  // Ensure native browser view is visible during normal browsing and hidden when modals are open
  useEffect(() => {
    if (window.adalBrowser) {
      window.adalBrowser.setBrowserVisible(!isAnyModalOpen).catch(() => {});
    }
  }, [isAnyModalOpen]);

  // Initial load of tabs, bookmarks, and history from Electron
  useEffect(() => {
    const api = window.adalBrowser;
    if (!api) {
      // In standalone web mode, provide an initial home tab so UI is interactive
      const fallbackTab: BrowserTab = {
        id: "tab-home",
        url: "adal://home",
        title: "New Tab",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        isHome: true,
      };
      setBrowserTabs([fallbackTab]);
      setActiveBrowserTabId(fallbackTab.id);
      return;
    }

    api.getTabs().then((tabs) => {
      if (tabs.length > 0) {
        setBrowserTabs(tabs);
      }
    }).catch(() => {});

    api.getActiveTabId().then((id) => {
      if (id) setActiveBrowserTabId(id);
    }).catch(() => {});

    api.getBookmarks().then(setBookmarks).catch(() => {});
    api.getHistory().then(setBrowserHistory).catch(() => {});

    const unsubTabUpdated = api.onTabUpdated((updated) => {
      setBrowserTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === updated.id);
        if (idx === -1) {
          return [...prev, updated];
        }
        const next = [...prev];
        next[idx] = updated;
        return next;
      });
    });

    const unsubTabsChanged = api.onTabsChanged(({ tabs, activeTabId }) => {
      setBrowserTabs(tabs);
      setActiveBrowserTabId(activeTabId);
    });

    const unsubDownload = api.onDownloadStatus((status) => {
      setDownloadStatus(status);
      if (status.state === "completed" || status.state === "cancelled" || status.state === "interrupted") {
        setTimeout(() => {
          setDownloadStatus((curr) => (curr?.filename === status.filename ? null : curr));
        }, 5000);
      }
    });

    return () => {
      unsubTabUpdated();
      unsubTabsChanged();
      unsubDownload();
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      const isTextInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable);

      if (cmdOrCtrl && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        window.adalBrowser?.createTab();
      } else if (cmdOrCtrl && (e.key === "w" || e.key === "W")) {
        e.preventDefault();
        if (activeBrowserTabId) {
          window.adalBrowser?.closeTab(activeBrowserTabId);
        }
      } else if ((cmdOrCtrl && (e.key === "r" || e.key === "R")) || e.key === "F5") {
        e.preventDefault();
        if (activeBrowserTabId) {
          window.adalBrowser?.reload(activeBrowserTabId);
        }
      } else if (cmdOrCtrl && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        handleToggleBookmark();
      } else if (cmdOrCtrl && (e.key === "h" || e.key === "H")) {
        e.preventDefault();
        setIsHistoryOpen(true);
      } else if (cmdOrCtrl && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        setIsDownloadsOpen(true);
      } else if (e.altKey && e.key === "ArrowLeft" && !isTextInput) {
        e.preventDefault();
        if (activeBrowserTabId) {
          window.adalBrowser?.goBack(activeBrowserTabId);
        }
      } else if (e.altKey && e.key === "ArrowRight" && !isTextInput) {
        e.preventDefault();
        if (activeBrowserTabId) {
          window.adalBrowser?.goForward(activeBrowserTabId);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeBrowserTabId, bookmarks, activeBrowserTabId]);

  const activeBrowserTab = browserTabs.find((t) => t.id === activeBrowserTabId) || browserTabs[0] || null;

  // Browser Actions
  const handleBrowserNewTab = () => {
    if (window.adalBrowser) {
      window.adalBrowser.createTab().catch(() => {});
    } else {
      const newTab: BrowserTab = {
        id: `tab-${Date.now()}`,
        url: "adal://home",
        title: "New Tab",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        isHome: true,
      };
      setBrowserTabs((prev) => [...prev, newTab]);
      setActiveBrowserTabId(newTab.id);
    }
  };

  const handleBrowserCloseTab = (id: string) => {
    if (window.adalBrowser) {
      window.adalBrowser.closeTab(id).catch(() => {});
    } else {
      const remaining = browserTabs.filter((t) => t.id !== id);
      setBrowserTabs(remaining);
      if (activeBrowserTabId === id && remaining.length > 0) {
        setActiveBrowserTabId(remaining[0].id);
      }
    }
  };

  const handleBrowserSelectTab = (id: string) => {
    if (window.adalBrowser) {
      window.adalBrowser.switchTab(id).catch(() => {});
    } else {
      setActiveBrowserTabId(id);
    }
  };

  const handleBrowserNavigate = (urlOrQuery: string, searchEngine?: "duckduckgo" | "google") => {
    let engine = searchEngine;
    if (!engine) {
      try {
        engine = (localStorage.getItem("adal-search-engine") as "duckduckgo" | "google") || "google";
      } catch {
        engine = "google";
      }
    }

    if (window.adalBrowser) {
      if (activeBrowserTabId) {
        window.adalBrowser.navigate(activeBrowserTabId, urlOrQuery, engine).catch(() => {});
      } else {
        window.adalBrowser.createTab(urlOrQuery).catch(() => {});
      }
    } else {
      const resolved = resolveAddressBarInput(urlOrQuery, engine);
      if (activeBrowserTabId) {
        setBrowserTabs((prev) =>
          prev.map((t) =>
            t.id === activeBrowserTabId
              ? {
                  ...t,
                  url: resolved.url,
                  isHome: resolved.url === "adal://home",
                  title: resolved.isSearch
                    ? `${resolved.engine === "duckduckgo" ? "🦆 " : ""}${urlOrQuery}`
                    : resolved.url.replace(/^https?:\/\//, ""),
                  error: resolved.isValid ? undefined : resolved.error,
                }
              : t
          )
        );
      }
    }
  };

  const handleBrowserGoBack = () => {
    if (activeBrowserTabId && window.adalBrowser) {
      window.adalBrowser.goBack(activeBrowserTabId).catch(() => {});
    }
  };

  const handleBrowserGoForward = () => {
    if (activeBrowserTabId && window.adalBrowser) {
      window.adalBrowser.goForward(activeBrowserTabId).catch(() => {});
    }
  };

  const handleBrowserReload = () => {
    if (activeBrowserTabId && window.adalBrowser) {
      window.adalBrowser.reload(activeBrowserTabId).catch(() => {});
    }
  };

  const handleBrowserStop = () => {
    if (activeBrowserTabId && window.adalBrowser) {
      window.adalBrowser.stop(activeBrowserTabId).catch(() => {});
    }
  };

  const handleBrowserGoHome = () => {
    handleBrowserNavigate("adal://home");
  };

  // Synchronize AI Agent execution steps with browser navigation so websites open in the live browser tab
  const navigatedStepIds = useRef<Set<string>>(new Set());
  const lastActiveRunId = useRef<string | null>(null);

  useEffect(() => {
    if (!run) return;

    if (run.runId !== lastActiveRunId.current) {
      lastActiveRunId.current = run.runId;
      navigatedStepIds.current.clear();
    }

    if (!run.steps || run.steps.length === 0) return;

    for (const step of run.steps) {
      if (
        (step.status === "running" || step.status === "completed") &&
        !navigatedStepIds.current.has(step.id)
      ) {
        let targetUrl: string | undefined;

        if (step.tool === "browser.open_url" || step.tool === "browser.navigate") {
          targetUrl = ((step.output as any)?.url || (step.input as any)?.url || (step.input as any)?.address) as string;
        } else if (step.tool === "browser.search") {
          const q = ((step.output as any)?.query || (step.input as any)?.query) as string;
          targetUrl = ((step.output as any)?.url || (q ? `https://duckduckgo.com/?q=${encodeURIComponent(q)}` : undefined)) as string;
        } else if (step.tool === "browser.play_youtube_video") {
          const q = ((step.output as any)?.query || (step.input as any)?.query) as string;
          targetUrl = ((step.output as any)?.url || (q ? `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` : "https://www.youtube.com")) as string;
        } else if (step.tool === "browser.new_tab") {
          targetUrl = ((step.output as any)?.url || (step.input as any)?.url) as string;
          navigatedStepIds.current.add(step.id);
          handleBrowserNewTab();
          if (targetUrl && targetUrl !== "adal://home") {
            setTimeout(() => handleBrowserNavigate(targetUrl!), 150);
          }
          continue;
        }

        if (targetUrl && typeof targetUrl === "string") {
          navigatedStepIds.current.add(step.id);
          // If tab is already displaying this URL and is not home, avoid redundant navigation
          if (activeBrowserTab?.url === targetUrl && !activeBrowserTab.isHome) {
            continue;
          }
          handleBrowserNavigate(targetUrl);
        }
      }
    }
  }, [run, activeBrowserTab?.url, activeBrowserTab?.isHome]);

  const isCurrentTabBookmarked =
    !!activeBrowserTab &&
    !activeBrowserTab.isHome &&
    bookmarks.some((b) => b.url === activeBrowserTab.url);

  const handleToggleBookmark = async () => {
    if (!activeBrowserTab || activeBrowserTab.isHome) return;
    const existing = bookmarks.find((b) => b.url === activeBrowserTab.url);
    if (existing) {
      if (window.adalBrowser) {
        await window.adalBrowser.removeBookmark(existing.id);
      }
      setBookmarks((prev) => prev.filter((b) => b.id !== existing.id));
    } else {
      if (window.adalBrowser) {
        const added = await window.adalBrowser.addBookmark({
          url: activeBrowserTab.url,
          title: activeBrowserTab.title || activeBrowserTab.url,
        });
        setBookmarks((prev) => [added, ...prev]);
      } else {
        const mockBm: Bookmark = {
          id: `bm-${Date.now()}`,
          url: activeBrowserTab.url,
          title: activeBrowserTab.title || activeBrowserTab.url,
          createdAt: new Date().toISOString(),
        };
        setBookmarks((prev) => [mockBm, ...prev]);
      }
    }
  };

  const handleRemoveBookmark = async (id: string) => {
    if (window.adalBrowser) {
      await window.adalBrowser.removeBookmark(id);
    }
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  };

  const handleClearBrowserHistory = async () => {
    if (window.adalBrowser) {
      await window.adalBrowser.clearHistory();
    }
    setBrowserHistory([]);
  };

  // Sidebar selection handler
  const handleSelectSidebarTab = (tab: SidebarTab) => {
    setSidebarTab(tab);
    if (tab === "home") {
      handleBrowserGoHome();
    } else if (tab === "bookmarks") {
      setIsBookmarksOpen(true);
    } else if (tab === "history") {
      if (window.adalBrowser) {
        window.adalBrowser.getHistory().then(setBrowserHistory).catch(() => {});
      }
      setIsHistoryOpen(true);
    } else if (tab === "downloads") {
      setIsDownloadsOpen(true);
    } else if (tab === "extensions") {
      setIsExtensionsOpen(true);
    } else if (tab === "settings") {
      setIsSettingsOpen(true);
    }
  };

  // Agent Actions
  const act = async (url: string, body?: unknown) => {
    setActionError(null);
    const err = await post(url, body);
    if (err) setActionError(err);
  };

  const generatePlan = async () => {
    setPlanError(null);
    setDraft(null);
    setPlanning(true);
    const { data, error } = await postJson<Draft>("/api/plans", { task });
    setPlanning(false);
    if (error) {
      setPlanError(error);
    } else if (data) {
      setDraft(data);
      setIsAIAgentOpen(true);
    }
  };

  const startDraft = async () => {
    if (!draft) return;
    setPlanError(null);
    setStarting(true);
    const { error } = await postJson(`/api/plans/${draft.planId}/start`);
    setStarting(false);
    if (error) {
      setPlanError(error);
    } else {
      setDraft(null);
      setIsAIAgentOpen(true);
    }
  };

  const handleRunResearch = () => {
    const q = task.trim().slice(0, 200) || "AI startups";
    act("/api/runs", researchPlan(q));
    setIsAIAgentOpen(true);
  };

  const handleRunDemo = () => {
    act("/api/runs", DEMO_PLAN);
    setIsAIAgentOpen(true);
  };

  const handleApprove = (stepId: string) => {
    if (!run) return;
    act(`/api/runs/${run.runId}/steps/${stepId}/approve`);
  };

  const handleReject = (stepId: string) => {
    if (!run) return;
    act(`/api/runs/${run.runId}/steps/${stepId}/reject`);
  };

  const isRunning = !!run && !TERMINAL.includes(run.status);
  const needsApproval = run?.status === "waiting_for_approval";

  return (
    <div className={`adal-browser-app ${isDarkMode ? "dark-theme" : "light-theme"}`}>
      {/* 1. TOP WINDOW BAR: Brand + Tabs + Omnibox + Browser Actions */}
      <BrowserChrome
        tabs={browserTabs}
        activeTab={activeBrowserTab}
        bookmarks={bookmarks}
        onNewTab={handleBrowserNewTab}
        onCloseTab={handleBrowserCloseTab}
        onSelectTab={handleBrowserSelectTab}
        onNavigate={handleBrowserNavigate}
        onGoBack={handleBrowserGoBack}
        onGoForward={handleBrowserGoForward}
        onReload={handleBrowserReload}
        onStop={handleBrowserStop}
        onGoHome={handleBrowserGoHome}
        onToggleBookmark={handleToggleBookmark}
        onOpenDownloads={() => setIsDownloadsOpen(true)}
        onToggleAIAgent={() => setIsAIAgentOpen((prev) => !prev)}
        isAIAgentOpen={isAIAgentOpen}
        isBookmarked={isCurrentTabBookmarked}
        downloadStatus={downloadStatus}
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode((prev) => !prev)}
        onOpenProfileOrSettings={() => setIsSettingsOpen(true)}
      />

      {/* 2. MAIN BROWSER BODY: Left Sidebar + Viewport + Integrated AI Drawer */}
      <div className="browser-app-body">
        {/* Left Vertical Navigation Rail (Matches Screenshot) */}
        <BrowserSidebar
          activeTab={sidebarTab}
          onSelectTab={handleSelectSidebarTab}
          isAIAgentOpen={isAIAgentOpen}
          onToggleAIAgent={() => setIsAIAgentOpen((prev) => !prev)}
          isAgentRunning={isRunning}
          agentNeedsApproval={needsApproval}
        />

        {/* Center Main Stage: Real Website Viewport or New Tab Start Page */}
        <main className="browser-main-viewport-stage">
          <BrowserViewport
            activeTab={activeBrowserTab}
            bookmarks={bookmarks}
            history={browserHistory}
            onNavigate={handleBrowserNavigate}
            onOpenAgent={() => setIsAIAgentOpen(true)}
            onOpenSocial={() => setIsSocialOpen(true)}
            onClearHistory={handleClearBrowserHistory}
            onRemoveBookmark={handleRemoveBookmark}
            onReload={handleBrowserReload}
            isAIAgentOpen={isAIAgentOpen}
          />
        </main>

        {/* Right Integrated AI Agent Panel (Collapsible Slide-Over Drawer) */}
        <AIAgentPanel
          isOpen={isAIAgentOpen}
          onClose={() => setIsAIAgentOpen(false)}
          activeTab={activeBrowserTab}
          task={task}
          onTaskChange={setTask}
          onGeneratePlan={generatePlan}
          onRunResearch={handleRunResearch}
          onRunDemo={handleRunDemo}
          isPlanning={planning}
          isRunning={isRunning}
          planError={planError}
          actionError={actionError}
          draft={draft}
          starting={starting}
          onStartDraft={startDraft}
          onDiscardDraft={() => setDraft(null)}
          run={run}
          onApprove={handleApprove}
          onReject={handleReject}
          onPause={() => run && act(`/api/runs/${run.runId}/pause`)}
          onResume={() => run && act(`/api/runs/${run.runId}/resume`)}
          onCancel={() => run && act(`/api/runs/${run.runId}/cancel`)}
          log={log}
          onOpenSocial={() => setIsSocialOpen(true)}
          llmConfigured={!!health?.llm.configured}
          providerName={health?.llm.provider}
        />
      </div>

      {/* 3. MODALS & DRAWERS */}
      <BookmarksModal
        isOpen={isBookmarksOpen}
        onClose={() => setIsBookmarksOpen(false)}
        bookmarks={bookmarks}
        onNavigate={handleBrowserNavigate}
        onRemoveBookmark={handleRemoveBookmark}
      />

      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={browserHistory}
        onNavigate={handleBrowserNavigate}
        onClearHistory={handleClearBrowserHistory}
      />

      <DownloadsModal
        isOpen={isDownloadsOpen}
        onClose={() => setIsDownloadsOpen(false)}
        downloadStatus={downloadStatus}
      />

      <ExtensionsModal
        isOpen={isExtensionsOpen}
        onClose={() => setIsExtensionsOpen(false)}
      />

      {isSettingsOpen && (
        <div className="modal-overlay" onClick={() => setIsSettingsOpen(false)}>
          <div className="modal-card settings-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-row">
                <SettingsIcon size={20} className="text-glow-purple" />
                <h2 className="modal-title">Settings &amp; Diagnostics</h2>
              </div>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => setIsSettingsOpen(false)}
                aria-label="Close"
              >
                <XIcon size={18} />
              </button>
            </div>
            <div className="modal-body-scroll">
              <SettingsView
                health={health}
                healthError={healthError}
                connected={connected}
                backgroundDimmed={isDarkMode}
                onToggleBackgroundDim={() => setIsDarkMode((prev) => !prev)}
              />
            </div>
          </div>
        </div>
      )}

      {isSocialOpen && (
        <div className="modal-overlay" onClick={() => setIsSocialOpen(false)}>
          <div className="modal-card social-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-row">
                <InstagramIcon size={20} className="text-glow-purple" />
                <h2 className="modal-title">Social Media Autopilot (Phase 3A)</h2>
              </div>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => setIsSocialOpen(false)}
                aria-label="Close"
              >
                <XIcon size={18} />
              </button>
            </div>
            <div className="modal-body-scroll">
              <SocialWorkspace />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
