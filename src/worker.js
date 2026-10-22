export default {
  async fetch(request, env) {
    return await handleRequest(request, env)
  },
}

const VERSION = '2.2.0'
const CONFIG_KEY = 'config'
const MAX_NODES = 300
const MAX_BODY = 256 * 1024

const MAIN_GROUP = '🌍选择节点'
const RESERVED_NAMES = new Set([
  MAIN_GROUP,
  '🇺🇸欧美节点',
  '🇯🇵日韩节点',
  '🇭🇰港台节点',
  '📶中转节点',
  '💬ChatGPT',
  'ⒼGoogle',
  '📺YOUTUBE',
  '📲 电报信息',
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'GLOBAL',
])

const REGION_META = {
  us: { group: '🇺🇸欧美节点', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/United_States.png' },
  jp: { group: '🇯🇵日韩节点', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Japan.png' },
  hk: { group: '🇭🇰港台节点', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Hong_Kong.png' },
  relay: { group: '📶中转节点', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Relay.png' },
}
const REGION_ORDER = ['us', 'jp', 'hk', 'relay']
const REGIONS = ['us', 'jp', 'hk', 'relay', 'other']
const TYPES = ['vless', 'hysteria2', 'trojan', 'vmess', 'ss']
const TAGS = ['chatgpt', 'google', 'youtube', 'telegram']

const APP_GROUPS = [
  {
    key: 'chatgpt',
    name: '💬ChatGPT',
    icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/ChatGPT.png',
    bases: ['🇺🇸欧美节点'],
  },
  {
    key: 'google',
    name: 'ⒼGoogle',
    icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Google_Search.png',
    bases: ['🇺🇸欧美节点', '🇯🇵日韩节点', '📶中转节点'],
  },
  {
    key: 'youtube',
    name: '📺YOUTUBE',
    icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/YouTube.png',
    bases: ['🇺🇸欧美节点', '🇯🇵日韩节点', '🇭🇰港台节点', '📶中转节点'],
  },
  {
    key: 'telegram',
    name: '📲 电报信息',
    icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Telegram.png',
    bases: [MAIN_GROUP, '🇺🇸欧美节点', '🇯🇵日韩节点', '🇭🇰港台节点', '📶中转节点'],
  },
]

const STATIC_HEAD = `__STATIC_HEAD__`
const STATIC_RULES = `__STATIC_RULES__`
const ADMIN_HTML = `__ADMIN_HTML__`

class HttpError extends Error {
  constructor(status, message, field) {
    super(message)
    this.status = status
    this.field = field
  }
}

async function handleRequest(request, env) {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'

  try {
    if (path === '/api/config' || path === '/api/preview') {
      return await handleApi(request, url, path, env)
    }
    if (path.startsWith('/api/')) {
      return json({ error: '接口不存在' }, 404)
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: baseHeaders() })
    }
    if (path === '/admin' || path === '/console' || url.searchParams.get('admin') === '1') {
      return serveAdmin()
    }
    const token = url.searchParams.get('token') || ''
    if (token && tokenEqual(token, authToken(env))) {
      return await serveSubscription(env)
    }
    return renderDecoy(request)
  } catch (err) {
    if (err instanceof HttpError) {
      return json({ error: err.message, field: err.field || null }, err.status)
    }
    console.error(err && err.stack ? err.stack : err)
    return new Response('Internal Server Error', {
      status: 500,
      headers: { ...baseHeaders(), 'content-type': 'text/plain;charset=UTF-8', 'cache-control': 'no-store' },
    })
  }
}

/* ------------------------------------------------------------------ */
/* auth                                                                */
/* ------------------------------------------------------------------ */

function authToken(env) {
  const value = env && env.AUTH_TOKEN
  return typeof value === 'string' ? value : ''
}

function adminToken(env) {
  const dedicated = env && typeof env.ADMIN_TOKEN === 'string' ? env.ADMIN_TOKEN : ''
  return dedicated || authToken(env)
}

function tokenEqual(a, b) {
  if (!a || !b) return false
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  const len = Math.max(x.length, y.length)
  for (let i = 0; i < len; i++) diff |= (x[i] || 0) ^ (y[i] || 0)
  return diff === 0
}

function isAdmin(request, env) {
  const expected = adminToken(env)
  if (!expected) return false
  const header = request.headers.get('authorization') || ''
  let supplied = ''
  if (/^bearer\s/i.test(header)) supplied = header.slice(7).trim()
  if (!supplied) supplied = request.headers.get('x-admin-token') || ''
  return tokenEqual(supplied, expected)
}

/* ------------------------------------------------------------------ */
/* storage                                                             */
/* ------------------------------------------------------------------ */

function kvBinding(env) {
  const kv = env && env.SUB_KV
  return kv && typeof kv.get === 'function' && typeof kv.put === 'function' ? kv : null
}

function emptyConfig() {
  return { v: 1, rev: 0, updatedAt: null, nodes: [], defaults: {}, regionOrder: {} }
}

function sanitizeDefaults(input) {
  const out = {}
  if (!input || typeof input !== 'object') return out
  const text = value => (typeof value === 'string' ? value.trim() : '')
  if (text(input.vlessUuid)) out.vlessUuid = text(input.vlessUuid)
  if (text(input.vlessPublicKey)) out.vlessPublicKey = text(input.vlessPublicKey)
  if (text(input.vlessShortId)) out.vlessShortId = text(input.vlessShortId)
  if (text(input.vlessServername)) out.vlessServername = text(input.vlessServername)
  return out
}

async function readConfig(env) {
  const kv = kvBinding(env)
  if (!kv) {
    return { config: emptyConfig(), readonly: true, corrupted: false }
  }

  let raw
  try {
    raw = await kv.get(CONFIG_KEY)
  } catch (err) {
    console.error('KV read failed:', err)
    throw new HttpError(502, '读取 KV 失败，请检查 SUB_KV 绑定是否正常')
  }

  if (!raw) {
    const seeded = emptyConfig()
    try {
      await kv.put(CONFIG_KEY, JSON.stringify(seeded))
    } catch (err) {
      console.error('KV seed failed:', err)
      throw new HttpError(502, '初始化 KV 失败，请检查 SUB_KV 绑定是否正常')
    }
    return { config: seeded, readonly: false, corrupted: false }
  }

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.nodes)) throw new Error('invalid config shape')
    return {
      config: {
        v: 1,
        rev: Number.isFinite(parsed.rev) ? parsed.rev : 1,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
        nodes: parsed.nodes,
        defaults: sanitizeDefaults(parsed.defaults),
        regionOrder: reconcileRegionOrder(parsed.regionOrder, parsed.nodes),
      },
      readonly: false,
      corrupted: false,
    }
  } catch (err) {
    console.error('Config corrupted:', err)
    return { config: emptyConfig(), readonly: false, corrupted: true }
  }
}

