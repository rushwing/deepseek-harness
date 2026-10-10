import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const engine = resolve(process.argv[2]);
const hostBinary = resolve(process.argv[3]);
const modules = join(engine, 'node_modules/@deepseek-ai');
const entry = pathToFileURL(join(modules, 'dsh-tool-fs-search/lib/index.js'));
const search = await import(entry.href);
const {Context} = await import(pathToFileURL(join(modules, 'cordis/lib/index.js')));
const {default: LocalSubprocess} = await import(pathToFileURL(join(modules, 'dsh-subprocess-local/lib/index.js')));
const platform = Object.getOwnPropertyDescriptor(process, 'platform');
const prefix = process.env.TERMUX__PREFIX;
const cwd = process.cwd();
const dir = await mkdtemp(join(tmpdir(), 'deepcode-search-'));
const ctx = new Context();
try {
  await mkdir(join(dir, 'bin'));
  await symlink(hostBinary, join(dir, 'bin/rg'));
  await writeFile(join(dir, 'target.txt'), 'needle\nsecond line\n');
  await ctx.plugin(LocalSubprocess);
  Object.defineProperty(process, 'platform', {value: 'android'});
  process.env.TERMUX__PREFIX = dir;
  process.chdir(dir);
  assert.equal(await search.resolveRgPath(), join(dir, 'bin/rg'));
  const exec = {signal: new AbortController().signal};
  const run = args => search.runRipgrep(ctx, exec, 'grep', args, 65536, 3000, 65536);
  const hit = await run(['--json', '--regexp=needle', 'target.txt']);
  assert.match(hit.stdout, /"type":"match"/);
  assert.equal(hit.noMatches, false);
  assert.equal((await run(['--regexp=absent', 'target.txt'])).noMatches, true);
  assert.equal((await run(['--fixed-strings', '--regexp=$(touch injected)', 'target.txt'])).noMatches, true);
  const {existsSync} = await import('node:fs');
  assert.equal(existsSync(join(dir, 'injected')), false);
  delete process.env.TERMUX__PREFIX;
  await assert.rejects((await import(entry.href+'?missing-prefix')).resolveRgPath(), /prefix unavailable/);
  process.env.TERMUX__PREFIX = 'relative';
  await assert.rejects((await import(entry.href+'?relative-prefix')).resolveRgPath(), /prefix unavailable/);
  process.env.TERMUX__PREFIX = join(dir, 'missing');
  await assert.rejects((await import(entry.href+'?missing-binary')).resolveRgPath(), /ripgrep unavailable/);
  console.log('PASS: Android resolver, real upstream subprocess/search, no matches, inert argv and fail-closed missing binary');
} finally {
  Object.defineProperty(process, 'platform', platform);
  if (prefix === undefined) delete process.env.TERMUX__PREFIX;
  else process.env.TERMUX__PREFIX = prefix;
  process.chdir(cwd);
  // Every subprocess handle has settled before this fixture is removed.
  await rm(dir, {recursive: true, force: true});
}
