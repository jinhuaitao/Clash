#!/usr/bin/env node
/*
 * Transit Hub · 节点导入工具
 *
 * 两种输入，最终都走 /api/config 的正式写入路径（服务端的 validateNodes 会再校验一遍）：
 *   --file  nodes.json    结构化节点；支持 [节点]、{nodes:[...]}、完整 config 备份
 *   --links links.txt     分享链接，一行一条（vless / vmess / trojan / hysteria2 / hy2 / ss）
 *
 * 默认「替换」已有节点；--append 追加。--dry-run 只打印将要提交的数据。
 *
 * 用法：
 *   node import-nodes.mjs --file nodes.json --env /etc/transit-hub/env.json
 *   node import-nodes.mjs --links links.txt --append
 *   node import-nodes.mjs --file nodes.json --dry-run
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const TYPES = ['vless', 'hysteria2', 'trojan', 'vmess', 'ss']
const CIPHERS = ['aes-128-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305']
const TAGS = ['chatgpt', 'google', 'youtube', 'telegram']
const FINGERPRINTS = ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random', 'randomized']
const NETWORKS = ['tcp', 'ws', 'grpc']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HOST_RE = /^[A-Za-z0-9._%:\-\[\]]+$/
const RESERVED_NAMES = new Set([
  '🌍选择节点', '🇺🇸欧美节点', '🇯🇵日韩节点', '🇭🇰港台节点', '📶中转节点',
  '💬ChatGPT', 'ⒼGoogle', '📺YOUTUBE', '📲 电报信息',
  'DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'GLOBAL',
])

/* ---------------- 参数 ---------------- */
function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) { out._.push(arg); continue }
    const key = arg.slice(2)
    if (['append', 'dry-run', 'json', 'help'].includes(key)) { out[key] = true; continue }
    const value = argv[++i]
    if (value === undefined) throw new Error(`参数 --${key} 缺少取值`)
    out[key] = value
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
if (args.help || (!args.file && !args.links && !args._.length)) {
  console.log(`Transit Hub 节点导入

  --file <path>       nodes.json（[节点] / {nodes:[...]} / 完整配置备份）
  --links <path>      分享链接文本，一行一条
  --append            追加到现有节点（默认替换）
  --group <id>        指定分组：us / jp / hk / relay 或自定义分组 id（默认按名称猜测）
  --base <url>        服务地址，默认 http://127.0.0.1:8787
  --env <path>        env.json 路径，自动读取 ADMIN_TOKEN / AUTH_TOKEN / PORT
  --admin-token <s>   直接指定恢复令牌（优先于 --env）
  --dry-run           只打印待提交节点，不写入
  --json              以 JSON 输出结果

示例：
  transit-hub import-nodes /etc/transit-hub/nodes.json
  transit-hub import-nodes --links /root/links.txt --append`)
  process.exit(0)
}

const envFile = args.env || path.join(here, 'env.json')
let fileEnv = {}
try {
  fileEnv = JSON.parse(await fs.readFile(envFile, 'utf8'))
} catch (err) {
  if (err.code !== 'ENOENT') console.error(`· 无法读取 ${envFile}：${err.message}`)
}
const ADMIN_TOKEN = args['admin-token'] || fileEnv.ADMIN_TOKEN || process.env.ADMIN_TOKEN || ''
const AUTH_TOKEN = fileEnv.AUTH_TOKEN || process.env.AUTH_TOKEN || ''
const PORT = fileEnv.PORT || process.env.TH_PORT || 8787
const BASE = (args.base || `http://127.0.0.1:${PORT}`).replace(/\/+$/, '')

/* ---------------- 分享链接解析 ---------------- */
const safeDecode = value => {
  try { return decodeURIComponent(String(value ?? '')) } catch { return String(value ?? '') }
}
const decodeBase64 = value => {
  const text = String(value).replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')
  const padded = text + '='.repeat((4 - (text.length % 4)) % 4)
  return Buffer.from(padded, 'base64').toString('utf8')
}
const shareBool = value => /^(1|true|yes|on)$/i.test(String(value || ''))
const shareBandwidth = value => {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/^\d{1,6}(\.\d{1,2})?$/.test(text)) return `${text} mbps`
  if (/^\d{1,6}(\.\d{1,2})?\s*(kbps|mbps|gbps)$/i.test(text)) return text.toLowerCase()
  return ''
}

