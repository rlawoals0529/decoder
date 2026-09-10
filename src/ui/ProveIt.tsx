/**
 * How to watch the browser refuse to send something, in your own console.
 *
 * This section has been rewritten twice by `check-no-network`, and both times it was right.
 *
 * It started as a button that attempted a real upload and reported the refusal. That needed
 * a `fetch(` call and an absolute URL in the bundle, which is exactly what the check
 * forbids, and allowlisting them would have turned "there is no way for this page to reach
 * the network" into "there is one, and here is why it is fine". A reader grepping the
 * deployed file would have found a fetch call and a remote URL.
 *
 * The replacement printed the line for the reader to copy, and the check failed again: the
 * *string* contains `fetch(` and a URL, and the check looks for primitives rather than for
 * intent, because intent is not greppable. Whitespace or string-splitting would have got
 * past it, and dodging your own check by obfuscation is worse than not having one.
 *
 * So the literal line lives in the README, next to the other verification recipe, and this
 * describes what to do. The check stays absolute, which is the thing worth protecting.
 *
 * What survived is stronger than the button was. The reader runs the request themselves, as
 * arbitrary code this page never shipped, so a refusal says nothing running here can get
 * out. `e2e/privacy.spec.ts` runs that request and asserts the directive, so the claim
 * cannot drift away from the behaviour.
 */
export function ProveIt() {
  return (
    <section className="prove" data-testid="prove">
      <h2>Prove it yourself</h2>

      <p>
        Open your browser console on this page and try to send something anywhere: a request
        to any other origin, by any method you like. It is your code, not ours, and this page
        never shipped it. The exact one-liner is in the README, under{" "}
        <em>The claim, and four ways to check it</em>.
      </p>

      <p>
        It will be refused, and the console will name <code>connect-src</code> as the reason.
        Nothing running on this page can open a connection, including anything you paste into
        a console, which is a stronger statement than a button on this page failing on
        purpose could make.
      </p>

      <p>
        Then the other half, which needs no console at all: turn your network off and keep
        using it. Everything here already works offline, because there was never anything to
        fetch.
      </p>

      <p className="prove-note">
        There was a button here that tried the upload for you, and then a copyable line. The
        repository&rsquo;s own check refused to build a bundle containing either, because a
        grep cannot tell a demonstration from a leak. That is the check working, so the
        instruction moved instead of the check.
      </p>
    </section>
  );
}
