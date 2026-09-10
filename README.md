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

## Not yet built

The detection engine. This is the shell, the policy and the checks, and that order is
deliberate: a policy written after the features is a policy shaped around whatever the
features happened to need, and every exception in it is load-bearing by the time anyone
looks.

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
