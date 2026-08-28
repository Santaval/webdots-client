#!/usr/bin/env node
/**
 * Zero-dependency static file server for the UMD embed demo (#9).
 *
 * `demo/umd.html` references the BUILT bundle at `../dist/webdots.umd.js`,
 * which is gitignored and only exists after `npm run build`. Vite's dev
 * server roots itself at `demo/` (so it can serve the source demo), so it
 * can't serve `dist/` too. This tiny server roots itself at the REPO root
 * instead, making both `demo/umd.html` and `dist/webdots.umd.js` reachable
 * from one origin — no express, no serve-static, no new devDependency
 * (same discipline as `size-limit.mjs`).
 *
 * Usage: node scripts/serve-demo.mjs [port]
 * Defaults to port 4173 (Vite's conventional preview port).
 *
 * Run via `npm run demo:umd`, which builds first.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DEFAULT_PORT = 4173;

const port = Number.parseInt(process.argv[2], 10) || DEFAULT_PORT;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  // `decodeURIComponent` so encoded traversal (`%2e%2e`) resolves to real `..`
  // before `join` sees it. `join` concatenates ROOT with the request path and
  // resolves `..` against the accumulated path — so a `..` that would escape
  // the repo root produces a path OUTSIDE ROOT, which the `startsWith` guard
  // below rejects as 403. In practice the WHATWG `new URL` parser above
  // already collapses `..`/`%2e%2e` segments, so the guard is defense-in-depth
  // — but it's the load-bearing boundary if that ever changes. The `ROOT + '/'`
  // boundary avoids sibling-prefix false positives (e.g. a directory named
  // `webdots-client-evil` next to ROOT). `join(ROOT, '/')` yields `ROOT + '/'`,
  // so the root check accepts both spellings.
  const requested = decodeURIComponent(url.pathname);
  const filePath = join(ROOT, requested);
  const isRoot = filePath === ROOT || filePath === ROOT + '/';

  if (!isRoot && !filePath.startsWith(ROOT + '/')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  if (isRoot) {
    // Root -> redirect to the UMD demo page.
    res.writeHead(302, { Location: '/demo/umd.html' });
    res.end();
    return;
  }

  let stats;
  try {
    stats = await stat(filePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404 Not Found: ${requested}`);
    return;
  }

  if (stats.isDirectory()) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden (directory)');
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.byteLength,
      // Never cache during local dev — the bundle is rebuilt on every
      // `npm run demo:umd`, and a stale cached UMD would mask build bugs.
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error');
  }
});

server.listen(port, () => {
  const url = `http://localhost:${port}/demo/umd.html`;
  console.log('[demo:umd] serving repo root on :%d', port);
  console.log('[demo:umd] UMD demo:           %s', url);
  console.log('[demo:umd] press Ctrl+C to stop.');
});