async function writeConfig(env, config) {
  const kv = kvBinding(env)
  if (!kv) throw new HttpError(503, '尚未绑定 KV 存储，无法保存')
  try {
    await kv.put(CONFIG_KEY, JSON.stringify(config))
  } catch (err) {
    console.error('KV write failed:', err)
    throw new HttpError(502, '写入 KV 失败，请稍后重试')
  }
}

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

function requireString(value, field, label, max) {
  if (typeof value !== 'string') throw new HttpError(400, `${label}不能为空`, field)
  const text = value.trim()
  if (!text) throw new HttpError(400, `${label}不能为空`, field)
  if (text.length > max) throw new HttpError(400, `${label}不能超过 ${max} 个字符`, field)
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new HttpError(400, `${label}包含非法字符`, field)
  return text
}

function optionalString(value, field, label, max) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw new HttpError(400, `${label}格式不正确`, field)
  const text = value.trim()
  if (!text) return ''
  if (text.length > max) throw new HttpError(400, `${label}不能超过 ${max} 个字符`, field)
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new HttpError(400, `${label}包含非法字符`, field)
  return text
}

function hostValue(value, field, label, { required = false } = {}) {
  const text = required
    ? requireString(value, field, label, 253)
    : optionalString(value, field, label, 253)
  if (!text) return ''
  if (!/^[A-Za-z0-9._%:\-\[\]]+$/.test(text)) {
    throw new HttpError(400, `${label}只能包含域名、IPv4 或 IPv6 地址`, field)
  }
  return text
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null) return fallback
  return value === true
}

function portValue(value) {
  const port = typeof value === 'string' ? Number(value.trim()) : value
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new HttpError(400, '端口必须是 1 - 65535 之间的整数', 'port')
  }
  return port
}

function bandwidthValue(value, field, label) {
  const text = optionalString(value, field, label, 24)
  if (!text) return ''
  const match = text.match(/^(\d{1,6}(?:\.\d{1,2})?)\s*(kbps|mbps|gbps)$/i)
  if (!match) throw new HttpError(400, `${label}格式应为 80 mbps`, field)
  return `${match[1]} ${match[2].toLowerCase()}`
}

const GROUP_REGIONS = ['us', 'jp', 'hk', 'relay']

function sanitizeRegionOrder(input) {
  const out = {}
  if (!input || typeof input !== 'object') return out
  GROUP_REGIONS.forEach(region => {
    const arr = input[region]
    if (!Array.isArray(arr)) return
    const seen = new Set()
    const clean = []
    arr.forEach(id => {
      if (typeof id === 'string' && id && !seen.has(id)) {
        seen.add(id)
        clean.push(id)
      }
    })
    if (clean.length) out[region] = clean
  })
  return out
}

