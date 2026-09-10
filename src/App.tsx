import { useMemo, useState } from "react";
import { DEFAULT_BUDGET, analyse, type Node } from "./detect/engine";
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
  /** Seeds the reader asked to expand, each with a budget of its own. */
  const [expanded, setExpanded] = useState<string[]>([]);

  const results = useMemo(
    () => [text, ...expanded].filter((t) => t.trim() !== "").map((t) => analyse(t, DETECTORS, systemClock, DEFAULT_BUDGET)),
    [text, expanded],
  );

  const onExpand = (node: Node) => setExpanded((prev) => (prev.includes(node.text) ? prev : [...prev, node.text]));

  const empty = text.trim() === "";

  return (
    <main className="page">
      <h1>Paste it. Find out what it is.</h1>
      <p className="lede">
        A token, a hash, a timestamp, something encoded twice. It says what it is and expands
        what it finds inside. This page cannot reach the network at all, so nothing you paste
        can leave it.
      </p>

      {/* No visible label. A large empty box you can type into has never needed one, and
          the aria-label is what a screen reader actually reads. */}
      <textarea
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

      <ProveIt />
    </main>
  );
}
