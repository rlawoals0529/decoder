import { describe, expect, it } from "vitest";
import { analyse } from "./engine";
import { hexDetector } from "./hex";
import { jsonDetector } from "./json";
import { jwtDetector } from "./jwt";
import { DETECTORS } from "./registry";
import { peers, score } from "./score";
import { timestampDetector, relative } from "./timestamp";
import { queryDetector, urlDetector } from "./url";
import { timestampOf, uuidDetector } from "./uuid";
import type { Clock } from "./types";

/** 2026-09-10T00:00:00Z, so every date below is fixed. */
const NOW = Date.UTC(2026, 8, 10);
const clock: Clock = { now: () => NOW };

const bits = (d: { detect: (t: string, c: Clock) => unknown; prior: number }, text: string) => {
  const f = d.detect(text, clock) as Parameters<typeof score>[0] | null;
  return f === null ? null : score(f, d.prior);
};

describe("jwt", () => {
  const header = btoa('{"alg":"HS256","typ":"JWT"}').replace(/=/g, "");
  const mk = (payload: object) =>
    `${header}.${btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")}.sig`;

  it("says the signature is not checked, first, and promises never to ask for the key", () => {
    // The whole honesty argument rests on this line, and on it being unmissable. A
    // "certain" badge next to a card with no such caveat would read as "verified".
    const f = jwtDetector.detect(mk({ sub: "1234567890" }), clock)!;
    expect(f.caveats[0]).toMatch(/Signature: not checked/);
    expect(f.caveats[0]).toMatch(/never ask you for it/);
  });

  it("reads the registered claims and renders their times as dates", () => {
    const f = jwtDetector.detect(mk({ sub: "abc", iat: 1_757_462_400, exp: 1_757_466_000 }), clock)!;
    expect(f.detail).toContain("2025-09-10T00:00:00Z");
    expect(f.detail).toContain("expires at");
  });

  it("says a token is expired against the injected clock, not the wall clock", () => {
    const token = mk({ exp: 1_600_000_000 }); // 2020-09-13

    // Both clocks are chosen so the wall clock gives the *opposite* answer to one of them.
    // The first version of this test used a token expiring in 2020 and one expiring in
    // 2096, which are past and future against real time as well, so it passed just as
    // happily with `clock.now()` replaced by `Date.now()`. Caught by making that mutation.
    const before: Clock = { now: () => Date.UTC(2010, 0, 1) };
    expect(jwtDetector.detect(token, before)!.detail).toMatch(/Valid until/);

    const after: Clock = { now: () => Date.UTC(2030, 0, 1) };
    expect(jwtDetector.detect(token, after)!.detail).toMatch(/Expired at/);

    // And a live token is called a live credential, which is the useful half.
    expect(jwtDetector.detect(token, before)!.caveats.join(" ")).toMatch(/live credential/);
  });

  it("shouts about alg: none, because a server that accepts one accepts anything", () => {
    const noneHeader = btoa('{"alg":"none","typ":"JWT"}').replace(/=/g, "");
    const f = jwtDetector.detect(`${noneHeader}.${btoa('{"sub":"x"}').replace(/=/g, "")}.`, clock)!;
    expect(f.caveats.join(" ")).toMatch(/not signed at all/);
  });

  it("does not fire on three dot-separated things that are not JSON", () => {
    expect(jwtDetector.detect("aaaaaaaa.bbbbbbbb.cccccccc", clock)).toBeNull();
    expect(jwtDetector.detect("one.two", clock)).toBeNull();
    expect(jwtDetector.detect("a.b.c.d", clock)).toBeNull();
  });
});

