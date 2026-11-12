/*
 * 把模板 + 运行文件打包成单文件 install.sh。
 * 之后若改动了 server.mjs / import-nodes.mjs / 模板，重新跑一次即可：
 *   node deploy/make-install.mjs
 */
import { readFile, writeFile, chmod } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const read = file => readFile(path.join(root, file), 'utf8')
const MARKER = 'TRANSIT_HUB_7f3a9c_END_OF_FILE'

const files = {
  __TH_WORKER_JS__: await read('dist/1.js'),
  __TH_SERVER_JS__: await read('deploy/server.mjs'),
  __TH_IMPORT_JS__: await read('deploy/import-nodes.mjs'),
  __TH_NODES_EXAMPLE__: await read('deploy/nodes.example.json'),
  __TH_LINKS_EXAMPLE__: await read('deploy/links.example.txt'),
}
const template = await read('deploy/install.template.sh')

for (const [placeholder, content] of Object.entries(files)) {
  if (content.includes(MARKER)) throw new Error(`${placeholder} 里出现了 heredoc 结束标记 ${MARKER}`)
  if (!content.endsWith('\n')) files[placeholder] = content + '\n'
  const pattern = new RegExp(`^${placeholder}$`, 'm')
  if (!pattern.test(template)) throw new Error(`模板里找不到占位符 ${placeholder}`)
}

let output = template
for (const [placeholder, content] of Object.entries(files)) {
  // 必须用函数形式替换：源码里有大量 $& / $1 字面量，字符串形式会被当成替换语法
  output = output.replace(new RegExp(`^${placeholder}$`, 'm'), () => content.replace(/\n$/, ''))
}
for (const placeholder of Object.keys(files)) {
  if (output.includes(placeholder)) throw new Error(`占位符未替换干净：${placeholder}`)
}

const target = path.join(here, 'install.sh')
await writeFile(target, output)
await chmod(target, 0o755)

const syntax = spawnSync('sh', ['-n', target], { encoding: 'utf8' })
if (syntax.status !== 0) throw new Error(`install.sh 语法检查失败：${syntax.stderr || syntax.stdout}`)

console.log(`生成 ${target}`)
console.log(`  ${(Buffer.byteLength(output) / 1024).toFixed(1)} KB · sh -n 通过 · 5 个文件已内联`)