// 按当前节点名单整理分组顺序：剔除已删除/已换组 id，未收录的本组节点按全局顺序追加到末尾
function reconcileRegionOrder(stored, nodes) {
  const clean = sanitizeRegionOrder(stored)
  const byRegion = { us: [], jp: [], hk: [], relay: [] }
  nodes.forEach(node => {
    if (node && byRegion[node.region]) byRegion[node.region].push(node.id)
  })
  const out = {}
  GROUP_REGIONS.forEach(region => {
    const members = new Set(byRegion[region])
    const seen = new Set()
    const arr = []
    ;(clean[region] || []).forEach(id => {
      if (members.has(id) && !seen.has(id)) {
        seen.add(id)
        arr.push(id)
      }
    })
    byRegion[region].forEach(id => {
      if (!seen.has(id)) {
        seen.add(id)
        arr.push(id)
      }
    })
    if (arr.length) out[region] = arr
  })
  return out
}

function validateDefaults(input) {
  const cleaned = sanitizeDefaults(input)
  if (cleaned.vlessUuid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleaned.vlessUuid)) {
    throw new HttpError(400, '预设 UUID 格式不正确', 'defaults.vlessUuid')
  }
  if (cleaned.vlessPublicKey && cleaned.vlessPublicKey.length > 128) {
    throw new HttpError(400, '预设 Reality 公钥不能超过 128 个字符', 'defaults.vlessPublicKey')
  }
  if (cleaned.vlessShortId && cleaned.vlessShortId.length > 32) {
    throw new HttpError(400, '预设 Reality Short ID 不能超过 32 个字符', 'defaults.vlessShortId')
  }
  if (cleaned.vlessServername) {
    const sni = hostValue(cleaned.vlessServername, 'defaults.vlessServername', '预设 SNI / 回落域名')
    cleaned.vlessServername = sni
  }
  return cleaned
}

function validateNodes(input) {
  if (!Array.isArray(input)) throw new HttpError(400, '节点数据格式不正确')
  if (input.length > MAX_NODES) throw new HttpError(400, `节点数量不能超过 ${MAX_NODES} 个`)

  const allowedFingerprints = ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random', 'randomized']
  const allowedNetworks = ['tcp', 'ws', 'grpc']
  const allowedCiphers = ['aes-128-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305']
  const ids = new Set()
  const names = new Set()
  const nodes = []

  input.forEach((raw, index) => {
    const seq = index + 1
    if (!raw || typeof raw !== 'object') throw new HttpError(400, `第 ${seq} 个节点数据无效`)

    const name = requireString(raw.name, 'name', '节点名称', 80)
    if (RESERVED_NAMES.has(name)) {
      throw new HttpError(400, `节点名称「${name}」与策略组或内置策略冲突`, 'name')
    }
    const nameKey = name.toLowerCase()
    if (names.has(nameKey)) throw new HttpError(400, `节点名称「${name}」重复`, 'name')
    names.add(nameKey)

    const type = TYPES.includes(raw.type) ? raw.type : ''
    if (!type) throw new HttpError(400, `节点「${name}」的协议类型不受支持`, 'type')
    const server = hostValue(raw.server, 'server', '服务器地址', { required: true })
    const port = portValue(raw.port)
    const region = REGIONS.includes(raw.region) ? raw.region : 'other'
    const tags = Array.isArray(raw.tags)
      ? [...new Set(raw.tags.filter(tag => TAGS.includes(tag)))]
      : []
    const enabled = raw.enabled !== false
    const showInMain = raw.showInMain !== false

    let id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : ''
    if (!id || ids.has(id)) id = 'n_' + crypto.randomUUID()
    ids.add(id)

    const node = { id, name, type, server, port, region, enabled, showInMain, tags }

    if (type === 'vless') {
      const uuid = requireString(raw.uuid, 'uuid', 'UUID', 64)
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
        throw new HttpError(400, `节点「${name}」的 UUID 格式不正确`, 'uuid')
      }
      node.uuid = uuid.toLowerCase()
      const network = allowedNetworks.includes(raw.network) ? raw.network : 'tcp'
      const reality = boolValue(raw.reality)
      if (reality && network !== 'tcp') {
        throw new HttpError(400, `节点「${name}」的 Reality 仅支持 TCP 传输`, 'reality')
      }
      node.network = network
      node.tls = boolValue(raw.tls, true)
      node.reality = reality
      node.servername = hostValue(raw.servername, 'servername', 'SNI / 回落域名')
      if (reality) {
        node.publicKey = requireString(raw.publicKey, 'publicKey', 'Reality 公钥', 128)
        node.shortId = optionalString(raw.shortId, 'shortId', 'Reality Short ID', 32)
      }
      node.flow = ['', 'xtls-rprx-vision'].includes(raw.flow) ? raw.flow || '' : ''
      node.fingerprint = allowedFingerprints.includes(raw.fingerprint) ? raw.fingerprint : 'chrome'
      node.udp = boolValue(raw.udp, true)
      if (network === 'ws') {
        node.wsPath = optionalString(raw.wsPath, 'wsPath', 'WS Path', 256) || '/'
        node.wsHost = hostValue(raw.wsHost, 'wsHost', 'WS Host')
      }
      if (network === 'grpc') {
        node.grpcService = optionalString(raw.grpcService, 'grpcService', 'gRPC 服务名', 64)
      }
    } else if (type === 'vmess') {
      const uuid = requireString(raw.uuid, 'uuid', 'UUID', 64)
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
        throw new HttpError(400, `节点「${name}」的 UUID 格式不正确`, 'uuid')
      }
      node.uuid = uuid.toLowerCase()
      node.network = ['tcp', 'ws', 'grpc'].includes(raw.network) ? raw.network : 'ws'
      node.tls = boolValue(raw.tls)
      node.servername = hostValue(raw.servername, 'servername', 'SNI')
      node.udp = boolValue(raw.udp, true)
      if (node.network === 'ws') {
        node.wsPath = optionalString(raw.wsPath, 'wsPath', 'WS Path', 256) || '/'
        node.wsHost = hostValue(raw.wsHost, 'wsHost', 'WS Host')
      }
      if (node.network === 'grpc') {
        node.grpcService = optionalString(raw.grpcService, 'grpcService', 'gRPC 服务名', 64)
      }
    } else if (type === 'trojan') {
      node.password = requireString(raw.password, 'password', '密码', 128)
      node.sni = hostValue(raw.sni, 'sni', 'SNI')
      node.skipCertVerify = boolValue(raw.skipCertVerify, true)
      node.udp = boolValue(raw.udp, true)
    } else if (type === 'hysteria2') {
      node.password = requireString(raw.password, 'password', '密码', 128)
      node.sni = hostValue(raw.sni, 'sni', 'SNI')
      node.skipCertVerify = boolValue(raw.skipCertVerify, true)
      node.up = bandwidthValue(raw.up, 'up', '上行带宽')
      node.down = bandwidthValue(raw.down, 'down', '下行带宽')
    } else if (type === 'ss') {
      node.cipher = allowedCiphers.includes(raw.cipher) ? raw.cipher : 'aes-256-gcm'
      node.password = requireString(raw.password, 'password', '密码', 128)
      node.udp = boolValue(raw.udp, true)
    }

    nodes.push(node)
  })

  return nodes
}

