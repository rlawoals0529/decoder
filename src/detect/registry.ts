import { base64Detector, base64UrlDetector } from "./base64";
import { hexDetector } from "./hex";
import { jsonDetector } from "./json";
import { jwtDetector } from "./jwt";
import { numberDetector } from "./number";
import { timestampDetector } from "./timestamp";
import { queryDetector, urlDetector } from "./url";
import { uuidDetector } from "./uuid";
import type { Detector } from "./types";

/**
 * Every detector, in one array.
 *
 * Adding a kind is one new file, one test file, and one line here. Nothing else in the app
 * enumerates kinds, so a detector that is written and not registered simply never runs.
 * `registry.test.ts` is what catches that, along with the catalogue rules every kind has to
 * satisfy.
 *
 * Order does not decide anything. Findings are ranked by evidence and ties break on the
 * kind name, so this list can be alphabetical without affecting a single result.
 */
export const DETECTORS: readonly Detector[] = [
  base64Detector,
  base64UrlDetector,
  hexDetector,
  jsonDetector,
  jwtDetector,
  numberDetector,
  queryDetector,
  timestampDetector,
  urlDetector,
  uuidDetector,
];
