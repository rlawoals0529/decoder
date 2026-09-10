#!/usr/bin/env node
/**
 * Nothing in `dependencies` but React.
 *
 * This is a real constraint rather than a slogan, and it is here because the privacy claim
 * is only as good as the code that actually ships. Every runtime dependency is code nobody
 * in this repo reviewed, running on a page people paste secrets into, and `check-no-network`
 * greps for primitives rather than reading intent: a dependency that builds a URL out of
 * fragments would slip past it.
 *
 * A new one needs an argument, and adding it here is where the argument gets written down.
 */
import { readFileSync } from "node:fs";

const ALLOWED = new Set(["react", "react-dom"]);

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const deps = Object.keys(pkg.dependencies ?? {});
const extra = deps.filter((d) => !ALLOWED.has(d));

if (extra.length > 0) {
  console.error(
    `check-deps: ${extra.length} runtime dependency that is not React: ${extra.join(", ")}\n\n` +
      "Everything in dependencies ships to the browser and runs on a page people paste\n" +
      "secrets into. If this one is genuinely needed, add it to ALLOWED with the reason.",
  );
  process.exit(1);
}

// A check that found nothing must be able to say it looked. An empty dependencies block
// would otherwise pass while meaning the file was not the one anybody thought.
if (!deps.includes("react")) {
  console.error("check-deps: react is not in dependencies, so this is not the file it thinks it is");
  process.exit(2);
}

console.log(`check-deps: ${deps.length} runtime dependency(ies), all expected: ${deps.join(", ")}`);
