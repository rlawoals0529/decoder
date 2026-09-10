import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The policy that makes "it never leaves your browser" enforced rather than promised.
 *
 * `connect-src 'none'` means the browser refuses every fetch, XHR, WebSocket and beacon
 * this page could attempt, including from code nobody here wrote. That moves the guarantee
 * off our diligence and onto the reader's own browser, which is the only place a privacy
 * claim can actually live.
 *
 * `default-src 'none'` carries the rest, and it can only say that because the fonts are
 * served from this origin rather than from a font CDN. A single external stylesheet would
 * have meant `style-src` and `font-src` pointing at somebody else's server, and two
 * requests carrying your IP address on every load.
 *
 * `style-src` needs `'unsafe-inline'` and that is worth being straight about: Vite injects
 * the stylesheet through a `<style>` element in dev and React sets inline styles. It is a
 * markup-injection concern and it does not weaken `connect-src`, which is the line that
 * matters here: even injected script cannot open a socket.
 *
 * `frame-ancestors` is ignored in a meta tag and GitHub Pages sends no headers of its own,
 * so a meta tag is all this build gets. Accepted, because `default-src 'none'` is the part
 * doing the work.
 */
const POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/**
 * Injected into the built HTML only.
 *
 * Never in dev, and this is the trap worth writing down: Vite's dev server needs a
 * WebSocket for hot reload, `connect-src 'none'` forbids it, and the symptom is a dev
 * server that appears broken. Somebody then repairs it by weakening the policy, and the
 * strongest layer of the claim quietly dies. So the tests point at a production preview
 * instead, where the policy is real.
 */
function csp(): Plugin {
  return {
    name: "decoder-csp",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: POLICY },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig({
  // Vitest would otherwise collect e2e/*.spec.ts, which uses Playwright's runner and fails
  // to load. A red file beside green ones trains you to skim the summary.
  test: { include: ["src/**/*.test.ts"] },
  // Served from a repo subpath on GitHub Pages, so asset URLs must be relative.
  base: "./",
  build: {
    /**
     * The module-preload polyfill is off, and `check-no-network` is why.
     *
     * That polyfill is the only `fetch(` in the whole bundle: it reads the page's own
     * `<link rel="modulepreload">` hrefs for browsers with no native support. Two reasons
     * it should not be here. It is already dead code, because `connect-src 'none'` refuses
     * that fetch as readily as any other. And a build that contains a fetch call cannot
     * pass a check whose whole purpose is that a stranger can grep the deployed file and
     * find none, which would mean either weakening the check or explaining an exception,
     * and both of those are worse than losing a preload hint.
     */
    modulePreload: { polyfill: false },
  },
  plugins: [react(), csp()],
});

export { POLICY };
