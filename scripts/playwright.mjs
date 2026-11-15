// Finds Playwright for the browser scripts in this folder, without a machine-specific path:
//   1. PLAYWRIGHT_PATH (a file or package to import), 2. the `playwright` package (npm i -D playwright),
//   3. a copy that `npx playwright` left in the npm cache (~/.npm/_npx/*/node_modules/playwright).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function load() {
  const asUrl = p => (path.isAbsolute(p) ? pathToFileURL(p).href : p);
  if (process.env.PLAYWRIGHT_PATH) return import(asUrl(process.env.PLAYWRIGHT_PATH));
  try { return await import('playwright'); } catch { /* not installed here */ }
  const cache = path.join(os.homedir(), '.npm', '_npx');
  let dirs = []; try { dirs = fs.readdirSync(cache); } catch { /* no npx cache */ }
  const found = dirs.map(d => path.join(cache, d, 'node_modules', 'playwright', 'index.mjs')).filter(f => fs.existsSync(f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (found) return import(pathToFileURL(found).href);
  throw new Error('Playwright not found: run `npm i -D playwright`, or set PLAYWRIGHT_PATH to its index.mjs');
}
const pw = await load();
export const chromium = pw.chromium ?? pw.default?.chromium;
