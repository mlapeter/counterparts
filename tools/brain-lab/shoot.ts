/**
 * Bundles lab.ts for the browser and shoots the lab page with headless Chrome
 * on a profile of its own (never anyone's browser), one Chrome per shot,
 * killed by pid and by that profile only once the file is written.
 *
 *   bun tools/brain-lab/shoot.ts round <N> [title]   frames + contact.png into out/round-N/
 *   bun tools/brain-lab/shoot.ts sheet <out.png> [query]
 *   bun tools/brain-lab/shoot.ts one <panel> <out.png> [query]
 *
 * LAB_SCRATCH sets where the Chrome profile lives (default: the OS temp dir).
 */

import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ROUND, findPanel, panelSize, sheetLayout } from './layout';

const HERE = import.meta.dir;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SCRATCH = process.env['LAB_SCRATCH'] ?? join(tmpdir(), 'brain-lab');
const PROFILE = join(SCRATCH, 'chrome-profile');

async function build(): Promise<void> {
  const r = await Bun.build({ entrypoints: [join(HERE, 'lab.ts')], target: 'browser', format: 'iife', outdir: join(HERE, 'dist'), naming: 'lab.js' });
  if (!r.success) {
    for (const l of r.logs) console.error(l);
    throw new Error('bundle failed');
  }
}

const sleep = (ms: number): Promise<void> => new Promise(res => setTimeout(res, ms));

async function shoot(query: string, w: number, h: number, out: string): Promise<void> {
  mkdirSync(PROFILE, { recursive: true });
  if (existsSync(out)) rmSync(out);
  const url = `file://${join(HERE, 'index.html')}?${query}`;
  const proc = Bun.spawn([
    CHROME, '--headless=new', '--disable-gpu', `--user-data-dir=${PROFILE}`, '--hide-scrollbars',
    '--force-device-scale-factor=2', `--window-size=${w},${h}`, '--virtual-time-budget=1500',
    `--screenshot=${out}`, url,
  ], { stdout: 'ignore', stderr: 'ignore' });
  let last = -1;
  for (let i = 0; i < 300; i++) {
    await sleep(100);
    if (!existsSync(out)) continue;
    const size = statSync(out).size;
    if (size > 0 && size === last) break;
    last = size;
  }
  proc.kill();
  Bun.spawnSync(['pkill', '-f', `user-data-dir=${PROFILE}`]);
  if (!existsSync(out)) throw new Error(`no screenshot: ${out}`);
}

async function main(): Promise<void> {
  const [verb, a, b, c] = process.argv.slice(2);
  await build();
  if (verb === 'round') {
    const dir = join(HERE, 'out', `round-${a ?? 'x'}`);
    mkdirSync(dir, { recursive: true });
    for (const row of ROUND) for (const p of row) {
      const s = panelSize(p);
      await shoot(`only=${p.name}`, s.w, s.h, join(dir, `${p.name}.png`));
      console.log(`${p.name}.png`);
    }
    const L = sheetLayout(ROUND);
    const title = b ?? `round ${a ?? ''}`;
    await shoot(`title=${encodeURIComponent(title)}`, L.w, L.h + 30, join(dir, 'contact.png'));
    console.log(`contact.png -> ${dir}`);
  } else if (verb === 'sheet') {
    const L = sheetLayout(ROUND);
    const q = b ?? '';
    await shoot(`title=${encodeURIComponent(c ?? 'lab')}&${q}`, L.w, L.h + 30, a ?? join(SCRATCH, 'sheet.png'));
    console.log(a);
  } else if (verb === 'one') {
    const p = findPanel(a ?? '');
    if (p === undefined) throw new Error(`no panel ${a}`);
    const s = panelSize(p);
    await shoot(`only=${p.name}&${c ?? ''}`, s.w, s.h, b ?? join(SCRATCH, `${p.name}.png`));
    console.log(b);
  } else {
    console.log('usage: shoot.ts round <N> [title] | sheet <out.png> [query] [title] | one <panel> <out.png> [query]');
  }
}

await main();