/* ------------------------------------------------------------------ */
/* api                                                                 */
/* ------------------------------------------------------------------ */

async function handleApi(request, url, path, env) {
  if (!isAdmin(request, env)) {
    return json({ error: '管理令牌无效或未配置' }, 401)
  }

  if (path === '/api/config') {
    if (request.method === 'GET') {
      const result = await readConfig(env)
      return json({
        config: result.config,
        meta: buildMeta(url, result, env),
      })
    }
    if (request.method === 'PUT') {
      return await apiSave(request, url, env)
    }
    return json({ error: '不支持的请求方法' }, 405)
  }

  if (path === '/api/preview') {
    if (request.method !== 'GET') return json({ error: '不支持的请求方法' }, 405)
    let result
    try {
      result = await readConfig(env)
    } catch (err) {
      result = { config: emptyConfig(), readonly: true, corrupted: false }
    }
    return new Response(buildYaml(result.config), {
      headers: {
        ...baseHeaders(),
        'content-type': 'text/yaml;charset=UTF-8',
        'cache-control': 'no-store',
      },
    })
  }

  return json({ error: '接口不存在' }, 404)
}

async function apiSave(request, url, env) {
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > MAX_BODY) throw new HttpError(413, '提交的配置过大')
  const raw = await request.text()
  if (raw.length > MAX_BODY) throw new HttpError(413, '提交的配置过大')

  let body
  try {
    body = JSON.parse(raw)
  } catch (err) {
    throw new HttpError(400, '请求数据格式错误')
  }
  if (!body || typeof body !== 'object') throw new HttpError(400, '请求数据格式错误')

  const current = await readConfig(env)
  if (current.readonly) {
    throw new HttpError(503, '尚未绑定 KV 存储，配置为只读模式。请先绑定 SUB_KV 后重试')
  }
  if (body.rev !== undefined && body.rev !== null && Number(body.rev) !== current.config.rev) {
    return json({
      error: '配置已在其他窗口被更新，请刷新后重试',
      rev: current.config.rev,
    }, 409)
  }

  const nodes = validateNodes(body.nodes)
  const defaults = body.defaults !== undefined
    ? validateDefaults(body.defaults)
    : sanitizeDefaults(current.config.defaults)
  const regionOrder = reconcileRegionOrder(
    body.regionOrder !== undefined ? body.regionOrder : current.config.regionOrder,
    nodes
  )
  const next = {
    v: 1,
    rev: (current.config.rev || 0) + 1,
    updatedAt: new Date().toISOString(),
    nodes,
    defaults,
    regionOrder,
  }
  await writeConfig(env, next)

  return json({
    config: next,
    meta: buildMeta(url, { readonly: false, corrupted: false }, env),
  })
}

