import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_BUDGET, analyse, type Node } from "./detect/engine";
import { announceReady, isEmbedded, onPaste } from "./embed";
import { DETECTORS } from "./detect/registry";
import { systemClock } from "./detect/types";
import { ProveIt } from "./ui/ProveIt";
import { Tree } from "./ui/Tree";

/**
 * One input, and everything that follows from it.
 *
 * There is no button to press. Analysis is synchronous and bounded by a 50ms deadline, so
 * it runs on every keystroke and the result is always of what is in the box right now. A
 * submit button here would only be a way to make the page feel like a form.
 */
export function App() {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  /** Seeds the reader asked to expand, each with a budget of its own. */
  const [expanded, setExpanded] = useState<string[]>([]);

  const results = useMemo(
    () => [text, ...expanded].filter((t) => t.trim() !== "").map((t) => analyse(t, DETECTORS, systemClock, DEFAULT_BUDGET)),
    [text, expanded],
  );

  const onExpand = (node: Node) => setExpanded((prev) => (prev.includes(node.text) ? prev : [...prev, node.text]));

  // Summoned rather than visited: a widget host pushes the clipboard in when the overlay
  // is shown, so a token is already decoded by the time the window appears. No listener at
  // all without ?embed=1.
  useEffect(() => {
    const stop = onPaste((incoming) => {
      setText(incoming);
      setExpanded([]);
      box.current?.focus();
      box.current?.select();
    });
    // After the listener, never before. The host waits for this rather than pushing on the
    // iframe's load event, which fires while this effect has not run yet: the clipboard was
    // posted into a page with nobody listening, and the overlay opened empty.
    announceReady();
    return stop;
  }, []);

  const empty = text.trim() === "";
  const embedded = isEmbedded();

  return (
    <main className={embedded ? "page embedded" : "page"}>
      {/* The overlay is summoned over whatever you were doing, so the title and the pitch
          are noise there: you already know what you pressed the key for. */}
      {!embedded && (
        <>
          <h1>Paste it. Find out what it is.</h1>
          <p className="lede">
            A token, a hash, a timestamp, something encoded twice. It says what it is and
            expands what it finds inside. This page cannot reach the network at all, so
            nothing you paste can leave it.
          </p>
        </>
      )}

      {/* No visible label. A large empty box you can type into has never needed one, and
          the aria-label is what a screen reader actually reads. */}
      <textarea
        ref={box}
        className="input"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          // A new input makes previous expansions meaningless, and leaving them on screen
          // under a different value would be worse than losing them.
          setExpanded([]);
        }}
        placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Anything at all"
        data-testid="input"
      />

      <div className="meta">
        <span data-testid="count">{text.length} characters</span>
        {!empty && (
          <span data-testid="found">
            {results.reduce((n, r) => n + r.nodes.filter((x) => x.findings.length > 0).length, 0)} reading
            {results.reduce((n, r) => n + r.nodes.filter((x) => x.findings.length > 0).length, 0) === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <section className="findings" data-testid="findings">
        {empty ? (
          <p className="empty">Nothing pasted yet. Whatever you put in the box stays in the box.</p>
        ) : (
          results.map((r, i) => <Tree key={i} result={r} onExpand={onExpand} />)
        )}
      </section>

      {!embedded && <ProveIt />}
    </main>
  );
}
