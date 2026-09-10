import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { analyse } from "./engine";
import { DETECTORS } from "./registry";
import { unexplainedEvidence } from "./score";
import { systemClock, type Clock, type Kind } from "./types";

const frozen = (at = 1_789_203_600_000): Clock => ({ now: () => at });

/**
 * The catalogue rules. Every kind has to satisfy these, and this file is what stops a new
 * detector shipping without the parts that make a card honest.
 */

/** Kinds that have a detector today. The rest of the union is not built yet. */
const IMPLEMENTED: Kind[] = [
  "base64",
  "base64url",
  "hex",
  "json",
  "jwt",
  "number",
  "query",
  "timestamp",
  "url",
  "uuid",
];

/** Inputs that make each implemented kind fire, so the rules below run on real findings. */
const SAMPLES: Record<string, string> = {
  base64: btoa("a readable sentence right here"),
  base64url: "SGVsbG8-V29ybGQ_IHRoaXMgaXMgbG9uZ2Vy",
  hex: "d41d8cd98f00b204e9800998ecf8427e",
  json: '{"a":1,"b":{"c":"a string long enough"}}',
  jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiaWF0IjoxNzg5MjAzNjAwfQ.abc",
  number: "42",
  query: "access_token=abcdefghijkl&state=xyz",
  timestamp: "1789203600",
  url: "https://example.com/a/b?token=abcdefghijkl#frag",
  uuid: "018f3a2b-7c4d-7e8f-9a0b-1c2d3e4f5060",
};

describe("the registry", () => {
  it("has no duplicate kinds", () => {
    const kinds = DETECTORS.map((d) => d.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("registers every detector that exists, so none is written and left unwired", () => {
    // The failure this guards against is silent: an unregistered detector simply never
    // runs, and nothing about the output says a kind is missing.
    const registered = new Set(DETECTORS.map((d) => d.kind));
    for (const kind of IMPLEMENTED) expect(registered.has(kind), `${kind} is not registered`).toBe(true);
    expect(registered.size).toBe(IMPLEMENTED.length);
  });

  it("every registered detector actually fires on something", () => {
    // A detector nothing can trigger is dead weight that looks like coverage.
    for (const d of DETECTORS) {
      const sample = SAMPLES[d.kind];
      expect(sample, `no sample for ${d.kind}`).toBeDefined();
      expect(d.detect(sample!, systemClock), `${d.kind} did not fire on its own sample`).not.toBeNull();
    }
  });
});

describe("every finding is honest, by rule rather than by review", () => {
  it("carries a proves that says something", () => {
    for (const d of DETECTORS) {
      const f = d.detect(SAMPLES[d.kind]!, frozen())!;
      // Long enough to be a sentence, and not a restatement of the kind name.
      expect(f.proves.trim().length, `${d.kind} proves is too short`).toBeGreaterThan(30);
      expect(f.proves.toLowerCase()).not.toBe(`this is a ${d.kind}`);
    }
  });

  it("carries at least one caveat, because every one of these readings has a limit", () => {
    for (const d of DETECTORS) {
      const f = d.detect(SAMPLES[d.kind]!, frozen())!;
      expect(f.caveats.length, `${d.kind} claims to have no limits`).toBeGreaterThan(0);
      for (const c of f.caveats) expect(c.trim().length).toBeGreaterThan(20);
    }
  });

  it("gives every reason a note", () => {
    for (const d of DETECTORS) {
      const f = d.detect(SAMPLES[d.kind]!, frozen())!;
      expect(unexplainedEvidence(f), d.kind).toEqual([]);
      expect(f.evidence.length, `${d.kind} fired with no reasons at all`).toBeGreaterThan(0);
    }
  });

  it("returns the text it was given, so a card can show what it looked at", () => {
    for (const d of DETECTORS) {
      const sample = SAMPLES[d.kind]!;
      const f = d.detect(sample, frozen())!;
      expect(sample).toContain(f.text.replace(/^\?/, ""));
    }
  });
});

describe("no detector throws", () => {
  it("on arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        for (const d of DETECTORS) expect(() => d.detect(input, frozen())).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });

  it("on input shaped like the things it is for", () => {
    const shaped = fc.oneof(
      fc.hexaString({ minLength: 1, maxLength: 140 }),
      fc.base64String({ minLength: 4, maxLength: 200 }),
      fc.stringMatching(/^[0-9]{1,20}$/),
      fc.tuple(fc.base64String(), fc.base64String(), fc.base64String()).map((p) => p.join(".")),
      fc.tuple(fc.string(), fc.string()).map(([a, b]) => `${a}=${b}`),
      fc.webUrl(),
      fc.uuid(),
      fc.json(),
    );
    fc.assert(
      fc.property(shaped, (input) => {
        for (const d of DETECTORS) expect(() => d.detect(input, frozen())).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });
});

describe("the whole thing, end to end", () => {
  it("reads a JWT down to the date inside its payload", () => {
    // The point of the whole design: the JWT detector knows nothing about timestamps, the
    // timestamp detector knows nothing about JWTs, and the engine puts them together.
    const jwt = SAMPLES["jwt"]!;
    const r = analyse(jwt, DETECTORS, frozen());
    const kinds = r.nodes.flatMap((n) => n.findings.map((f) => f.kind));
    expect(kinds).toContain("jwt");
    expect(kinds).toContain("json");
    expect(kinds).toContain("timestamp");
  });

  it("shows the boring reading beside the interesting one", () => {
    // 1789203600 is a date and it is also just a number. Both, or neither is trustworthy.
    const r = analyse("1789203600", DETECTORS, frozen());
    const kinds = r.nodes[0]!.findings.map((f) => f.kind);
    expect(kinds).toContain("timestamp");
    expect(kinds).toContain("number");
  });

  it("shows MD5 and UUID as peers for 32 bare hex characters, rather than choosing", () => {
    const r = analyse("018f3a2b7c4d7e8f9a0b1c2d3e4f5060", DETECTORS, frozen());
    const kinds = r.nodes[0]!.findings.map((f) => f.kind);
    expect(kinds).toContain("hex");
    expect(kinds).toContain("uuid");
  });

  it("pulls a token out of a URL and reads it", () => {
    const url = `https://example.com/callback?access_token=${SAMPLES["jwt"]}&state=abcdefghijkl`;
    const r = analyse(url, DETECTORS, frozen());
    const kinds = r.nodes.flatMap((n) => n.findings.map((f) => f.kind));
    expect(kinds).toContain("url");
    expect(kinds).toContain("jwt");
  });
});
