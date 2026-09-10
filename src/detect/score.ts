import type { Band, Finding, Scored } from "./types";

/**
 * Turning reasons into a ranking, and deciding what to show.
 *
 * The bands are fixed and the thresholds are here, in one place, so tuning cannot become a
 * fudge factory spread across fifteen detectors.
 */

/** Bit thresholds. A finding at or above a threshold gets that band. */
export const BANDS = {
  certain: 12,
  likely: 7,
  possible: 2,
} as const;

/**
 * Two findings within this many bits of each other are peers, and both are shown.
 *
 * This is the number that makes ambiguity visible instead of resolved. 32 hex characters
 * are a plausible MD5 and a plausible dashless UUID, and picking one would be inventing an
 * answer. Three bits is roughly "one good reason apart", which is not enough to choose.
 */
export const PEER_WINDOW = 3;

export function bandFor(bits: number): Band {
  if (bits >= BANDS.certain) return "certain";
  if (bits >= BANDS.likely) return "likely";
  if (bits >= BANDS.possible) return "possible";
  return "dropped";
}

/**
 * A finding's total, which is its prior plus every piece of evidence.
 *
 * Clamped at both ends. Without a ceiling, a detector that emits ten small reasons outranks
 * one that emits a single decisive one, which is a way of gaming the ranking by being
 * verbose. Without a floor, negative evidence could push something arbitrarily far below
 * everything else and make the ordering meaningless.
 */
export const MIN_BITS = -8;
export const MAX_BITS = 20;

export function score(finding: Finding, prior: number): number {
  const total = finding.evidence.reduce((sum, e) => sum + e.bits, prior);
  return Math.max(MIN_BITS, Math.min(MAX_BITS, total));
}

/**
 * Every reason carries a note.
 *
 * This is the one rule that holds the whole design up, and it is enforced rather than
 * documented. Bits without a note is a number nobody can argue with, which is exactly what
 * a confidence score usually is and exactly what this is trying not to be.
 *
 * @returns the offending notes, empty when the finding is well formed
 */
export function unexplainedEvidence(finding: Finding): string[] {
  return finding.evidence
    .filter((e) => e.bits !== 0 && e.note.trim() === "")
    .map(() => `${finding.kind}: evidence worth bits with no note`);
}

/**
 * Rank, band, and drop what is not worth showing.
 *
 * Ties break on the kind name rather than on array order, so the same input always renders
 * the same way. An ordering that depends on registration order is one that changes when
 * somebody adds a detector.
 */
export function rank(findings: readonly { finding: Finding; prior: number }[]): Scored[] {
  return findings
    .map(({ finding, prior }) => {
      const bits = score(finding, prior);
      return { ...finding, bits, band: bandFor(bits) };
    })
    .filter((f) => f.band !== "dropped")
    .sort((a, b) => b.bits - a.bits || a.kind.localeCompare(b.kind));
}

/**
 * Which findings are peers of the top one, and therefore shown joined by "or".
 *
 * Always returns at least the leader when there is one. The point is that a reader sees
 * "MD5 or UUID" rather than a chosen winner with the alternative hidden behind a control
 * they will not open.
 */
export function peers(scored: readonly Scored[]): Scored[] {
  const top = scored[0];
  if (!top) return [];
  return scored.filter((f) => top.bits - f.bits <= PEER_WINDOW);
}
