import { describe, expect, it } from "vitest";
import { announceReady, isEmbedded, isPasteMessage, onPaste } from "./embed";

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

describe("announceReady", () => {
  const spy = () => {
    const sent: unknown[] = [];
    return { window: { postMessage: (m: unknown) => sent.push(m) } as unknown as Window, sent };
  };

  it("says nothing when the page is not embedded", () => {
    // A browser tab has no host to tell. Posting to whatever is above it would be the one
    // outbound message this app makes, sent for no reason.
    const host = spy();
    announceReady("", host.window);
    expect(host.sent).toEqual([]);
  });

  it("says nothing when there is no parent, or the parent is this page", () => {
    const host = spy();
    announceReady("?embed=1", null);
    announceReady("?embed=1", globalThis.self);
    expect(host.sent).toEqual([]);
  });

  it("carries no data, only the fact that the page exists", () => {
    // The property the widget frame's comment depends on: text goes in, and what comes back
    // out is not data. A field added here would quietly make that untrue.
    const host = spy();
    announceReady("?embed=1", host.window);
    expect(host.sent).toEqual([{ type: "hikari:ready" }]);
    expect(Object.keys(host.sent[0] as object)).toEqual(["type"]);
  });
});
