import type { Detector, Evidence, Finding, Seed } from "./types";

/**
 * JSON, and the fields inside it worth looking at again.
 *
 * This is the other half of the nesting spine. A JWT payload is JSON, a decoded base64 blob
 * is often JSON, and the values inside are where the timestamps and IDs live. So this emits
 * a seed per interesting field rather than one for the whole document, which is what makes
 * `exp` inside a payload become a date without the JWT detector knowing anything about
 * timestamps.
 *
 * "Interesting" is deliberately narrow. A seed per field on a large object would produce
 * forty cards, so a value has to be a string long enough to be something, or a number in
 * the range a date falls in.
 */

const MAX_SEEDS = 12;

/** Values worth handing back to the engine. Anything else is noise. */
function interesting(value: unknown): string | null {
  if (typeof value === "string") {
    // Short strings are labels, not payloads. Twelve is about where a token, a hash or an
    // encoded blob starts and a word ends.
    if (value.length < 12) return null;
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    // Only in the range a unix time falls in, so an ordinary quantity does not get expanded.
    const digits = Math.abs(value).toString().length;
    if (digits >= 9 && digits <= 14) return String(value);
    return null;
  }
  return null;
}

/** Every scalar in the tree, with a dotted path, breadth first and capped. */
export function fields(root: unknown): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const queue: { path: string; value: unknown }[] = [{ path: "", value: root }];

  while (queue.length > 0 && out.length < MAX_SEEDS) {
    const item = queue.shift();
    if (!item) break;
    const { path, value } = item;

    if (Array.isArray(value)) {
      value.forEach((v, i) => queue.push({ path: `${path}[${i}]`, value: v }));
      continue;
    }
    if (typeof value === "object" && value !== null) {
      for (const [k, v] of Object.entries(value)) {
        queue.push({ path: path === "" ? k : `${path}.${k}`, value: v });
      }
      continue;
    }
    const text = interesting(value);
    if (text !== null) out.push({ path, text });
  }
  return out;
}

/** Counts, so the card can say how big it is without printing all of it. */
function shape(value: unknown): { keys: number; depth: number } {
  let keys = 0;
  let depth = 0;
  const walk = (v: unknown, d: number) => {
    depth = Math.max(depth, d);
    if (Array.isArray(v)) return v.forEach((x) => walk(x, d + 1));
    if (typeof v === "object" && v !== null) {
      const entries = Object.entries(v);
      keys += entries.length;
      for (const [, x] of entries) walk(x, d + 1);
    }
  };
  walk(value, 0);
  return { keys, depth };
}

export const jsonDetector: Detector = {
  kind: "json",
  mode: "whole",
  prior: 1,
  detect(text): Finding | null {
    const t = text.trim();
    // A bare number or a quoted word is technically valid JSON, and claiming it as such
    // says nothing while pushing a real reading down the list.
    if (!/^[[{]/.test(t)) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch {
      return null;
    }

    const { keys, depth } = shape(parsed);
    const evidence: Evidence[] = [
      { note: "parses as JSON", bits: 8 },
      {
        note: Array.isArray(parsed)
          ? `an array of ${(parsed as unknown[]).length} items`
          : `an object with ${keys} key${keys === 1 ? "" : "s"}`,
        bits: 2,
      },
    ];
    if (depth > 1) evidence.push({ note: `nested ${depth} levels deep`, bits: 1 });

    const found = fields(parsed);
    const seeds: Seed[] = found.map((f) => ({
      label: f.path,
      text: f.text,
      relation: "extracted",
    }));

    const caveats: string[] = [];
    if (found.length >= MAX_SEEDS) {
      caveats.push(
        `Only the first ${MAX_SEEDS} interesting fields are expanded. A document this size would otherwise produce more cards than anyone reads.`,
      );
    }

    return {
      kind: "json",
      text: t,
      evidence,
      proves:
        "It parses, so the structure below is exactly what a parser sees rather than a guess at the shape.",
      caveats: [
        ...caveats,
        "Valid JSON says nothing about whether the values in it mean what their names suggest.",
      ],
      detail: JSON.stringify(parsed, null, 2),
      ...(seeds.length > 0 ? { seeds } : {}),
    };
  },
};
