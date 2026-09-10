import type { Detector, Evidence, Finding } from "./types";

/**
 * A UUID, and the ambiguity that makes this whole tool's design necessary.
 *
 * A dashless UUID is 32 hex characters. So is an MD5 hash. There is no way to tell them
 * apart from the characters alone, and a tool that picked one would be inventing an answer.
 * So this earns bits from things a hash has no reason to satisfy, and the hex detector earns
 * its own, and when they land close together both are shown as peers.
 *
 * The version and variant nibbles are the evidence. In a UUID, one nibble is the version
 * (1 to 8) and the top two bits of another are the variant (binary 10, so the nibble is
 * 8, 9, a or b). A random 32-hex hash satisfies both by chance about one time in eight,
 * which is worth some bits and nowhere near certainty.
 *
 * A v1, v6 or v7 timestamp that lands in a plausible range is much stronger, because a hash
 * has no reason at all to encode a date in this decade.
 */

const DASHED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BARE = /^[0-9a-f]{32}$/i;

/** Gregorian offset: 100-nanosecond intervals between 1582-10-15 and the Unix epoch. */
const GREGORIAN_OFFSET_100NS = 122_192_928_000_000_000n;

const PLAUSIBLE_FROM = Date.UTC(1970, 0, 1);
const PLAUSIBLE_TO = Date.UTC(2100, 0, 1);

const VERSION_NAMES: Record<number, string> = {
  1: "time and MAC address",
  2: "DCE security",
  3: "MD5 of a name",
  4: "random",
  5: "SHA-1 of a name",
  6: "time, reordered so it sorts",
  7: "Unix time then random, sorts by creation",
  8: "custom",
};

/** Milliseconds since the epoch encoded in a v1, v6 or v7 UUID, or null. */
export function timestampOf(hex: string, version: number): number | null {
  try {
    if (version === 7) {
      // v7: the first 48 bits are milliseconds since the epoch, plainly.
      return Number(BigInt("0x" + hex.slice(0, 12)));
    }
    if (version === 1) {
      // v1: 60 bits of 100ns intervals since 1582, split across three fields in an order
      // that is not the order they appear in.
      const timeLow = hex.slice(0, 8);
      const timeMid = hex.slice(8, 12);
      const timeHigh = hex.slice(13, 16);
      const ticks = BigInt("0x" + timeHigh + timeMid + timeLow);
      return Number((ticks - GREGORIAN_OFFSET_100NS) / 10_000n);
    }
    if (version === 6) {
      // v6 is v1 with the time fields reordered so the value sorts by creation.
      const ticks = BigInt("0x" + hex.slice(0, 12) + hex.slice(13, 16));
      return Number((ticks - GREGORIAN_OFFSET_100NS) / 10_000n);
    }
  } catch {
    return null;
  }
  return null;
}

export const uuidDetector: Detector = {
  kind: "uuid",
  mode: "whole",
  prior: 0,
  detect(text): Finding | null {
    const t = text.trim();
    const dashed = DASHED.test(t);
    const bare = BARE.test(t);
    if (!dashed && !bare) return null;

    const hex = t.replace(/-/g, "").toLowerCase();
    const evidence: Evidence[] = [];
    const caveats: string[] = [];

    if (dashed) {
      // The 8-4-4-4-12 grouping is the strong signal. Nothing produces it by accident.
      evidence.push({ note: "32 hex characters grouped 8-4-4-4-12", bits: 9 });
    } else {
      evidence.push({ note: "32 hex characters with no dashes", bits: 2 });
      caveats.push(
        "Without the dashes this is indistinguishable from an MD5 hash by its characters alone. The reading below rests on the version and variant nibbles, which a hash satisfies by chance roughly one time in eight.",
      );
    }

    const version = parseInt(hex[12] ?? "0", 16);
    const variantNibble = parseInt(hex[16] ?? "0", 16);
    const variantOk = variantNibble >= 8 && variantNibble <= 11;
    const versionOk = version >= 1 && version <= 8;

    if (versionOk && variantOk) {
      evidence.push({
        note: `the version nibble is ${version} and the variant nibble is ${variantNibble.toString(16)}, both legal`,
        bits: 4,
      });
    } else {
      // Not fatal: plenty of systems mint identifiers in this shape without following the
      // spec. But it is the single best reason to doubt the reading.
      evidence.push({
        note: `the version or variant nibbles are not legal for a UUID (version ${version}, variant ${variantNibble.toString(16)})`,
        bits: -4,
      });
    }

    const lines: string[] = [];
    if (versionOk) {
      lines.push(`Version ${version}: ${VERSION_NAMES[version] ?? "unknown"}`);
    }

    const ms = versionOk ? timestampOf(hex, version) : null;
    if (ms !== null && ms >= PLAUSIBLE_FROM && ms <= PLAUSIBLE_TO) {
      const when = new Date(ms).toISOString();
      // This is the decisive one. A hash has no reason to encode a date in this range.
      evidence.push({ note: `the embedded timestamp is ${when}, which is a plausible date`, bits: 6 });
      lines.push(`Created ${when}`);
    } else if (ms !== null) {
      evidence.push({
        note: "the embedded timestamp is not a plausible date, so the version claim is doubtful",
        bits: -3,
      });
    }

    if (version === 4) {
      lines.push("Random, so there is nothing else inside it: no time, no machine, no order.");
    }

    return {
      kind: "uuid",
      text: t,
      evidence,
      proves:
        version === 4
          ? "A version 4 UUID is random. It carries no creation time and no ordering, so it cannot tell you when the thing it identifies was made."
          : "The version and variant nibbles are where a UUID differs from any other run of hex, and a version that encodes time is what lets a creation date be read out of it.",
      caveats: [
        ...caveats,
        "A UUID identifies something. It says nothing about what, and nothing here has looked it up.",
      ],
      ...(lines.length > 0 ? { detail: lines.join("\n") } : {}),
    };
  },
};
