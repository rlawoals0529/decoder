import { describe, expect, it } from "vitest";
import { isEmbedded, isPasteMessage, onPaste } from "./embed";

describe("isEmbedded", () => {
  it("is only true for the exact opt-in", () => {
    expect(isEmbedded("?embed=1")).toBe(true);
    expect(isEmbedded("?a=b&embed=1")).toBe(true);
  });

  it("is false for everything else, including a truthy-looking value", () => {
    // The listener being off by default is the point, so anything short of the exact
    // parameter has to leave it off. "true" and "yes" read as opt-ins to a human and are
    // not this one.
    for (const s of ["", "?", "?embed=0", "?embed", "?embed=true", "?embed=yes", "?embedded=1", "?x=1"]) {
      expect(isEmbedded(s), s).toBe(false);
    }
  });
});

describe("isPasteMessage", () => {
  it("accepts the one shape it is for", () => {
    expect(isPasteMessage({ type: "hikari:paste", text: "abc" })).toBe(true);
    expect(isPasteMessage({ type: "hikari:paste", text: "" })).toBe(true);
  });

  it("rejects everything else without comment", () => {
    // A page that can postMessage into this one can send anything, so the guard has to be
    // narrow rather than forgiving.
    for (const v of [
      null,
      undefined,
      "hikari:paste",
      42,
      [],
      {},
      { type: "hikari:paste" },
      { type: "hikari:paste", text: 42 },
      { type: "hikari:paste", text: null },
      { type: "paste", text: "abc" },
      { type: "hikari:other", text: "abc" },
    ]) {
      expect(isPasteMessage(v), JSON.stringify(v)).toBe(false);
    }
  });
});

describe("onPaste", () => {
  /** A message on a bare EventTarget, which is all the listener ever reads. */
  const post = (target: EventTarget, data: unknown) =>
    target.dispatchEvent(Object.assign(new Event("message"), { data }));

  it("registers no listener at all without the opt-in", () => {
    // Not "registers one that ignores messages". A feature that is off unless requested
    // cannot be reached by accident, and this is the assertion that keeps it that way.
    const target = new EventTarget();
    let added = false;
    const original = target.addEventListener.bind(target);
    target.addEventListener = (...args: Parameters<EventTarget["addEventListener"]>) => {
      added = true;
      original(...args);
    };
    onPaste(() => {}, "", target)();
    expect(added).toBe(false);
  });

  it("delivers the text of a valid message", () => {
    const target = new EventTarget();
    const seen: string[] = [];
    const off = onPaste((t) => seen.push(t), "?embed=1", target);
    post(target, { type: "hikari:paste", text: "a token" });
    expect(seen).toEqual(["a token"]);
    off();
  });

  it("ignores a message of any other shape", () => {
    const target = new EventTarget();
    const seen: string[] = [];
    const off = onPaste((t) => seen.push(t), "?embed=1", target);
    post(target, { type: "evil", text: "x" });
    post(target, "hikari:paste");
    post(target, null);
    expect(seen).toEqual([]);
    off();
  });

  it("stops listening when unsubscribed", () => {
    const target = new EventTarget();
    const seen: string[] = [];
    onPaste((t) => seen.push(t), "?embed=1", target)();
    post(target, { type: "hikari:paste", text: "after" });
    expect(seen).toEqual([]);
  });
});
