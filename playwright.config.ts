import { defineConfig, devices } from "@playwright/test";

/**
 * Pointed at a production preview, never at the dev server.
 *
 * The Content-Security-Policy is injected at build time only, because Vite's hot reload
 * needs a WebSocket and `connect-src 'none'` forbids it. Running these against `npm run
 * dev` would test a page with no policy and pass, which is the worst outcome available: the
 * strongest layer of the privacy claim would be unmeasured and look measured.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4177",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Built first, on purpose: see the note above. Bind the host explicitly, because Vite
    // defaults to "localhost", which resolves to ::1 on some machines, and then the
    // 127.0.0.1 health check waits out its whole timeout against a server that is up and
    // listening somewhere else.
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 4177 --strictPort",
    url: "http://127.0.0.1:4177",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
