import { useState } from "react";

/**
 * The shell. One input, and a place for what comes out of it.
 *
 * The detection engine is not wired in yet; this exists so the privacy layers can be built
 * and tested against a real page first. That order is deliberate: a Content-Security-Policy
 * added after the features is a policy shaped around whatever the features happened to
 * need, and every exception in it was already load-bearing by the time anyone looked.
 */
export function App() {
  const [text, setText] = useState("");

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
        onChange={(e) => setText(e.target.value)}
        placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Anything at all"
        data-testid="input"
      />

      <div className="meta">
        <span data-testid="count">{text.length} characters</span>
      </div>

      <section className="findings" data-testid="findings">
        {text.trim() === "" ? (
          <p className="empty">
            Nothing pasted yet. Whatever you put in the box stays in the box.
          </p>
        ) : (
          <p className="empty" data-testid="pending">
            Detection is not wired up yet, so this is only holding {text.trim().length}{" "}
            characters and telling you so.
          </p>
        )}
      </section>
    </main>
  );
}
