#!/usr/bin/env node
/**
 * Refuse to ship a build that contains any way to send data somewhere.
 *
 * This is the layer a stranger can run without trusting a word of the source, and that is
 * the whole point of it: the same command works against the deployed file.
 *
 *   node scripts/check-no-network.mjs dist
 *   curl -s https://<pages-url>/assets/index-*.js | node scripts/check-no-network.mjs -
 *
 * It looks for the primitives rather than for intent, because intent is not greppable. A
 * false positive here is cheap: it means writing down why one string is allowed. A false
 * negative means the claim on the front page is wrong.
 */
import { readFileSync, readdirSync, statSync, realpathSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every way a page can reach the network.
 *
 * `new Image` is in here because an image with a remote src is the classic way to smuggle
 * data out without any of the obvious APIs: the request happens, the response is discarded,
 * and nothing looks like networking.
 */
const FORBIDDEN = [
  { pattern: /\bfetch\s*\(/g, name: "fetch(" },
  { pattern: /\bXMLHttpRequest\b/g, name: "XMLHttpRequest" },
  { pattern: /\bWebSocket\b/g, name: "WebSocket" },
  { pattern: /\bEventSource\b/g, name: "EventSource" },
  { pattern: /\bsendBeacon\b/g, name: "navigator.sendBeacon" },
  { pattern: /\bnew\s+Image\b/g, name: "new Image" },
  { pattern: /\bimportScripts\s*\(/g, name: "importScripts(" },
  { pattern: /\bnavigator\s*\.\s*clipboard\b/g, name: "navigator.clipboard" },
];

/**
 * Absolute URLs are matched separately, and the two kinds that are allowed are kept apart
 * because the reason they are allowed is different. Lumping them together would let a real
 * endpoint in under a justification written for an XML namespace.
 */
const URL_PATTERN = /\bhttps?:\/\/[^\s"'`)\\]+/g;

/** Not addresses at all. These are identifiers, carried in attribute values. */
const NAMESPACE_URLS = [
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xhtml",
  "http://www.w3.org/1998/Math/MathML",
  "http://www.w3.org/XML/1998/namespace",
  "http://www.w3.org/1999/xlink",
];

/**
 * Real addresses that appear only inside text a human reads, and that nothing requests.
 *
 * React's production build minifies its error messages down to a number and points the
 * developer at this page to look it up. It is string concatenation into `Error.message`,
 * never a request, and `connect-src 'none'` would refuse it if it ever became one.
 */
const TEXT_ONLY_URLS = ["https://react.dev/errors/"];

const ALLOWED_URLS = [...NAMESPACE_URLS, ...TEXT_ONLY_URLS];

const CHECKED = new Set([".js", ".mjs", ".cjs", ".html", ".css"]);

function filesIn(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesIn(p));
    else if (CHECKED.has(extname(name))) out.push(p);
  }
  return out;
}

/** Line and column of an offset, so a hit can be looked at rather than only counted. */
function locate(text, index) {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  const col = index - before.lastIndexOf("\n");
  return `${line}:${col}`;
}

/** @returns {{file: string, what: string, where: string, excerpt: string}[]} */
export function scan(text, file) {
  const hits = [];
  for (const { pattern, name } of FORBIDDEN) {
    for (const m of text.matchAll(pattern)) {
      hits.push({
        file,
        what: name,
        where: locate(text, m.index),
        excerpt: text.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\n/g, " "),
      });
    }
  }
  for (const m of text.matchAll(URL_PATTERN)) {
    if (ALLOWED_URLS.some((u) => m[0].startsWith(u))) continue;
    hits.push({ file, what: `URL ${m[0]}`, where: locate(text, m.index), excerpt: m[0] });
  }
  return hits;
}

/** True only when this file was the thing node was asked to run, not when it was imported. */
const ranDirectly = () => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (ranDirectly()) {
  const target = process.argv[2];
  if (!target) {
    console.error("usage: check-no-network.mjs <dist-dir|->");
    process.exit(2);
  }

  let hits = [];
  let checked = 0;

  if (target === "-") {
    const text = readFileSync(0, "utf8");
    hits = scan(text, "<stdin>");
    checked = 1;
  } else {
    const files = filesIn(target);
    // A run that checked nothing must not report success. An empty dist is the shape this
    // check fails silently-clean in, and a green tick over zero files is worse than no
    // check at all.
    if (files.length === 0) {
      console.error(`check-no-network: nothing to check in ${target}. Did the build run?`);
      process.exit(2);
    }
    for (const f of files) {
      hits.push(...scan(readFileSync(f, "utf8"), f));
      checked++;
    }
  }

  if (hits.length === 0) {
    console.log(`check-no-network: ${checked} file(s) clean, no way to reach the network`);
    process.exit(0);
  }

  console.error(`check-no-network: ${hits.length} finding(s) across ${checked} file(s)\n`);
  for (const h of hits) console.error(`  ${h.file}:${h.where}  ${h.what}\n    ...${h.excerpt}...`);
  console.error(
    "\nIf one of these is genuinely fine, add it to ALLOWED_URLS with the reason. Do not\n" +
      "widen a pattern: the patterns are the claim.",
  );
  process.exit(1);
}
