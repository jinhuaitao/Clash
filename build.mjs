import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = name => readFile(path.join(root, name), 'utf8');

/*
 * 可选静态检查：仓库里存在 scripts/check.mjs 时才执行。
 * CI（Cloudflare Builds）可能只包含构建所需文件，缺这个脚本不应阻断部署；
 * 本地开发时它会先跑一遍，有 error 级问题直接中止构建。
 */
const checkerPath = path.join(root, 'scripts/check.mjs');
if (existsSync(checkerPath)) {
  const checked = spawnSync(process.execPath, [checkerPath, '--strict'], { stdio: 'inherit' });
  if (checked.error) throw new Error(`静态检查无法执行：${checked.error.message}`);
  if (checked.status !== 0) throw new Error('静态检查未通过，已中止构建');
} else {
  console.log('· 跳过静态检查（未找到 scripts/check.mjs）');
}

const [workerSource, staticHead, staticRules, adminTemplate, adminCss, adminJs, pkg] = await Promise.all([
  read('src/worker.js'),
  read('src/static-head.yaml'),
  read('src/rules.yaml'),
  read('admin/index.html'),
  read('admin/app.css'),
  read('admin/app.js'),
  read('package.json'),
]);

if (/<\/script/i.test(adminJs)) {
  throw new Error('admin/app.js must not contain a literal closing script tag');
}

try {
  new vm.Script(adminJs, { filename: 'admin/app.js' });
} catch (err) {
  throw new Error(`admin/app.js syntax error: ${err.message}`);
}

const version = JSON.parse(pkg).version;

let adminHtml = adminTemplate
  .replace(/__APP_VERSION__/g, version)
  .replace('/*__CSS__*/', () => adminCss)
  .replace('/*__JS__*/', () => adminJs);

for (const marker of ['/*__CSS__*/', '/*__JS__*/', '__APP_VERSION__']) {
  if (adminHtml.includes(marker)) throw new Error(`Unreplaced admin marker: ${marker}`);
}
if (!adminHtml.includes('__CSP_NONCE__')) throw new Error('Admin HTML is missing CSP nonce placeholders');

const escapeTemplate = value => value
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${');

let output = workerSource
  .replace('__STATIC_HEAD__', () => escapeTemplate(staticHead.trimEnd()))
  .replace('__STATIC_RULES__', () => escapeTemplate(staticRules.trim()))
  .replace('__ADMIN_HTML__', () => escapeTemplate(adminHtml));

for (const marker of ['__STATIC_HEAD__', '__STATIC_RULES__', '__ADMIN_HTML__']) {
  if (output.includes(marker)) throw new Error(`Unreplaced worker marker: ${marker}`);
}

const banner = `/*! Transit Hub v${version} | Cloudflare Worker | built ${new Date().toISOString()} */\n`;
output = banner + output;

await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist/1.js'), output);

const kb = value => (Buffer.byteLength(value, 'utf8') / 1024).toFixed(1) + ' KB';
console.log(`Built dist/1.js  ·  ${kb(output)}`);
console.log(`  worker: ${kb(workerSource)}  admin html: ${kb(adminHtml)}  css: ${kb(adminCss)}  js: ${kb(adminJs)}`);
