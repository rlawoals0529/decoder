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

## Detectors

| Change | Turns red |
| --- | --- |
| The JWT signature caveat is deleted | `jwt > says the signature is not checked, first` and the catalogue's `carries at least one caveat` |
| `clock.now()` in the JWT becomes `Date.now()` | `jwt > says a token is expired against the injected clock` |
| The UUID embedded-date evidence drops to 0 bits | `an embedded date is the decisive evidence` |
| The 8-4-4-4-12 grouping drops from 9 bits to 1 | `the 8-4-4-4-12 grouping alone is enough to be certain` |
| `BY_LENGTH` in hex is trimmed to one candidate per length | `hex mentions a git object id on the SHA-1 card` |
| Timestamps render with `toLocaleString()` | `timestamp > labels every date UTC` |
| The "never as a link" caveat is deleted | `url > never renders as a link, and says why` |
| JSON expands every string, not only long ones | `json > expands a long string field and a date-shaped number, not everything` |

## Three that got away, and what they taught

**`fatal: true` to `fatal: false` in `decodeBase64` passed the entire suite** the first time
these were run. With `fatal: false`, invalid UTF-8 becomes U+FFFD replacement characters
rather than throwing, so `decodeBase64` returns a string of black diamonds, the detector
reports "decodes cleanly to printable text", and the card presents that as the contents of
what you pasted. Every hash and key that happens to match the base64 alphabet would have
rendered that way.

Nothing caught it because every test until then fed the decoder text that was already valid
UTF-8. `src/detect/base64.test.ts` now pins `//79/Pv6+fj39vX0`, which is valid base64 whose
bytes are not text.

### A test can be vacuous in a way that reads as thorough

Two of the detector tests above passed against the mutation on the first run, and neither
looked weak:

**`says a token is expired against the injected clock, not the wall clock`** used a token
expiring in 2020 and one expiring in 2096. Those are past and future against real time too,
so replacing `clock.now()` with `Date.now()` changed no answer. It now uses two clocks
chosen so the wall clock gives the opposite answer to one of them.

**`a dashed UUID clearly beats the hex reading`** compared the UUID score against the hex
score for the same string. The hex detector does not fire on a string containing dashes at
all, so the comparison was against `null`, and it stayed green with the grouping worth 1 bit
instead of 9. It now asserts the band a dashed v4 reaches on the grouping alone.

Both are the same mistake: **an assertion whose other side does not exist.** A comparison
against a value that is always absent, or a boundary the input never crosses, is a test that
can only pass.

## What a property test cannot do

Two limits worth stating so nobody expects otherwise.

**A property cannot validate a constant.** `BANDS.certain` could change from 12 to 15 and
every relationship test would move with it, because they read the constant they are checking.
That is why `the tuning numbers are what they are` writes the numbers out longhand. It is a
boring test and it is the only thing standing between a set of thresholds and a fudge factory.

**A property cannot tell "correct" from "consistently wrong".** The determinism properties
would pass just as happily against a detector that always returned the same wrong answer.
The named tests in `base64.test.ts` are what pin behaviour to specific inputs.

## A failing test that was right

`a bare 32-hex string is a peer of both` failed the first time it ran, and the code was
correct. The example was a v7 UUID, whose embedded timestamp decodes to a real date, and a
hash has no reason to carry one: three independent reasons stack and the question stops being
ambiguous. That is the scoring design working rather than a bug in it.

The genuinely ambiguous case is a **v4**, which is random and carries no date, so once the
dashes are gone there is nothing in the characters to separate it from an MD5. There are now
two tests: one asserting the v4 case is shown as a pair, and one asserting the v7 case is
not.