function buildMeta(url, result, env) {
  const dedicated = !!(env && typeof env.ADMIN_TOKEN === 'string' && env.ADMIN_TOKEN.length > 0)
  const auth = authToken(env)
  return {
    version: VERSION,
    kv: !!kvBinding(env),
    readonly: !!result.readonly,
    corrupted: !!result.corrupted,
    hasAuthToken: !!auth,
    authMode: dedicated ? 'dedicated' : 'shared',
    subUrl: auth ? `${url.origin}/?token=${encodeURIComponent(auth)}` : null,
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...baseHeaders(),
      'content-type': 'application/json;charset=UTF-8',
      'cache-control': 'no-store',
    },
  })
}

function baseHeaders() {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
  }
}

/* ------------------------------------------------------------------ */
/* subscription                                                        */
/* ------------------------------------------------------------------ */

async function serveSubscription(env) {
  let config
  try {
    config = (await readConfig(env)).config
  } catch (err) {
    console.error('Subscription fallback to empty config:', err)
    config = emptyConfig()
  }

  const timestamp = Math.floor(Date.now() / 1000)
  return new Response(buildYaml(config), {
    headers: {
      ...baseHeaders(),
      'content-type': 'text/yaml;charset=UTF-8',
      'cache-control': 'no-store, max-age=0',
      'profile-update-interval': '12',
      'subscription-userinfo': `upload=0;download=0;total=10737418240000;expire=${timestamp}`,
      'access-control-allow-origin': '*',
    },
  })
}

