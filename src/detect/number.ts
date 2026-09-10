import type { Detector, Finding } from "./types";

/**
 * The boring answer, always present when the input is just digits.
 *
 * This detector exists so that the interesting answer can be trusted. `1789203600` is a
 * plausible unix timestamp and it is also, simply, a number, and a tool that only ever
 * offers the exciting reading is a tool that is wrong the first time somebody pastes a
 * quantity. **The null hypothesis has to be a visible peer, not an absence.**
 *
 * Fixed at `possible`: it is never the best explanation of anything, and it should never
 * outrank a reading that actually decoded something.
 */
export const numberDetector: Detector = {
  kind: "number",
  mode: "whole",
  // Deliberately low. Matching digits is free, so the prior carries the cost of that.
  prior: 0,
  detect(text): Finding | null {
    const t = text.trim();
    if (!/^-?\d+$/.test(t)) return null;

    const digits = t.replace("-", "").length;
    const evidence = [{ note: `${digits} digits and nothing else`, bits: 2 }];

    // Grouped, because the whole value of showing this is that a human can read the
    // magnitude. 1789203600 is unreadable; 1,789,203,600 is obviously ten digits.
    const grouped = (() => {
      try {
        return BigInt(t).toLocaleString("en-US");
      } catch {
        return t;
      }
    })();

    return {
      kind: "number",
      text: t,
      evidence,
      proves: `Read as a plain decimal integer it is ${grouped}.`,
      caveats: [
        "This says nothing about what the number means. It is here so that a more interesting reading beside it is a choice rather than the only option offered.",
      ],
      detail: grouped,
    };
  },
};
