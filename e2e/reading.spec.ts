import { test, expect } from "@playwright/test";

/**
 * What the page actually shows, as opposed to what the engine found.
 *
 * These exist because of one bug that no unit test could have caught: the tree rendered
 * only two levels deep, because each level was handed its own siblings as the pool to
 * search for children rather than the whole list. The engine had found the timestamp inside
 * the JWT payload, the count said four readings, and three were on screen. **A count that
 * disagrees with the screen is the shape of this class of bug**, so the count is asserted
 * against what is rendered rather than trusted.
 */

/** iat 1789203600, a v7-shaped sub, and a nested blob. Header alg HS256. */
const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkphbmUiLCJpYXQiOjE3ODkyMDM2MDB9" +
  ".dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

test("a JWT is read down to the date inside its payload", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("input").fill(JWT);

  await expect(page.getByTestId("finding-jwt")).toBeVisible();
  await expect(page.getByTestId("finding-json").first()).toBeVisible();
  // Three levels: jwt at the root, json parsed out of it, timestamp extracted from that.
  // This is the assertion the two-level bug failed.
  await expect(page.getByTestId("finding-timestamp")).toBeVisible();
  await expect(page.getByTestId("finding-timestamp")).toContainText("2026-09-12");
});

test("the count of readings matches the number on screen", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("input").fill(JWT);

  const claimed = Number((await page.getByTestId("found").textContent())?.match(/\d+/)?.[0]);
  // Nodes that rendered at least one reading. Counting findings would double-count a pair
  // of peers, which is a different number and not the one the label claims.
  const rendered = await page.locator('[data-testid^="node-"]:has(article.finding)').count();
  expect(claimed).toBe(rendered);
});

test("the signature caveat is on screen beside the certain badge, not behind a control", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("input").fill(JWT);

  const card = page.getByTestId("finding-jwt");
  await expect(card).toHaveAttribute("data-band", "certain");
  // Both visible at once is the whole safety argument: a "certain" badge with the caveat
  // hidden would read as "verified".
  await expect(card.getByText(/Signature: not checked/)).toBeVisible();
  await expect(card.getByText(/never ask you for it/)).toBeVisible();
  await expect(page.getByTestId("caveats-jwt")).toBeVisible();
});

test("a bare v4 UUID shows both readings joined by or, rather than picking one", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("input").fill("d41d8cd98f0042049980" + "0998ecf8427e");

  await expect(page.getByTestId("peers")).toBeVisible();
  await expect(page.getByTestId("peers").getByText("or", { exact: true })).toBeVisible();
  await expect(page.getByTestId("finding-uuid")).toBeVisible();
  await expect(page.getByTestId("finding-hex")).toBeVisible();
});

test("a timestamp shows the boring reading beside it", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("input").fill("1789203600");

  await expect(page.getByTestId("finding-timestamp")).toBeVisible();
  // The null hypothesis has to be a visible peer. Without it the tool is wrong the first
  // time somebody pastes a quantity.
  await expect(page.getByTestId("finding-number")).toBeVisible();
  await expect(page.getByTestId("finding-number")).toContainText("1,789,203,600");
});

test("a URL renders as text and not as a link, so nothing can prefetch it", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("input").fill("https://example.com/cb?access_token=abcdefghijklmnop");

  await expect(page.getByTestId("finding-url")).toBeVisible();
  // The whole point: an anchor invites a hover preview or a prefetch, either of which hands
  // the URL to a remote host without a click.
  await expect(page.locator("a[href]")).toHaveCount(0);
});

test("nesting that runs out of budget says so and offers to continue", async ({ page }) => {
  await page.goto("/");
  // Eight layers of base64 against a default depth of four.
  const deep = await page.evaluate(() => {
    let s = "the thing at the very bottom";
    for (let i = 0; i < 8; i++) s = btoa(s);
    return s;
  });
  await page.getByTestId("input").fill(deep);

  const stopped = page.locator('[data-testid^="stopped-"]');
  await expect(stopped.first()).toBeVisible();
  await expect(stopped.first()).toContainText("Stopped expanding here");

  // And continuing is a real action rather than a message about a limit.
  const before = await page.locator("article.finding").count();
  await stopped.first().getByRole("button", { name: "Expand this" }).click();
  await expect(page.locator("article.finding")).not.toHaveCount(before);
});

test("nothing recognised is an answer, not an empty screen", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("input").fill("just some words that are not anything");
  await expect(page.getByTestId("findings")).toContainText("not that it failed to look");
});