function splitUri(line) {
  const match = String(line).match(/^([A-Za-z0-9+.-]+):\/\/(.*)$/)
  if (!match) throw new Error('不是有效的分享链接')
  let rest = match[2]
  let name = ''
  const hash = rest.indexOf('#')
  if (hash !== -1) { name = safeDecode(rest.slice(hash + 1)).trim(); rest = rest.slice(0, hash) }
  let query = ''
  const mark = rest.indexOf('?')
  if (mark !== -1) { query = rest.slice(mark + 1); rest = rest.slice(0, mark) }
  const params = {}
  for (const pair of query.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const key = eq === -1 ? pair : pair.slice(0, eq)
    const value = eq === -1 ? '' : pair.slice(eq + 1)
    params[safeDecode(key).toLowerCase()] = safeDecode(value.replace(/\+/g, '%2B'))
  }
  if (['vless', 'trojan', 'hysteria2', 'hy2'].includes(match[1].toLowerCase())) rest = rest.replace(/\/+$/, '')
  return { scheme: match[1].toLowerCase(), body: rest, query: params, name }
}

function splitAuthority(body) {
  const at = String(body || '').lastIndexOf('@')
  return at === -1
    ? { userinfo: '', hostport: body || '' }
    : { userinfo: body.slice(0, at), hostport: body.slice(at + 1) }
}

function splitHostPort(text) {
  let value = String(text || '').trim()
  if (!value) throw new Error('缺少服务器地址')
  if (value.startsWith('[')) {
    const close = value.indexOf(']')
    if (close === -1) throw new Error('IPv6 地址格式不正确')
    const host = value.slice(1, close)
    const portMatch = value.slice(close + 1).match(/^:(\d+)$/)
    if (!portMatch) throw new Error('缺少端口')
    return { server: host, port: Number(portMatch[1]) }
  }
  const slash = value.indexOf('/')
  if (slash !== -1) value = value.slice(0, slash)
  const colon = value.lastIndexOf(':')
  if (colon === -1) throw new Error('缺少端口')
  return { server: value.slice(0, colon), port: Number(value.slice(colon + 1)) }
}

function endpoint(hostport) {
  const { server, port } = splitHostPort(hostport)
  if (!server || !HOST_RE.test(server)) throw new Error('服务器地址格式不正确')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口号无效')
  return { server, port }
}

function parseVless(parts) {
  const auth = splitAuthority(parts.body)
  const uuid = safeDecode(auth.userinfo)
  if (!UUID_RE.test(uuid)) throw new Error('VLESS 的 UUID 格式不正确')
  const ep = endpoint(auth.hostport)
  const q = parts.query
  const network = (q.type || 'tcp').toLowerCase()
  if (!NETWORKS.includes(network)) throw new Error(`暂不支持 ${network} 传输`)
  let security = (q.security || '').toLowerCase()
  if (security === 'xtls') security = 'tls'
  if (security && !['tls', 'reality', 'none'].includes(security)) throw new Error(`暂不支持 ${security} 加密`)
  const reality = security === 'reality'
  const tls = security === 'tls' || reality
  if (reality && !q.pbk) throw new Error('Reality 链接缺少 pbk 公钥')
  if (reality && network !== 'tcp') throw new Error('Reality 仅支持 TCP 传输')
  const node = {
    type: 'vless', ...ep, uuid: uuid.toLowerCase(), network, tls, reality,
    servername: q.sni || q.host || '', fingerprint: FINGERPRINTS.includes((q.fp || '').toLowerCase()) ? q.fp.toLowerCase() : 'chrome',
    flow: network === 'tcp' && tls ? (q.flow || '') : '', udp: true,
  }
  if (reality) { node.publicKey = String(q.pbk).slice(0, 128); node.shortId = String(q.sid || '').slice(0, 32) }
  if (network === 'ws') { node.wsPath = q.path || '/'; node.wsHost = q.host || '' }
  if (network === 'grpc') node.grpcService = String(q.servicename || q.path || '').slice(0, 64)
  return { node, name: parts.name || `VLESS · ${ep.server}` }
}

