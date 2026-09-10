/**
 * Being summoned by something else, which is how this runs on a desktop.
 *
 * The desktop build of this tool is the same build. A widget host frames this page and
 * pushes the clipboard in by `postMessage`, so the interaction is: copy a token, press a
 * key, and it is already decoded. That is only possible outside a browser, and it is the
 * reason to have a desktop build at all.
 *
 * Three decisions worth reading before touching this.
 *
 * **It only listens when asked.** Without `?embed=1` no listener is registered, so the
 * page as people visit it has no message surface at all. A feature that is off unless
 * requested cannot be reached by accident.
 *
 * **The sender is not trusted, and cannot be.** A page loaded from `file://` has an origin
 * of `"null"`, so there is no origin to check against. What makes that acceptable is the
 * direction of travel: this only ever *receives* text and puts it in the input. It sends
 * nothing back, ever, so the worst a hostile framer can do is type into a box you are
 * looking at. Reading the result would need cross-origin DOM access, which no framer has.
 *
 * **The clipboard is never read from here.** In the browser there is no clipboard access
 * at all, by design: a permission prompt is a terrible look for a tool whose pitch is that
 * it wants nothing from you, and `check-no-network` forbids `navigator.clipboard` outright.
 * The host reads it in its own trusted process, gated on the widget's manifest asking for
 * permission, and pushes the text in. Same core, two hosts, and the privileged one is the
 * one the user installed on purpose.
 */

/** The one message shape this accepts. Anything else is ignored without comment. */
export interface PasteMessage {
  readonly type: "hikari:paste";
  readonly text: string;
}

export function isEmbedded(search: string = location.search): boolean {
  return new URLSearchParams(search).get("embed") === "1";
}

/** True when a message is one we act on. Narrow on purpose. */
export function isPasteMessage(data: unknown): data is PasteMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "hikari:paste" &&
    typeof (data as { text?: unknown }).text === "string"
  );
}

/**
 * Tell the host this page is listening.
 *
 * The frame used to push the clipboard in when the iframe fired `load`, and that is too
 * early: the document has finished loading before the app has mounted and attached its
 * message listener, so the message arrived with nobody listening and was lost. Measured,
 * not guessed -- posting the same message a moment later worked every time.
 *
 * So the page says when it is ready instead of the host guessing. One message goes out and
 * it carries nothing but the fact that this page exists, which is the only outbound message
 * there is: everything else travels inwards.
 */
export function announceReady(search: string = location.search, parent: Window | null = globalThis.parent): void {
  if (!isEmbedded(search)) return;
  // Not when the page is the top window: posting to yourself is harmless but meaningless,
  // and the guard makes the intent legible.
  if (!parent || parent === globalThis.self) return;
  parent.postMessage({ type: "hikari:ready" }, "*");
}

/**
 * Listen for text being pushed in. Returns an unsubscribe.
 *
 * A no-op that unsubscribes nothing when the page was not asked to embed, so a caller does
 * not have to check first.
 *
 * `target` exists so the tests can hand it a plain `EventTarget`. The alternative was
 * adding jsdom to run four assertions, and a dependency is a worse answer than a parameter
 * with an obvious default.
 */
export function onPaste(
  handler: (text: string) => void,
  search: string = location.search,
  target: EventTarget = globalThis,
): () => void {
  if (!isEmbedded(search)) return () => {};
  const listener = (e: Event) => {
    const data = (e as MessageEvent).data;
    if (isPasteMessage(data)) handler(data.text);
  };
  target.addEventListener("message", listener);
  return () => target.removeEventListener("message", listener);
}
