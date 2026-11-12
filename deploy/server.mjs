#!/usr/bin/env node
/*
 * Transit Hub · 本地服务器适配层（Debian / Alpine / 任意 Node >= 20 的 Linux）
 *
 * 原项目是 Cloudflare Worker：入口是 `worker.fetch(request, env)`。
 * 这里用 Node 内置的 http + Fetch API 把二者桥接起来，并用单个 JSON 文件
 * 模拟 Cloudflare KV（只用到 get / put / delete）。Worker 源码一行不改。
 *
 * 环境变量：
 *   TH_ENV           env.json 路径（默认同目录 env.json）
 *   TH_DATA          KV 持久化文件（默认同目录 kv.json）
 *   TH_PORT          监听端口（默认 8787）
 *   TH_BIND          监听地址（默认 0.0.0.0）
 *   TH_PUBLIC_BASE   对外访问地址，例如 https://sub.example.com
 *                    只影响控制台里显示的订阅链接，不参与路由
 *   TH_TRUST_PROXY   设为 1 时从 X-Forwarded-For 取真实客户端 IP
 *   TH_WORKER        Worker 产物路径（默认 ./1.js，缺失时回退 ../dist/1.js）
 *
 * 日志刻意不打印请求 URL：订阅令牌在 query 里，落日志等于泄露凭据。
 */
import http from 'node:http'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ENV_FILE = process.env.TH_ENV || path.join(here, 'env.json')
const DATA_FILE = process.env.TH_DATA || path.join(here, 'kv.json')
const PORT = Number(process.env.TH_PORT || 8787)
const BIND = process.env.TH_BIND || '0.0.0.0'
const PUBLIC_BASE = process.env.TH_PUBLIC_BASE || ''
const TRUST_PROXY = process.env.TH_TRUST_PROXY === '1'
const MAX_BODY = 1024 * 1024 // 比 Worker 自己的 256 KB 上限宽，留给 Node 层做硬闸

/* ------------------------------------------------------------------ */
/* Worker 产物：安装后是同目录 1.js；源码树里直接跑时用 ../dist/1.js     */
/* ------------------------------------------------------------------ */
async function loadWorker() {
  const candidates = [
    process.env.TH_WORKER,
    path.join(here, '1.js'),
    path.join(here, '..', 'dist', '1.js'),
  ].filter(Boolean)
  const target = candidates.find(file => existsSync(file))
  if (!target) {
    throw new Error('找不到 Worker 产物 1.js（也找不到 ../dist/1.js）')
  }
  const mod = await import('file://' + target)
  if (!mod.default || typeof mod.default.fetch !== 'function') {
    throw new Error('Worker 产物没有导出 fetch(request, env)')
  }
  return mod.default
}

/* ------------------------------------------------------------------ */
/* 文件版 KV：写入串行化 + 临时文件 rename，避免半截 JSON 与并发覆盖     */
/* ------------------------------------------------------------------ */
class FileKV {
  constructor(file) {
    this.file = file
    this.data = Object.create(null)
    this.queue = Promise.resolve()
  }

  async init() {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        this.data = { ...Object.create(null), ...parsed }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw new Error(`KV 数据文件无法解析（${this.file}）：${err.message}`)
      }
    }
  }

  async get(key) {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null
  }

  async put(key, value) {
    return this.enqueue(async () => {
      this.data[key] = String(value)
      await this.flush()
    })
  }

  async delete(key) {
    return this.enqueue(async () => {
      delete this.data[key]
      await this.flush()
    })
  }

  enqueue(task) {
    const result = this.queue.then(task, task)
    this.queue = result.catch(() => {})
    return result
  }

  async flush() {
    const tmp = `${this.file}.tmp`
    await fs.writeFile(tmp, JSON.stringify(this.data), { mode: 0o600 })
    await fs.rename(tmp, this.file)
    try { await fs.chmod(this.file, 0o600) } catch { /* 非 POSIX 文件系统可忽略 */ }
  }
}

