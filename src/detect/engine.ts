import { rank } from "./score";
import type { Clock, Detector, Scored, Seed } from "./types";

/**
 * Expanding what is inside what you pasted, breadth first, under a budget.
 *
 * Detectors never recurse. They emit seeds, and this walks them, which puts every
 * termination argument in one file instead of fifteen.
 *
 * **Breadth first, not depth first**, and that is a real decision rather than a preference.
 * Under a node budget, depth first spends the entire budget descending one
 * base64-of-base64-of-base64 chain and never looks at the second thing you pasted. Breadth
 * first spends it on the shallowest, most likely-to-matter layers first.
 *
 * **Exceeding a budget is never an error.** It records where it stopped and the UI offers
 * to continue from there with a fresh budget, which turns a hang into a decision the reader
 * makes. A tool that silently truncates and a tool that hangs are equally bad; this is
 * neither.
 */

export interface Budget {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxInputBytes: number;
  readonly deadlineMs: number;
}

export const DEFAULT_BUDGET: Budget = {
  maxDepth: 4,
  maxNodes: 400,
  maxInputBytes: 64 * 1024,
  deadlineMs: 50,
};

export interface Node {
  readonly id: string;
  readonly parentId: string | null;
  /** Where this text came from, for the tree. Null at the root. */
  readonly label: string | null;
  readonly relation: Seed["relation"] | null;
  readonly text: string;
  readonly depth: number;
  readonly findings: readonly Scored[];
  /** Set when a budget stopped this node from being expanded. */
  readonly stoppedBecause?: StopReason;
}

export type StopReason = "depth" | "nodes" | "time";

export interface Result {
  readonly nodes: readonly Node[];
  /** Every budget that was hit, so the UI can say which and the tests can assert it. */
  readonly stopped: readonly StopReason[];
  /** The input was truncated before anything ran. */
  readonly inputTruncated: boolean;
}

/**
 * A decoding must shrink.
 *
 * This is the structural half of termination, and a visited set alone would not give it.
 * Something that decodes to a plausible re-encoding of itself can cycle through values
 * that are each new, so a visited set never fires and the node budget is the only thing
 * that stops it, one wasted expansion at a time. Requiring a decoding to be strictly
 * shorter than its parent makes that chain finite by construction.
 *
 * Extraction and parsing are exempt: pulling a field out of JSON legitimately produces
 * something that is not shorter than the whole document in every case, and those relations
 * cannot cycle the same way.
 */
export function seedAllowed(seed: Seed, parentText: string): boolean {
  if (seed.text === "") return false;
  if (seed.relation !== "decoded") return true;
  return seed.text.length < parentText.length;
}

/** Findings for one piece of text, ranked. Never throws. */
function findingsFor(text: string, detectors: readonly Detector[], clock: Clock, mode: Detector["mode"]) {
  const found: { finding: ReturnType<Detector["detect"]>; prior: number }[] = [];
  for (const d of detectors) {
    if (d.mode !== mode) continue;
    let finding = null;
    try {
      finding = d.detect(text, clock);
    } catch (e) {
      // A detector that throws is a bug here, not a property of the input, and it must not
      // take the other fourteen with it. Reported rather than swallowed.
      console.error(`detector "${d.kind}" threw on ${text.length} chars:`, e);
    }
    if (finding) found.push({ finding, prior: d.prior });
  }
  return rank(found.filter((f): f is { finding: NonNullable<typeof f.finding>; prior: number } => f.finding !== null));
}

export function analyse(
  input: string,
  detectors: readonly Detector[],
  clock: Clock,
  budget: Budget = DEFAULT_BUDGET,
): Result {
  const inputTruncated = input.length > budget.maxInputBytes;
  const root = inputTruncated ? input.slice(0, budget.maxInputBytes) : input;

  const nodes: Node[] = [];
  const stopped = new Set<StopReason>();
  const visited = new Set<string>();
  const started = clock.now();

  /** The queue is the whole reason this is breadth first. */
  const queue: { text: string; depth: number; parentId: string | null; label: string | null; relation: Seed["relation"] | null }[] =
    [{ text: root.trim(), depth: 0, parentId: null, label: null, relation: null }];

  let counter = 0;

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;

    if (nodes.length >= budget.maxNodes) {
      stopped.add("nodes");
      break;
    }
    // Checked per node rather than per detector. A deadline checked too finely spends more
    // time reading the clock than working.
    if (clock.now() - started > budget.deadlineMs) {
      stopped.add("time");
      break;
    }

    const key = `${item.depth}:${item.text}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const id = `n${counter++}`;
    const findings = findingsFor(item.text, detectors, clock, "whole");

    let stoppedBecause: StopReason | undefined;
    const seeds: Seed[] = [];
    for (const f of findings) for (const s of f.seeds ?? []) seeds.push(s);

    if (seeds.length > 0 && item.depth >= budget.maxDepth) {
      stoppedBecause = "depth";
      stopped.add("depth");
    } else {
      for (const seed of seeds) {
        if (!seedAllowed(seed, item.text)) continue;
        queue.push({
          text: seed.text,
          depth: item.depth + 1,
          parentId: id,
          label: seed.label,
          relation: seed.relation,
        });
      }
    }

    nodes.push({
      id,
      parentId: item.parentId,
      label: item.label,
      relation: item.relation,
      text: item.text,
      depth: item.depth,
      findings,
      ...(stoppedBecause ? { stoppedBecause } : {}),
    });
  }

  // Anything still queued when a budget stopped the walk is a place the reader can ask to
  // continue from, so the node that owns it is marked rather than the queue being dropped
  // silently.
  if (queue.length > 0) {
    const unexpanded = new Set(queue.map((q) => q.parentId));
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n && unexpanded.has(n.id) && !n.stoppedBecause) {
        nodes[i] = { ...n, stoppedBecause: stopped.has("time") ? "time" : "nodes" };
      }
    }
  }

  return { nodes, stopped: [...stopped], inputTruncated };
}
