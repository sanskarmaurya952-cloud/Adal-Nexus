/**
 * Step-to-step data flow. A step input may contain `{ "$ref": "stepId.path.to.value" }` anywhere.
 * - Plan time: refs must be well-formed and point at an EARLIER step (no forward/self/unknown refs).
 * - Run time: the controller resolves them from completed/unverified steps' outputs only; a missing
 *   output or path FAILS the step. Resolved data is deep-cloned, size-capped, and only ever handed to the
 *   tool, which still validates its own input. Policy decisions depend on tool names, never on refs.
 */
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 8;
export const MAX_RESOLVED_CHARS = 500_000;

export interface RefUse {
  at: string;
  stepId: string;
  path: string[];
}

export class RefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefError";
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

export function parseRef(ref: string): { stepId: string; path: string[] } | string {
  const parts = ref.split(".");
  if (parts.length < 2) return `reference "${ref}" must look like "stepId.path"`;
  for (const p of parts) {
    if (!SEGMENT.test(p)) return `reference "${ref}" has an invalid segment "${p.slice(0, 20)}"`;
    if (FORBIDDEN.has(p)) return `reference "${ref}" uses a forbidden segment "${p}"`;
  }
  return { stepId: parts[0], path: parts.slice(1) };
}

export function findRefs(input: unknown): { uses: RefUse[]; errors: string[] } {
  const uses: RefUse[] = [];
  const errors: string[] = [];
  const walk = (v: unknown, at: string, depth: number) => {
    if (depth > MAX_DEPTH) return void errors.push(`${at}: input is nested too deeply`);
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`, depth + 1));
    if (!isPlainObject(v)) return;
    if ("$ref" in v) {
      if (Object.keys(v).length !== 1 || typeof v.$ref !== "string") {
        return void errors.push(`${at}: a $ref object must contain only a string "$ref"`);
      }
      const parsed = parseRef(v.$ref);
      if (typeof parsed === "string") errors.push(`${at}: ${parsed}`);
      else uses.push({ at, ...parsed });
      return;
    }
    for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`, depth + 1);
  };
  walk(input, "input", 0);
  return { uses, errors };
}

/** Plan-time dependency check for an ordered list of steps. Returns human-readable problems. */
export function checkPlanRefs(steps: { id: string; input?: unknown }[]): string[] {
  const problems: string[] = [];
  const index = new Map(steps.map((s, i) => [s.id, i]));
  steps.forEach((s, i) => {
    const { uses, errors } = findRefs(s.input);
    errors.forEach((e) => problems.push(`step "${s.id}": ${e}`));
    for (const u of uses) {
      const at = index.get(u.stepId);
      if (at === undefined) problems.push(`step "${s.id}": ${u.at} refers to unknown step "${u.stepId}"`);
      else if (at >= i) problems.push(`step "${s.id}": ${u.at} must refer to an EARLIER step ("${u.stepId}" is not earlier)`);
    }
  });
  return problems;
}

export function hasRefs(input: unknown): boolean {
  return findRefs(input).uses.length > 0;
}

/** Replaces every ref with a deep clone of the referenced output value. Throws RefError on any problem. */
export function resolveRefs(input: unknown, outputs: ReadonlyMap<string, unknown>): unknown {
  const resolve = (v: unknown, depth: number): unknown => {
    if (depth > MAX_DEPTH) throw new RefError("input is nested too deeply");
    if (Array.isArray(v)) return v.map((x) => resolve(x, depth + 1));
    if (!isPlainObject(v)) return v;
    if ("$ref" in v) {
      const parsed = parseRef(String(v.$ref));
      if (typeof parsed === "string") throw new RefError(parsed);
      if (!outputs.has(parsed.stepId)) {
        throw new RefError(`reference "${v.$ref}": step "${parsed.stepId}" produced no output (it did not complete)`);
      }
      let cur: unknown = outputs.get(parsed.stepId);
      for (const seg of parsed.path) {
        if (Array.isArray(cur)) {
          const i = /^\d+$/.test(seg) ? Number(seg) : -1;
          if (i < 0 || i >= cur.length) throw new RefError(`reference "${v.$ref}": index "${seg}" not found`);
          cur = cur[i];
        } else if (cur && typeof cur === "object" && Object.hasOwn(cur, seg)) {
          cur = (cur as Record<string, unknown>)[seg];
        } else {
          throw new RefError(`reference "${v.$ref}": path segment "${seg}" not found in the step output`);
        }
      }
      if (cur === undefined) throw new RefError(`reference "${v.$ref}" resolved to nothing`);
      return structuredClone(cur);
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, depth + 1)]));
  };
  const out = resolve(input, 0);
  if (JSON.stringify(out ?? null).length > MAX_RESOLVED_CHARS) {
    throw new RefError(`resolved input is larger than ${MAX_RESOLVED_CHARS} characters`);
  }
  return out;
}
