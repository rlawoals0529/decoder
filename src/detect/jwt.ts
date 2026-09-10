import { decodeBase64 } from "./base64";
import type { Detector, Evidence, Finding, Seed } from "./types";

/**
 * A JSON Web Token, which is the thing people paste into a tool like this most often.
 *
 * Three base64url segments separated by dots. The first two are JSON and the third is a
 * signature over them, and the signature is where the honesty lives: **this cannot check
 * it, and it will never ask you for the key.** A tool that offered to verify a signature
 * would need the secret, and asking for a signing secret is asking for the one thing that
 * must never be pasted anywhere.
 *
 * The claims are read but not judged beyond their shape. `exp` in the past is a fact worth
 * stating; whether that matters is not something this can know.
 */

/** The registered claims worth naming, and what each one is. */
const CLAIMS: Record<string, string> = {
  iss: "issuer",
  sub: "subject",
  aud: "audience",
  exp: "expires at",
  nbf: "not valid before",
  iat: "issued at",
  jti: "token id",
};

const TIME_CLAIMS = new Set(["exp", "nbf", "iat"]);

/** Seconds since the epoch, rendered as something a person reads. */
function asDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(".000Z", "Z");
}

function parseSegment(raw: string): { json: unknown; text: string } | null {
  const text = decodeBase64(raw, true);
  if (text === null) return null;
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return null;
  }
}

export const jwtDetector: Detector = {
  kind: "jwt",
  mode: "whole",
  // High: three dot-separated base64url segments where the first two are JSON is a shape
  // almost nothing else produces by accident.
  prior: 4,
  detect(text, clock): Finding | null {
    const t = text.trim();
    const parts = t.split(".");
    if (parts.length !== 3) return null;
    const [rawHeader, rawPayload, signature] = parts;
    if (rawHeader === undefined || rawPayload === undefined || signature === undefined) return null;
    if (rawHeader === "" || rawPayload === "") return null;
    if (!/^[A-Za-z0-9_-]+$/.test(rawHeader) || !/^[A-Za-z0-9_-]+$/.test(rawPayload)) return null;
    // An empty third segment is legal: `alg: none` tokens exist, and they are worth
    // reporting loudly rather than refusing to read.
    if (signature !== "" && !/^[A-Za-z0-9_-]+$/.test(signature)) return null;

    const header = parseSegment(rawHeader);
    const payload = parseSegment(rawPayload);
    if (!header || !payload) return null;

    const evidence: Evidence[] = [
      { note: "three dot-separated base64url segments", bits: 3 },
      { note: "the first two both decode to JSON", bits: 6 },
    ];
    const caveats: string[] = [];
    const seeds: Seed[] = [];
    const lines: string[] = [];

    const head = header.json;
    const alg = typeof head === "object" && head !== null ? (head as Record<string, unknown>)["alg"] : undefined;
    const typ = typeof head === "object" && head !== null ? (head as Record<string, unknown>)["typ"] : undefined;

    if (typ === "JWT") evidence.push({ note: 'the header says typ: "JWT"', bits: 3 });
    if (typeof alg === "string") {
      evidence.push({ note: `the header names an algorithm, ${alg}`, bits: 2 });
      if (alg.toLowerCase() === "none") {
        // Worth shouting about. A `none` token is unsigned, and a server that accepts one
        // will accept anything anybody writes.
        caveats.push(
          `The algorithm is "${alg}", which means this token is not signed at all. Anything that accepts it accepts a token anyone can write.`,
        );
      }
    }

    lines.push("Header", header.text);
    lines.push("", "Payload", payload.text);

    const claims = typeof payload.json === "object" && payload.json !== null ? (payload.json as Record<string, unknown>) : {};
    const named = Object.keys(claims).filter((k) => k in CLAIMS);
    if (named.length > 0) {
      evidence.push({
        note: `the payload carries registered claims: ${named.join(", ")}`,
        bits: 2,
      });
    }

    // Times are the one thing worth interpreting, because a raw epoch second is unreadable
    // and "expired" is the question people are usually asking.
    const times: string[] = [];
    for (const key of named) {
      if (!TIME_CLAIMS.has(key)) continue;
      const value = claims[key];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      times.push(`${key} (${CLAIMS[key]}) is ${asDate(value)}`);
    }
    if (times.length > 0) lines.push("", ...times);

    const exp = claims["exp"];
    if (typeof exp === "number" && Number.isFinite(exp)) {
      const expired = exp * 1000 < clock.now();
      lines.push(
        "",
        expired ? `Expired at ${asDate(exp)}.` : `Valid until ${asDate(exp)}, by its own claim.`,
      );
      if (!expired) {
        // A live token is a live credential. Saying so is the useful part.
        caveats.push(
          "By its own exp claim this token has not expired yet, so treat it as a live credential.",
        );
      }
    }

    // The segments become seeds so whatever is nested inside a claim gets expanded too: a
    // base64 blob in `sub`, an ID, a timestamp.
    seeds.push({ label: "header", text: header.text, relation: "parsed" });
    seeds.push({ label: "payload", text: payload.text, relation: "parsed" });

    return {
      kind: "jwt",
      text: t,
      evidence,
      proves:
        "The header and payload are readable by anyone holding this token, because they are only base64-encoded. Encoding is not encryption.",
      caveats: [
        // First, always, and phrased so a "certain" badge beside it cannot be misread as
        // "verified".
        "Signature: not checked. We cannot verify this without the key, and we will never ask you for it. Everything below is what the token claims about itself.",
        ...caveats,
      ],
      detail: lines.join("\n"),
      seeds,
    };
  },
};
