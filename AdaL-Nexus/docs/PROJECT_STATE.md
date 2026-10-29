# AdaL Nexus: Project State

Last updated: 2026-10-28 (after Milestone 5.1 quality audit). Purpose: let a fresh session resume without re-reading the PRD or code.

## Goal (from the PRD, condensed)
Natural-language task -> reviewed plan -> real browser research of 10 AI startups (source URLs + verified pricing,
"Unavailable" when unknown) -> real `.xlsx` -> independent re-open/verify -> visible progress, logs, errors, cancel,
approvals. Never fabricate results; never claim a feature works until tested.

## Architecture
Single Node/TypeScript process (Express) + React/Vite UI. No database. State is in memory.

```
UI (web/src/App.tsx) <-- SSE /api/events + REST --> Express (src/server/app.ts)
  Planner (LLM draft, user must click Start) -> Controller (state machine, sequential steps, {"$ref"} step inputs)
  Controller -> Policy (separate) -> Tool registry (explicit, by name) -> tools
  Tools: system.note/wait/checkpoint | browser.search/open/extract (Playwright, visible Chrome)
         | research.find_sources/collect/consolidate (compose the browser tools + pure analysis)
```

## Important files
| Path | Role |
|------|------|
| `src/server/agent/controller.ts` | Run state machine: events, cancel, pause/resume, approvals, timeouts, `$ref` resolution, stale/duplicate handling |
| `src/server/agent/refs.ts` | `{"$ref":"stepId.path"}`: syntax, plan-time dependency check, run-time resolution (clone, size cap) |
| `src/server/agent/policy.ts` | Separate policy: unknown tool = deny; sensitive tool or `requiresApproval` = approval |
| `src/server/agent/registry.ts`, `types.ts` | Tool registry, shared types |
| `src/server/tools/index.ts` | `createDefaultRegistry(browser?, guard?)`: the ONLY place tools are registered |
| `src/server/browser/{tools,urlSafety,extract,playwrightDriver,types}.ts` | Browser tools, URL policy, deterministic extraction, Playwright driver (visible Chrome) |
| `src/server/research/types.ts` | Typed records + RUNTIME validators (`parseSources`, `validateRecord`) |
| `src/server/research/analyze.ts` | Name/product/target-market/pricing derivation with evidence; pricing ambiguity rules; `siteKey` |
| `src/server/research/tools.ts` | `research.find_sources` (search + labelled fallback), `research.collect`, `research.consolidate` |
| `src/server/research/seeds.ts` | Curated fallback seed list + its label (not evidence; edit freely) |
| `src/server/llm/*`, `src/server/planner/planner.ts` | Gemini adapter, planner (untrusted output validation, refs checked, review-then-Start) |
| `src/server/app.ts`, `index.ts`, `events.ts`, `config.ts` | Routes, wiring, SSE, env config |
| `web/src/App.tsx` | UI: task, plan review, status, steps+outputs, approvals, event log, "Run research workflow" button |
| `Readme.md` | Setup, behavior, live-check tables, limitations (keep in sync) |
| `docs/adal-evidence.md` | Log of AdaL work; evidence column is filled in by the team only |

Config (`.env`, git-ignored; `.env.example` has no secrets): `GEMINI_API_KEY`, `GEMINI_MODEL`
(default `gemini-2.5-flash-lite`), `LLM_PROVIDER`, `BROWSER_CHANNEL` (`chrome` uses installed Chrome), `PORT`.

## Milestones
| M | Scope | Status |
|---|-------|--------|
| 1 | Scaffold, health, SSE, UI shell | Done, browser-checked |
| 2 | Controller, policy, approvals, cancel/pause/resume | Done, tested, browser-checked |
| 3 | Gemini planner, review-then-Start | Done; user generated a live plan; automated tests use mocks |
| 4 | Browser tools + URL safety + evidence extraction | Done; mock-tested + manual live checks |
| 5 | Step data flow (`$ref`) + research orchestration + evidence + labelled seed-list fallback | **Done (this update).** Mock-tested; run live twice on real sites; output quality limited, not manually audited |
| 5.1 | Quality audit of the 10 live records + extraction improvements (plan-tied pricing, claim-only target market, about-page hop, second search query, run persistence) | **Done.** Audit in `docs/audits/2026-10-28-m5.1-audit.md`; classification is my judgment from quotes, not a human review |
| 6 | Spreadsheet writer + independent verifier (`sheet.write` / `sheet.verify`), download | **Done.** Real .xlsx generator strictly in `output/`, independent verification of all 13 columns, row count, non-empty cells, evidence quotes and pricing integrity. Sandboxed download route `GET /api/downloads/:fileName`. 219 tests pass. Live 5-step run completed in Chrome. |
| 7 | Summary, results view, failure tests, docs, demo | Not started |