function parseVmess(parts) {
  let data
  try { data = JSON.parse(decodeBase64(parts.body)) } catch { throw new Error('VMess 内容不是有效的 Base64 JSON') }
  if (!data || typeof data !== 'object') throw new Error('VMess 内容格式不正确')
  const uuid = String(data.id || '').trim()
  if (!UUID_RE.test(uuid)) throw new Error('VMess 的 UUID 格式不正确')
  const aid = Number(data.aid || 0)
  if (aid) throw new Error('暂不支持 alterId ≠ 0 的旧版 VMess')
  if (data.scy && String(data.scy).toLowerCase() !== 'auto') throw new Error(`暂不支持 ${data.scy} 加密方式`)
  const server = String(data.add || '').trim()
  const port = Number(data.port)
  if (!server || !HOST_RE.test(server)) throw new Error('VMess 服务器地址格式不正确')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('VMess 端口号无效')
  const network = String(data.net || 'tcp').toLowerCase()
  if (!NETWORKS.includes(network)) throw new Error(`暂不支持 ${network} 传输`)
  const node = {
    type: 'vmess', server, port, uuid: uuid.toLowerCase(), network,
    tls: String(data.tls || '').toLowerCase() === 'tls',
    servername: data.sni || data.host || '', udp: true,
  }
  if (network === 'ws') { node.wsPath = data.path || '/'; node.wsHost = data.host || '' }
  if (network === 'grpc') node.grpcService = String(data.path || data.serviceName || '').slice(0, 64)
  return { node, name: parts.name || String(data.ps || '').trim() || `VMess · ${server}` }
}

function parseTrojan(parts) {
  const auth = splitAuthority(parts.body)
  const password = safeDecode(auth.userinfo)
  if (!password) throw new Error('Trojan 缺少密码')
  const ep = endpoint(auth.hostport)
  const q = parts.query
  if ((q.type || 'tcp').toLowerCase() !== 'tcp') throw new Error('Trojan 暂不支持非 TCP 传输')
  return {
    node: {
      type: 'trojan', ...ep, password: password.slice(0, 128),
      sni: q.sni || q.peer || '', skipCertVerify: shareBool(q.allowinsecure || q.insecure), udp: true,
    },
    name: parts.name || `Trojan · ${ep.server}`,
  }
}

function parseHysteria2(parts) {
  const auth = splitAuthority(parts.body)
  const password = safeDecode(auth.userinfo)
  if (!password) throw new Error('Hysteria2 缺少密码')
  const ep = endpoint(auth.hostport)
  const q = parts.query
  if (q.obfs) throw new Error('暂不支持 Hysteria2 的 obfs 混淆')
  return {
    node: {
      type: 'hysteria2', ...ep, password: password.slice(0, 128),
      sni: q.sni || q.peer || '', skipCertVerify: shareBool(q.insecure || q.allowinsecure),
      up: shareBandwidth(q.up || q.upmbps), down: shareBandwidth(q.down || q.downmbps),
    },
    name: parts.name || `Hysteria2 · ${ep.server}`,
  }
}

function parseSS(parts) {
  let body = String(parts.body || '')
  if (!body) throw new Error('SS 缺少加密方式与服务器地址')
  if (parts.query.plugin) throw new Error('暂不支持 Shadowsocks 插件')
  let userinfo = ''
  let hostport = ''
  const at = body.lastIndexOf('@')
  if (at !== -1) {
    const raw = safeDecode(body.slice(0, at))
    userinfo = raw.includes(':') ? raw : decodeBase64(body.slice(0, at))
    hostport = body.slice(at + 1)
  } else {
    const decoded = decodeBase64(body)
    const split = decoded.lastIndexOf('@')
    if (split === -1) throw new Error('SS 链接缺少服务器地址')
    userinfo = decoded.slice(0, split)
    hostport = decoded.slice(split + 1)
  }
  const colon = userinfo.indexOf(':')
  if (colon === -1) throw new Error('SS 链接缺少加密方式或密码')
  const cipher = userinfo.slice(0, colon).trim().toLowerCase()
  const password = userinfo.slice(colon + 1)
  if (!CIPHERS.includes(cipher)) throw new Error(`暂不支持 ${cipher} 加密方式`)
  if (!password) throw new Error('SS 缺少密码')
  return {
    node: { type: 'ss', ...endpoint(hostport), cipher, password: password.slice(0, 128), udp: true },
    name: parts.name || `SS · ${splitHostPort(hostport).server}`,
  }
}