describe("uuid and hex, which is the ambiguity this tool exists for", () => {
  it("the 8-4-4-4-12 grouping alone is enough to be certain", () => {
    // A v4 with dashes: random, so there is no embedded date to help. The grouping and the
    // legal nibbles have to carry it on their own, and they do.
    //
    // Written this way because the obvious version was vacuous: comparing a dashed UUID's
    // score against the hex detector's score for the same string passes trivially, since
    // hex does not fire on a string containing dashes at all. It stayed green with the
    // grouping worth 1 bit instead of 9. Caught by making that mutation.
    const dashedV4 = "d41d8cd9-8f00-4204-9980-0998ecf8427e";
    const f = analyse(dashedV4, DETECTORS, clock).nodes[0]!.findings.find((x) => x.kind === "uuid")!;
    expect(f.band).toBe("certain");
    expect(f.evidence.map((e) => e.note).join(" ")).toMatch(/8-4-4-4-12/);
  });

  it("a bare v4 UUID is a peer of the hex reading, because nothing can tell them apart", () => {
    // A version 4 UUID is random and carries no date, so once the dashes are gone there is
    // genuinely no information in the characters that separates it from an MD5. Both are
    // shown, because picking one would be inventing an answer.
    //
    // The example matters and this test was written wrong first: a bare *v7* is not
    // ambiguous at all, because its embedded timestamp decodes to a real date and a hash has
    // no reason to carry one. That case is the test below, asserting the opposite.
    const bare = "d41d8cd98f0042049980" + "0998ecf8427e";
    const findings = analyse(bare, DETECTORS, clock).nodes[0]!.findings;
    const uuid = findings.find((f) => f.kind === "uuid")!;
    const hex = findings.find((f) => f.kind === "hex")!;
    expect(Math.abs(uuid.bits - hex.bits)).toBeLessThanOrEqual(3);
    expect(peers(findings).map((f) => f.kind)).toEqual(expect.arrayContaining(["uuid", "hex"]));
  });

  it("but a bare v7 is not ambiguous, because a hash has no reason to encode a date", () => {
    // This is the design working rather than a preference: three independent reasons stack,
    // and stacked evidence is allowed to settle a question the characters alone cannot.
    const bare = "018f3a2b7c4d7e8f9a0b1c2d3e4f5060";
    const findings = analyse(bare, DETECTORS, clock).nodes[0]!.findings;
    const uuid = findings.find((f) => f.kind === "uuid")!;
    const hex = findings.find((f) => f.kind === "hex")!;
    expect(uuid.bits - hex.bits).toBeGreaterThan(3);
    expect(peers(findings).map((f) => f.kind)).not.toContain("hex");
  });

  it("a bare UUID says out loud that it cannot be told from an MD5", () => {
    const f = uuidDetector.detect("018f3a2b7c4d7e8f9a0b1c2d3e4f5060", clock)!;
    expect(f.caveats.join(" ")).toMatch(/indistinguishable from an MD5/);
  });

  it("an embedded date is the decisive evidence, because a hash has no reason to carry one", () => {
    // v7: the first 48 bits are milliseconds since the epoch.
    const withDate = "018f3a2b-7c4d-7e8f-9a0b-1c2d3e4f5060";
    const nonsenseDate = "ffffffff-ffff-7fff-9a0b-1c2d3e4f5060";
    expect(bits(uuidDetector, withDate)!).toBeGreaterThan(bits(uuidDetector, nonsenseDate)!);
  });

  it("reads a v7 and a v1 timestamp correctly", () => {
    // v7 first 48 bits: 0x018f3a2b7c4d ms.
    expect(timestampOf("018f3a2b7c4d7e8f9a0b1c2d3e4f5060", 7)).toBe(0x018f3a2b7c4d);
    // A known v1: this is the RFC's own example time fields, reassembled.
    const v1 = timestampOf("58e0a7d7eebc11d8a1e00800200c9a66", 1);
    expect(v1).not.toBeNull();
    expect(new Date(v1!).getUTCFullYear()).toBe(2004);
  });

  it("hex names candidates by length and says that is all it did", () => {
    const f = hexDetector.detect("d41d8cd98f00b204e9800998ecf8427e", clock)!;
    expect(f.detail).toMatch(/MD5/);
    expect(f.caveats.join(" ")).toMatch(/guess from the length/);
    expect(f.proves).toMatch(/length is the whole argument/);
  });

  it("hex mentions a git object id on the SHA-1 card rather than guessing it is one", () => {
    // A git hash is a SHA-1 and there is no way to tell without the repository, so it
    // belongs as one candidate among several, not as its own confident reading.
    const f = hexDetector.detect("da39a3ee5e6b4b0d3255bfef95601890afd80709", clock)!;
    expect(f.detail).toMatch(/git object id/);
  });

  it("hex argues against itself when every character is also a digit", () => {
    expect(bits(hexDetector, "1234567890123456")!).toBeLessThan(bits(hexDetector, "d41d8cd98f00b204")!);
  });

  it("hex refuses an odd length as a digest", () => {
    const f = hexDetector.detect("abcde", clock)!;
    expect(f.caveats.join(" ")).toMatch(/not a byte string/);
  });
});

