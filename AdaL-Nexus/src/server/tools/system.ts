import type { Tool } from "../agent/types.js";

/**
 * Real but harmless "system" tools. They exist so the controller, pause/cancel and
 * approval flows can be exercised end-to-end. They do NOT research, browse or
 * create files, and must never be presented as such.
 */

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

function field(input: unknown, key: string): unknown {
  return input && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
}

export const systemNote: Tool = {
  name: "system.note",
  description: 'Records a text note in the run output. Input: {"text": string}. No external effect.',
  async run(input) {
    const text = field(input, "text");
    if (typeof text !== "string" || !text) throw new Error('system.note needs input.text (string)');
    return { output: { text } };
  },
};

export const systemWait: Tool = {
  name: "system.wait",
  description: 'Waits (abortable) and reports progress each second. Input: {"ms": number 0-10000}. No external effect.',
  async run(input, ctx) {
    const ms = field(input, "ms");
    if (typeof ms !== "number" || ms < 0 || ms > 10_000) {
      throw new Error("system.wait needs input.ms (number between 0 and 10000)");
    }
    let elapsed = 0;
    while (elapsed < ms) {
      const slice = Math.min(1000, ms - elapsed);
      await sleep(slice, ctx.signal);
      elapsed += slice;
      ctx.progress(`waited ${elapsed}/${ms} ms`);
    }
    return { output: { waitedMs: ms } };
  },
};

export const systemCheckpoint: Tool = {
  name: "system.checkpoint",
  description: 'Approval-gated no-op that exercises the approval flow. Input: {"action": string}. Performs no external action.',
  sensitive: true,
  async run(input) {
    const action = field(input, "action");
    return { output: { recorded: true, action: typeof action === "string" ? action : null } };
  },
};