## Verified results (last run, after M6)
- `npm run typecheck`: clean. `npm run build`: succeeds. `npm test`: 219 tests, 219 pass, 0 fail
  (no network, no browser, no Gemini). New in M6: `sheet/sheet.test.ts` (14 new tests covering valid round-trip, missing headers, row count mismatch, missing source URLs, missing evidence quotes, unsupported price status, blank cells, corrupt/0-byte/missing files, path traversal on write/verify/download, controller $ref integration, and verification failure stopping task completion).
- Mutation checks: approval gate and private-IPv4 block, tests failed when disabled.
- Live M6 (real Chrome, no Gemini): 5-step plan find -> collect -> consolidate -> write -> verify completed with runId `5a876057-5f68-4a6f-9187-9e28ba2ad3e2`. 10 startups researched, consolidated, written to `output/m6-accepted-startups.xlsx` (12,033 bytes, 10 data rows, SHA-256 `44496a4bb5a6d89b11f610d91b8af4b6b91c0f5193a23e292b3f306cb3ebab88`), and independently reopened and verified. Secure download `GET /api/downloads/m6-accepted-startups.xlsx` verified byte-for-byte (12,033 bytes, status 200).
- Live M5.1 acceptance check (real Chrome): 10 startups audited in `docs/audits/2026-10-28-m5-acceptance-audit.md`.
- Live M4 checks still valid (localhost blocked, DNS failure, HTTP error, cancel of slow navigation).
- NOT verified: the updated planner prompt against live Gemini; real CAPTCHA on the search engine; manual takeover by hand;
  UI changes in a browser.

## Security controls in place
- Tools are an explicit allow-list; unregistered tools rejected at plan time and again before each step.
- Step references are validated (earlier steps only, safe path segments), resolved only from completed/unverified
  outputs, cloned and size-capped; they cannot alter policy or approvals.
- LLM output is untrusted: whitelisted fields only, approval/timeout flags dropped, refs checked, user must click Start.
- Page text is untrusted: never sent to an LLM, never selects tools/approvals; only same-site pricing links are followed;
  shown as plain text.
- Browser/research tools are read-only (no click/type/forms/downloads/scripts/shell/messaging).
- URL policy on requested URL, redirects, sub-resources, final URL, pages read, and every fallback/seed URL (all visits go through `browser.open`).
- Secrets only in `.env`; never logged or returned. NOTE: a real-looking Gemini key was found in `.env.example` twice and
  blanked each time; the user must revoke/rotate it. A scan of project files (outside `.env`) found no key-like strings.

## Known gaps
1. No results view or market summary (M7).
2. Source discovery by search is weak for generic queries (lists/directories dominate); the seed list does the real work.
   Selection is a heuristic (domain blocklist + list words); no LLM-assisted selection or second search engine.
3. Extraction is pattern-based: target market claims can be use cases rather than audiences; pricing often partial (some plans excluded as ambiguous); localized pages are not reproducible;
   corrected values were spot-checked against quotes, not fully re-audited.
4. Plans have no loops/conditions; repetition is inside `research.collect`. One run and one tab at a time; in-memory state.
5. DNS-rebinding TOCTOU, WebSocket/WebRTC not covered by the URL hook; robots.txt not checked. No auth (localhost only).
6. Playwright driver code has no automated tests (manual live checks only).
7. Planner prompt for research tools untested against live Gemini.

## Next steps
1. Await user review of Milestone 6. Do not start Milestone 7 without approval.
2. Then M7: summary/results view, failure-scenario tests, demo, docs.

## Working agreements
Stop after each milestone and wait for approval. Do not run `git add .` from the Desktop parent (repo root is above this
folder). Do not touch the user's dev servers on 3001/5173; use another port (e.g. 3002) for test servers and stop them
afterwards. Label test fixtures as test-only.