const PARSERS = {
  vless: parseVless, vmess: parseVmess, trojan: parseTrojan,
  hysteria2: parseHysteria2, hy2: parseHysteria2, ss: parseSS,
}

function guessGroup(text) {
  if (/(香港|\bhk\b|hong ?kong|台湾|\btw\b|taipei)/i.test(text)) return 'hk'
  if (/(日本|\bjp\b|tokyo|osaka|韩国|首尔|\bkr\b|新加坡|\bsg\b)/i.test(text)) return 'jp'
  if (/(中转|中继|relay|落地)/i.test(text)) return 'relay'
  if (/(美国|\bus\b|欧美|英国|德国|欧洲|洛杉矶|硅谷)/i.test(text)) return 'us'
  return ''
}

/* ---------------- 输入归一化 ---------------- */
function normalizeNode(raw, index, usedNames) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`第 ${index + 1} 个节点不是对象`)
  }
  const type = String(raw.type || '').toLowerCase()
  if (!TYPES.includes(type)) throw new Error(`第 ${index + 1} 个节点的 type 不受支持（${raw.type}）`)
  const server = String(raw.server || '').trim()
  if (!server) throw new Error(`第 ${index + 1} 个节点缺少 server`)
  const port = Number(raw.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`第 ${index + 1} 个节点端口无效`)

  let name = String(raw.name || '').replace(/\s+/g, ' ').trim().slice(0, 80) || `${type.toUpperCase()} · ${server}`
  if (RESERVED_NAMES.has(name)) name = `${name.slice(0, 74)} 节点`
  const base = name
  let suffix = 2
  while (usedNames.has(name.toLowerCase())) name = `${base.slice(0, 76)} ${suffix++}`
  usedNames.add(name.toLowerCase())

  const node = {
    name, type, server, port,
    groupId: args.group || raw.groupId || guessGroup([name, server, raw.servername, raw.sni, raw.wsHost].join(' ')),
    enabled: raw.enabled !== false,
    showInMain: raw.showInMain !== false,
    tags: Array.isArray(raw.tags) ? [...new Set(raw.tags.filter(t => TAGS.includes(t)))] : [],
  }
  // 保留已有 id：追加/替换时让服务端能维持顺序，不需要重新生成
  if (typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id)) node.id = raw.id

  if (type === 'vless' || type === 'vmess') {
    const uuid = String(raw.uuid || '').trim()
    if (!UUID_RE.test(uuid)) throw new Error(`节点「${name}」缺少合法 UUID`)
    node.uuid = uuid.toLowerCase()
    node.network = NETWORKS.includes(raw.network) ? raw.network : (type === 'vmess' ? 'ws' : 'tcp')
    node.tls = raw.tls === true
    node.servername = String(raw.servername || '').trim()
    node.udp = raw.udp !== false
    if (node.network === 'ws') { node.wsPath = String(raw.wsPath || '/'); node.wsHost = String(raw.wsHost || '').trim() }
    if (node.network === 'grpc') node.grpcService = String(raw.grpcService || '').slice(0, 64)
    if (type === 'vless') {
      node.reality = raw.reality === true
      node.fingerprint = FINGERPRINTS.includes(raw.fingerprint) ? raw.fingerprint : 'chrome'
      node.flow = raw.flow === 'xtls-rprx-vision' ? raw.flow : ''
      if (node.reality) {
        if (!raw.publicKey) throw new Error(`节点「${name}」开启 Reality 但缺少 publicKey`)
        node.publicKey = String(raw.publicKey).slice(0, 128)
        node.shortId = String(raw.shortId || '').slice(0, 32)
      }
    }
  } else {
    const password = String(raw.password || '')
    if (!password) throw new Error(`节点「${name}」缺少 password`)
    node.password = password.slice(0, 128)
    node.sni = String(raw.sni || '').trim()
    node.skipCertVerify = raw.skipCertVerify === true
    node.udp = raw.udp !== false
    if (type === 'hysteria2') {
      node.up = shareBandwidth(raw.up)
      node.down = shareBandwidth(raw.down)
    }
    if (type === 'ss') node.cipher = CIPHERS.includes(raw.cipher) ? raw.cipher : 'aes-256-gcm'
  }
  return node
}

