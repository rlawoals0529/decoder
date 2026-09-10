import type { Detector, Evidence, Finding } from "./types";

/**
 * A run of hex, and the hash it might be.
 *
 * **Length is the only evidence, and this says so on every card.** 32 hex characters is the
 * length of an MD5 digest. It is also the length of a dashless UUID, of half a SHA-256, and
 * of sixteen arbitrary bytes somebody wrote down. Naming the algorithm from the length alone
 * would be a confident guess dressed as a fact, so the card names the *candidates* and the
 * `proves` line says the reasoning is length and nothing else.
 *
 * Git object IDs are deliberately not their own kind. A git blob hash is a SHA-1 and there
 * is no way to tell one from any other SHA-1 without the repository, so it appears as a
 * possibility on the SHA-1 card rather than as a separate reading that would be wrong most
 * of the time.
 */

/** Digest lengths, in hex characters, and everything that produces one. */
const BY_LENGTH: Record<number, string[]> = {
  32: ["MD5", "MD4", "NTLM", "a UUID with its dashes removed"],
  40: ["SHA-1", "RIPEMD-160", "a git object id, which is a SHA-1"],
  56: ["SHA-224", "SHA3-224"],
  64: ["SHA-256", "SHA3-256", "BLAKE2s", "a 32-byte key"],
  96: ["SHA-384", "SHA3-384"],
  128: ["SHA-512", "SHA3-512", "BLAKE2b", "Whirlpool"],
};

const HEX = /^(0x)?[0-9a-f]+$/i;

export const hexDetector: Detector = {
  kind: "hex",
  mode: "whole",
  // Negative on purpose. Hex is the easiest thing in the world to look like: every digit
  // string is hex, and so is every word made of a to f. The prior is where that is paid for
  // once rather than in every branch below.
  prior: -2,
  detect(text): Finding | null {
    const t = text.trim();
    if (!HEX.test(t)) return null;
    const prefixed = /^0x/i.test(t);
    const digits = prefixed ? t.slice(2) : t;
    if (digits.length < 4) return null;

    const evidence: Evidence[] = [
      { note: `${digits.length} hex characters${prefixed ? ", with an 0x prefix" : ""}`, bits: 2 },
    ];
    const caveats: string[] = [];
    const lines: string[] = [];

    if (prefixed) {
      // `0x` is a deliberate mark. Somebody wrote it to say "read this as hex".
      evidence.push({ note: "the 0x prefix says explicitly that this is hex", bits: 4 });
    }

    if (/^[0-9]+$/.test(digits)) {
      // All decimal digits, so a plain number is the better reading and this should not
      // outrank it.
      evidence.push({ note: "every character is also a decimal digit, so this may not be hex at all", bits: -3 });
    }

    const mixedCase = /[a-f]/.test(digits) && /[A-F]/.test(digits);
    if (mixedCase) {
      // Digests are almost always emitted in one case. Mixed case suggests something else.
      evidence.push({ note: "mixed upper and lower case, which a digest almost never is", bits: -2 });
    }

    const candidates = BY_LENGTH[digits.length];
    if (candidates) {
      evidence.push({
        note: `${digits.length} characters is the length of ${candidates[0]}`,
        bits: 4,
      });
      lines.push(`By length alone this could be: ${candidates.join(", ")}.`);
      caveats.push(
        `The algorithm is a guess from the length and nothing else. All of these produce ${digits.length} hex characters and they are indistinguishable without knowing where the value came from.`,
      );
    }

    if (digits.length % 2 === 0) {
      const bytes = digits.length / 2;
      lines.push(`${bytes} bytes.`);
    } else {
      evidence.push({
        note: "an odd number of hex characters, so it is not a whole number of bytes",
        bits: -1,
      });
      caveats.push("An odd length means this is not a byte string, so it is not a digest or a key.");
    }

    // Small values are worth reading as a number, because that is usually why they were
    // written in hex.
    if (digits.length <= 16) {
      try {
        lines.push(`As a number: ${BigInt("0x" + digits).toLocaleString("en-US")}.`);
      } catch {
        // Unreachable given the pattern above, and swallowed rather than thrown because a
        // detector that throws takes the other fourteen down with it.
      }
    }

    return {
      kind: "hex",
      text: t,
      evidence,
      proves: candidates
        ? "The length is the whole argument. Nothing here has hashed anything or compared anything, so the algorithm named is a shortlist and not a finding."
        : "It is a run of hexadecimal, which is a notation rather than a kind of thing. What it means depends entirely on where you got it.",
      caveats: [
        ...caveats,
        "A hash cannot be reversed. If you are hoping to see what went into this, there is nothing in the value to see.",
      ],
      ...(lines.length > 0 ? { detail: lines.join("\n") } : {}),
    };
  },
};
