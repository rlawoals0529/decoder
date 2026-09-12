import { expect, test } from "@playwright/test";

test("a palette can be chosen, and it sticks", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /palette|wisteria|lantern|dusk|sakura/i }).first().click();

  await page.getByRole("button", { name: "Sakura Lake" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sakura-lake");
  // color-scheme travels with it, or the browser paints scrollbars for the other one.
  expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe("light");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sakura-lake");
});

test("switching actually repaints the page, not just a swatch", async ({ page }) => {
  await page.goto("/");
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.getByRole("button", { name: /palette|wisteria|lantern|dusk|sakura/i }).first().click();
  await page.getByRole("button", { name: "Starfall Dusk" }).click();
  const after = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(after).not.toBe(before);
});

test("the page still renders when site data is blocked", async ({ browser }) => {
  // The guard in browserHost, tested where it can actually be tested: a real Storage that
  // throws. A fake cannot prove this without becoming a test of the fake.
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const boom = () => {
      throw new DOMException("denied", "SecurityError");
    };
    Object.defineProperty(window, "localStorage", {
      get: () => ({ getItem: boom, setItem: boom, removeItem: boom }),
    });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await expect(page.locator("[data-testid=input]")).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});