async function readInput() {
  let raws = []
  const errors = []
  const inputFile = args.file || args._[0]

  if (args.links || (inputFile && /\.txt$/i.test(inputFile))) {
    const text = await fs.readFile(args.links || inputFile, 'utf8')
    text.split(/\r?\n/).forEach((line, i) => {
      const value = line.trim()
      if (!value || value.startsWith('#')) return
      try {
        const parts = splitUri(value)
        const parser = PARSERS[parts.scheme]
        if (!parser) throw new Error(`暂不支持 ${parts.scheme}:// 协议`)
        const parsed = parser(parts)
        // 链接 # 后面的备注是用户给节点起的名字，优先于协议默认值
        parsed.node.name = parsed.name
        raws.push(parsed.node)
      } catch (err) {
        errors.push(`第 ${i + 1} 行：${err.message}`)
      }
    })
  } else if (inputFile) {
    const parsed = JSON.parse(await fs.readFile(inputFile, 'utf8'))
    const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.nodes) ? parsed.nodes : null)
    if (!list) throw new Error('JSON 需要是节点数组，或含 nodes 数组的对象')
    raws = list
  } else {
    throw new Error('请用 --file 或 --links 指定节点来源')
  }

  const used = new Set()
  const nodes = []
  raws.forEach((raw, index) => {
    try { nodes.push(normalizeNode(raw, index, used)) }
    catch (err) { errors.push(err.message) }
  })
  return { nodes, errors }
}

/* ---------------- 提交 ---------------- */
async function api(pathname, init = {}) {
  const headers = { authorization: `Bearer ${ADMIN_TOKEN}`, ...(init.headers || {}) }
  const response = await fetch(BASE + pathname, { ...init, headers })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  if (!response.ok) {
    const detail = body && body.error ? body.error : (typeof body === 'string' ? body.slice(0, 200) : response.statusText)
    throw new Error(`${init.method || 'GET'} ${pathname} → ${response.status}：${detail}`)
  }
  return body
}

const { nodes, errors } = await readInput()
for (const message of errors) console.error(`· 跳过：${message}`)
if (!nodes.length) {
  console.error('没有可导入的节点')
  process.exit(1)
}

if (args['dry-run']) {
  console.log(JSON.stringify(nodes, null, 2))
  console.error(`\n· 预演：共 ${nodes.length} 个节点，未写入`)
  process.exit(0)
}

if (!ADMIN_TOKEN) throw new Error('缺少 ADMIN_TOKEN：请用 --admin-token 指定，或确认 --env 指向的 env.json 里有该字段')

const current = await api('/api/config')
let finalNodes = nodes
if (args.append) {
  // 追加时保留现有节点，按「类型 + server + port + 凭据」去重
  const signature = node => [node.type, String(node.server).toLowerCase(), node.port, node.uuid || node.password || ''].join('|')
  const seen = new Set(current.config.nodes.map(signature))
  finalNodes = [...current.config.nodes]
  for (const node of nodes) {
    if (seen.has(signature(node))) continue
    seen.add(signature(node))
    finalNodes.push(node)
  }
}

const result = await api('/api/config', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ rev: current.config.rev, nodes: finalNodes }),
})

const subUrl = (result.meta && result.meta.subUrl) ||
  (AUTH_TOKEN ? `${BASE}/?token=${encodeURIComponent(AUTH_TOKEN)}` : null)

if (args.json) {
  console.log(JSON.stringify({ imported: finalNodes.length, subUrl }, null, 2))
} else {
  // 自定义域名时服务端会用 TH_PUBLIC_BASE 生成 subUrl，控制台地址跟着它走
  const consoleUrl = subUrl ? `${new URL(subUrl).origin}/admin` : `${BASE}/admin`
  console.log(`✓ 节点已写入：${result.config.nodes.length} 个（本次提交 ${finalNodes.length} 个）`)
  if (subUrl) console.log(`  订阅链接：${subUrl}`)
  console.log(`  控制台：  ${consoleUrl}`)
  if (errors.length) console.log(`  · ${errors.length} 条被跳过，详见上方输出`)
}
