import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = name => readFile(path.join(root, name), 'utf8');

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
