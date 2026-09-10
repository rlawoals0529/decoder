/**
 * What a detector is, and what it is allowed to say.
 *
 * The shapes here carry two decisions that the rest of the app depends on, so they are
 * worth reading before adding a kind.
 *
 * **A score is derived from reasons, never written directly.** A detector emits
 * `evidence`, each item a human-readable note plus how many bits it is worth, and the
 * score is a sum. A float confidence was considered and rejected: "87% likely MD5" is
 * precision nobody can justify, it makes brittle tests, and it hides the only thing a
 * reader can actually use. The notes are what let somebody overrule the ranking using
 * knowledge of where the string came from, which they always have and this never does.
 *
 * **Honesty is a required field.** `caveats` and `proves` cannot be omitted, because the
 * card that renders a finding renders them, and a kind that shipped without them would be
 * a card that quietly claims more than it knows.
 */

/** Every kind this can name. A union, so a kind with no copy is a type error. */
export type Kind =
  | "jwt"
  | "base64"
  | "base64url"
  | "url"
  | "query"
  | "timestamp"
  | "uuid"
  | "hex"
  | "json"
  | "hash"
  | "percent"
  | "ip"
  | "cidr"
  | "colour"
  | "number";

/**
 * One reason to believe, and its weight in bits.
 *
 * Bits rather than percentages because they add. Two independent reasons worth 3 bits each
 * are worth 6, and that is a statement about evidence rather than an arbitrary curve.
 */
export interface Evidence {
  /** Readable, specific, and about this input. "32 hex characters", not "matches pattern". */
  readonly note: string;
  /** How much this reason is worth. May be negative: evidence can argue against a kind. */
  readonly bits: number;
}

/** How confident, in the only four steps worth distinguishing. */
export type Band = "certain" | "likely" | "possible" | "dropped";

/**
 * Something to decode next, emitted by a detector rather than recursed into by it.
 *
 * Detectors never recurse. They say "there is something in here" and the engine decides
 * whether to look, under a budget. That is what keeps a base64-of-base64 chain from being
 * the detector's problem.
 */
export interface Seed {
  /** Where it came from, for the tree: "payload", "the sub claim", "decoded". */
  readonly label: string;
  readonly text: string;
  /**
   * How this text relates to its parent.
   *
   * `decoded` is the load-bearing one. A decoding seed must be strictly shorter than its
   * parent or the engine refuses it, which is what stops the hang where something
   * re-encodes plausibly forever.
   */
  readonly relation: "decoded" | "extracted" | "parsed";
}

/** What a detector returns when it fires. */
export interface Finding {
  readonly kind: Kind;
  /** The input this is about. Kept so a card can show what it was looking at. */
  readonly text: string;
  readonly evidence: readonly Evidence[];
  /**
   * What this reading is worth knowing, and it must contain a real fact rather than a
   * restatement of the kind. "The signature is not checked" is a fact; "this is a JWT" is
   * not.
   */
  readonly proves: string;
  /** Everything this cannot tell you. Empty is allowed; missing is not. */
  readonly caveats: readonly string[];
  /** Human-readable decoding, when there is one worth showing. */
  readonly detail?: string;
  readonly seeds?: readonly Seed[];
}

/** A finding with its score and band worked out. */
export interface Scored extends Finding {
  readonly bits: number;
  readonly band: Band;
}

/**
 * A detector.
 *
 * `whole` runs against the entire input; `scan` runs against substrings found in prose.
 * Without that split, pasting a paragraph produces forty cards.
 */
export interface Detector {
  readonly kind: Kind;
  readonly mode: "whole" | "scan";
  /**
   * The prior for this kind, in bits, before any evidence.
   *
   * Negative for kinds that are cheap to match and therefore usually wrong: 32 hex
   * characters are a plausible MD5 and a plausible dashless UUID, and the prior is where
   * "hex is easy to look like" gets said once instead of in every detector.
   */
  readonly prior: number;
  /** Null when it does not fire. Never throws: the engine treats a throw as a bug. */
  detect(text: string, clock: Clock): Finding | null;
}

/** Time, injected, so evaluation is deterministic and a test can pin a date. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
