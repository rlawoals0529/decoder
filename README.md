# decoder

One box. Paste anything and it says what it is.

A token, a hash, a timestamp, an ID, something encoded twice. It names it, decodes it, and
expands what it finds inside, so a JWT becomes its header and payload and the timestamp
inside the payload becomes a date.

**Nothing leaves your browser, and that is enforced rather than promised.**

## The claim, and four ways to check it without trusting me

A privacy tool asking to be trusted is the wrong shape. These are in order of how little
they need you to believe.

### 1. The page cannot reach the network. Your browser enforces it

The built page carries this:

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
font-src 'self'; img-src 'self' data:; connect-src 'none';
base-uri 'none'; form-action 'none'
```

`connect-src 'none'` means the browser refuses every `fetch`, `XMLHttpRequest`,
`WebSocket`, `EventSource` and `sendBeacon` this page could attempt, **including from code
nobody here wrote.** That moves the guarantee off my diligence and onto your browser, which
is the only place a claim like this can actually live.

Open the console on the page and run this. It is your code, not mine, and the page never
shipped it:

```js
fetch("https://example.com/", { method: "POST", body: "anything" })
```

It is refused, and the console names `connect-src` as the reason. If arbitrary code you
typed cannot get out, nothing on the page can.

**This line lives here rather than on the page, and the reason is worth knowing.** There was
a button in the app that ran the upload for you, and then a copyable line printed on screen.
`check-no-network` failed the build on both: the first contained a real `fetch` call, and
the second contained the string `fetch(` and a remote URL. The check looks for primitives
rather than for intent, because intent is not greppable, so it cannot tell a demonstration
from a leak. Whitespace or string-splitting would have got past it, and dodging your own
check by obfuscation is worse than not having one. So the instruction moved and the check
stayed absolute.

### 2. Grep the file that is actually deployed

Not the source. The file your browser downloaded:

```bash
curl -s https://rlawoals0529.github.io/decoder/assets/index-*.js \
  | node scripts/check-no-network.mjs -
```

`scripts/check-no-network.mjs` looks for `fetch(`, `XMLHttpRequest`, `WebSocket`,
`EventSource`, `sendBeacon`, `new Image`, `importScripts(`, `navigator.clipboard`, and any
absolute URL outside a five-entry allowlist. `npm run build` runs it against `dist/` and
**fails the build on a single hit**, so a version that could phone home cannot be published
by accident.

It looks for the primitives rather than for intent, because intent is not greppable. A false
positive costs one line explaining why a string is allowed. A false negative makes the front
page a lie.

Two findings from the first real run of it, both kept:

- **Vite's module-preload polyfill contains the only `fetch(` in the bundle.** It is off
  now. `connect-src 'none'` refused that fetch as readily as any other, so it was already
  dead code, and a build containing a fetch call cannot pass a check whose whole point is
  that you can grep the deployed file and find none.
- **React's production build carries `https://react.dev/errors/`** in the string it builds
  minified error messages from. Never requested. Allowlisted, with that reason written next
  to it.

### 3. Turn the network off and use it

Open the page, go offline, paste a real secret. It still works, because there was never
anything to fetch. **The fonts are served from this origin**, which is the part most pages
get wrong: one `<link>` to a font CDN is two requests to somebody else's server carrying
your IP address and the page you came from, on every single load. Archivo and JetBrains Mono
are here as 110 KB of woff2, which is also what lets `default-src 'none'` mean what it says.

### 4. Read the tests, which are shaped like the mistakes

`e2e/privacy.spec.ts` records a canary, pastes it, waits, and asserts that nothing was
requested and nothing carried it. Three of them are worth reading for what they had to be
changed to:

**`sendBeacon` returns `true` when the browser has blocked it.** Measured in Chromium 153.
No two of these APIs report a refusal the same way: `fetch` rejects, a `WebSocket`
constructor does not throw and fires an error event, `EventSource` and `XMLHttpRequest` do
not throw at all, and `sendBeacon` claims success having sent nothing. So refusal is asserted
through the `securitypolicyviolation` event, which is the browser naming what it stopped,
and which is uniform across all five.

**A rejected cross-origin `fetch` proves nothing.** CORS rejects it on any page with or
without a policy. That test stayed green with the entire policy removed until it asserted
the violated directive. Found by removing the policy and watching which tests noticed.

**A font test that only watches requests passes on a 404.** The URL is still same-origin, so
"no third-party font" stays true while the page silently falls back to a system face. It
checks response status now, and that the face is really usable.

## What it reads

JWT, base64 and base64url, hex with its candidate digests, JSON, URLs, query strings, unix
timestamps in seconds or milliseconds, UUIDs with their version and embedded time, and a
plain-number baseline.

**Nothing is read by one detector.** A JWT emits its header and payload, the JSON detector
emits the interesting fields inside them, and the timestamp detector reads the `exp` it
never knew was coming. Paste an OAuth callback URL and it reaches the token in
`access_token`, then its payload, then the date inside the payload. No detector knows about
any other; the engine walks what each one emits, breadth first, under a budget.

### Confidence is a list of reasons

Every reading shows what it is worth in bits and why, one line per reason, and evidence can
argue against a reading as well as for it. A float confidence was rejected: "87% likely MD5"
is precision nobody can justify, and the notes are the part you can actually use, because
you know where the string came from and this does not.

**Ambiguity is shown rather than resolved.** A bare 32-character hex string is equally well
explained as an MD5 and as a UUID with its dashes stripped, so both appear, joined by "or",
inside the one outlined thing on the page. Tabs would hide one behind a click, a dropdown
would imply a default, and a single best guess with the rest collapsed is picking while
looking humble.

That is only true when the evidence really is even. A bare **v7** UUID is not ambiguous,
because its first 48 bits decode to a real date and a hash has no reason to carry one. A
bare **v4** is, because it is random and carries nothing. Both cases are pinned by tests, in
opposite directions.

### Every reading says what it cannot tell you

`caveats` is a required field and the card renders it unconditionally, never behind a
disclosure. A `certain` badge beside "signature not checked" is the normal look here, and it
is only safe because both are in the same glance: hide the caveat and the badge starts
meaning "verified".

The JWT card leads with **"Signature: not checked. We cannot verify this without the key, and
we will never ask you for it."** Verifying would need the secret, and asking for a signing
secret is asking for the one thing that should never be pasted anywhere.

Two more that matter:

- **A URL never renders as a link.** An anchor invites a hover preview or a prefetch, either
  of which hands a signed URL to a remote host without a click.
- **hex names candidates by length and says that is all it did.** A git object id is a SHA-1
  with no way to tell it apart without the repository, so it appears as one candidate among
  several rather than as its own confident reading that would be wrong most of the time.

### Nesting stops, and says where

Depth 4, 400 nodes, 64 KB, and a 50ms deadline. Hitting one is never a silent truncation: the
row says which budget stopped it and offers to continue from there with a fresh one, so a
limit is a decision you make rather than one you cannot see.

Termination is structural rather than a counter. A visited set is not enough on its own,
because something that decodes to a plausible re-encoding of itself cycles through values
that are each new, so a **decoding** seed is refused unless it is strictly shorter than its
parent.

## Running it

```bash
npm install
npm run dev          # no policy here, see below
npm run build        # typecheck, build, then refuse the build if it can reach the network
npm test             # unit
npm run e2e          # the privacy suite, against a production preview
```

**The policy is injected into the production build only, and there is a trap in that.**
Vite's dev server needs a WebSocket for hot reload and `connect-src 'none'` forbids it, so
in dev the page would appear broken. Somebody then repairs the dev server by weakening the
policy, and the strongest layer of this whole thing quietly dies. So the tests point at
`vite preview` instead, where the policy is real. Do not move them to the dev server.

## No runtime dependencies but React

`scripts/check-deps.mjs` fails CI if anything else appears in `dependencies`, and it runs as
its own job so the reason a run went red is legible from the job list. Every runtime
dependency is code nobody here reviewed, running on a page people paste secrets into, and
`check-no-network` greps for primitives rather than reading intent: a dependency that built a
URL out of fragments would go straight past it.

Colours and type are [yozora](https://github.com/rlawoals0529/yozora), vendored.

MIT
