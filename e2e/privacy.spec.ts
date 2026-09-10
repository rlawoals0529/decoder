import { test, expect, type Request } from "@playwright/test";

/**
 * The claim on the front page, tested rather than asserted.
 *
 * These run against a production preview, not the dev server, and that is not incidental.
 * The policy is injected at build time only, because Vite's hot reload needs a WebSocket
 * and `connect-src 'none'` forbids it. Pointing these at `npm run dev` would test a page
 * with no policy at all and pass.
 *
 * The canary is a string that appears nowhere except the input, so any request carrying it
 * came from what was typed.
 */
const CANARY = "canary-2f8b41d9-do-not-send";

/** Everything a browser asks for that is not this page and its own assets. */
function isThirdParty(req: Request, base: string): boolean {
  return !req.url().startsWith(base) && !req.url().startsWith("data:") && !req.url().startsWith("blob:");
}

test("the page declares a policy that forbids reaching the network", async ({ page }) => {
  await page.goto("/");
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(policy, "no CSP meta tag in the built page").not.toBeNull();
  // Pinned individually. A policy that lost `connect-src 'none'` while keeping the rest
  // would still look like a policy, and that is the one directive doing the work here.
  expect(policy).toContain("connect-src 'none'");
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain("font-src 'self'");
});

test("the browser refuses a fetch, and refuses it for the right reason", async ({ page }) => {
  await page.goto("/");

  const outcome = await page.evaluate(async () => {
    const violations: string[] = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      violations.push(`${e.violatedDirective} <- ${e.blockedURI}`),
    );
    let settled: string;
    try {
      await fetch("https://post.example/", { method: "POST", body: "x" });
      settled = "resolved";
    } catch (e) {
      settled = `rejected: ${(e as Error).message}`;
    }
    await new Promise((res) => setTimeout(res, 300));
    return { settled, violations };
  });

  expect(outcome.settled).toContain("rejected");
  // The rejection alone proves nothing. A cross-origin POST is rejected by CORS on any
  // page, with or without a policy, so an assertion on the rejection passes just as
  // happily with the whole Content-Security-Policy removed. Verified by removing it: this
  // test stayed green until it asserted the directive. The violation event is the browser
  // naming what stopped it.
  expect(outcome.violations.join(" ")).toContain("connect-src");
  expect(outcome.violations.join(" ")).toContain("post.example");
});

test("every other way out is refused too, and the browser says so", async ({ page }) => {
  await page.goto("/");

  /**
   * Asserted through `securitypolicyviolation`, because no two of these APIs report a
   * refusal the same way, and one of them lies about it. Measured in Chromium 153:
   *
   *   fetch            rejects the promise
   *   WebSocket        constructor does not throw; readyState is 3 and an error event fires
   *   EventSource      constructor does not throw
   *   XMLHttpRequest   send() does not throw
   *   sendBeacon       returns TRUE, having sent nothing
   *
   * That last one is why this test is shaped this way. A per-API check would have asserted
   * `sendBeacon(...) === false` and gone red against a browser that had correctly blocked
   * the request, and the obvious repair for a red test is to loosen it. The violation event
   * is the browser stating what it blocked, and it is uniform across all five.
   */
  const result = await page.evaluate(async () => {
    const violations: { directive: string; blocked: string }[] = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      violations.push({ directive: e.violatedDirective, blocked: e.blockedURI }),
    );

    const ws = new WebSocket("wss://socket.example/");
    const wsReached = await new Promise<string>((res) => {
      ws.addEventListener("open", () => res("open"));
      ws.addEventListener("error", () => res("error"));
      setTimeout(() => res(`neither, state=${ws.readyState}`), 2000);
    });

    new EventSource("https://sse.example/stream");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://xhr.example/");
    xhr.send("payload");
    const beaconSaid = navigator.sendBeacon("https://beacon.example/", "payload");

    await new Promise((res) => setTimeout(res, 500));
    return { violations, wsReached, beaconSaid };
  });

  const blocked = result.violations.filter((v) => v.directive === "connect-src").map((v) => v.blocked);
  for (const host of ["socket.example", "sse.example", "xhr.example", "beacon.example"]) {
    expect(blocked.join(" "), `${host} was not blocked`).toContain(host);
  }
  // The socket never opened. This is the outcome, as opposed to the browser's report of it.
  expect(result.wsReached).not.toBe("open");
  // Pinned as a fact about the platform, not as an approval: it returned true and sent
  // nothing. Anything relying on this return value to detect a block is wrong.
  expect(result.beaconSaid).toBe(true);
});

test("pasting a secret produces no request at all, and none carrying it", async ({ page, baseURL }) => {
  const base = baseURL ?? "http://127.0.0.1:4176";
  const requests: string[] = [];
  const carrying: string[] = [];

  page.on("request", (req) => {
    if (isThirdParty(req, base)) requests.push(req.url());
    const body = req.postData() ?? "";
    if (req.url().includes(CANARY) || body.includes(CANARY)) carrying.push(req.url());
  });

  await page.goto("/");
  // Everything before this point is the page loading its own assets. From here, only what
  // typing causes counts.
  const afterLoad: string[] = [];
  page.on("request", (req) => {
    if (isThirdParty(req, base)) afterLoad.push(req.url());
  });

  await page.getByTestId("input").fill(CANARY);
  await expect(page.getByTestId("count")).toContainText(String(CANARY.length));
  // A deliberate wait: a leak that fires on a debounce would pass an assertion made
  // immediately after typing.
  await page.waitForTimeout(1500);

  expect(carrying, "a request carried the pasted text").toEqual([]);
  expect(afterLoad, "typing caused a request to a third party").toEqual([]);
  expect(requests, "the page loaded something from a third party").toEqual([]);
});

test("the page works with the network cut off, which is the honest version of the claim", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await context.setOffline(true);

  // No reload. Offline blocks the page's own assets too, so reloading tests whether a
  // static site can be re-fetched from nothing, which is a question about caching and not
  // about this app. The claim being tested is that once it is open it needs no network, so
  // the test is: cut the cord, then use it.
  // A real reading, not just a character count: the whole engine has to work with no
  // network, and asserting the count alone would pass against a page that had stopped
  // detecting anything.
  await page.getByTestId("input").fill("1789203600");
  await expect(page.getByTestId("count")).toContainText("10");
  await expect(page.getByTestId("finding-timestamp")).toBeVisible();
  await expect(page.getByTestId("finding-number")).toBeVisible();

  await context.setOffline(false);
});

test("the fonts come from this origin, and they arrive", async ({ page, baseURL }) => {
  const base = baseURL ?? "http://127.0.0.1:4176";
  const fonts: { url: string; status: number }[] = [];

  // Responses, not requests. A request-only check passes on a 404: the URL is still
  // same-origin, so "no third-party font" stays true while the page silently falls back to
  // a system face. That is exactly what happened when these lived in public/.
  page.on("response", async (res) => {
    const url = res.url();
    if (res.request().resourceType() === "font" || /\.woff2?($|\?)/.test(url)) {
      fonts.push({ url, status: res.status() });
    }
  });

  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);

  expect(fonts.length, "no font was requested at all, so this test proves nothing").toBeGreaterThan(0);
  for (const f of fonts) {
    expect(f.url.startsWith(base), `${f.url} is not from this origin`).toBe(true);
    expect(f.status, `${f.url} did not load`).toBe(200);
  }

  // And the face is genuinely in use, rather than named in CSS and quietly substituted.
  const loaded = await page.evaluate(() => document.fonts.check("16px Archivo"));
  expect(loaded, "Archivo is declared but not usable").toBe(true);
});