function buildYaml(config) {
  const enabled = config.nodes.filter(node => node.enabled)
  const time = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(new Date()).replace(/\//g, '-')

  const header = [
    '# ============================================================',
    '# Transit Hub · Clash Subscription',
    `# 更新时间: ${time} (Asia/Shanghai)`,
    `# 节点: ${config.nodes.length} 个 · 已启用: ${enabled.length} 个`,
    '# 由 Transit Hub Console 自动生成，请勿手动编辑',
    '# ============================================================',
    '',
  ].join('\n')

  const proxies = enabled.map(nodeToYaml).join('\n')
  const groups = buildProxyGroups(config).map(groupToYaml).join('\n')
  const proxySection = enabled.length ? ['proxies:', proxies] : ['proxies: []']

  return [
    header,
    STATIC_HEAD.trimEnd(),
    '',
    '# 节点',
    ...proxySection,
    '',
    '# 策略组',
    'proxy-groups:',
    groups,
    '',
    STATIC_RULES.trim(),
    '',
  ].join('\n')
}

function yq(value) {
  return JSON.stringify(String(value))
}

function nodeToYaml(node) {
  const lines = [
    `- name: ${yq(node.name)}`,
    `  type: ${node.type}`,
    `  server: ${yq(node.server)}`,
    `  port: ${node.port}`,
  ]

  if (node.type === 'vless') {
    lines.push(`  uuid: ${yq(node.uuid)}`)
    lines.push(`  network: ${node.network}`)
    if (node.network === 'ws') {
      lines.push('  ws-opts:')
      lines.push(`    path: ${yq(node.wsPath || '/')}`)
      if (node.wsHost) {
        lines.push('    headers:')
        lines.push(`      Host: ${yq(node.wsHost)}`)
      }
    }
    if (node.network === 'grpc' && node.grpcService) {
      lines.push('  grpc-opts:')
      lines.push(`    grpc-service-name: ${yq(node.grpcService)}`)
    }
    if (node.udp) lines.push('  udp: true')
    if (node.tls || node.reality) lines.push('  tls: true')
    if (node.flow && node.network === 'tcp' && node.tls) lines.push(`  flow: ${node.flow}`)
    if (node.servername && (node.tls || node.reality)) lines.push(`  servername: ${yq(node.servername)}`)
    if (node.reality) {
      lines.push('  reality-opts:')
      lines.push(`    public-key: ${yq(node.publicKey)}`)
      if (node.shortId) lines.push(`    short-id: ${yq(node.shortId)}`)
    }
    if (node.fingerprint) lines.push(`  client-fingerprint: ${node.fingerprint}`)
    return lines.join('\n')
  }

  if (node.type === 'vmess') {
    lines.push(`  uuid: ${yq(node.uuid)}`)
    lines.push('  alterId: 0')
    lines.push('  cipher: auto')
    lines.push(`  network: ${node.network}`)
    if (node.network === 'ws') {
      lines.push('  ws-opts:')
      lines.push(`    path: ${yq(node.wsPath || '/')}`)
      if (node.wsHost) {
        lines.push('    headers:')
        lines.push(`      Host: ${yq(node.wsHost)}`)
      }
    }
    if (node.network === 'grpc' && node.grpcService) {
      lines.push('  grpc-opts:')
      lines.push(`    grpc-service-name: ${yq(node.grpcService)}`)
    }
    if (node.udp) lines.push('  udp: true')
    if (node.tls) lines.push('  tls: true')
    if (node.servername && node.tls) lines.push(`  servername: ${yq(node.servername)}`)
    return lines.join('\n')
  }

  if (node.type === 'trojan') {
    lines.push(`  password: ${yq(node.password)}`)
    if (node.sni) lines.push(`  sni: ${yq(node.sni)}`)
    if (node.skipCertVerify) lines.push('  skip-cert-verify: true')
    if (node.udp) lines.push('  udp: true')
    return lines.join('\n')
  }

  if (node.type === 'hysteria2') {
    lines.push(`  password: ${yq(node.password)}`)
    lines.push('  quic:')
    lines.push('    initStreamReceiveWindow: 8388608')
    lines.push('    maxStreamReceiveWindow: 8388608')
    lines.push('    initConnReceiveWindow: 20971520')
    lines.push('    maxConnReceiveWindow: 20971520')
    lines.push('    maxIdleTimeout: 30s')
    lines.push('    maxIncomingStreams: 1024')
    lines.push('    disablePathMTUDiscovery: false')
    if (node.up || node.down) {
      lines.push('  bandwidth:')
      if (node.up) lines.push(`    up: ${yq(node.up)}`)
      if (node.down) lines.push(`    down: ${yq(node.down)}`)
    }
    if (node.sni) lines.push(`  sni: ${yq(node.sni)}`)
    if (node.skipCertVerify) lines.push('  skip-cert-verify: true')
    return lines.join('\n')
  }

  if (node.type === 'ss') {
    lines.push(`  cipher: ${node.cipher}`)
    lines.push(`  password: ${yq(node.password)}`)
    if (node.udp) lines.push('  udp: true')
    return lines.join('\n')
  }

  return lines.join('\n')
}

function buildProxyGroups(config) {
  const enabled = config.nodes.filter(node => node.enabled)
  const buckets = []

  REGION_ORDER.forEach(key => {
    const inRegion = enabled.filter(node => node.region === key)
    if (inRegion.length) {
      // 各分组按独立的 regionOrder 排序，未收录的节点保持全局相对顺序（sort 稳定）
      const rank = new Map((((config.regionOrder || {})[key]) || []).map((id, i) => [id, i]))
      const far = Number.MAX_SAFE_INTEGER
      const members = inRegion
        .slice()
        .sort((a, b) => {
          const ra = rank.has(a.id) ? rank.get(a.id) : far
          const rb = rank.has(b.id) ? rank.get(b.id) : far
          return ra - rb
        })
        .map(node => node.name)
      buckets.push({ key, name: REGION_META[key].group, icon: REGION_META[key].icon, members })
    }
  })

  const mainProxies = [
    'DIRECT',
    ...buckets.map(bucket => bucket.name),
    ...enabled.filter(node => node.showInMain !== false).map(node => node.name),
  ]
  const groups = [{
    name: MAIN_GROUP,
    icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Global.png',
    proxies: mainProxies,
  }]

  buckets.forEach(bucket => {
    groups.push({ name: bucket.name, icon: bucket.icon, proxies: bucket.members })
  })

  const availableBuckets = new Set(buckets.map(bucket => bucket.name))

  APP_GROUPS.forEach(app => {
    const proxies = []
    const push = value => {
      if (value && !proxies.includes(value)) proxies.push(value)
    }
    app.bases.forEach(base => {
      if (base === MAIN_GROUP || availableBuckets.has(base)) push(base)
    })
    enabled.forEach(node => {
      if (node.tags.includes(app.key)) push(node.name)
    })
    if (!proxies.length) push(MAIN_GROUP)
    groups.push({ name: app.name, icon: app.icon, proxies })
  })

  return groups
}

function groupToYaml(group) {
  const lines = [`- name: ${yq(group.name)}`]
  if (group.icon) lines.push(`  icon: ${yq(group.icon)}`)
  lines.push('  type: select')
  lines.push('  proxies:')
  group.proxies.forEach(proxy => lines.push(`    - ${yq(proxy)}`))
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* admin page                                                          */
/* ------------------------------------------------------------------ */

function serveAdmin() {
  const nonce = randomNonce()
  const html = ADMIN_HTML.split('__CSP_NONCE__').join(nonce)
  return new Response(html, {
    headers: {
      ...baseHeaders(),
      'content-type': 'text/html;charset=UTF-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'content-security-policy': [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        "style-src 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    },
  })
}

function randomNonce() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

/* ------------------------------------------------------------------ */
/* decoy page                                                          */
/* ------------------------------------------------------------------ */

function renderDecoy(request) {
  const headers = request.headers
  const ip = headers.get('cf-connecting-ip') || '未知'
  const country = request.cf ? request.cf.country : '未知'
  const city = request.cf ? request.cf.city : '未知'
  const isp = request.cf ? request.cf.asOrganization : '未知运营商'
  const colo = request.cf ? request.cf.colo : '未知节点'
  const ua = headers.get('user-agent') || '未知浏览器'
  const location = [city, country].filter(value => value && value !== '未知').join(', ') || '未知'
  const version = /:/.test(ip) ? 'IPv6' : 'IPv4'
  const uaShort = ua.length > 120 ? ua.slice(0, 120) + '…' : ua

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>IP 地址查询</title>
<style>
  :root {
    color-scheme: light;
    --bg: #f3f5fb;
    --panel: rgba(255,255,255,.78);
    --panel-solid: #ffffff;
    --line: rgba(15,23,42,.08);
    --line-strong: rgba(15,23,42,.12);
    --text: #0f172a;
    --muted: #667085;
    --faint: #98a2b3;
    --accent: #4f46e5;
    --accent-2: #0ea5e9;
    --soft: #eef2ff;
    --ok: #12b76a;
    --shadow: 0 24px 70px -24px rgba(15,23,42,.28), 0 2px 8px rgba(15,23,42,.04);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --bg: #070b14;
      --panel: rgba(15,23,42,.62);
      --panel-solid: #0d1424;
      --line: rgba(148,163,184,.14);
      --line-strong: rgba(148,163,184,.22);
      --text: #e8eefb;
      --muted: #94a3b8;
      --faint: #64748b;
      --accent: #8ba3ff;
      --accent-2: #38bdf8;
      --soft: rgba(99,102,241,.14);
      --ok: #34d399;
      --shadow: 0 30px 80px -30px rgba(0,0,0,.8), 0 2px 8px rgba(0,0,0,.24);
    }
  }
  * { box-sizing: border-box; }
  html, body { min-height: 100%; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 15px;
    line-height: 1.6;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    overflow-x: hidden;
  }
  .backdrop { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
  .backdrop::before {
    content: "";
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(15,23,42,.045) 1px, transparent 1px),
      linear-gradient(90deg, rgba(15,23,42,.045) 1px, transparent 1px);
    background-size: 44px 44px;
    mask-image: radial-gradient(ellipse 80% 60% at 50% 35%, #000 20%, transparent 78%);
  }
  .backdrop .orb { position: absolute; border-radius: 999px; filter: blur(70px); opacity: .55; }
  .orb-a { width: 440px; height: 440px; left: -120px; top: -140px; background: rgba(99,102,241,.25); }
  .orb-b { width: 380px; height: 380px; right: -100px; top: 20%; background: rgba(14,165,233,.18); }
  .orb-c { width: 340px; height: 340px; left: 30%; bottom: -160px; background: rgba(16,185,129,.12); }
  @media (prefers-color-scheme: dark) {
    .backdrop::before {
      background-image:
        linear-gradient(rgba(148,163,184,.06) 1px, transparent 1px),
        linear-gradient(90deg, rgba(148,163,184,.06) 1px, transparent 1px);
    }
  }
  .topbar {
    position: relative; z-index: 1;
    display: flex; align-items: center; justify-content: space-between;
    padding: 26px 32px;
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand-mark { width: 30px; height: 30px; }
  .brand-name { font-weight: 650; letter-spacing: -.01em; font-size: 15px; }
  .brand-tag { color: var(--faint); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; margin-left: 8px; }
  .top-status { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); font-size: 12px; }
  .pulse { position: relative; width: 7px; height: 7px; border-radius: 50%; background: var(--ok); }
  .pulse::after {
    content: ""; position: absolute; inset: -4px; border-radius: 50%;
    border: 1px solid var(--ok); opacity: .45; animation: pulse 2.4s ease-out infinite;
  }
  @keyframes pulse { 0% { transform: scale(.55); opacity: .55; } 80%,100% { transform: scale(1.3); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .pulse::after { animation: none; } }
  main { position: relative; z-index: 1; flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px 20px 48px; }
  .card {
    width: 100%; max-width: 570px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 24px;
    box-shadow: var(--shadow);
    backdrop-filter: blur(22px) saturate(140%);
    -webkit-backdrop-filter: blur(22px) saturate(140%);
    padding: 34px 36px 30px;
    position: relative;
    overflow: hidden;
  }
  .card::before {
    content: ""; position: absolute; inset: 0 0 auto 0; height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.7), transparent);
    opacity: .8;
  }
  @media (prefers-color-scheme: dark) { .card::before { background: linear-gradient(90deg, transparent, rgba(255,255,255,.22), transparent); } }
  .eyebrow {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 11px; font-weight: 650; letter-spacing: .14em; text-transform: uppercase;
    color: var(--accent); margin-bottom: 22px;
  }
  .eyebrow .line { width: 22px; height: 1px; background: currentColor; opacity: .45; }
  .ip-label { font-size: 13px; color: var(--muted); margin: 0 0 8px; letter-spacing: .02em; }
  .ip {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: clamp(26px, 7vw, 38px);
    font-weight: 650; letter-spacing: -.035em; line-height: 1.15;
    word-break: break-all; margin: 0 0 10px;
    background: linear-gradient(96deg, var(--text) 20%, var(--accent) 120%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .ip-meta { display: flex; align-items: center; gap: 10px; color: var(--faint); font-size: 12px; margin-bottom: 28px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; background: var(--soft); color: var(--accent); font-weight: 600; font-size: 11px; letter-spacing: .02em; }
  .grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 1px;
    background: var(--line); border: 1px solid var(--line); border-radius: 16px; overflow: hidden;
  }
  .info { background: var(--panel-solid); padding: 16px 18px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .info-label { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }
  .info-label svg { width: 13px; height: 13px; opacity: .8; }
  .info-value { font-weight: 600; font-size: 14px; letter-spacing: -.01em; overflow-wrap: anywhere; }
  .info.span-2 { grid-column: span 2; }
  .ua { margin-top: 18px; padding: 13px 16px; border-radius: 12px; border: 1px solid var(--line); background: color-mix(in srgb, var(--panel-solid) 70%, transparent); }
  .ua-label { font-size: 11px; font-weight: 600; letter-spacing: .10em; text-transform: uppercase; color: var(--faint); margin-bottom: 4px; }
  .ua-text { font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
  .card-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--faint); font-size: 12px; }
  .card-foot .ok { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 14%, transparent); }
  footer { position: relative; z-index: 1; text-align: center; padding: 0 20px 28px; color: var(--faint); font-size: 11.5px; letter-spacing: .03em; }
  @media (max-width: 540px) {
    .topbar { padding: 20px; }
    .brand-tag { display: none; }
    .card { padding: 26px 22px 24px; border-radius: 20px; }
    .grid { grid-template-columns: 1fr; }
    .info.span-2 { grid-column: auto; }
    .card-foot { flex-direction: column; align-items: flex-start; gap: 8px; }
    .top-status span:last-child { display: none; }
  }
</style>
</head>
<body>
<div class="backdrop" aria-hidden="true">
  <div class="orb orb-a"></div>
  <div class="orb orb-b"></div>
  <div class="orb orb-c"></div>
</div>
<header class="topbar">
  <div class="brand">
    <svg class="brand-mark" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" rx="11" fill="currentColor" opacity=".07"/>
      <rect x="1" y="1" width="38" height="38" rx="11" stroke="currentColor" stroke-opacity=".12"/>
      <path d="M12 25.5 20 12l8 13.5-8 4.6-8-4.6Z" stroke="var(--accent)" stroke-width="1.7" stroke-linejoin="round"/>
      <circle cx="20" cy="12" r="2.2" fill="var(--accent)"/>
      <circle cx="12" cy="25.5" r="2.2" fill="var(--accent)" opacity=".7"/>
      <circle cx="28" cy="25.5" r="2.2" fill="var(--accent)" opacity=".7"/>
    </svg>
    <span class="brand-name">Transit Hub</span>
    <span class="brand-tag">Edge Network</span>
  </div>
  <div class="top-status"><span class="pulse"></span><span>节点运行中</span></div>
</header>
<main>
  <section class="card" aria-labelledby="ip-title">
    <div class="eyebrow"><span class="line"></span>Network Diagnostics</div>
    <p class="ip-label" id="ip-title">您的公网 IP 地址</p>
    <div class="ip">${esc(ip)}</div>
    <div class="ip-meta"><span class="chip">${version}</span><span>由 Cloudflare 边缘网络识别</span></div>
    <div class="grid">
      <div class="info">
        <span class="info-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/></svg>
          地理位置
        </span>
        <span class="info-value">${esc(location)}</span>
      </div>
      <div class="info">
        <span class="info-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.6 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.6-3.8-9S9.5 5.5 12 3Z"/></svg>
          接入节点
        </span>
        <span class="info-value">${esc(colo)}</span>
      </div>
      <div class="info span-2">
        <span class="info-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M3.5 9.5h17M8 14.5h5"/></svg>
          运营商
        </span>
        <span class="info-value">${esc(isp)}</span>
      </div>
    </div>
    <div class="ua">
      <div class="ua-label">浏览器信息</div>
      <div class="ua-text">${esc(uaShort)}</div>
    </div>
    <div class="card-foot">
      <span class="ok"><span class="dot"></span>服务运行正常</span>
      <span>Transit Hub · Edge Node</span>
    </div>
  </section>
</main>
<footer>© ${new Date().getFullYear()} Transit Hub · Network Diagnostics</footer>
</body>
</html>`

  return new Response(html, {
    headers: {
      ...baseHeaders(),
      'content-type': 'text/html;charset=UTF-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  })
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]))
}
