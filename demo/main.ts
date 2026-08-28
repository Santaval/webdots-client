import { init, type WidgetHandle, type WebdotsConfig, type ScreenshotContext } from '../src/index';

declare global {
  interface Window {
    __webdots?: WidgetHandle;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window {
    html2canvas?: (el: Element, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement>;
  }
}

let html2canvasLoaded: Promise<void> | null = null;
function loadHtml2Canvas(): Promise<void> {
  if (html2canvasLoaded) return html2canvasLoaded;
  html2canvasLoaded = new Promise<void>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-html2canvas]');
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    script.async = true;
    script.dataset.html2canvas = 'true';
    script.onload = () => resolve();
    script.onerror = () => resolve(); // resolve either way; the call site checks `window.html2canvas`
    document.head.appendChild(script);
  });
  return html2canvasLoaded;
}

/**
 * Demo screenshot capture (#8). The library ships no rasterizer (bundle
 * budget); an embedder supplies a callback. Here html2canvas is loaded lazily
 * from a CDN on the first capture so the demo exercises the full capture →
 * upload → store round-trip without adding a build dependency. Errors are
 * caught and returned as `null` (skip this screenshot) so an offline demo
 * degrades silently — the library's toast/onError path for a THROWING
 * callback is covered by the Widget test suite instead.
 */
async function captureScreenshot(ctx: ScreenshotContext): Promise<string | null> {
  try {
    await loadHtml2Canvas();
    const render = window.html2canvas;
    if (typeof render !== 'function') return null;
    const canvas = await render(ctx.target, { backgroundColor: '#ffffff', scale: 1 });
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/**
 * Build the `init()` config. `api` is omitted so the default
 * `HttpAnnotationAPI` transport is used against a real `webdots` server, and
 * `user` is omitted so the magic-link sign-in panel mounts and the reviewer
 * establishes a session — the most faithful end-to-end exercise of the
 * #4/#5/#6 flows. `apiUrl`/`apiKey` come from env vars so secrets aren't
 * hardcoded; see `.env.example`.
 */
function buildConfig(): WebdotsConfig {
  const apiUrl = "http://localhost:3000/api/v1";
  const apiKey = "wdk_d7b38ba5390cb30aa52ca2679f98a471";
  if (!apiUrl) {
    throw new Error('[demo] requires VITE_WEBDOTS_API_URL (see .env.example).');
  }
  return {
    apiUrl,
    apiKey,
    debug: true,
    captureScreenshot,
  };
}

const handle = init(buildConfig());

// Expose for console poking: window.__webdots.setMode('annotate'), etc.
window.__webdots = handle;
