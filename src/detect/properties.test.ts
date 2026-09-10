import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET, analyse, seedAllowed } from "./engine";
import { DETECTORS } from "./registry";
import { BANDS, MAX_BITS, MIN_BITS, PEER_WINDOW, bandFor, peers, rank, score, unexplainedEvidence } from "./score";
import type { Clock, Finding } from "./types";

/** A clock that does not move, so nothing here can depend on wall time. */
const frozen = (at = 1_789_203_600_000): Clock => ({ now: () => at });

/**
 * A clock that advances by a fixed step on every read, for driving the deadline without
 * sleeping. Real time in a test is a flake waiting to happen.
 */
const ticking = (stepMs: number): Clock => {
  let t = 0;
  return { now: () => (t += stepMs) };
};

describe("the parser is total", () => {
  it("never throws, whatever it is handed", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(() => analyse(input, DETECTORS, frozen())).not.toThrow();
      }),
      { numRuns: 400 },
    );
  });

  it("never throws on the kinds of string that actually turn up", () => {
    // Plain fc.string() rarely produces anything that looks like a token, so the shapes
    // this tool exists for would go untested by the property above alone.
    const shaped = fc.oneof(
      fc.hexaString({ minLength: 1, maxLength: 80 }),
      fc.base64String({ minLength: 4, maxLength: 200 }),
      fc.stringMatching(/^[0-9]{1,19}$/),
      fc.tuple(fc.base64String(), fc.base64String(), fc.base64String()).map((p) => p.join(".")),
      fc.string({ unit: fc.constantFrom("=", "-", "_", ".", "/", "+", "%", "{", "}", '"', ":") }),
    );
    fc.assert(
      fc.property(shaped, (input) => {
        expect(() => analyse(input, DETECTORS, frozen())).not.toThrow();
      }),
      { numRuns: 400 },
    );
  });

  it("always returns at least one node, even for nothing at all", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(analyse(input, DETECTORS, frozen()).nodes.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 200 },
    );
  });
});

describe("evaluation is deterministic", () => {
  it("the same input against the same clock gives the same answer twice", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const a = analyse(input, DETECTORS, frozen());
        const b = analyse(input, DETECTORS, frozen());
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      }),
      { numRuns: 200 },
    );
  });

  it("nothing reads the wall clock", () => {
    // Two different frozen times must produce the same findings for input with no date in
    // it. A detector that called Date.now() at a call site would break this.
    fc.assert(
      fc.property(fc.base64String({ minLength: 8, maxLength: 64 }), (input) => {
        const a = analyse(input, DETECTORS, frozen(0));
        const b = analyse(input, DETECTORS, frozen(4_000_000_000_000));
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      }),
      { numRuns: 200 },
    );
  });
});

describe("no bits without a note", () => {
  it("holds for every finding every detector produces", () => {
    // This is the rule the whole design rests on: a score is a list of reasons, and a
    // reason with no words is a number nobody can argue with.
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (input) => {
        for (const node of analyse(input, DETECTORS, frozen()).nodes) {
          for (const f of node.findings) expect(unexplainedEvidence(f)).toEqual([]);
        }
      }),
      { numRuns: 400 },
    );
  });

  it("and the check itself catches a violation", () => {
    const bad: Finding = {
      kind: "number",
      text: "1",
      evidence: [{ note: "   ", bits: 5 }],
      proves: "p",
      caveats: [],
    };
    expect(unexplainedEvidence(bad)).toHaveLength(1);
  });
});

