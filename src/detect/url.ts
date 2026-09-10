import type { Detector, Evidence, Finding, Seed } from "./types";

/**
 * A URL, and its query string, and whatever is hiding in a parameter.
 *
 * **The URL is never rendered as a link, anywhere.** An anchor invites a hover preview and
 * a prefetch, and either one hands the URL to a remote host the moment a cursor passes over
 * it. For a tool people paste signed URLs and session links into, that would leak the exact
 * thing they came here to inspect, without a click. It renders as text.
 *
 * The parameters are where the interesting things are: a JWT in `access_token`, a timestamp
 * in `expires`, a base64 blob in `state`. Each becomes a seed.
 */

const MAX_PARAM_SEEDS = 12;

/** Parameters whose names say they carry something worth a hard look. */
const SENSITIVE = /^(access_token|id_token|refresh_token|token|code|secret|password|passwd|pwd|api_?key|key|signature|sig|auth|session|sid|jwt)$/i;

export const urlDetector: Detector = {
  kind: "url",
  mode: "whole",
  prior: 2,
  detect(text): Finding | null {
    const t = text.trim();
    // A scheme is required. Without one, "example.com/x" is as likely a file path or a
    // sentence fragment, and guessing a scheme would mean inventing the host.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return null;

    let url: URL;
    try {
      url = new URL(t);
    } catch {
      return null;
    }

    const evidence: Evidence[] = [{ note: `parses as a URL with the ${url.protocol.replace(":", "")} scheme`, bits: 7 }];
    const caveats: string[] = [];
    const lines: string[] = [`Scheme    ${url.protocol.replace(":", "")}`, `Host      ${url.hostname}`];

    if (url.port) lines.push(`Port      ${url.port}`);
    if (url.username) {
      // Credentials in a URL are worth pointing at. They end up in logs and in history.
      evidence.push({ note: "carries a username in the URL itself", bits: 2 });
      caveats.push(
        "This URL contains credentials in its userinfo section. Those travel into browser history, server logs and proxy logs, which is why the form is deprecated.",
      );
    }
    lines.push(`Path      ${url.pathname || "/"}`);

    const params = [...url.searchParams.entries()];
    if (params.length > 0) {
      evidence.push({ note: `${params.length} query parameter${params.length === 1 ? "" : "s"}`, bits: 2 });
      lines.push("", "Query");
      for (const [k, v] of params) lines.push(`  ${k} = ${v}`);
    }

    if (url.hash) {
      lines.push("", `Fragment  ${url.hash.slice(1)}`);
      // Worth knowing: the fragment never reaches the server, which is exactly why tokens
      // are sometimes put there.
      evidence.push({ note: "has a fragment, which is never sent to the server", bits: 1 });
    }

    const named = params.filter(([k]) => SENSITIVE.test(k)).map(([k]) => k);
    if (named.length > 0) {
      caveats.push(
        `Parameters named ${named.join(", ")} usually carry a credential. If this URL came from somewhere you do not control, treat what is in them as exposed.`,
      );
    }

    const seeds: Seed[] = [];
    for (const [k, v] of params.slice(0, MAX_PARAM_SEEDS)) {
      // Short values are flags and page numbers. Nothing to expand.
      if (v.length < 8) continue;
      seeds.push({ label: `?${k}`, text: v, relation: "extracted" });
    }
    if (url.hash.length > 9) {
      seeds.push({ label: "#fragment", text: url.hash.slice(1), relation: "extracted" });
    }

    return {
      kind: "url",
      text: t,
      evidence,
      proves:
        "It parses, so the host below is the host a browser would actually go to, which is not always the one the text appears to say.",
      caveats: [
        ...caveats,
        "Shown as text and never as a link, on purpose: a link invites a hover preview or a prefetch, and either one would hand this URL to a remote host without a click.",
      ],
      detail: lines.join("\n"),
      ...(seeds.length > 0 ? { seeds } : {}),
    };
  },
};

/**
 * A bare query string, with no URL around it.
 *
 * People paste these on their own, out of a log line or a form body, and without this they
 * would fall through to base64 or to nothing at all.
 */
export const queryDetector: Detector = {
  kind: "query",
  mode: "whole",
  prior: -1,
  detect(text): Finding | null {
    const t = text.trim().replace(/^\?/, "");
    if (t === "" || !t.includes("=")) return null;
    // Every segment has to look like a pair. One `=` in a sentence is not a query string.
    const pairs = t.split("&");
    if (pairs.length < 1) return null;
    if (!pairs.every((p) => /^[^=&\s]+=[^&\s]*$/.test(p))) return null;
    // A single pair is weak evidence; several is a shape.
    if (pairs.length === 1 && t.length < 12) return null;

    const parsed = new URLSearchParams(t);
    const entries = [...parsed.entries()];

    const seeds: Seed[] = entries
      .filter(([, v]) => v.length >= 8)
      .slice(0, MAX_PARAM_SEEDS)
      .map(([k, v]) => ({ label: k, text: v, relation: "extracted" as const }));

    const named = entries.filter(([k]) => SENSITIVE.test(k)).map(([k]) => k);

    return {
      kind: "query",
      text: t,
      evidence: [
        { note: `${pairs.length} key=value pair${pairs.length === 1 ? "" : "s"} joined by &`, bits: 5 },
        ...(entries.some(([, v]) => v.includes("%")) ? [{ note: "at least one value is percent-encoded", bits: 2 }] : []),
      ],
      proves:
        "The values below are decoded the way a server would decode them, so a percent-encoded or plus-separated value reads as what it actually is.",
      caveats: [
        ...(named.length > 0
          ? [`Parameters named ${named.join(", ")} usually carry a credential.`]
          : []),
        "A query string on its own does not say which URL it came from, so nothing here knows what these parameters mean.",
      ],
      detail: entries.map(([k, v]) => `${k} = ${v}`).join("\n"),
      ...(seeds.length > 0 ? { seeds } : {}),
    };
  },
};
