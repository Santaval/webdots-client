#!/usr/bin/env node
/**
 * Zero-dependency gzip size budget check for the UMD bundle. Deliberately
 * hand-rolled (node:zlib + node:fs only) rather than pulling in a
 * size-limit-style devDependency — the whole point of this library is a
 * tiny, dependency-free footprint, and that discipline should extend to the
 * tooling that verifies it.
 *
 * Usage: node scripts/size-limit.mjs
 * Exits non-zero (and prints actual vs. budget) when the gzip size of
 * dist/webdots.umd.js exceeds the budget.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET_FILE = resolve(__dirname, '..', 'dist', 'webdots.umd.js');
const BUDGET_BYTES = 25 * 1024; // 25 KB gzip

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

if (!existsSync(TARGET_FILE)) {
  console.error(`[size] ${TARGET_FILE} does not exist. Run "npm run build" first.`);
  process.exit(1);
}

const source = readFileSync(TARGET_FILE);
// Gzip level 9 (max compression) — matches what CDNs/servers typically apply,
// and gives the tightest (most favorable-to-us, so most honest-against-us)
// estimate of what a consumer actually downloads.
const gzipped = gzipSync(source, { level: 9 });

const actualBytes = gzipped.byteLength;
const passed = actualBytes <= BUDGET_BYTES;

console.log(`[size] dist/webdots.umd.js: ${formatKb(actualBytes)} gzip (budget: ${formatKb(BUDGET_BYTES)})`);

if (!passed) {
  console.error(`[size] FAILED — ${formatKb(actualBytes - BUDGET_BYTES)} over budget.`);
  process.exit(1);
}

console.log(`[size] OK — ${formatKb(BUDGET_BYTES - actualBytes)} under budget.`);