describe("timestamp", () => {
  it("offers both units when both are plausible, rather than picking by digit count", () => {
    // 1000000000 is 2001 as seconds and 1970 as milliseconds. Choosing silently would be
    // wrong about half the strings people paste out of old systems.
    const f = timestampDetector.detect("1000000000", clock)!;
    expect(f.detail).toMatch(/As seconds: 2001-09-09/);
  });

  it("labels every date UTC, because a local rendering differs per machine", () => {
    const f = timestampDetector.detect("1789203600", clock)!;
    expect(f.detail).toMatch(/UTC/);
    expect(f.caveats.join(" ")).toMatch(/Shown in UTC/);
  });

  it("is relative to the injected clock and not to now", () => {
    const past: Clock = { now: () => Date.UTC(2030, 0, 1) };
    const f = timestampDetector.detect("1789203600", past)!;
    expect(f.detail).toMatch(/ago/);
    const before: Clock = { now: () => Date.UTC(2000, 0, 1) };
    expect(timestampDetector.detect("1789203600", before)!.detail).toMatch(/in \d+ year/);
  });

  it("relative() says the roughest thing that is still true", () => {
    const day = 86_400_000;
    expect(relative(NOW - 2 * day, NOW)).toBe("2 days ago");
    expect(relative(NOW - day, NOW)).toBe("1 day ago");
    expect(relative(NOW + 3 * 3_600_000, NOW)).toBe("in 3 hours");
    expect(relative(NOW - 1000, NOW)).toBe("just now");
  });

  it("does not fire on a number too short or too long to be a unix time", () => {
    expect(timestampDetector.detect("12345", clock)).toBeNull();
    expect(timestampDetector.detect("123456789012345678", clock)).toBeNull();
  });
});

describe("url", () => {
  it("never renders as a link, and says why", () => {
    // A hover preview or a prefetch would hand the URL to a remote host without a click,
    // which for a signed URL is the exact thing the reader came here to avoid.
    const f = urlDetector.detect("https://example.com/a?x=abcdefghijkl", clock)!;
    expect(f.caveats.join(" ")).toMatch(/never as a link/);
  });

  it("names parameters that usually carry a credential", () => {
    const f = urlDetector.detect("https://example.com/cb?access_token=abcdefghijkl&page=2", clock)!;
    expect(f.caveats.join(" ")).toMatch(/access_token/);
  });

  it("pulls out long parameter values and leaves short ones alone", () => {
    const f = urlDetector.detect("https://example.com/?long=abcdefghijklmnop&n=2", clock)!;
    const labels = (f.seeds ?? []).map((s) => s.label);
    expect(labels).toContain("?long");
    expect(labels).not.toContain("?n");
  });

  it("points out credentials in the userinfo section", () => {
    const f = urlDetector.detect("https://user:pw@example.com/x", clock)!;
    expect(f.caveats.join(" ")).toMatch(/userinfo/);
  });

  it("needs a scheme, because guessing one means inventing the host", () => {
    expect(urlDetector.detect("example.com/path", clock)).toBeNull();
  });

  it("a bare query string is read the way a server would read it", () => {
    const f = queryDetector.detect("a=one%20two&b=three", clock)!;
    expect(f.detail).toContain("a = one two");
  });

  it("a sentence with an equals sign in it is not a query string", () => {
    expect(queryDetector.detect("the answer = 42 apparently", clock)).toBeNull();
  });
});

describe("json", () => {
  it("expands a long string field and a date-shaped number, not everything", () => {
    const f = jsonDetector.detect(
      JSON.stringify({ id: 1, name: "ok", blob: "abcdefghijklmnop", at: 1_789_203_600 }),
      clock,
    )!;
    const labels = (f.seeds ?? []).map((s) => s.label);
    expect(labels).toContain("blob");
    expect(labels).toContain("at");
    expect(labels).not.toContain("id");
    expect(labels).not.toContain("name");
  });

  it("gives a nested field its dotted path, so a card can say where it came from", () => {
    const f = jsonDetector.detect(JSON.stringify({ outer: { inner: "abcdefghijklmnop" } }), clock)!;
    expect((f.seeds ?? []).map((s) => s.label)).toContain("outer.inner");
  });

  it("does not claim a bare number or a quoted word as JSON", () => {
    expect(jsonDetector.detect("42", clock)).toBeNull();
    expect(jsonDetector.detect('"hello"', clock)).toBeNull();
  });
});
