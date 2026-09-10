import type { Detector, Finding, Seed } from "./types";

/**
 * base64 and base64url, which are the spine of the nesting.
 *
 * Almost everything interesting arrives wrapped in one of these, so this detector is what
 * makes a JWT's payload, a session cookie's contents and a double-encoded blob reachable at
 * all. It emits what it decoded as a seed and lets the engine decide whether to look
 * further.
 *
 * The two alphabets are distinguished rather than merged, because which one it is tells you
 * something: base64url appears where a value had to survive being put in a URL or a JWT,
 * and that is a real clue about where the string came from.
 */

const STANDARD = /^[A-Za-z0-9+/]+={0,2}$/;
const URLSAFE = /^[A-Za-z0-9_-]+={0,2}$/;

/** Decode, or null. Never throws. */
export function decodeBase64(text: string, urlsafe: boolean): string | null {
  const normalised = urlsafe ? text.replace(/-/g, "+").replace(/_/g, "/") : text;
  // atob wants a length that is a multiple of four. A base64url value usually arrives with
  // its padding stripped, which is legal there and not something to hold against it.
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  try {
    const bytes = atob(padded);
    // Decoding to bytes always "works"; decoding to text is the question. Round-tripping
    // through UTF-8 is what separates a real string from a hash that happens to be valid
    // base64, and getting that wrong is how a tool shows you mojibake and calls it a
    // decoding.
    const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(bytes, (c) => c.charCodeAt(0)),
    );
    return utf8;
  } catch {
    return null;
  }
}

/** How much of a string is characters a person would expect to read. */
export function printableRatio(text: string): number {
  if (text.length === 0) return 0;
  // eslint-disable-next-line no-control-regex
  const printable = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").length;
  return printable / text.length;
}

function build(kind: "base64" | "base64url", text: string, decoded: string | null): Finding {
  const evidence = [
    {
      note: `${text.length} characters, all from the ${kind === "base64url" ? "URL-safe" : "standard"} base64 alphabet`,
      bits: 3,
    },
  ];

  const seeds: Seed[] = [];
  const caveats: string[] = [];

  if (decoded === null) {
    // Valid alphabet, not valid text. Usually means it was never text: a hash, a key, an
    // image. Saying so is more useful than showing bytes as question marks.
    evidence.push({ note: "the bytes it decodes to are not valid UTF-8 text", bits: -2 });
    caveats.push(
      "It decodes to bytes, but those bytes are not text. That is normal for a hash, a key or a binary blob, and it means there is nothing readable inside to show you.",
    );
  } else {
    const ratio = printableRatio(decoded);
    if (ratio === 1) {
      evidence.push({ note: "decodes cleanly to printable text", bits: 5 });
    } else {
      // Decoded "successfully" to text full of control characters is the classic false
      // positive: a random hex string is often valid base64 whose decoding is garbage.
      evidence.push({
        note: `decodes to text that is ${Math.round((1 - ratio) * 100)}% control characters`,
        bits: -3,
      });
      caveats.push(
        "The decoding is technically valid but mostly unprintable, which usually means this was not base64 at all and the match is a coincidence.",
      );
    }
    if (ratio > 0.9) seeds.push({ label: "decoded", text: decoded, relation: "decoded" });
  }

  if (text.length % 4 !== 0 && !text.includes("=")) {
    evidence.push({ note: "padding is stripped, which is normal in a URL or a token", bits: 1 });
  }

  return {
    kind,
    text,
    evidence,
    proves:
      decoded === null
        ? "The characters are all in the base64 alphabet and the bytes decode, so this is base64 of something that was never text."
        : "This decodes to valid UTF-8 text, which is a much stronger signal than the alphabet alone: most strings that merely look like base64 decode to nonsense.",
    caveats: [
      ...caveats,
      "base64 is an encoding and not a protection. Anything encoded this way is readable by anyone who has it, including whoever it passed through on the way here.",
    ],
    ...(decoded !== null ? { detail: decoded } : {}),
    ...(seeds.length > 0 ? { seeds } : {}),
  };
}

export const base64Detector: Detector = {
  kind: "base64",
  mode: "whole",
  // Slightly negative: plenty of things are accidentally valid base64, so the alphabet on
  // its own is weak and the decoding has to carry it.
  prior: -1,
  detect(text): Finding | null {
    const t = text.trim();
    // Below this, coincidence dominates. "abcd" is valid base64 and means nothing.
    if (t.length < 8) return null;
    if (!STANDARD.test(t)) return null;
    // A pure-digit or pure-hex string is far better explained by another detector, and
    // claiming it as base64 as well is noise on every card.
    if (/^\d+$/.test(t)) return null;
    return build("base64", t, decodeBase64(t, false));
  },
};

export const base64UrlDetector: Detector = {
  kind: "base64url",
  mode: "whole",
  prior: -1,
  detect(text): Finding | null {
    const t = text.trim();
    if (t.length < 8) return null;
    if (!URLSAFE.test(t)) return null;
    if (/^\d+$/.test(t)) return null;
    // Only claim base64url when it is actually distinguishable. Without a `-` or `_` the
    // two alphabets agree, and the standard detector already covers it: firing both would
    // put two identical cards on screen for one string.
    if (!/[-_]/.test(t)) return null;
    return build("base64url", t, decodeBase64(t, true));
  },
};