describe("every finding is honest by construction", () => {
  it("carries a proves and a caveats, both real", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (input) => {
        for (const node of analyse(input, DETECTORS, frozen()).nodes) {
          for (const f of node.findings) {
            expect(typeof f.proves).toBe("string");
            expect(f.proves.trim().length).toBeGreaterThan(10);
            expect(Array.isArray(f.caveats)).toBe(true);
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("scoring", () => {
  it("stays inside its clamps whatever the evidence says", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -50, max: 50 }), { maxLength: 30 }),
        fc.integer({ min: -20, max: 20 }),
        (bits, prior) => {
          const f: Finding = {
            kind: "number",
            text: "x",
            evidence: bits.map((b, i) => ({ note: `reason ${i}`, bits: b })),
            proves: "a sentence long enough to pass",
            caveats: [],
          };
          const s = score(f, prior);
          expect(s).toBeGreaterThanOrEqual(MIN_BITS);
          expect(s).toBeLessThanOrEqual(MAX_BITS);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("bands are ordered, so more evidence never means less confidence", () => {
    fc.assert(
      fc.property(fc.integer({ min: MIN_BITS, max: MAX_BITS }), (bits) => {
        const order = { dropped: 0, possible: 1, likely: 2, certain: 3 };
        expect(order[bandFor(bits + 1)]).toBeGreaterThanOrEqual(order[bandFor(bits)]);
      }),
      { numRuns: 200 },
    );
  });

  it("a band starts at its threshold and not one bit later", () => {
    // Reads the constants, so it pins the boundary being inclusive. It cannot catch a
    // changed threshold: it would move with it. That is what the next test is for.
    expect(bandFor(BANDS.certain)).toBe("certain");
    expect(bandFor(BANDS.certain - 1)).toBe("likely");
    expect(bandFor(BANDS.likely)).toBe("likely");
    expect(bandFor(BANDS.likely - 1)).toBe("possible");
    expect(bandFor(BANDS.possible)).toBe("possible");
    expect(bandFor(BANDS.possible - 1)).toBe("dropped");
  });

  it("the tuning numbers are what they are", () => {
    // Written out rather than read from the module, because the risk this guards against
    // is the thresholds quietly drifting until every reading is "certain". Changing one is
    // fine; changing one without noticing is not, and this makes it a deliberate edit.
    expect(BANDS).toEqual({ certain: 12, likely: 7, possible: 2 });
    expect(PEER_WINDOW).toBe(3);
    expect([MIN_BITS, MAX_BITS]).toEqual([-8, 20]);
  });

  it("ranks highest first, and ties break on the kind rather than on array order", () => {
    const mk = (kind: Finding["kind"], bits: number) => ({
      finding: { kind, text: "x", evidence: [{ note: "n", bits }], proves: "a long enough sentence", caveats: [] },
      prior: 0,
    });
    const forward = rank([mk("uuid", 9), mk("hex", 9), mk("jwt", 15)]);
    const reversed = rank([mk("hex", 9), mk("uuid", 9), mk("jwt", 15)]);
    expect(forward.map((f) => f.kind)).toEqual(reversed.map((f) => f.kind));
    expect(forward[0]?.kind).toBe("jwt");
  });

  it("peers are everything within the window of the leader, never fewer than one", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 2, max: MAX_BITS }), { minLength: 1, maxLength: 8 }), (all) => {
        const scored = rank(
          all.map((bits, i) => ({
            finding: {
              kind: (["uuid", "hex", "jwt", "json", "url", "number", "ip", "colour"] as const)[i] ?? "number",
              text: "x",
              evidence: [{ note: "n", bits }],
              proves: "a long enough sentence",
              caveats: [],
            },
            prior: 0,
          })),
        );
        const p = peers(scored);
        expect(p.length).toBeGreaterThanOrEqual(1);
        const top = scored[0];
        for (const f of p) expect(top!.bits - f.bits).toBeLessThanOrEqual(PEER_WINDOW);
      }),
      { numRuns: 200 },
    );
  });
});

describe("the walk terminates", () => {
  it("a decoding that does not shrink is refused", () => {
    // The structural half of termination. A visited set alone would not give this: a value
    // that decodes to a plausible re-encoding of itself cycles through values that are each
    // new, so the visited set never fires.
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (parent, child) => {
        const allowed = seedAllowed({ label: "l", text: child, relation: "decoded" }, parent);
        expect(allowed).toBe(child.length < parent.length);
      }),
      { numRuns: 300 },
    );
  });

  it("never exceeds the node budget", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), (input) => {
        const budget = { ...DEFAULT_BUDGET, maxNodes: 12 };
        expect(analyse(input, DETECTORS, frozen(), budget).nodes.length).toBeLessThanOrEqual(12);
      }),
      { numRuns: 200 },
    );
  });

  it("never exceeds the depth budget", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (input) => {
        const budget = { ...DEFAULT_BUDGET, maxDepth: 2 };
        for (const n of analyse(input, DETECTORS, frozen(), budget).nodes) {
          expect(n.depth).toBeLessThanOrEqual(2);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("a budget it hits is reported, never silently applied", () => {
    // Deep nesting on purpose: base64 of base64 of base64, which is the shape that made
    // the budget necessary.
    let deep = "the secret at the bottom";
    for (let i = 0; i < 8; i++) deep = btoa(deep);
    const r = analyse(deep, DETECTORS, frozen(), { ...DEFAULT_BUDGET, maxDepth: 2 });
    expect(r.stopped).toContain("depth");
    expect(r.nodes.some((n) => n.stoppedBecause === "depth")).toBe(true);
  });

  it("a deadline stops it and says so, without any real waiting", () => {
    // 30ms per clock read against a 50ms deadline: the second node is already too late.
    const r = analyse("aGVsbG8gd29ybGQgdGhpcyBpcyBsb25nZXI=", DETECTORS, ticking(30));
    expect(r.stopped).toContain("time");
  });

  it("oversized input is truncated and the truncation is reported", () => {
    const r = analyse("a".repeat(200), DETECTORS, frozen(), { ...DEFAULT_BUDGET, maxInputBytes: 50 });
    expect(r.inputTruncated).toBe(true);
    expect(r.nodes[0]?.text.length).toBeLessThanOrEqual(50);
  });
});

describe("nesting reaches the bottom when the budget allows", () => {
  it("finds text buried under three layers of base64", () => {
    const secret = "the thing at the bottom";
    const wrapped = btoa(btoa(btoa(secret)));
    const r = analyse(wrapped, DETECTORS, frozen());
    expect(r.nodes.some((n) => n.text === secret)).toBe(true);
    expect(r.stopped).toEqual([]);
  });

  it("every node except the root knows where it came from", () => {
    const r = analyse(btoa(btoa("readable text here")), DETECTORS, frozen());
    for (const n of r.nodes) {
      if (n.parentId === null) expect(n.depth).toBe(0);
      else expect(n.label).not.toBeNull();
    }
  });
});
