import type { Detector, Evidence, Finding } from "./types";

/**
 * A unix timestamp, in seconds or milliseconds.
 *
 * The interesting decision is that **both readings are offered when both are plausible**,
 * rather than one being chosen by digit count. Ten digits is almost certainly seconds and
 * thirteen almost certainly milliseconds, but the ranges overlap: `1000000000` is a
 * plausible second (2001) and a plausible millisecond (1970), and a tool that silently
 * picked would be wrong about half the strings people paste from the 1970s.
 *
 * Every date here is rendered in UTC and labelled as UTC. A local rendering would be a
 * different answer on a different machine, which is the last thing a tool like this should
 * produce.
 */

/** Anything outside this is far more likely to be a plain number than a date. */
const FROM = Date.UTC(1990, 0, 1);
const TO = Date.UTC(2100, 0, 1);

/** Wider, for saying "that would be 1970, which is probably not what you meant". */
const LOOSE_FROM = Date.UTC(1970, 0, 1);

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

/** How long ago, in the roughest terms that are still true. */
export function relative(ms: number, now: number): string {
  const diff = now - ms;
  const abs = Math.abs(diff);
  const day = 86_400_000;
  const units: [number, string][] = [
    [365 * day, "year"],
    [30 * day, "month"],
    [day, "day"],
    [3_600_000, "hour"],
    [60_000, "minute"],
  ];
  for (const [size, name] of units) {
    if (abs >= size) {
      const n = Math.floor(abs / size);
      return diff >= 0 ? `${n} ${name}${n === 1 ? "" : "s"} ago` : `in ${n} ${name}${n === 1 ? "" : "s"}`;
    }
  }
  return diff >= 0 ? "just now" : "in a moment";
}

export const timestampDetector: Detector = {
  kind: "timestamp",
  mode: "whole",
  prior: -1,
  detect(text, clock): Finding | null {
    const t = text.trim();
    if (!/^\d{9,14}$/.test(t)) return null;

    const value = Number(t);
    if (!Number.isSafeInteger(value)) return null;

    const now = clock.now();
    const evidence: Evidence[] = [{ note: `${t.length} digits, which is the range a unix time falls in`, bits: 2 }];
    const lines: string[] = [];
    const caveats: string[] = [];

    const asSeconds = value * 1000;
    const asMillis = value;

    const secondsPlausible = asSeconds >= FROM && asSeconds <= TO;
    const millisPlausible = asMillis >= FROM && asMillis <= TO;

    if (secondsPlausible) {
      evidence.push({ note: `read as seconds it is ${iso(asSeconds)}`, bits: 6 });
      lines.push(`As seconds: ${iso(asSeconds)} UTC, ${relative(asSeconds, now)}.`);
    }
    if (millisPlausible) {
      evidence.push({ note: `read as milliseconds it is ${iso(asMillis)}`, bits: 6 });
      lines.push(`As milliseconds: ${iso(asMillis)} UTC, ${relative(asMillis, now)}.`);
    }

    if (secondsPlausible && millisPlausible) {
      // Both readings land in a range somebody might mean. Say so rather than choosing.
      caveats.push(
        "Both readings are plausible dates, and nothing in the number itself says which unit it is in. Which one is right depends on where you got it.",
      );
    }

    if (!secondsPlausible && !millisPlausible) {
      // Still worth showing, because "that would be 1970" is a useful answer to somebody
      // who expected a recent date.
      const nearer = asSeconds >= LOOSE_FROM && asSeconds <= TO ? asSeconds : asMillis;
      if (nearer >= LOOSE_FROM && nearer <= TO) {
        evidence.push({ note: `it is a date, but ${iso(nearer)}, which is early enough to be doubtful`, bits: 1 });
        lines.push(`${iso(nearer)} UTC. That is early enough that this is probably just a number.`);
      } else {
        return null;
      }
    }

    if (t.length === 10 && secondsPlausible) {
      evidence.push({ note: "ten digits, which is the usual length for seconds", bits: 2 });
    }
    if (t.length === 13 && millisPlausible) {
      evidence.push({ note: "thirteen digits, which is the usual length for milliseconds", bits: 2 });
    }

    return {
      kind: "timestamp",
      text: t,
      evidence,
      proves:
        "A unix time is a count from 1970-01-01 UTC, so the date below is exact and carries no timezone. What it is a date *of* is not in the number.",
      caveats: [
        ...caveats,
        "Shown in UTC. Rendering it in a local timezone would give a different answer on a different machine, which is not something a tool like this should do quietly.",
      ],
      detail: lines.join("\n"),
    };
  },
};
