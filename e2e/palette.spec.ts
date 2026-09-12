import { expect, test } from "@playwright/test";
import { describeFailures, probeContrast } from "./contrast-probe.js";
import themes from "../src/theme/palettes.json" with { type: "json" };

/* The picker itself is covered by e2e/palette-picker.spec.ts, vendored with the component,
   so the same guard runs in every app that uses it rather than in this one. */

test("no text on the page is below AA contrast, in any palette", async ({ page }) => {
  await page.goto("/");
  // Open the picker, so its own fifteen options are measured too. They paint a chip in
  // another palette, which is the exact shape of mistake that puts foreign colours on a page.
  await page.getByRole("button", { name: /^Palette:/ }).click();

  const probe = await probeContrast(page, themes);

  // A selector that stopped matching would make this pass by measuring nothing.
  expect(probe.styles).toBeGreaterThan(9);
  expect(probe.measured).toBeGreaterThan(140);

  // The sweep has to have actually swept. Fewer distinct paintings than palettes means some
  // of them never applied, and those numbers are another palette measured twice.
  expect(probe.distinctPalettes, "some palettes painted nothing of their own").toBe(themes.length);
  expect(probe.failures, describeFailures(probe.failures)).toEqual([]);
});
