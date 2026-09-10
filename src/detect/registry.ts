import { base64Detector, base64UrlDetector } from "./base64";
import { numberDetector } from "./number";
import type { Detector } from "./types";

/**
 * Every detector, in one array.
 *
 * Adding a kind is three new files and one line here. Nothing else in the app enumerates
 * kinds, so a detector that is written and not registered simply does not run, which is a
 * failure mode worth naming: the catalogue test below is what catches it.
 */
export const DETECTORS: readonly Detector[] = [
  numberDetector,
  base64Detector,
  base64UrlDetector,
];