/* ------------------------------------------------------------------ */
/* 环境变量：env.json 提供 Worker 的 Secret，进程的 TH_* 只做运行参数     */
/* ------------------------------------------------------------------ */
async function loadEnv() {
  let fileEnv = {}
  try {
    const parsed = JSON.parse(await fs.readFile(ENV_FILE, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) fileEnv = parsed
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw new Error(`env.json 无法解析（${ENV_FILE}）：${err.message}`)
    }
  }
  // Worker 只读自己认识的几个键，多余字段无害；SUB_KV 由下面注入
  return { ...fileEnv }
}

/* ------------------------------------------------------------------ */
/* HTTP → Fetch Request / Fetch Response → HTTP                        */
/* ------------------------------------------------------------------ */
function clientIp(req) {
  let ip = ''
  if (TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for']
    if (forwarded) ip = String(Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim()
  }
  if (!ip) ip = req.socket.remoteAddress || 'unknown'
  return ip.replace(/^::ffff:/, '')
}

function requestHeaders(req) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    const text = Array.isArray(value) ? value.join(', ') : String(value)
    try { headers.set(name, text) } catch { /* 非法头部名直接丢弃 */ }
  }
  // Worker 的限流键来自 cf-connecting-ip；不给就全落进 'unknown' 一个桶
  headers.set('cf-connecting-ip', clientIp(req))
  return headers
}

async function readBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.byteLength
    if (total > MAX_BODY) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function requestUrl(req) {
  const host = req.headers.host || `127.0.0.1:${PORT}`
  let base
  if (PUBLIC_BASE) {
    base = new URL(PUBLIC_BASE)
  } else {
    const proto = (TRUST_PROXY && req.headers['x-forwarded-proto']) || 'http'
    base = new URL(`${Array.isArray(proto) ? proto[0] : proto}://${host}`)
  }
  return new URL(req.url || '/', base)
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */
const worker = await loadWorker()
const env = await loadEnv()
const kv = new FileKV(DATA_FILE)
await kv.init()
env.SUB_KV = kv
// 边缘限流绑定不注入：Worker 会自动回落到进程内令牌桶（单机单进程足够）

const server = http.createServer(async (req, res) => {
  const isHead = req.method === 'HEAD'
  try {
    let body
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = await readBody(req)
      if (body === null) {
        res.writeHead(413, { 'content-type': 'text/plain;charset=UTF-8' })
        res.end('Payload Too Large')
        return
      }
    }

    const init = { method: req.method, headers: requestHeaders(req) }
    if (body !== undefined && body.length) init.body = new Uint8Array(body)
    const request = new Request(requestUrl(req), init)
    const response = await worker.fetch(request, env)

    const headers = {}
    response.headers.forEach((value, key) => { headers[key] = value })
    res.writeHead(response.status, headers)
    if (isHead) {
      res.end()
    } else {
      res.end(Buffer.from(await response.arrayBuffer()))
    }
  } catch (err) {
    console.error('[transit-hub] 请求处理失败:', err && err.stack ? err.stack : err)
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain;charset=UTF-8', 'cache-control': 'no-store' })
    }
    res.end('Internal Server Error')
  }
})

server.on('clientError', (err, socket) => {
  if (!socket.writableEnded) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
})

server.listen(PORT, BIND, () => {
  const publicUrl = PUBLIC_BASE || `http://${BIND === '0.0.0.0' ? '127.0.0.1' : BIND}:${PORT}`
  console.log(`[transit-hub] v2.10.0 已启动  ${BIND}:${PORT}`)
  console.log(`[transit-hub] 控制台  ${publicUrl}/admin`)
  console.log(`[transit-hub] KV 文件 ${DATA_FILE}`)
  console.log(`[transit-hub] 恢复令牌 ${env.ADMIN_TOKEN ? '已配置' : '未配置（/api/setup 将返回 503）'}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`[transit-hub] 收到 ${signal}，正在关闭`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5000).unref()
  })
}
