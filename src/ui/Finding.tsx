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
 * The evidence is a list of sentences, not a bar or a percentage. The reader knows where the
 * string came from and this does not, so the notes are what let them overrule the ranking.
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

      {detail !== undefined && detail !== "" && <pre className="detail">{detail}</pre>}

      <p className="proves">{proves}</p>

      <ul className="evidence">
        {evidence.map((e, i) => (
          <li key={i}>
            <span className="ev-bits" data-sign={e.bits < 0 ? "against" : "for"}>
              {e.bits > 0 ? `+${e.bits}` : e.bits}
            </span>
            {e.note}
          </li>
        ))}
      </ul>

      <ul className="caveats" data-testid={`caveat-list-${kind}`}>
        {caveats.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </article>
  );
}

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
