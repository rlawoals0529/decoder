# Mutations

A test suite nobody has watched fail is not evidence. Each row below is a change to the
source that must turn a **named** test red. Run them by hand after touching the core.

The method: back the file up, apply the change, `npx vitest run`, restore.

## Caught

| Change | Turns red |
| --- | --- |
| `seedAllowed` returns `true` unconditionally, so a decoding may grow | `the walk terminates > a decoding that does not shrink is refused` |
| `bandFor` uses `>` instead of `>=`, so a band starts one bit late | `scoring > a band starts at its threshold and not one bit later` |
| `PEER_WINDOW` becomes 99, so everything is a peer of everything | `scoring > the tuning numbers are what they are` |
| `score` drops both clamps | `scoring > stays inside its clamps whatever the evidence says` |
| `rank` drops the `localeCompare` tie-break, so ordering depends on registration order | `scoring > ranks highest first, and ties break on the kind rather than on array order` |
| `TextDecoder` constructed with `fatal: false` | `decoding > returns null when the bytes are not valid UTF-8` and `ranks a clean decoding above one that decodes to control characters` |

## The one that got away, and what it taught

**`fatal: true` to `fatal: false` in `decodeBase64` passed the entire suite** the first time
these were run. With `fatal: false`, invalid UTF-8 becomes U+FFFD replacement characters
rather than throwing, so `decodeBase64` returns a string of black diamonds, the detector
reports "decodes cleanly to printable text", and the card presents that as the contents of
what you pasted. Every hash and key that happens to match the base64 alphabet would have
rendered that way.

Nothing caught it because every test until then fed the decoder text that was already valid
UTF-8. `src/detect/base64.test.ts` now pins `//79/Pv6+fj39vX0`, which is valid base64 whose
bytes are not text.

## What a property test cannot do

Two limits worth stating so nobody expects otherwise.

**A property cannot validate a constant.** `BANDS.certain` could change from 12 to 15 and
every relationship test would move with it, because they read the constant they are checking.
That is why `the tuning numbers are what they are` writes the numbers out longhand. It is a
boring test and it is the only thing standing between a set of thresholds and a fudge factory.

**A property cannot tell "correct" from "consistently wrong".** The determinism properties
would pass just as happily against a detector that always returned the same wrong answer.
The named tests in `base64.test.ts` are what pin behaviour to specific inputs.
