import type { Scored } from "../detect/types";

/**
 * One reading, with everything that qualifies it.
 *
 * **The caveats are not optional and they are not behind a control.** A `certain` badge
 * next to "signature not checked" is the normal look here, and it is only safe because both
 * are on screen at once: hide the caveat behind a disclosure and the badge starts meaning
 * "verified". So this component destructures `caveats` and renders them unconditionally, and
 * the count sits inside the badge row where the confidence is, rather than somewhere the eye
 * can skip.
 *
 * Every reason still carries its sentence. The reader knows where the string came from and
 * this does not, so the notes are what let them overrule the ranking - but the sentence now
 * comes with the weight drawn beside it, on one scale shared by every reading on the page,
 * with evidence AGAINST running the other way from a zero line. A column of "+4" and "-2"
 * is a table you have to add up; the same numbers drawn are a shape you can read.
 */
export function Finding({ finding }: { finding: Scored }) {
  const { kind, band, bits, evidence, proves, caveats, detail } = finding;

  return (
    <article className="finding" data-testid={`finding-${kind}`} data-band={band}>
      <header className="finding-head">
        <h3>{kind}</h3>
        <span className="band" data-band={band}>
          {band}
        </span>
        {/* Beside the band on purpose. The number of things this cannot tell you belongs in
            the same glance as how sure it is. */}
        {caveats.length > 0 && (
          <span className="caveat-count" data-testid={`caveats-${kind}`}>
            {caveats.length} caveat{caveats.length === 1 ? "" : "s"}
          </span>
        )}
        <span className="bits" title="Total evidence, in bits">
          {bits > 0 ? `+${bits}` : bits}
        </span>
      </header>

      {/*
       * What this reading does NOT establish, before the reasons it does.
       *
       * A forensic report puts its limits at the top, and this one has to: "certain" beside
       * "signature not checked" is only safe while both are read, and a reader who has
       * already gone down the evidence has decided what the finding means before reaching a
       * footnote that changes it.
       */}
      {caveats.length > 0 && (
        <div className="limits" data-testid={`caveat-list-${kind}`}>
          <p className="limits-label">Not established</p>
          <ul>
            {caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {detail !== undefined && detail !== "" && <pre className="detail">{detail}</pre>}

      <p className="proves">{proves}</p>

      <ul className="evidence">
        {evidence.map((e, i) => (
          <li key={i} data-sign={e.bits < 0 ? "against" : "for"}>
            <span className="ev-bits">{e.bits > 0 ? `+${e.bits}` : e.bits}</span>
            {/* The weight, drawn. Width is bits at a fixed rate shared by every finding on
                the page, so two readings can be compared by looking rather than by adding.
                aria-hidden because the number beside it already says the same thing. */}
            <span className="ev-scale" aria-hidden="true">
              <i style={{ width: `calc(${Math.min(Math.abs(e.bits), EV_CAP)} * var(--bit))` }} />
            </span>
            <span className="ev-note">{e.note}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

/**
 * Where a bar stops growing.
 *
 * Nothing a detector emits is worth more than this, and a runaway value would set the scale
 * for the whole page and flatten every other bar into a stub. Capping is a lie about one
 * number; normalising to the largest would be a lie about all of them.
 */
const EV_CAP = 8;

/**
 * Two or more readings that the evidence cannot separate, shown as one unit joined by "or".
 *
 * This is the whole reason the scores are bits rather than a percentage. When 32 hex
 * characters are equally well explained as an MD5 and as a dashless UUID, there is no
 * winner, and the shapes that usually get reached for here all lie about that: tabs hide one
 * behind a click, a dropdown implies a default, and a single best guess with the rest
 * collapsed is just picking while looking humble.
 *
 * One outline around the pair. It is the only outlined thing on the page, which is what
 * makes an outline mean something.
 */
export function Peers({ findings }: { findings: readonly Scored[] }) {
  if (findings.length === 0) return null;
  if (findings.length === 1) return <Finding finding={findings[0]!} />;

  return (
    <div className="peers" data-testid="peers">
      <p className="peers-lede">
        Two readings fit this equally well. Nothing in the value itself separates them, so
        both are here rather than one being chosen for you.
      </p>
      {findings.map((f, i) => (
        <div key={f.kind}>
          {i > 0 && <div className="or">or</div>}
          <Finding finding={f} />
        </div>
      ))}
    </div>
  );
}
