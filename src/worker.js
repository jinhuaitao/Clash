export default {
  async fetch(request, env) {
    return await handleRequest(request, env)
  },
}

const VERSION = '2.9.0'
const CONFIG_KEY = 'config'
const USERS_KEY = 'users'
const MAX_NODES = 300
const MAX_BODY = 256 * 1024
const MAX_USERS = 20
/* 成员个人节点单独存一个 KV 键：不进管理员配置、不影响其他账号，
   只在该成员的配置、预览与订阅链接里合并展现 */
const PERSONAL_KEY_PREFIX = 'user_nodes:'
const MAX_PERSONAL_NODES = 100
/* 成员的个人分组和「未分组」一样，只在自己的订阅里生效。
   单独给一个上限：共享分组已经占掉一部分策略组名额，成员侧不需要再开到 24 个。
   id 统一用 mg_ 前缀，和所有者的内置组 / g_ 自定义组天然隔开。 */
const MAX_MEMBER_GROUPS = 12
const MEMBER_GROUP_ID_RE = /^mg_[A-Za-z0-9_-]{1,61}$/
const PERSONAL_ID_RE = /^p_[A-Za-z0-9_-]{1,62}$/
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._+@-]{2,253}$/
const USERNAME_MAX = 254
const PASSWORD_MIN = 12
const PASSWORD_MAX = 128
// Workers Free 只有 10ms CPU，默认 1 万次；付费计划可用 PASSWORD_ITERATIONS 提高（上限 20 万）
const PASSWORD_ITERATIONS = 10000
const PASSWORD_ITERATIONS_MAX = 200000

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

/* 分组名可以叫「🇭🇰港台节点」这类内置分组名（它们由分组表本身去重保证唯一），
   但不能占用全局选择组、应用策略组与内置策略的名字，否则 YAML 里会出现重名策略组 */
const RESERVED_GROUP_NAMES = new Set([
  MAIN_GROUP,
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

/* 分组（策略组）由控制台维护，存在 config.groups 里。
   内置四组的 id 直接沿用旧版的 region 键（us / jp / hk / relay），
   因此历史节点、regionOrder 与订阅输出都不需要迁移；自定义分组用 g_ 前缀的新 id。
   节点只记 groupId，分组改名 / 换图标 / 调顺序都不会动到节点数据。 */
const DEFAULT_GROUPS = [
  { id: 'us', name: '🇺🇸欧美节点', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/United_States.png' },
  { id: 'jp', name: '🇯🇵日韩节点', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Japan.png' },
  { id: 'hk', name: '🇭🇰港台节点', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Hong_Kong.png' },
  { id: 'relay', name: '📶中转节点', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Relay.png' },
]
const MAX_GROUPS = 24
const GROUP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const GROUP_NAME_MAX = 40
const TYPES = ['vless', 'hysteria2', 'trojan', 'vmess', 'ss']
const TAGS = ['chatgpt', 'google', 'youtube', 'telegram']
/* 写入校验与 YAML 渲染共用同一套白名单，避免两处规则漂移 */
const NETWORKS = ['tcp', 'ws', 'grpc']
const FINGERPRINTS = ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random', 'randomized']
const CIPHERS = ['aes-128-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305']
const FLOWS = ['', 'xtls-rprx-vision']

/* 应用策略组的默认成员：bases 写分组 id（MAIN_GROUP 表示全局选择组），
   渲染时再换成当前分组名 —— 分组可以改名，写死名字会让策略组引用失效 */
const APP_GROUPS = [
  {
    key: 'chatgpt',
    name: '💬ChatGPT',
    icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/ChatGPT.png',
    bases: ['us'],
  },
  {
    key: 'google',
    name: 'ⒼGoogle',
    icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Google_Search.png',
    bases: ['us', 'jp', 'relay'],
  },
  {
    key: 'youtube',
    name: '📺YOUTUBE',
    icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/YouTube.png',
    bases: ['us', 'jp', 'hk', 'relay'],
  },
  {
    key: 'telegram',
    name: '📲 电报信息',
    icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Telegram.png',
    bases: [MAIN_GROUP, 'us', 'jp', 'hk', 'relay'],
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
    if (path.startsWith('/api/')) {
      const limited = await checkApiRateLimit(request, env)
      if (limited) return limited
      return await handleApi(request, url, path, env)
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: baseHeaders() })
    }
    // HEAD 只用于探活：不拼伪装页 HTML，也不返回正文，避免白烧 CPU 且符合 RFC 9110
    const headOnly = request.method === 'HEAD'
    if (path === '/admin' || path === '/console') {
      return serveAdmin(headOnly)
    }
    const token = subscriptionToken(request, url)
    if (token) {
      const limited = await checkSubRateLimit(request, env)
      if (limited) return limited
      const access = await subscriptionAccess(env, token)
      if (access) return await serveSubscription(env, access.config, headOnly)
      // 令牌无效：本次请求已经在上面计过一次，这里不再重复扣配额，
      // 否则爆破者实际可用的次数只有配置值的一半
      return renderDecoy(request, headOnly)
    }
    // 无令牌路径同样限流：伪装页每次都要拼整页 HTML，不能成为免费刷 CPU 的入口
    const decoyLimited = await checkSubRateLimit(request, env)
    if (decoyLimited) return decoyLimited
    return renderDecoy(request, headOnly)
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

let warnedWeakAuthToken = false
function authToken(env) {
  const value = env && env.AUTH_TOKEN
  if (typeof value !== 'string') return ''
  const token = value.trim()
  if (!token) return ''
  // 环境变量可能被误粘入换行或超长内容：这类值既无法与 URL 中的令牌匹配，
  // 也不该被当作有效凭据。过短的令牌等于可爆破，一并按「未配置」处理并提示一次。
  if (token.length < AUTH_TOKEN_MIN || token.length > AUTH_TOKEN_MAX || /[\s\u0000-\u001f\u007f]/.test(token)) {
    if (!warnedWeakAuthToken) {
      warnedWeakAuthToken = true
      console.warn(`AUTH_TOKEN 需为 ${AUTH_TOKEN_MIN}-${AUTH_TOKEN_MAX} 位且不含空白，当前值已忽略；请在设置页生成新令牌`)
    }
    return ''
  }
  return token
}

/* 部署恢复令牌是「绕过登录直接拿所有者权限」的凭据，短到能被爆破就等于没有密码。
   与 AUTH_TOKEN 同一套形态规则：过短 / 含空白 / 含控制字符一律按「未配置」处理，
   只提示一次，避免每个请求都刷日志。 */
let warnedWeakAdminToken = false
function dedicatedAdminToken(env) {
  const value = env && env.ADMIN_TOKEN
  if (typeof value !== 'string') return ''
  const token = value.trim()
  if (!token) return ''
  if (token.length < ADMIN_TOKEN_MIN || token.length > AUTH_TOKEN_MAX || /[\s\u0000-\u001f\u007f]/.test(token)) {
    if (!warnedWeakAdminToken) {
      warnedWeakAdminToken = true
      console.warn(`ADMIN_TOKEN 需为 ${ADMIN_TOKEN_MIN}-${AUTH_TOKEN_MAX} 位且不含空白，当前值已忽略，恢复通道不可用`)
    }
    return ''
  }
  return token
}

function effectiveAuthToken(config, env) {
  return storedAuthToken(config) || authToken(env)
}

/* 首次初始化默认要求先配好 ADMIN_TOKEN。
   未配置的公开实例，第一个打开 /admin 的人就会成为所有者 —— 在扫描器遍地的
   环境里这不是「便捷」，而是「抢注」。因此默认 fail-closed：
   没有恢复令牌就拒绝 /api/setup，并明确告诉部署者该配什么。
   确实需要零配置体验（本地开发、一次性实例）可以显式打开 ALLOW_OPEN_SETUP。 */
function openSetupAllowed(env) {
  const raw = env && env.ALLOW_OPEN_SETUP
  if (typeof raw !== 'string') return false
  const value = raw.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function bearerToken(request) {
  const header = request.headers.get('authorization') || ''
  if (/^bearer\s/i.test(header)) return header.slice(7).trim()
  return request.headers.get('x-admin-token') || ''
}

/* 订阅令牌优先取查询参数（客户端兼容），其次接受 Authorization: Bearer。
   走头部时令牌不会进入 URL，也就不会被 CDN / Worker 日志与浏览器历史留存。 */
function subscriptionToken(request, url) {
  const query = url.searchParams.get('token') || ''
  if (query) return query
  const header = request.headers.get('authorization') || ''
  if (/^bearer\s/i.test(header)) return header.slice(7).trim()
  return ''
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

function bytesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

function randomBytes(length) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

function bytesToBase64Url(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(value) {
  const base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function validateUsername(value) {
  if (typeof value !== 'string') throw new HttpError(400, '用户名格式不正确', 'username')
  const username = value.trim()
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(400, '用户名需为 3–254 位（字母、数字或 . _ + @ -），也可以直接填写邮箱地址', 'username')
  }
  // 用户名会显示在账号列表里，零宽 / 双向控制符可以把它伪装成另一个账号
  if (FORMAT_CHARS_RE.test(username)) throw new HttpError(400, '用户名不能包含不可见控制字符', 'username')
  return username
}

/* 只挡「必然被秒破」的口令，不强制字符类别：
   12 位以上的长口令短语（全小写或全字母）本来就更安全，不该被规则逼成 Passw0rd! 这类模式。 */
const WEAK_PASSWORDS = new Set([
  'password1234', 'password12345', 'password123456', 'passw0rd1234',
  '123456789012', '1234567890123', '12345678901234', '111111111111',
  'qwertyuiop12', 'qwertyuiop123', 'qwerty123456', 'asdfghjkl123',
  'administrator', 'administrator1', 'letmein12345', 'iloveyou12345',
  'welcome12345', 'changeme1234', 'admin1234567', 'abc123456789',
])
const KEYBOARD_RUNS = ['0123456789', '9876543210', 'abcdefghijklmnopqrstuvwxyz', 'zyxwvutsrqponmlkjihgfedcba', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']

function weakPasswordReason(password, username) {
  const lower = password.toLowerCase()
  if (WEAK_PASSWORDS.has(lower)) return '该密码在常见弱口令列表中，请换一个'
  // 单一 / 双字符重复：aaaaaaaaaaaa、abababababab
  if (new Set(lower).size <= 2) return '密码字符过于单一，请混合更多不同字符'
  // 去掉分隔符后整体落在键盘序列 / 数字序列里
  const compact = lower.replace(/[\s._-]/g, '')
  if (compact && KEYBOARD_RUNS.some(run => run.includes(compact))) {
    return '密码是连续序列（如 123456789 / qwerty），请换一个'
  }
  const name = String(username || '').toLowerCase().split('@')[0]
  if (name.length >= 3 && lower === name) return '密码不能与用户名相同'
  return ''
}

function validatePassword(value, username) {
  if (typeof value !== 'string' || !value) throw new HttpError(400, '密码不能为空', 'password')
  if (value.length < PASSWORD_MIN) throw new HttpError(400, `密码至少需要 ${PASSWORD_MIN} 个字符`, 'password')
  if (value.length > PASSWORD_MAX) throw new HttpError(400, `密码不能超过 ${PASSWORD_MAX} 个字符`, 'password')
  if (!value.trim()) throw new HttpError(400, '密码不能全部为空格', 'password')
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new HttpError(400, '密码不能包含控制字符', 'password')
  const reason = weakPasswordReason(value, username)
  if (reason) throw new HttpError(400, reason, 'password')
  return value
}

async function derivePasswordHash(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  )
  return new Uint8Array(bits)
}

/* 新建 / 改密时的迭代次数：默认 1 万次以适配免费计划，付费计划可通过环境变量提高。
   已有账号按其存储值校验，改环境变量不会让旧口令失效。 */
let warnedPasswordIterations = false
function passwordIterations(env) {
  const raw = Number(env && env.PASSWORD_ITERATIONS)
  if (!Number.isInteger(raw) || raw < PASSWORD_ITERATIONS) {
    // 1 万次只有 OWASP 建议值的 1/60：免费计划的 10ms CPU 是硬上限，
    // 这里不能擅自调高，但必须让部署者知道自己在什么水位上
    if (!warnedPasswordIterations) {
      warnedPasswordIterations = true
      console.warn(`未配置 PASSWORD_ITERATIONS，按 ${PASSWORD_ITERATIONS} 次迭代派生口令（免费计划 CPU 限制）。付费计划请设为 ${PASSWORD_ITERATIONS_MAX}，否则 KV 一旦泄漏，离线爆破成本很低`)
    }
    return PASSWORD_ITERATIONS
  }
  return Math.min(raw, PASSWORD_ITERATIONS_MAX)
}

async function buildPasswordRecord(password, iterations = PASSWORD_ITERATIONS) {
  const rounds = Math.min(Math.max(iterations, PASSWORD_ITERATIONS), PASSWORD_ITERATIONS_MAX)
  const salt = randomBytes(16)
  const hash = await derivePasswordHash(password, salt, rounds)
  return {
    passwordSalt: bytesToBase64Url(salt),
    passwordHash: bytesToBase64Url(hash),
    passwordIterations: rounds,
  }
}

async function verifyPassword(password, user) {
  if (!user || typeof user.passwordSalt !== 'string' || typeof user.passwordHash !== 'string') return false
  const iterations = Number.isFinite(user.passwordIterations) &&
    user.passwordIterations >= 1000 &&
    user.passwordIterations <= PASSWORD_ITERATIONS_MAX
    ? user.passwordIterations
    : PASSWORD_ITERATIONS
  // 盐/哈希可能因 KV 被手工写坏而不是合法 base64：解码失败按密码不正确处理，不能 500
  let salt
  let expected
  try {
    salt = base64UrlToBytes(user.passwordSalt)
    expected = base64UrlToBytes(user.passwordHash)
  } catch (err) {
    return false
  }
  if (salt.length < 8 || expected.length !== 32) return false
  const actual = await derivePasswordHash(password, salt, iterations)
  return bytesEqual(actual, expected)
}

/* 未知账号也要消耗同等量级的 CPU，否则响应时间会泄漏用户名是否存在 */
async function dummyPasswordCheck(password, iterations = PASSWORD_ITERATIONS) {
  const rounds = Math.min(Math.max(iterations, PASSWORD_ITERATIONS), PASSWORD_ITERATIONS_MAX)
  await derivePasswordHash(
    String(password || '').slice(0, PASSWORD_MAX),
    randomBytes(16),
    rounds
  )
  return false
}

/* KV 里的 secret 是 base64url；环境变量 SESSION_SECRET 是普通字符串，
   两者不能走同一个 importKey（atob 会拒绝非 base64 字符）。 */
async function hmacSign(secret, value) {
  return await hmacSignBytes(base64UrlToBytes(secret), value)
}

async function hmacSignText(textSecret, value) {
  return await hmacSignBytes(new TextEncoder().encode(textSecret), value)
}

async function hmacSignBytes(keyBytes, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return new Uint8Array(signature)
}

/* 会话签名密钥：优先用环境变量 SESSION_SECRET，这样即使 KV 被读走也无法伪造会话
   （KV 里的 secret 只用于派生成员订阅令牌）。未配置时回落到 KV 内的随机 secret，
   保持零配置可用；配置了但不合格则告警并回落，不会让控制台直接不可用。 */
let warnedWeakSessionSecret = false
function sessionKey(store, env) {
  const raw = env && env.SESSION_SECRET
  if (typeof raw === 'string') {
    const value = raw.trim()
    if (value.length >= 32 && value.length <= 256 && !/[\s\u0000-\u001f\u007f]/.test(value)) {
      return { kind: 'env', value }
    }
    if (value && !warnedWeakSessionSecret) {
      warnedWeakSessionSecret = true
      console.warn('SESSION_SECRET 需为 32-256 位且不含空白，当前值已忽略，回落到 KV 内的会话密钥')
    }
  }
  return { kind: 'kv', value: store.secret }
}

async function signSession(key, value) {
  return key.kind === 'env' ? await hmacSignText(key.value, value) : await hmacSign(key.value, value)
}

function sessionTtlSeconds(env) {
  const raw = Number(env && env.SESSION_TTL_HOURS)
  if (!Number.isFinite(raw) || raw < SESSION_TTL_HOURS_MIN) return SESSION_TTL_HOURS_DEFAULT * 3600
  return Math.round(Math.min(raw, SESSION_TTL_HOURS_MAX) * 3600)
}

async function createSessionToken(user, key, env) {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    v: 1,
    sub: user.id,
    ver: user.version,
    iat: now,
    exp: now + sessionTtlSeconds(env),
  }
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const signature = await signSession(key, body)
  return `${body}.${bytesToBase64Url(signature)}`
}

async function verifySessionToken(token, key) {
  if (typeof token !== 'string' || token.length > SESSION_TOKEN_MAX) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  let supplied
  try {
    supplied = base64UrlToBytes(parts[1])
  } catch (err) {
    return null
  }
  // 先验签再解析：不能让未签名的 payload 影响任何分支
  const expected = await signSession(key, parts[0])
  if (!bytesEqual(supplied, expected)) return null

  let payload
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])))
  } catch (err) {
    return null
  }
  if (!payload || payload.v !== 1) return null
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 80) return null
  if (!Number.isInteger(payload.ver) || payload.ver < 1) return null
  if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) return null
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp <= now) return null
  // 未来时间戳 = 时钟回拨或伪造：留 60 秒容差
  if (payload.iat > now + 60) return null
  // 有效期上限兜底：签名密钥泄漏后攻击者也无法签出「十年不过期」的会话
  if (payload.exp - payload.iat > SESSION_TTL_MAX) return null
  return payload
}

function newUserId() {
  return 'u_' + (crypto.randomUUID ? crypto.randomUUID() : bytesToBase64Url(randomBytes(16)))
}

/* 盐/哈希必须是可解码的 base64url，否则 verifyPassword 会抛未捕获异常导致登录 500 */
function isDecodableBase64Url(value) {
  if (typeof value !== 'string' || !value) return false
  try {
    base64UrlToBytes(value)
    return true
  } catch (err) {
    return false
  }
}

const ROLES = ['owner', 'member']

/* 节点范围只存节点 id：名称 / 服务器会变，id 才是稳定标识。
   读取 KV 时也走这里，因此对旧数据必须是宽松的（丢弃无法识别的项，而不是抛错）。 */
function sanitizeScope(input) {
  const out = { allNodes: false, nodeIds: [] }
  if (!input || typeof input !== 'object') return out
  out.allNodes = input.allNodes === true
  if (!Array.isArray(input.nodeIds)) return out
  const seen = new Set()
  for (const item of input.nodeIds) {
    if (typeof item !== 'string') continue
    const id = item.slice(0, 64)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.nodeIds.push(id)
    if (out.nodeIds.length >= MAX_NODES) break
  }
  return out
}

function validateScope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, '节点可用范围格式不正确', 'scope')
  }
  if (input.allNodes !== undefined && typeof input.allNodes !== 'boolean') {
    throw new HttpError(400, '节点可用范围格式不正确', 'scope')
  }
  if (input.nodeIds !== undefined && !Array.isArray(input.nodeIds)) {
    throw new HttpError(400, '节点可用范围格式不正确', 'scope')
  }
  return sanitizeScope(input)
}

function normalizeStoredUser(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('invalid user')
  // id 会拼进 KV 键（user_nodes:<id>）与订阅令牌：只允许安全字符并限长，
  // 避免手工写坏的 KV 记录产生超长键或带分隔符的键
  if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(raw.id)) throw new Error('invalid user id')
  if (typeof raw.username !== 'string' || !USERNAME_RE.test(raw.username)) throw new Error('invalid username')
  if (typeof raw.passwordSalt !== 'string' || typeof raw.passwordHash !== 'string') throw new Error('invalid password')
  if (!isDecodableBase64Url(raw.passwordSalt) || !isDecodableBase64Url(raw.passwordHash)) {
    throw new Error('invalid password encoding')
  }
  if (!Number.isFinite(raw.passwordIterations)) throw new Error('invalid password iterations')
  // 与 verifyPassword 使用同一区间，避免读路径和校验路径对同一条记录得出不同结论
  const iterations = raw.passwordIterations >= 1000 && raw.passwordIterations <= PASSWORD_ITERATIONS_MAX
    ? raw.passwordIterations
    : PASSWORD_ITERATIONS
  const version = Number.isFinite(raw.version) && raw.version > 0 ? raw.version : 1
  return {
    id: raw.id,
    username: raw.username,
    usernameKey: raw.username.toLowerCase(),
    passwordSalt: raw.passwordSalt,
    passwordHash: raw.passwordHash,
    passwordIterations: iterations,
    version,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    role: ROLES.includes(raw.role) ? raw.role : '',
    scope: raw.scope === undefined ? null : sanitizeScope(raw.scope),
  }
}

/* 升级迁移：旧记录没有 role，按「首个账号为所有者，其余为成员」处理。
   旧成员保留全部节点（升级不能突然掐断已有订阅），新成员由所有者显式分配。
   迁移只在内存中完成，下一次所有者写账号时自然落盘，读路径不产生 KV 写入。 */
function migrateUserRoles(users) {
  const hasOwner = users.some(user => user.role === 'owner')
  return users.map((user, index) => {
    const legacy = !user.role
    let role = legacy ? 'member' : user.role
    if (legacy && !hasOwner && index === 0) role = 'owner'
    let scope
    if (role === 'owner') scope = { allNodes: true, nodeIds: [] }
    else if (user.scope) scope = user.scope
    else scope = { allNodes: legacy, nodeIds: [] }
    return { ...user, role, scope }
  })
}

async function readUsersStore(env) {
  const kv = kvBinding(env)
  if (!kv) return { store: null, readonly: true, corrupted: false }

  let raw
  try {
    raw = await kv.get(USERS_KEY)
  } catch (err) {
    console.error('Users KV read failed:', err)
    throw new HttpError(502, '读取用户数据失败，请检查 KV 绑定')
  }
  if (!raw) return { store: null, readonly: false, corrupted: false }

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.users) || !parsed.users.length) throw new Error('empty users')
    if (typeof parsed.secret !== 'string' || base64UrlToBytes(parsed.secret).length < 16) {
      throw new Error('invalid session secret')
    }
    const users = migrateUserRoles(parsed.users.map(normalizeStoredUser))
    return {
      store: {
        v: 1,
        rev: Number.isFinite(parsed.rev) ? parsed.rev : 1,
        secret: parsed.secret,
        users,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      },
      readonly: false,
      corrupted: false,
    }
  } catch (err) {
    console.error('Users store corrupted:', err)
    return { store: null, readonly: false, corrupted: true }
  }
}

async function writeUsersStore(env, store) {
  const kv = kvBinding(env)
  if (!kv) throw new HttpError(503, '尚未绑定 KV 存储，无法保存用户')
  try {
    await kv.put(USERS_KEY, JSON.stringify(store))
  } catch (err) {
    console.error('Users KV write failed:', err)
    throw new HttpError(502, '写入用户数据失败，请稍后重试')
  }
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
    role: user.role,
    scope: { allNodes: user.scope.allNodes, nodeIds: user.scope.nodeIds.slice() },
  }
}

/* 账号接口共用：区分「没绑 KV」「还没初始化」「数据损坏」三种状态，
   损坏时不能像未初始化那样提示用户去创建账号，否则会误导成可以覆盖原数据 */
function usersStoreError(result) {
  if (result.store) return null
  if (result.corrupted) {
    return json({ error: '用户数据已损坏，请在 Cloudflare KV 中修复或删除 users 记录后再操作', corrupted: true }, 409)
  }
  if (result.readonly) {
    return json({ error: '尚未绑定 KV 存储，无法管理账号' }, 503)
  }
  return json({ error: '控制台尚未初始化' }, 409)
}

function usersResponse(store, principal) {
  return {
    users: store.users.map(publicUser),
    rev: store.rev,
    currentUserId: principal && principal.userId ? principal.userId : null,
    maxUsers: MAX_USERS,
  }
}

/* 恢复令牌爆破计数用的虚拟用户名（与登录限流共用桶，但独立计数） */
const RECOVERY_RATE_KEY = '__recovery__'

/* 会话令牌形如 base64url.base64url；恢复令牌与订阅令牌都没有点 */
function looksLikeSessionToken(value) {
  const parts = String(value || '').split('.')
  return parts.length === 2 &&
    /^[A-Za-z0-9_-]+$/.test(parts[0]) &&
    /^[A-Za-z0-9_-]+$/.test(parts[1])
}

/* 每个成员一条独立订阅链接：令牌由账号 id + 版本派生，改密（version+1）即失效。
   服务端不需要额外存储，也无法从令牌反推出其他账号的链接。 */
async function deriveSubscriptionToken(user, secret) {
  const signature = await hmacSign(secret, `sub|${user.id}|${user.version}`)
  const idPart = bytesToBase64Url(new TextEncoder().encode(user.id))
  return 'sub_' + idPart + '.' + bytesToBase64Url(signature)
}

function isOwner(principal) {
  return !!principal && principal.role === 'owner'
}

function requireOwner(principal, message) {
  if (!isOwner(principal)) throw new HttpError(403, message || '只有所有者可以执行此操作')
}

/* 成员的控制台与订阅都只包含其可用节点；所有者（及全局订阅令牌）不受限制。
   defaults 里放的是所有者自己的预设凭据（VLESS UUID / Reality 公钥 / 回落域名），
   成员拿着没有任何正当用途，却等于白送一份可用凭据，因此对成员一律清空。
   regionOrder 也按过滤后的节点集重建，避免把 scope 之外节点的 id 一起下发。 */
function filterConfigForPrincipal(config, principal) {
  if (!principal || isOwner(principal)) return config
  const scope = principal.scope || { allNodes: false, nodeIds: [] }
  let nodes = config.nodes
  if (!scope.allNodes) {
    const allowed = new Set(scope.nodeIds)
    nodes = config.nodes.filter(node => allowed.has(node.id))
  }
  return {
    ...config,
    nodes,
    defaults: {},
    regionOrder: reconcileRegionOrder(config.regionOrder, nodes, resolveGroups(config)),
  }
}

async function authenticateRequest(request, env) {
  const supplied = bearerToken(request)
  if (!supplied) return null

  const dedicated = dedicatedAdminToken(env)
  if (dedicated) {
    if (tokenEqual(supplied, dedicated)) {
      clearLoginFailures(request, RECOVERY_RATE_KEY)
      return {
        kind: 'recovery',
        username: '部署恢复令牌',
        userId: null,
        user: null,
        role: 'owner',
        scope: { allNodes: true, nodeIds: [] },
      }
    }
    // 既不是恢复令牌、也不像会话令牌：按恢复通道爆破处理（8 次 / 10 分钟）
    if (!looksLikeSessionToken(supplied)) {
      const limited = checkLoginRateLimit(request, RECOVERY_RATE_KEY)
      if (limited) throw new HttpError(429, '尝试次数过多，请稍后再试')
      recordLoginFailure(request, RECOVERY_RATE_KEY)
    }
  }

  /* 形态不符的 Bearer（随手一串字符）在读 KV 之前就否掉：
     否则每个未鉴权请求都会换来一次 KV 读 + 一次 HMAC，等于把
     「不需要凭据」的路径变成可放大的 IO 成本。 */
  if (supplied.length > SESSION_TOKEN_MAX || !looksLikeSessionToken(supplied)) return null

  const { store } = await readUsersStore(env)
  if (!store) return null
  const payload = await verifySessionToken(supplied, sessionKey(store, env))
  if (!payload) return null
  const user = store.users.find(item => item.id === payload.sub)
  if (!user || Number(payload.ver) !== user.version) return null
  return {
    kind: 'session',
    username: user.username,
    userId: user.id,
    user,
    role: user.role,
    scope: user.scope,
    subscriptionToken: user.role === 'member'
      ? await deriveSubscriptionToken(user, store.secret)
      : null,
  }
}

/* 成员订阅令牌：sub_<base64url(userId)>.<签名>。
   带上 userId 后校验只需一次 HMAC + 一次查表，不再「遍历全部账号逐个比对」——
   未鉴权请求无法用合法前缀放大 CPU，也不再有「哪个账号匹配」的时序信号。
   不带 userId 的旧格式（sub_<签名>）仍然接受，改密后自然轮换到新格式。 */
async function matchSubscriptionToken(token, store) {
  const body = token.slice('sub_'.length)
  const dot = body.indexOf('.')
  if (dot > 0) {
    let userId
    try {
      userId = new TextDecoder().decode(base64UrlToBytes(body.slice(0, dot)))
    } catch (err) {
      return null
    }
    const user = store.users.find(item => item.id === userId)
    if (!user) return null
    const candidate = await deriveSubscriptionToken(user, store.secret)
    return tokenEqual(token, candidate) ? user : null
  }
  // 旧格式：逐账号比较且不提前退出，保持原有的时序特征
  let matched = null
  for (const user of store.users) {
    const candidate = await deriveSubscriptionToken(user, store.secret)
    if (tokenEqual(token, candidate)) matched = user
  }
  return matched
}

async function subscriptionAccess(env, token) {
  // 长度先兜底：超长令牌必然无效，没必要为它读一次 KV（未鉴权请求的可控成本）
  if (typeof token !== 'string' || !token || token.length > AUTH_TOKEN_MAX) return null
  const config = (await readConfig(env)).config
  const expected = effectiveAuthToken(config, env)
  if (expected && tokenEqual(token, expected)) return { config }
  if (!token.startsWith('sub_')) return null

  const { store } = await readUsersStore(env)
  if (!store) return null
  const matched = await matchSubscriptionToken(token, store)
  if (!matched) return null
  const base = filterConfigForPrincipal(config, { role: matched.role, scope: matched.scope })
  if (matched.role === 'owner') return { config: base }
  const personal = await readPersonalNodes(env, matched.id, resolveGroups(config))
  return {
    config: personal.nodes.length || personal.groups.length ? applyPersonal(base, personal) : base,
  }
}

/* ------------------------------------------------------------------ */
/* storage                                                             */
/* ------------------------------------------------------------------ */

function kvBinding(env) {
  const kv = env && env.SUB_KV
  return kv && typeof kv.get === 'function' && typeof kv.put === 'function' ? kv : null
}

function emptyConfig() {
  return {
    v: 1,
    rev: 0,
    updatedAt: null,
    groups: defaultGroups(),
    nodes: [],
    defaults: {},
    regionOrder: {},
    subscription: {},
    authToken: '',
    providerBase: '',
  }
}

const PROVIDER_BASE_DEFAULT = 'https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release'

/* rule-providers 的镜像前缀：允许换成自建 / 国内可达的 CDN，空值用默认。
   只接受 https:// 开头、无空白与控制字符、无引号与反斜杠的短 URL，避免拼进 YAML 后破坏结构。
   `#` 会把该行后面的 `path:` / `interval:` 注释掉，`?` 之后的内容也不会参与取文件，
   两者都只会产出坏配置，直接拒掉。 */
function sanitizeProviderBase(input) {
  const value = typeof input === 'string' ? input.trim() : ''
  if (!value) return ''
  if (value.length > 256) return ''
  if (/[\s\u0000-\u001f\u007f"'\\#?]/.test(value)) return ''
  if (!/^https:\/\/[A-Za-z0-9._~:/@!$&*+,;=%-]+$/.test(value)) return ''
  return value.replace(/\/+$/, '')
}

function validateProviderBase(value) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw new HttpError(400, 'rule-providers 镜像地址格式不正确', 'providerBase')
  const cleaned = sanitizeProviderBase(value)
  if (!cleaned) {
    throw new HttpError(400, 'rule-providers 镜像地址需为 https:// 开头、不含空格与引号且不超过 256 个字符', 'providerBase')
  }
  return cleaned
}

function sanitizeDefaults(input) {
  const out = {}
  if (!input || typeof input !== 'object') return out
  const text = value => (typeof value === 'string' ? value.trim() : '')
  if (text(input.vlessUuid)) out.vlessUuid = text(input.vlessUuid)
  if (text(input.vlessPublicKey)) out.vlessPublicKey = text(input.vlessPublicKey)
  if (text(input.vlessShortId)) out.vlessShortId = text(input.vlessShortId)
  if (text(input.vlessServername)) {
    // 读路径也要拦：旧数据 / 手工改过的 KV 不能把含空白、引号或不可见字符的
    // SNI 原样回填进表单，否则等于绕过写路径的 hostValue 校验
    const sni = text(input.vlessServername)
    if (/^[A-Za-z0-9._%:\-\[\]]+$/.test(sni) && !FORMAT_CHARS_RE.test(sni)) out.vlessServername = sni
  }
  const port = Number(input.vlessPort)
  if (Number.isInteger(port) && port >= 1 && port <= 65535) out.vlessPort = port
  return out
}

/* ------------------------------------------------------------------ */
/* groups                                                              */
/* ------------------------------------------------------------------ */

function defaultGroups() {
  return DEFAULT_GROUPS.map(group => ({ id: group.id, name: group.name, icon: group.icon }))
}

/* 分组图标是可选的 https 图片地址，会原样拼进 YAML 的 icon 字段：
   只接受 https、无空白与控制字符、无引号反斜杠的短 URL，其余一律丢弃。 */
function sanitizeGroupIcon(input) {
  const value = typeof input === 'string' ? input.trim() : ''
  if (!value || value.length > 256) return ''
  if (/[\s\u0000-\u001f\u007f"'\\]/.test(value)) return ''
  if (!/^https:\/\/[A-Za-z0-9._~:/@!$&*+,;=%?#[\]-]+$/.test(value)) return ''
  return value
}

function validateGroupIcon(value) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw new HttpError(400, '分组图标格式不正确', 'groupIcon')
  const cleaned = sanitizeGroupIcon(value)
  if (!cleaned) {
    throw new HttpError(400, '分组图标需为 https:// 开头、不含空格与引号且不超过 256 个字符', 'groupIcon')
  }
  return cleaned
}

/* 读路径宽松：坏项逐条丢弃，id 与名称去重，超量截断，绝不抛错。
   KV 里被手工改坏或旧版本写入的分组不能把整份订阅拖成 500。 */
function sanitizeGroups(input) {
  if (!Array.isArray(input)) return []
  const out = []
  const ids = new Set()
  const names = new Set()
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    if (typeof raw.id !== 'string' || !GROUP_ID_RE.test(raw.id)) continue
    if (typeof raw.name !== 'string') continue
    const name = raw.name.trim()
    if (!name || name.length > GROUP_NAME_MAX) continue
    if (/[\u0000-\u001f\u007f]/.test(name) || FORMAT_CHARS_RE.test(name)) continue
    const nameKey = name.toLowerCase()
    if (ids.has(raw.id) || names.has(nameKey)) continue
    ids.add(raw.id)
    names.add(nameKey)
    out.push({ id: raw.id, name, icon: sanitizeGroupIcon(raw.icon) })
    if (out.length >= MAX_GROUPS) break
  }
  return out
}

/* 没有分组配置（首次部署 / 旧版本数据）时回落到内置四组，
   保证升级后订阅输出与升级前逐字一致。 */
function resolveGroups(config) {
  const clean = sanitizeGroups(config && config.groups)
  return clean.length ? clean : defaultGroups()
}

/* 写路径严格：名称必填、不重名、不与策略组 / 应用组 / 内置策略冲突，
   id 不合法或重复时重新生成（前端新建分组不必自己造 id）。 */
function validateGroups(input) {
  if (!Array.isArray(input)) throw new HttpError(400, '分组数据格式不正确', 'groups')
  // 空分组表会被读路径回落到内置四组，等于「删了又回来」：直接拒绝，避免这种半生效状态
  if (!input.length) throw new HttpError(400, '至少需要保留一个分组', 'groups')
  if (input.length > MAX_GROUPS) throw new HttpError(400, `分组数量不能超过 ${MAX_GROUPS} 个`, 'groups')
  const out = []
  const ids = new Set()
  const names = new Set()
  input.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new HttpError(400, `第 ${index + 1} 个分组数据无效`, 'groups')
    }
    const name = requireString(raw.name, 'groupName', '分组名称', GROUP_NAME_MAX)
    if (FORMAT_CHARS_RE.test(name)) throw new HttpError(400, '分组名称不能包含不可见控制字符', 'groupName')
    if (RESERVED_GROUP_NAMES.has(name)) {
      throw new HttpError(400, `分组名称「${name}」与内置策略或应用策略组冲突`, 'groupName')
    }
    const nameKey = name.toLowerCase()
    if (names.has(nameKey)) throw new HttpError(400, `分组名称「${name}」重复`, 'groupName')
    names.add(nameKey)
    let id = typeof raw.id === 'string' && GROUP_ID_RE.test(raw.id) ? raw.id : ''
    if (!id || ids.has(id)) {
      do { id = 'g_' + crypto.randomUUID() } while (ids.has(id))
    }
    ids.add(id)
    out.push({ id, name, icon: validateGroupIcon(raw.icon) })
  })
  return out
}

/* 成员分组：只存在于 user_nodes:<id> 里，和共享分组合并后进入该成员的订阅。
   写路径和所有者分组一样严格：名称必填、不重名、不占用内置策略名，
   另外还不能与共享分组重名 —— 两组合并后同名策略组会让整份 YAML 失效。 */
function validateMemberGroups(input, ownerGroups) {
  if (!Array.isArray(input)) throw new HttpError(400, '分组数据格式不正确', 'groups')
  if (input.length > MAX_MEMBER_GROUPS) {
    throw new HttpError(400, `个人分组数量不能超过 ${MAX_MEMBER_GROUPS} 个`, 'groups')
  }
  const ownerIds = new Set((ownerGroups || []).map(group => group.id))
  const ownerNames = new Set((ownerGroups || []).map(group => group.name.toLowerCase()))
  const out = []
  const ids = new Set()
  const names = new Set()
  input.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new HttpError(400, `第 ${index + 1} 个分组数据无效`, 'groups')
    }
    const name = requireString(raw.name, 'groupName', '分组名称', GROUP_NAME_MAX)
    if (FORMAT_CHARS_RE.test(name)) throw new HttpError(400, '分组名称不能包含不可见控制字符', 'groupName')
    if (RESERVED_GROUP_NAMES.has(name)) {
      throw new HttpError(400, `分组名称「${name}」与内置策略或应用策略组冲突`, 'groupName')
    }
    const nameKey = name.toLowerCase()
    if (ownerNames.has(nameKey)) {
      throw new HttpError(400, `分组名称「${name}」与共享分组重复`, 'groupName')
    }
    if (names.has(nameKey)) throw new HttpError(400, `分组名称「${name}」重复`, 'groupName')
    names.add(nameKey)
    let id = typeof raw.id === 'string' && MEMBER_GROUP_ID_RE.test(raw.id) ? raw.id : ''
    if (!id || ids.has(id) || ownerIds.has(id)) {
      do { id = 'mg_' + crypto.randomUUID() } while (ids.has(id) || ownerIds.has(id))
    }
    ids.add(id)
    out.push({ id, name, icon: validateGroupIcon(raw.icon) })
  })
  return out
}

/* 读路径宽松：坏项逐条丢弃，不抛错。与共享分组同名 / 同 id 的个人分组直接忽略，
   避免手工改过的 KV 把两份同名策略组拼进同一份订阅。 */
function normalizeMemberGroups(input, ownerGroups) {
  if (!Array.isArray(input)) return []
  const ownerIds = new Set((ownerGroups || []).map(group => group.id))
  const ownerNames = new Set((ownerGroups || []).map(group => group.name.toLowerCase()))
  const out = []
  const ids = new Set()
  const names = new Set()
  for (const raw of input.slice(0, MAX_MEMBER_GROUPS)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    if (typeof raw.id !== 'string' || !GROUP_ID_RE.test(raw.id) || ids.has(raw.id) || ownerIds.has(raw.id)) continue
    if (typeof raw.name !== 'string') continue
    const name = raw.name.trim()
    if (!name || name.length > GROUP_NAME_MAX) continue
    if (/[\u0000-\u001f\u007f]/.test(name) || FORMAT_CHARS_RE.test(name)) continue
    if (RESERVED_GROUP_NAMES.has(name)) continue
    const nameKey = name.toLowerCase()
    if (names.has(nameKey) || ownerNames.has(nameKey)) continue
    ids.add(raw.id)
    names.add(nameKey)
    out.push({ id: raw.id, name, icon: sanitizeGroupIcon(raw.icon) })
  }
  return out
}

/* 共享分组在前，个人分组在后：所有者调整顺序时成员侧跟着变，
   成员自己的分组顺序则只由他自己决定。 */
function mergeGroups(baseGroups, extraGroups) {
  if (!Array.isArray(extraGroups) || !extraGroups.length) return baseGroups
  const ids = new Set(baseGroups.map(group => group.id))
  const names = new Set(baseGroups.map(group => group.name.toLowerCase()))
  const out = baseGroups.slice()
  for (const group of extraGroups) {
    const nameKey = group.name.toLowerCase()
    if (ids.has(group.id) || names.has(nameKey)) continue
    ids.add(group.id)
    names.add(nameKey)
    out.push(group)
  }
  return out
}

/* 节点所属分组：只认分组表里存在的 id，其余（含已删除的分组）归入「未分组」。
   groupId 缺失时回落到旧版的 region 字段，历史节点因此无需迁移。 */
function nodeGroupId(raw, groups) {
  if (!raw || typeof raw !== 'object') return ''
  const candidate = typeof raw.groupId === 'string'
    ? raw.groupId.trim()
    : (typeof raw.region === 'string' ? raw.region.trim() : '')
  if (!candidate || !GROUP_ID_RE.test(candidate)) return ''
  if (Array.isArray(groups) && !groups.some(group => group.id === candidate)) return ''
  return candidate
}

/* Clash 要求 proxy 名与 proxy-group 名不能相同：同名节点会被客户端判为配置错误。
   写入路径两侧都校验，渲染路径再兜一层（成员的个人节点可能绕过分组校验）。 */
function policyGroupNames(config) {
  const names = new Set([MAIN_GROUP])
  APP_GROUPS.forEach(app => names.add(app.name))
  resolveGroups(config).forEach(group => names.add(group.name))
  return names
}

const MAX_TOTAL_GB = 1048576
const AUTH_TOKEN_MIN = 16
const AUTH_TOKEN_MAX = 256
const ADMIN_TOKEN_MIN = 16

/* 会话有效期：默认 7 天，可用 SESSION_TTL_HOURS 缩短（1-168 小时）。
   verifySessionToken 始终按 SESSION_TTL_MAX 兜底，因此调小配置不会让已签发的
   旧令牌「超长有效」——它们仍然会在自己的 exp 到期后失效。 */
const SESSION_TTL_HOURS_DEFAULT = 168
const SESSION_TTL_HOURS_MIN = 1
const SESSION_TTL_HOURS_MAX = 168
const SESSION_TTL_MAX = SESSION_TTL_HOURS_MAX * 60 * 60

/* 会话令牌的形态上限：payload + 签名远小于这个值，超出必然是垃圾输入 */
const SESSION_TOKEN_MAX = 512

/* 双向控制符 / 零宽字符：会让「节点名」「用户名」在界面上显示成另一串字符
   （例如用 RLO 把 evil.com 伪装成 moc.live），除了欺骗审核者没有正当用途 */
const FORMAT_CHARS_RE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/

let warnedStoredAuthToken = false

function storedAuthToken(config) {
  const value = config && config.authToken
  if (typeof value !== 'string') return ''
  const token = value.trim()
  if (!token) return ''
  // 写路径有 16 位下限，读路径也必须一致：否则 KV 被改坏（或被旧版本写短）
  // 之后，一个几位的令牌就能拉走整份订阅
  if (token.length < AUTH_TOKEN_MIN || token.length > AUTH_TOKEN_MAX || /[\s\u0000-\u001f\u007f]/.test(token)) {
    if (!warnedStoredAuthToken) {
      warnedStoredAuthToken = true
      console.warn(`KV 中的订阅令牌不符合 ${AUTH_TOKEN_MIN}-${AUTH_TOKEN_MAX} 位且不含空白的规则，已忽略；请在设置页重新生成`)
    }
    return ''
  }
  return token
}

function validateAuthToken(value) {
  if (typeof value !== 'string') throw new HttpError(400, '订阅令牌格式不正确', 'authToken')
  const token = value.trim()
  if (!token) return ''
  // 掩码字符不可能是合法令牌：避免前端把「••••abcd」原样回传，把订阅链接改掉
  // 放在长度校验之前，无论掩码多长都能给出可执行的提示
  if (token.includes('•')) {
    throw new HttpError(400, '订阅令牌不能包含掩码字符，请填写完整令牌', 'authToken')
  }
  if (token.length < AUTH_TOKEN_MIN) {
    throw new HttpError(400, `订阅令牌至少需要 ${AUTH_TOKEN_MIN} 个字符`, 'authToken')
  }
  if (token.length > AUTH_TOKEN_MAX) {
    throw new HttpError(400, `订阅令牌不能超过 ${AUTH_TOKEN_MAX} 个字符`, 'authToken')
  }
  if (/[\s\u0000-\u001f\u007f]/.test(token)) {
    throw new HttpError(400, '订阅令牌不能包含空格或控制字符', 'authToken')
  }
  return token
}

// 订阅信息只用于客户端展示（流量条 / 到期提示），留空则不发送相应响应头
function sanitizeSubscription(input) {
  const out = {}
  if (!input || typeof input !== 'object') return out
  const total = Number(input.totalGB)
  if (Number.isFinite(total) && total > 0) {
    out.totalGB = Math.min(Math.round(total * 100) / 100, MAX_TOTAL_GB)
  }
  if (typeof input.expire === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.expire)) {
    const time = Date.parse(`${input.expire}T23:59:59Z`)
    // 上限 2100 年：避免手滑写成 9999 后客户端把「到期」显示成永不过期
    if (Number.isFinite(time) && time <= Date.UTC(2100, 11, 31)) out.expire = input.expire
  }
  return out
}

async function readConfig(env, options = {}) {
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
    // 只有写路径才落盘：订阅与伪装页这类未鉴权的读请求不应该产生 KV 写入
    if (options.seed) {
      try {
        await kv.put(CONFIG_KEY, JSON.stringify(seeded))
      } catch (err) {
        console.error('KV seed failed:', err)
        throw new HttpError(502, '初始化 KV 失败，请检查 SUB_KV 绑定是否正常')
      }
    }
    return { config: seeded, readonly: false, corrupted: false }
  }

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.nodes)) throw new Error('invalid config shape')
    /* 元素级兜底：旧版本写入、手工编辑或并发写入都可能留下 null / 非对象元素，
       只判断「是不是数组」不够——buildYaml 里一句 node.enabled 就会让整条订阅 500。
       坏元素直接丢弃，渲染层（isRenderableNode）再兜一层字段级校验。 */
    const groups = resolveGroups(parsed)
    const nodes = parsed.nodes
      .filter(node => node && typeof node === 'object' && !Array.isArray(node))
      /* 旧数据只有 region：读出来就折成 groupId，写路径与渲染路径因此只需要认一个字段 */
      .map(node => {
        const { region, ...rest } = node
        return { ...rest, groupId: nodeGroupId(node, groups) }
      })
    return {
      config: {
        v: 1,
        rev: Number.isFinite(parsed.rev) ? parsed.rev : 1,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
        groups,
        nodes,
        defaults: sanitizeDefaults(parsed.defaults),
        regionOrder: reconcileRegionOrder(parsed.regionOrder, nodes, groups),
        subscription: sanitizeSubscription(parsed.subscription),
        authToken: storedAuthToken(parsed),
        providerBase: sanitizeProviderBase(parsed.providerBase),
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

function personalNodesKey(userId) {
  return PERSONAL_KEY_PREFIX + userId
}

/* 读路径同样不信任 KV：逐条过一遍写入校验，坏数据只丢该条，
   不会让某个成员的个人节点把整份订阅拖成 500。 */
function normalizePersonalNodes(input) {
  if (!Array.isArray(input)) return []
  const ids = new Set()
  const names = new Set()
  const out = []
  for (const raw of input.slice(0, MAX_PERSONAL_NODES)) {
    if (!raw || typeof raw !== 'object') continue
    if (typeof raw.id !== 'string' || !PERSONAL_ID_RE.test(raw.id) || ids.has(raw.id)) continue
    const nameKey = typeof raw.name === 'string' ? raw.name.trim().toLowerCase() : ''
    if (!nameKey || names.has(nameKey)) continue
    let node
    try {
      node = validateNodes([{ ...raw, id: raw.id }])[0]
    } catch (err) {
      continue
    }
    ids.add(node.id)
    names.add(nameKey)
    out.push(node)
  }
  return out
}

/* ownerGroups 只用于个人分组的重名 / 同 id 判定：读路径拿不到时可以省略，
   mergeGroups 在合并阶段还会再挡一次，行为不会因此变得不安全。 */
async function readPersonalNodes(env, userId, ownerGroups) {
  const empty = { nodes: [], groups: [], rev: 0, corrupted: false }
  if (!userId) return empty
  const kv = kvBinding(env)
  if (!kv) return empty

  let raw
  try {
    raw = await kv.get(personalNodesKey(userId))
  } catch (err) {
    console.error('Personal nodes read failed:', err)
    return { ...empty, corrupted: true }
  }
  if (!raw) return empty

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.nodes)) throw new Error('invalid personal node store')
    return {
      nodes: normalizePersonalNodes(parsed.nodes),
      groups: normalizeMemberGroups(parsed.groups, ownerGroups),
      rev: Number.isFinite(parsed.rev) ? parsed.rev : 1,
      corrupted: false,
    }
  } catch (err) {
    console.error('Personal nodes corrupted:', err)
    return { ...empty, corrupted: true }
  }
}

async function writePersonalNodes(env, userId, store) {
  const kv = kvBinding(env)
  if (!kv) throw new HttpError(503, '尚未绑定 KV 存储，无法保存')
  try {
    await kv.put(personalNodesKey(userId), JSON.stringify(store))
  } catch (err) {
    console.error('Personal nodes write failed:', err)
    throw new HttpError(502, '写入 KV 失败，请稍后重试')
  }
}

async function deletePersonalNodes(env, userId) {
  const kv = kvBinding(env)
  if (!kv || !userId || typeof kv.delete !== 'function') return
  try {
    await kv.delete(personalNodesKey(userId))
  } catch (err) {
    // 账号已经删掉，残留键不可再被任何会话读取；清理失败只记日志
    console.warn('Personal nodes cleanup failed:', err)
  }
}

/* 个人节点追加在管理员节点之后；名称冲突时加后缀而不是覆盖，
   因为管理员可能事后新增了同名节点，这时不能让某个成员的订阅因重名而失效。 */
function mergePersonalNodes(baseNodes, personalNodes) {
  if (!personalNodes.length) return baseNodes
  const ids = new Set(baseNodes.map(node => node.id))
  const names = new Set(baseNodes.map(node => node.name.toLowerCase()))
  const merged = []
  for (const node of personalNodes) {
    let id = node.id
    while (ids.has(id)) id = 'p_' + crypto.randomUUID()
    let name = node.name
    if (names.has(name.toLowerCase())) {
      const root = `${node.name} · 个人`.slice(0, 80)
      name = root
      let index = 2
      while (names.has(name.toLowerCase())) {
        const suffix = ` (${index})`
        name = root.slice(0, 80 - suffix.length) + suffix
        index += 1
      }
    }
    ids.add(id)
    names.add(name.toLowerCase())
    merged.push(id === node.id && name === node.name ? node : { ...node, id, name })
  }
  return baseNodes.concat(merged)
}

/* 个人节点与个人分组合并进成员视图：三处读路径（配置 / 预览 / 订阅）共用，
   避免「控制台看得到、订阅里没有」这类漂移。 */
function applyPersonal(config, personal) {
  const groups = mergeGroups(
    Array.isArray(config.groups) && config.groups.length ? config.groups : defaultGroups(),
    personal && personal.groups
  )
  const nodes = mergePersonalNodes(config.nodes, (personal && personal.nodes) || [])
  return {
    ...config,
    groups,
    nodes,
    regionOrder: reconcileRegionOrder(config.regionOrder, nodes, groups),
  }
}

/* 成员的可用节点 = 管理员分配的节点 + 自己的个人节点。
   所有读路径（配置、预览、订阅）都走这里，避免三处行为漂移。 */
async function configForPrincipal(env, config, principal) {
  const filtered = filterConfigForPrincipal(config, principal)
  if (!principal || isOwner(principal) || !principal.userId) return { config: filtered, personal: null }
  const personal = await readPersonalNodes(env, principal.userId, resolveGroups(config))
  if (!personal.nodes.length && !personal.groups.length) return { config: filtered, personal }
  return { config: applyPersonal(filtered, personal), personal }
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
  if (FORMAT_CHARS_RE.test(text)) throw new HttpError(400, `${label}包含不可见控制字符`, field)
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

/* 每个分组一条独立的节点顺序表，键就是分组 id（内置组沿用 us / jp / hk / relay）。
   键形态不合法的直接丢弃：它不可能匹配到任何分组，只会白占 KV 体积。 */
function sanitizeRegionOrder(input) {
  const out = {}
  if (!input || typeof input !== 'object') return out
  Object.keys(input).slice(0, MAX_GROUPS * 2).forEach(id => {
    if (!GROUP_ID_RE.test(id)) return
    const arr = input[id]
    if (!Array.isArray(arr)) return
    const seen = new Set()
    const clean = []
    arr.forEach(nodeId => {
      if (typeof nodeId === 'string' && nodeId && !seen.has(nodeId)) {
        seen.add(nodeId)
        clean.push(nodeId)
      }
    })
    if (clean.length) out[id] = clean
  })
  return out
}

// 按当前分组与节点名单整理顺序：剔除已删除分组 / 已删除节点 / 已换组的 id，
// 未收录的本组节点按全局顺序追加到末尾
function reconcileRegionOrder(stored, nodes, groups) {
  const list = Array.isArray(groups) && groups.length ? groups : defaultGroups()
  const clean = sanitizeRegionOrder(stored)
  const byGroup = {}
  list.forEach(group => { byGroup[group.id] = [] })
  nodes.forEach(node => {
    const id = nodeGroupId(node, list)
    if (id && byGroup[id]) byGroup[id].push(node.id)
  })
  const out = {}
  list.forEach(group => {
    const members = new Set(byGroup[group.id])
    const seen = new Set()
    const arr = []
    ;(clean[group.id] || []).forEach(id => {
      if (members.has(id) && !seen.has(id)) {
        seen.add(id)
        arr.push(id)
      }
    })
    byGroup[group.id].forEach(id => {
      if (!seen.has(id)) {
        seen.add(id)
        arr.push(id)
      }
    })
    if (arr.length) out[group.id] = arr
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
  const rawPort = input && typeof input === 'object' ? input.vlessPort : undefined
  if (rawPort !== undefined && rawPort !== null && rawPort !== '' && cleaned.vlessPort === undefined) {
    throw new HttpError(400, '预设端口需为 1–65535 的整数', 'defaults.vlessPort')
  }
  return cleaned
}

/* options.groups：当前分组表。传入时 groupId 只接受表内 id（未知值折成未分组），
   节点名也不允许与分组同名 —— Clash 里 proxy 与 proxy-group 同名会让整份配置失效。 */
function validateNodes(input, options = {}) {
  if (!Array.isArray(input)) throw new HttpError(400, '节点数据格式不正确')
  if (input.length > MAX_NODES) throw new HttpError(400, `节点数量不能超过 ${MAX_NODES} 个`)

  const allowedFingerprints = FINGERPRINTS
  const allowedNetworks = NETWORKS
  const allowedCiphers = CIPHERS
  const groups = Array.isArray(options.groups) ? options.groups : null
  const groupNames = new Set()
  if (groups) groups.forEach(group => groupNames.add(group.name.toLowerCase()))
  const ids = new Set()
  const names = new Set()
  const nodes = []

  input.forEach((raw, index) => {
    const seq = index + 1
    if (!raw || typeof raw !== 'object') throw new HttpError(400, `第 ${seq} 个节点数据无效`)

    const name = requireString(raw.name, 'name', '节点名称', 80)
    if (FORMAT_CHARS_RE.test(name)) {
      throw new HttpError(400, '节点名称不能包含不可见控制字符', 'name')
    }
    if (RESERVED_NAMES.has(name)) {
      throw new HttpError(400, `节点名称「${name}」与策略组或内置策略冲突`, 'name')
    }
    if (groupNames.has(name.toLowerCase())) {
      throw new HttpError(400, `节点名称「${name}」与分组同名，客户端会解析失败`, 'name')
    }
    const nameKey = name.toLowerCase()
    if (names.has(nameKey)) throw new HttpError(400, `节点名称「${name}」重复`, 'name')
    names.add(nameKey)

    const type = TYPES.includes(raw.type) ? raw.type : ''
    if (!type) throw new HttpError(400, `节点「${name}」的协议类型不受支持`, 'type')
    const server = hostValue(raw.server, 'server', '服务器地址', { required: true })
    const port = portValue(raw.port)
    const groupId = nodeGroupId(raw, groups)
    const tags = Array.isArray(raw.tags)
      ? [...new Set(raw.tags.filter(tag => TAGS.includes(tag)))]
      : []
    const enabled = raw.enabled !== false
    const showInMain = raw.showInMain !== false

    let id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : ''
    if (!id || ids.has(id)) id = 'n_' + crypto.randomUUID()
    ids.add(id)

    const node = { id, name, type, server, port, groupId, enabled, showInMain, tags }

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
      // 默认校验证书：跳过校验只应由用户在抽屉里显式打开（自签 / 测试场景）
      node.skipCertVerify = boolValue(raw.skipCertVerify)
      node.udp = boolValue(raw.udp, true)
    } else if (type === 'hysteria2') {
      node.password = requireString(raw.password, 'password', '密码', 128)
      node.sni = hostValue(raw.sni, 'sni', 'SNI')
      node.skipCertVerify = boolValue(raw.skipCertVerify)
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
  if (path === '/api/auth') {
    if (request.method !== 'GET') return json({ error: '不支持的请求方法' }, 405)
    return await apiAuthStatus(env)
  }

  if (path === '/api/setup') {
    if (request.method !== 'POST') return json({ error: '不支持的请求方法' }, 405)
    return await apiSetup(request, env)
  }

  if (path === '/api/login') {
    if (request.method !== 'POST') return json({ error: '不支持的请求方法' }, 405)
    return await apiLogin(request, env)
  }

  const principal = await authenticateRequest(request, env)
  if (!principal) {
    return json({ error: '登录已失效，请重新登录' }, 401)
  }

  if (path === '/api/config') {
    if (request.method === 'GET') {
      const result = await readConfig(env)
      const view = await configForPrincipal(env, result.config, principal)
      return json({
        config: publicConfig(view.config),
        meta: await buildMeta(url, result, env, principal, view.personal),
      })
    }
    if (request.method === 'PUT') {
      requireOwner(principal)
      return await apiSave(request, url, env, principal)
    }
    return json({ error: '不支持的请求方法' }, 405)
  }

  if (path === '/api/nodes') {
    if (request.method !== 'PUT') return json({ error: '不支持的请求方法' }, 405)
    return await apiSavePersonalNodes(request, url, env, principal)
  }

  if (path === '/api/password') {
    if (request.method !== 'POST') return json({ error: '不支持的请求方法' }, 405)
    return await apiChangePassword(request, env, principal)
  }

  if (path === '/api/users' || path === '/api/users/update' || path === '/api/users/delete') {
    requireOwner(principal)
    return await apiUsers(request, path, env, principal)
  }

  if (path === '/api/preview') {
    if (request.method !== 'GET') return json({ error: '不支持的请求方法' }, 405)
    let result
    try {
      result = await readConfig(env)
    } catch (err) {
      result = { config: emptyConfig(), readonly: true, corrupted: false }
    }
    const view = await configForPrincipal(env, result.config, principal)
    return new Response(buildYaml(view.config), {
      headers: {
        ...baseHeaders(),
        'content-type': 'text/yaml;charset=UTF-8',
        'cache-control': 'no-store',
      },
    })
  }

  return json({ error: '接口不存在' }, 404)
}

async function apiAuthStatus(env) {
  const kv = !!kvBinding(env)
  let store = null
  let corrupted = false
  if (kv) {
    const result = await readUsersStore(env)
    store = result.store
    corrupted = !!result.corrupted
  }
  const recovery = !!dedicatedAdminToken(env)
  const openSetup = openSetupAllowed(env)
  return json({
    version: VERSION,
    kv,
    needsSetup: !store,
    // 初始化需要恢复令牌（配了 ADMIN_TOKEN 的实例）
    setupLocked: !store && recovery,
    // 初始化被完全拒绝：既没配 ADMIN_TOKEN，也没显式打开 ALLOW_OPEN_SETUP
    setupDisabled: !store && !recovery && !openSetup,
    recovery,
    allowOpenSetup: openSetup,
    corrupted,
    maxUsers: MAX_USERS,
  })
}

async function apiSetup(request, env) {
  const limited = checkLoginRateLimit(request, '__setup__')
  if (limited) return limited

  /* 闸门放在读请求体之前：被拒绝的请求不该消耗解析与校验成本，
     也不该通过错误码差异透露「这台实例到底能不能初始化」以外的东西。 */
  const result = await readUsersStore(env)
  if (result.store) return json({ error: '控制台已完成初始化，请直接登录' }, 409)
  // 用户库存在但解析失败：若放行初始化，任何访问者都能覆盖原数据并抢占管理员。
  // 恢复动作必须由持有 KV 写权限的人完成（删除 users 记录），而不是公开的 setup 接口。
  if (result.corrupted) {
    return json({
      error: '用户数据已损坏，出于安全考虑已阻止自动初始化。请先在 KV 中删除 users 记录，或使用 ADMIN_TOKEN 恢复后再初始化',
      corrupted: true,
    }, 409)
  }
  if (!kvBinding(env)) throw new HttpError(503, '尚未绑定 SUB_KV，无法创建管理员账号')

  const dedicated = dedicatedAdminToken(env)
  if (dedicated) {
    const supplied = bearerToken(request)
    if (!tokenEqual(supplied, dedicated)) {
      recordLoginFailure(request, '__setup__')
      return json({ error: '该实例已配置 ADMIN_TOKEN，请填写部署恢复令牌后再初始化', field: 'setupToken' }, 403)
    }
  } else if (!openSetupAllowed(env)) {
    // fail-closed：宁可不给部署者方便，也不能让任意访问者抢注所有者
    return json({
      error: '为避免实例被任意访问者抢占，初始化前请先在 Worker 的环境变量里配置 ADMIN_TOKEN（16 位以上随机字符串，建议写成 Secret），再打开本页初始化。确实需要开放初始化，可显式设置 ALLOW_OPEN_SETUP=1',
      setupDisabled: true,
    }, 503)
  }

  const body = await readJsonBody(request)
  const username = validateUsername(body.username)
  const password = validatePassword(body.password, username)

  const record = await buildPasswordRecord(password, passwordIterations(env))
  const user = {
    id: newUserId(),
    username,
    usernameKey: username.toLowerCase(),
    ...record,
    version: 1,
    createdAt: new Date().toISOString(),
    role: 'owner',
    scope: { allNodes: true, nodeIds: [] },
  }
  const store = {
    v: 1,
    rev: 1,
    secret: bytesToBase64Url(randomBytes(32)),
    users: [user],
    updatedAt: new Date().toISOString(),
  }
  await writeUsersStore(env, store)

  /* 走到这里说明没有 ADMIN_TOKEN（要么开了 ALLOW_OPEN_SETUP，要么从未配置）。
     提示一次，避免部署者误以为「已经安全」。 */
  if (!dedicated) {
    console.warn('控制台已通过开放初始化创建，但未配置 ADMIN_TOKEN：既没有忘记密码的恢复通道，也无法阻止后续的重复初始化尝试，建议立刻补一个 16 位以上的随机 Secret 并关闭 ALLOW_OPEN_SETUP')
  }

  // KV 没有条件写（CAS），并发初始化只能事后校验。新键的读是写后一致的，
  // 因此只有「读回来看见的正是别人刚建的那个账号」才能确定这次初始化输了，此时明确报错；
  // 读回为空（尚未同步 / 极端情况）不算失败，避免误伤正常的首次初始化。
  const verify = await readUsersStore(env)
  if (verify.store && verify.store.users.length && verify.store.users[0].id !== user.id) {
    console.error('Concurrent setup detected: admin created by another request wins for the reader')
    return json({
      error: '初始化已由另一个请求完成，请使用刚刚创建成功的账号登录；若无法登录在 KV 中删除 users 记录后重试',
      conflict: true,
    }, 409)
  }

  clearLoginFailures(request, '__setup__')

  const token = await createSessionToken(user, sessionKey(store, env), env)
  return json({ token, user: publicUser(user) })
}

async function apiLogin(request, env) {
  const body = await readJsonBody(request)
  // 先截断再进限流桶：否则超长用户名会按「每次不同」生成桶键，撑爆 isolate 内存
  const username = typeof body.username === 'string' ? body.username.trim().slice(0, USERNAME_MAX) : ''
  const password = typeof body.password === 'string' ? body.password : ''

  const limited = checkLoginRateLimit(request, username)
  if (limited) return limited

  const usersResult = await readUsersStore(env)
  if (!usersResult.store) {
    if (usersResult.corrupted) {
      return json({ error: '用户数据已损坏，无法登录。请在 Cloudflare KV 中修复或删除 users 记录', corrupted: true }, 500)
    }
    return json({ error: '控制台尚未初始化，请刷新页面创建管理员账号', needsSetup: true }, 403)
  }
  const store = usersResult.store

  const user = username
    ? store.users.find(item => item.usernameKey === username.toLowerCase())
    : null
  let ok = false
  if (user && password.length <= PASSWORD_MAX) {
    ok = await verifyPassword(password, user)
  } else {
    // 未知账号按库内最高迭代次数空转，避免响应时间暴露账号是否存在
    const rounds = store.users.reduce(
      (max, item) => Math.max(max, item.passwordIterations || PASSWORD_ITERATIONS),
      PASSWORD_ITERATIONS
    )
    await dummyPasswordCheck(password, rounds)
  }

  if (!ok) {
    recordLoginFailure(request, username)
    return json({ error: '用户名或密码不正确' }, 401)
  }
  clearLoginFailures(request, username)

  const token = await createSessionToken(user, sessionKey(store, env), env)
  return json({ token, user: publicUser(user) })
}

async function apiUsers(request, path, env, principal) {
  requireOwner(principal)
  if (path === '/api/users') {
    if (request.method === 'GET') {
      const result = await readUsersStore(env)
      if (!result.store) return usersStoreError(result)
      return json(usersResponse(result.store, principal))
    }
    if (request.method !== 'POST') return json({ error: '不支持的请求方法' }, 405)
    return await apiCreateUser(request, env, principal)
  }
  if (request.method !== 'POST') return json({ error: '不支持的请求方法' }, 405)
  if (path === '/api/users/update') return await apiUpdateUser(request, env, principal)
  return await apiDeleteUser(request, env, principal)
}

async function apiCreateUser(request, env, principal) {
  const body = await readJsonBody(request)
  const username = validateUsername(body.username)
  const password = validatePassword(body.password, username)
  const role = body.role === undefined ? 'member' : body.role
  if (!ROLES.includes(role)) throw new HttpError(400, '账号角色不正确', 'role')

  const result = await readUsersStore(env)
  if (!result.store) {
    if (result.readonly) throw new HttpError(503, '尚未绑定 KV 存储，无法创建用户')
    return usersStoreError(result)
  }
  const store = result.store
  if (body.rev !== undefined && Number(body.rev) !== store.rev) {
    return json({ error: '用户列表已在其他窗口更新，请刷新后重试', rev: store.rev }, 409)
  }
  if (store.users.length >= MAX_USERS) {
    return json({ error: `最多只能创建 ${MAX_USERS} 个用户` }, 400)
  }
  if (store.users.some(item => item.usernameKey === username.toLowerCase())) {
    return json({ error: '该用户名已存在', field: 'username' }, 400)
  }

  const record = await buildPasswordRecord(password, passwordIterations(env))
  const user = {
    id: newUserId(),
    username,
    usernameKey: username.toLowerCase(),
    ...record,
    version: 1,
    createdAt: new Date().toISOString(),
    role,
    // 新成员默认不分配节点；所有者天然拥有全部节点
    scope: role === 'owner' ? { allNodes: true, nodeIds: [] } : validateScope(body.scope || {}),
  }
  const next = {
    ...store,
    rev: store.rev + 1,
    users: store.users.concat(user),
    updatedAt: new Date().toISOString(),
  }
  await writeUsersStore(env, next)
  return json(usersResponse(next, principal))
}

async function apiUpdateUser(request, env, principal) {
  const body = await readJsonBody(request)
  const id = typeof body.id === 'string' ? body.id.slice(0, 64) : ''
  // 密码留空表示不修改（账号范围 / 角色的调整不应强制所有者重设密码）
  const password = body.password === undefined || body.password === null || body.password === ''
    ? ''
    : validatePassword(body.password, '')
  if (body.role !== undefined && !ROLES.includes(body.role)) {
    throw new HttpError(400, '账号角色不正确', 'role')
  }

  const usersResult = await readUsersStore(env)
  if (!usersResult.store) return usersStoreError(usersResult)
  const store = usersResult.store
  if (body.rev !== undefined && Number(body.rev) !== store.rev) {
    return json({ error: '用户列表已在其他窗口更新，请刷新后重试', rev: store.rev }, 409)
  }
  const target = store.users.find(item => item.id === id)
  if (!target) return json({ error: '用户不存在或已被删除' }, 404)

  const role = body.role === undefined ? target.role : body.role
  if (target.role === 'owner' && role !== 'owner'
    && store.users.filter(item => item.role === 'owner').length <= 1) {
    return json({ error: '至少需要保留一个所有者账号' }, 400)
  }
  let scope
  if (role === 'owner') {
    scope = { allNodes: true, nodeIds: [] }
  } else if (body.scope !== undefined) {
    scope = validateScope(body.scope)
  } else if (target.role === 'member') {
    scope = target.scope
  } else {
    // 从所有者降为成员且未指定范围：默认不分配节点，避免越权
    scope = { allNodes: false, nodeIds: [] }
  }

  let updated = { ...target, role, scope }
  if (password) {
    const record = await buildPasswordRecord(password, passwordIterations(env))
    updated = { ...updated, ...record, version: target.version + 1 }
  }
  const next = {
    ...store,
    rev: store.rev + 1,
    users: store.users.map(item => item.id === id ? updated : item),
    updatedAt: new Date().toISOString(),
  }
  await writeUsersStore(env, next)

  const response = usersResponse(next, principal)
  if (password && principal.kind === 'session' && principal.userId === id) {
    response.token = await createSessionToken(updated, sessionKey(next, env), env)
  }
  return json(response)
}

async function apiDeleteUser(request, env, principal) {
  const body = await readJsonBody(request)
  const id = typeof body.id === 'string' ? body.id.slice(0, 64) : ''

  const usersResult = await readUsersStore(env)
  if (!usersResult.store) return usersStoreError(usersResult)
  const store = usersResult.store
  if (body.rev !== undefined && Number(body.rev) !== store.rev) {
    return json({ error: '用户列表已在其他窗口更新，请刷新后重试', rev: store.rev }, 409)
  }
  const target = store.users.find(item => item.id === id)
  if (!target) return json({ error: '用户不存在或已被删除' }, 404)
  if (store.users.length <= 1) return json({ error: '至少需要保留一个管理员账号' }, 400)
  if (principal.kind === 'session' && principal.userId === id) {
    return json({ error: '不能删除当前登录账号，请使用其他账号操作' }, 400)
  }
  if (target.role === 'owner' && store.users.filter(item => item.role === 'owner').length <= 1) {
    return json({ error: '至少需要保留一个所有者账号' }, 400)
  }

  const next = {
    ...store,
    rev: store.rev + 1,
    users: store.users.filter(item => item.id !== id),
    updatedAt: new Date().toISOString(),
  }
  await writeUsersStore(env, next)
  await deletePersonalNodes(env, id)
  return json(usersResponse(next, principal))
}

/* 成员自助改密：需要当前密码，成功后 version+1。
   version 同时参与会话与账号订阅令牌的派生，因此旧登录与旧订阅链接会一起失效，
   响应里返回新的会话令牌，前端无需重新登录。 */
async function apiChangePassword(request, env, principal) {
  if (principal.kind !== 'session' || !principal.userId) {
    throw new HttpError(403, '部署恢复令牌无需修改密码')
  }
  const body = await readJsonBody(request)
  const current = typeof body.currentPassword === 'string' ? body.currentPassword : ''
  const nextPassword = validatePassword(body.newPassword, principal.username)

  const limitKey = '__password__|' + principal.username
  const limited = checkLoginRateLimit(request, limitKey)
  if (limited) return limited

  const result = await readUsersStore(env)
  if (!result.store) return usersStoreError(result)
  const store = result.store
  if (body.rev !== undefined && Number(body.rev) !== store.rev) {
    return json({ error: '账号信息已在其他窗口更新，请刷新后重试', rev: store.rev }, 409)
  }
  const target = store.users.find(item => item.id === principal.userId)
  if (!target) return json({ error: '账号不存在或已被删除' }, 404)

  const ok = current.length <= PASSWORD_MAX && await verifyPassword(current, target)
  if (!ok) {
    recordLoginFailure(request, limitKey)
    return json({ error: '当前密码不正确', field: 'currentPassword' }, 400)
  }
  clearLoginFailures(request, limitKey)

  const record = await buildPasswordRecord(nextPassword, passwordIterations(env))
  const updated = { ...target, ...record, version: target.version + 1 }
  const next = {
    ...store,
    rev: store.rev + 1,
    users: store.users.map(item => item.id === target.id ? updated : item),
    updatedAt: new Date().toISOString(),
  }
  await writeUsersStore(env, next)

  const token = await createSessionToken(updated, sessionKey(next, env), env)
  return json({ token, user: publicUser(updated) })
}

/* 边读边计数：content-length 可以缺失，也可以故意写小，
   只有读到超过上限时立刻取消，才不会把 100MB 请求体整块读进内存。 */
async function readBodyLimited(request, max) {
  const body = request.body
  if (!body || typeof body.getReader !== 'function') {
    const text = await request.text()
    if (new TextEncoder().encode(text).length > max) throw new HttpError(413, '提交的数据过大')
    return text
  }

  const reader = body.getReader()
  const chunks = []
  let total = 0
  try {
    for (;;) {
      const step = await reader.read()
      if (step.done) break
      const chunk = step.value
      total += chunk.byteLength
      if (total > max) {
        try {
          await reader.cancel()
        } catch (cancelErr) {
          console.warn('Request body cancel failed:', cancelErr)
        }
        throw new HttpError(413, '提交的数据过大')
      }
      chunks.push(chunk)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch (releaseErr) {
      console.warn('Request body release failed:', releaseErr)
    }
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

async function readJsonBody(request) {
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > MAX_BODY) throw new HttpError(413, '提交的数据过大')
  const raw = await readBodyLimited(request, MAX_BODY)

  let body
  try {
    body = JSON.parse(raw)
  } catch (err) {
    throw new HttpError(400, '请求数据格式错误')
  }
  if (!body || typeof body !== 'object') throw new HttpError(400, '请求数据格式错误')
  return body
}

/* 下发给控制器的配置：订阅令牌只以掩码形式出现在 meta 里。
   令牌本身就是订阅凭据，没有必要在每个读写响应里平铺明文——
   它会随「复制响应体」进入剪贴板、日志与浏览器历史，而订阅链接（meta.subUrl）
   才是产品需要展示的那一份。 */
function publicConfig(config) {
  const { authToken, ...rest } = config
  return rest
}

function maskedAuthToken(config, env) {
  const token = storedAuthToken(config) || authToken(env)
  if (!token) return null
  // 过短的令牌不显示末位：4 位尾码在 9 位以下的令牌里已经是可用信息的主要部分
  if (token.length < AUTH_TOKEN_MIN) return '•'.repeat(8)
  const tail = token.slice(-4)
  return '•'.repeat(Math.max(6, Math.min(token.length - 4, 24))) + tail
}

async function apiSave(request, url, env, principal) {
  requireOwner(principal)
  const body = await readJsonBody(request)

  const current = await readConfig(env, { seed: true })
  if (current.readonly) {
    throw new HttpError(503, '尚未绑定 KV 存储，配置为只读模式。请先绑定 SUB_KV 后重试')
  }
  if (body.rev !== undefined && body.rev !== null && Number(body.rev) !== current.config.rev) {
    return json({
      error: '配置已在其他窗口被更新，请刷新后重试',
      rev: current.config.rev,
    }, 409)
  }

  // 分组先校验：节点名要与分组名互斥，节点 groupId 也要按分组表归一
  const groups = body.groups !== undefined
    ? validateGroups(body.groups)
    : resolveGroups(current.config)
  const nodes = validateNodes(body.nodes, { groups })
  const groupNames = new Set(groups.map(group => group.name.toLowerCase()))
  const clash = nodes.find(node => groupNames.has(node.name.toLowerCase()))
  if (clash) {
    throw new HttpError(400, `分组名称「${clash.name}」与节点同名，客户端会解析失败`, 'groupName')
  }
  const defaults = body.defaults !== undefined
    ? validateDefaults(body.defaults)
    : sanitizeDefaults(current.config.defaults)
  const providerBase = body.providerBase !== undefined
    ? validateProviderBase(body.providerBase)
    : sanitizeProviderBase(current.config.providerBase)
  const regionOrder = reconcileRegionOrder(
    body.regionOrder !== undefined ? body.regionOrder : current.config.regionOrder,
    nodes,
    groups
  )
  const subscription = body.subscription !== undefined
    ? sanitizeSubscription(body.subscription)
    : sanitizeSubscription(current.config.subscription)
  let authToken = storedAuthToken(current.config)
  if (body.authToken !== undefined) {
    if (body.authToken === null) {
      // 显式清除：删除设置页令牌，回退到环境变量 AUTH_TOKEN（都没有则订阅需要重新配置）
      authToken = ''
    } else {
      const candidate = validateAuthToken(body.authToken)
      // 空值表示沿用当前令牌，避免误清空后无法登录或生成订阅链接
      if (candidate) authToken = candidate
    }
  }
  const next = {
    v: 1,
    rev: (current.config.rev || 0) + 1,
    updatedAt: new Date().toISOString(),
    groups,
    nodes,
    defaults,
    regionOrder,
    subscription,
    providerBase,
    authToken,
  }
  await writeConfig(env, next)

  return json({
    config: publicConfig(next),
    meta: await buildMeta(url, { readonly: false, corrupted: false, config: next }, env, principal),
  })
}

/* 成员的写路径：只接受个人节点与个人分组，全部落到 user_nodes:<userId>，
   管理员配置的 rev / updatedAt / nodes / groups 都不会被触碰。
   提交里混入的 n_ 节点 id 一律重写为 p_，因此无法借保存覆盖已分配节点。 */
async function apiSavePersonalNodes(request, url, env, principal) {
  if (isOwner(principal)) throw new HttpError(400, '所有者请通过配置接口保存节点')
  if (!principal.userId) throw new HttpError(403, '当前会话不能保存个人节点')

  const body = await readJsonBody(request)
  if (!Array.isArray(body.nodes)) throw new HttpError(400, '节点数据格式不正确')
  if (body.nodes.length > MAX_PERSONAL_NODES) {
    throw new HttpError(400, `个人节点数量不能超过 ${MAX_PERSONAL_NODES} 个`)
  }

  const admin = await readConfig(env)
  if (admin.readonly) throw new HttpError(503, '尚未绑定 KV 存储，无法保存')
  const ownerGroups = resolveGroups(admin.config)
  const current = await readPersonalNodes(env, principal.userId, ownerGroups)
  if (body.rev !== undefined && body.rev !== null && Number(body.rev) !== current.rev) {
    return json({ error: '个人节点已在其他窗口更新，请刷新后重试', rev: current.rev }, 409)
  }

  /* 分组先校验，节点才能按「共享分组 + 个人分组」的合并表归一 groupId。
     没传 groups 时沿用已存的分组，旧版前端因此不需要同步改造。 */
  const groups = body.groups !== undefined
    ? validateMemberGroups(body.groups, ownerGroups)
    : current.groups
  const allGroups = mergeGroups(ownerGroups, groups)
  const nodes = validateNodes(body.nodes, { groups: allGroups })
  const adminIds = new Set(admin.config.nodes.map(node => node.id))
  const usedIds = new Set()
  const prepared = nodes.map(node => {
    let id = PERSONAL_ID_RE.test(node.id) && !adminIds.has(node.id) && !usedIds.has(node.id)
      ? node.id
      : ''
    if (!id) {
      do { id = 'p_' + crypto.randomUUID() } while (adminIds.has(id) || usedIds.has(id))
    }
    usedIds.add(id)
    return id === node.id ? node : { ...node, id }
  })

  const filtered = filterConfigForPrincipal(admin.config, principal)
  const mergedNodes = mergePersonalNodes(filtered.nodes, prepared)
  /* validateNodes 只比对个人节点与全部分组；共享节点是所有者写的，
     这里补一次「个人分组 vs 共享节点」的同名检查，避免 YAML 里策略组与 proxy 撞名。 */
  const memberNames = new Set(groups.map(group => group.name.toLowerCase()))
  const clash = mergedNodes.find(node => memberNames.has(node.name.toLowerCase()))
  if (clash) {
    throw new HttpError(400, `分组名称「${clash.name}」与节点同名，客户端会解析失败`, 'groupName')
  }

  const next = {
    v: 1,
    rev: (current.rev || 0) + 1,
    updatedAt: new Date().toISOString(),
    nodes: prepared,
    groups,
  }
  await writePersonalNodes(env, principal.userId, next)

  const merged = {
    ...filtered,
    groups: allGroups,
    nodes: mergedNodes,
    regionOrder: reconcileRegionOrder(filtered.regionOrder, mergedNodes, allGroups),
  }
  return json({
    config: publicConfig(merged),
    meta: await buildMeta(url, admin, env, principal, { ...next, corrupted: false }),
  })
}

/* 成员的 meta 只暴露自己的订阅链接：全局 AUTH_TOKEN 是「全部节点」凭据，
   不能因为成员登录就下发到他的浏览器里。 */
async function buildMeta(url, result, env, principal, personal) {
  const stored = storedAuthToken(result.config)
  const envToken = authToken(env)
  const auth = stored || envToken
  const owner = isOwner(principal)
  const role = owner ? 'owner' : 'member'
  const accountToken = !owner && principal ? principal.subscriptionToken : null
  const subToken = owner ? auth : accountToken
  const personalNodes = personal && Array.isArray(personal.nodes) ? personal.nodes : []
  const personalGroups = personal && Array.isArray(personal.groups) ? personal.groups : []
  return {
    version: VERSION,
    kv: !!kvBinding(env),
    readonly: !!result.readonly,
    corrupted: !!result.corrupted,
    hasAuthToken: owner ? !!auth : !!accountToken,
    // 令牌来源与掩码末位足够前端判断状态，明文只在订阅链接里出现一次
    authSource: owner ? (stored ? 'settings' : (envToken ? 'environment' : 'none')) : 'account',
    authTokenHint: subToken ? maskedAuthToken({ authToken: subToken }, env) : null,
    subUrl: subToken ? `${url.origin}/?token=${encodeURIComponent(subToken)}` : null,
    authType: principal ? principal.kind : null,
    username: principal ? principal.username : null,
    userId: principal && principal.userId ? principal.userId : null,
    role,
    // 成员也能写自己的节点，但只能落到 user_nodes:<id>，碰不到管理员配置
    canWrite: !!kvBinding(env) && !result.readonly,
    canManageUsers: owner,
    scope: principal && principal.scope
      ? { allNodes: !!principal.scope.allNodes, nodeIds: principal.scope.nodeIds.slice() }
      : { allNodes: true, nodeIds: [] },
    personalNodeIds: personalNodes.map(node => node.id),
    personalGroupIds: personalGroups.map(group => group.id),
    personalRev: personal ? personal.rev : 0,
    personalCount: personalNodes.length,
    personalGroupCount: personalGroups.length,
    maxPersonalNodes: MAX_PERSONAL_NODES,
    maxPersonalGroups: MAX_MEMBER_GROUPS,
    personalCorrupted: !!(personal && personal.corrupted),
  }
}

function json(data, status = 200, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...baseHeaders(),
      'content-type': 'application/json;charset=UTF-8',
      'cache-control': 'no-store',
      ...(extraHeaders || {}),
    },
  })
}

/* ------------------------------------------------------------------ */
/* rate limiting (best-effort, per-isolate)                             */
/*                                                                     */
/* 给管理接口加一层轻量限流：同一出口 IP 每分钟最多 120 次 /api 请求， */
/* 超过返回 429 + Retry-After。Worker 内存是按 isolate 隔离的，       */
/* 因此这是尽力而为的防护；如需严格限流，请在 Cloudflare 控制台       */
/* 为 /api/* 配置边缘 Rate Limiting 规则（见 README）。               */
/* ------------------------------------------------------------------ */

const API_RATE_WINDOW_MS = 60 * 1000
const API_RATE_MAX = 120
/* 订阅路径：客户端会周期性刷新，阈值放宽到 240/分钟，只用于挡住令牌爆破 */
const SUB_RATE_MAX = 240
const apiRateBuckets = new Map()

const LOGIN_RATE_WINDOW_MS = 10 * 60 * 1000
const LOGIN_RATE_MAX = 8
/* 同一 IP 针对「任意用户名」的失败总闸：挡住换用户名批量试密码（password spraying） */
const LOGIN_IP_RATE_MAX = 60
const LOGIN_IP_BUCKET = '__ip__'
const loginFailureBuckets = new Map()

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown'
}

function loginBucketKey(request, username) {
  return clientIp(request) + '|' + String(username || '').toLowerCase()
}

function loginIpBucketKey(request) {
  return clientIp(request) + '|' + LOGIN_IP_BUCKET
}

function loginBucketLimited(key, max, now) {
  const bucket = loginFailureBuckets.get(key)
  if (!bucket) return 0
  if (now - bucket.start >= LOGIN_RATE_WINDOW_MS) {
    loginFailureBuckets.delete(key)
    return 0
  }
  if (bucket.fails < max) return 0
  return Math.max(1, Math.ceil((LOGIN_RATE_WINDOW_MS - (now - bucket.start)) / 1000))
}

function checkLoginRateLimit(request, username) {
  const now = Date.now()
  const retryAfter = loginBucketLimited(loginBucketKey(request, username), LOGIN_RATE_MAX, now) ||
    loginBucketLimited(loginIpBucketKey(request), LOGIN_IP_RATE_MAX, now)
  if (!retryAfter) return null
  return json({ error: '尝试次数过多，请稍后再试' }, 429, { 'retry-after': String(retryAfter) })
}

function bumpLoginBucket(key, now) {
  let bucket = loginFailureBuckets.get(key)
  if (!bucket || now - bucket.start >= LOGIN_RATE_WINDOW_MS) {
    bucket = { start: now, fails: 0 }
    loginFailureBuckets.set(key, bucket)
  }
  bucket.fails += 1
}

function recordLoginFailure(request, username) {
  const now = Date.now()
  bumpLoginBucket(loginBucketKey(request, username), now)
  bumpLoginBucket(loginIpBucketKey(request), now)
  if (loginFailureBuckets.size > 2000) {
    for (const [item, value] of loginFailureBuckets) {
      if (now - value.start >= LOGIN_RATE_WINDOW_MS) loginFailureBuckets.delete(item)
      if (loginFailureBuckets.size <= 1000) break
    }
  }
}

/* 只清除该账号的失败计数：按 IP 的总闸不因某次成功而放行，否则批量试探可被一次正确登录洗白 */
function clearLoginFailures(request, username) {
  loginFailureBuckets.delete(loginBucketKey(request, username))
}

function rateLimit(request, keyPrefix, max) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  const key = keyPrefix + ip
  const now = Date.now()
  let bucket = apiRateBuckets.get(key)
  if (!bucket || now - bucket.start >= API_RATE_WINDOW_MS) {
    bucket = { start: now, count: 0 }
    apiRateBuckets.set(key, bucket)
  }
  if (apiRateBuckets.size > 2000) {
    for (const [item, value] of apiRateBuckets) {
      if (now - value.start >= API_RATE_WINDOW_MS) apiRateBuckets.delete(item)
      if (apiRateBuckets.size <= 1000) break
    }
  }
  bucket.count += 1
  if (bucket.count > max) {
    const retryAfter = Math.max(1, Math.ceil((API_RATE_WINDOW_MS - (now - bucket.start)) / 1000))
    return json({ error: '请求过于频繁，请稍后再试' }, 429, { 'retry-after': String(retryAfter) })
  }
  return null
}

/* Cloudflare 边缘限流（跨 isolate 生效，需在 wrangler.toml 里声明 [[ratelimits]]）。
   内存桶按 isolate 计数，攻击者换个 isolate 就能重置；边缘限流才是真正按 IP 计的。
   绑定缺失或调用失败一律返回 null 交给内存桶兜底——限流组件故障不能把正常请求拒掉。 */
async function edgeRateLimit(env, bindingName, scope, request) {
  const limiter = env && env[bindingName]
  if (!limiter || typeof limiter.limit !== 'function') return null
  try {
    const verdict = await limiter.limit({ key: scope + ':' + clientIp(request) })
    if (!verdict || verdict.success !== false) return null
    return json({ error: '请求过于频繁，请稍后再试' }, 429, { 'retry-after': '60' })
  } catch (err) {
    console.error('Edge rate limiter failed, falling back to memory bucket:', err)
    return null
  }
}

async function checkApiRateLimit(request, env) {
  const edge = await edgeRateLimit(env, 'RATE_LIMITER', 'api', request)
  if (edge) return edge
  return rateLimit(request, 'api:', API_RATE_MAX)
}

/* 订阅拉取单独计数：客户端会周期性刷新，阈值放宽，仅用于挡住令牌爆破 */
async function checkSubRateLimit(request, env) {
  const edge = await edgeRateLimit(env, 'SUB_RATE_LIMITER', 'sub', request)
  if (edge) return edge
  return rateLimit(request, 'sub:', SUB_RATE_MAX)
}

function baseHeaders() {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    // includeSubDomains 让自定义域名下的子域也强制 HTTPS；workers.dev 属于公共后缀，不受影响
    'strict-transport-security': 'max-age=15552000; includeSubDomains',
  }
}

/* HTML 页面专用：不响应 CORS，禁用一切内嵌能力，并显式声明不需要的浏览器特性 */
function htmlHeaders() {
  return {
    ...baseHeaders(),
    'cross-origin-resource-policy': 'same-origin',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
  }
}

/* HEAD 请求保留完整头部（含 content-length 语义由运行时处理），但不发送正文 */
function pageBody(headOnly, html) {
  return headOnly ? null : html
}

/* ------------------------------------------------------------------ */
/* subscription                                                        */
/* ------------------------------------------------------------------ */

async function serveSubscription(env, config, headOnly = false) {
  if (!config) {
    try {
      config = (await readConfig(env)).config
    } catch (err) {
      console.error('Subscription fallback to empty config:', err)
      config = emptyConfig()
    }
  }

  const headers = {
    ...baseHeaders(),
    'content-type': 'text/yaml;charset=UTF-8',
    'cache-control': 'no-store, max-age=0',
    'profile-update-interval': '12',
    // 订阅 URL 自带令牌，任何索引 / 抓取都会把它抄进第三方缓存
    'x-robots-tag': 'noindex, nofollow, noarchive',
    ...subscriptionHeaders(config),
    'access-control-allow-origin': '*',
  }
  // HEAD 用于客户端探活（令牌是否仍然有效）：不渲染 YAML，只回头部
  if (headOnly) return new Response(null, { status: 200, headers })

  return new Response(buildYaml(config), { headers })
}

// 未配置流量 / 到期时间时不发送 subscription-userinfo，避免客户端显示虚构额度
function subscriptionHeaders(config) {
  const info = config.subscription || {}
  const totalGB = Number(info.totalGB)
  const expire = info.expire ? Math.floor(Date.parse(`${info.expire}T23:59:59Z`) / 1000) : 0
  if (!(totalGB > 0) && !expire) return {}
  const parts = ['upload=0', 'download=0']
  parts.push(`total=${totalGB > 0 ? Math.round(totalGB * 1024 * 1024 * 1024) : 0}`)
  if (expire) parts.push(`expire=${expire}`)
  return { 'subscription-userinfo': parts.join('; ') }
}

function buildYaml(config) {
  const enabled = config.nodes.filter(node => node.enabled)
  /* 最后一道防线：节点名与策略组同名时 Clash 会整份配置报错。
     写路径已经拦过，这里兜住手工编辑 KV、成员个人节点与旧数据。 */
  const taken = policyGroupNames(config)
  const renderable = enabled.filter(node => isRenderableNode(node) && !taken.has(node.name))
  if (renderable.length !== enabled.length) {
    console.warn('Skipped invalid nodes while rendering YAML:', enabled.length - renderable.length)
  }
  const time = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(new Date()).replace(/\//g, '-')

  const info = config.subscription || {}
  const infoBits = []
  if (Number(info.totalGB) > 0) infoBits.push(`流量 ${info.totalGB} GB`)
  if (info.expire) infoBits.push(`到期 ${info.expire}`)

  const header = [
    '# ============================================================',
    '# Transit Hub · Clash Subscription',
    `# 更新时间: ${time} (Asia/Shanghai)`,
    `# 节点: ${config.nodes.length} 个 · 已启用: ${enabled.length} 个`,
    ...(infoBits.length ? [`# ${infoBits.join(' · ')}`] : []),
    '# 由 Transit Hub Console 自动生成，请勿手动编辑',
    '# ============================================================',
    '',
  ].join('\n')

  const proxies = renderable.map(nodeToYaml).join('\n')
  // 策略组只引用实际渲染出来的节点，否则 Clash 会因 proxy not found 报错
  const groups = buildProxyGroups({ ...config, nodes: renderable }).map(groupToYaml).join('\n')
  const proxySection = renderable.length ? ['proxies:', proxies] : ['proxies: []']

  // rule-providers 镜像：只替换固定的规则集前缀，未配置时保持默认 CDN
  const base = sanitizeProviderBase(config.providerBase) || PROVIDER_BASE_DEFAULT
  const rules = base === PROVIDER_BASE_DEFAULT
    ? STATIC_RULES.trim()
    : STATIC_RULES.trim().split(PROVIDER_BASE_DEFAULT).join(base)

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
    rules,
    '',
  ].join('\n')
}

function yq(value) {
  return JSON.stringify(String(value))
}

/**
 * 渲染前的最后一道防线。
 * KV 里可能存在旧版本写入、手工编辑或竞态产生的异常数据，读路径不会再跑一遍
 * validateNodes，所以这里必须自行兜底：枚举字段只允许白名单值，凭据字段必须真的是凭据，
 * 否则整节点跳过，避免把含换行的值或 "undefined" 拼进 YAML 造成结构破坏、字段注入，
 * 或者下发一份客户端必然连不上的配置。
 */
function safeEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isRenderableNode(node) {
  if (!node || typeof node !== 'object') return false
  if (!TYPES.includes(node.type)) return false
  if (!Number.isInteger(node.port) || node.port < 1 || node.port > 65535) return false
  if (typeof node.server !== 'string' || !node.server || node.server.length > 253) return false
  if (typeof node.name !== 'string' || !node.name || node.name.length > 80) return false
  if (/[\u0000-\u001f\u007f]/.test(node.name) || /[\u0000-\u001f\u007f]/.test(node.server)) return false
  // 渲染前的最后一道：零宽 / 双向控制符会让客户端列表里出现「看着一样、其实不同」的节点名
  if (FORMAT_CHARS_RE.test(node.name) || FORMAT_CHARS_RE.test(node.server)) return false

  if (node.type === 'vless' || node.type === 'vmess') {
    if (typeof node.uuid !== 'string' || !UUID_SHAPE.test(node.uuid)) return false
    // Reality 缺公钥等于连不上：跳过而不是下发 public-key: "undefined"
    if (node.type === 'vless' && node.reality && (typeof node.publicKey !== 'string' || !node.publicKey)) return false
    return true
  }
  if (typeof node.password !== 'string' || !node.password || /[\u0000-\u001f\u007f]/.test(node.password)) return false
  if (node.type === 'ss' && !CIPHERS.includes(node.cipher)) return false
  return true
}

function nodeToYaml(node) {
  const lines = [
    `- name: ${yq(node.name)}`,
    `  type: ${safeEnum(node.type, TYPES, 'vless')}`,
    `  server: ${yq(node.server)}`,
    `  port: ${Number.isInteger(node.port) ? node.port : 443}`,
  ]

  if (node.type === 'vless') {
    lines.push(`  uuid: ${yq(node.uuid)}`)
    lines.push(`  network: ${safeEnum(node.network, NETWORKS, 'tcp')}`)
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
    if (node.flow && node.network === 'tcp' && node.tls) lines.push(`  flow: ${safeEnum(node.flow, FLOWS, '')}`)
    if (node.servername && (node.tls || node.reality)) lines.push(`  servername: ${yq(node.servername)}`)
    if (node.reality) {
      lines.push('  reality-opts:')
      lines.push(`    public-key: ${yq(node.publicKey)}`)
      if (node.shortId) lines.push(`    short-id: ${yq(node.shortId)}`)
    }
    if (node.fingerprint) lines.push(`  client-fingerprint: ${safeEnum(node.fingerprint, FINGERPRINTS, 'chrome')}`)
    return lines.join('\n')
  }

  if (node.type === 'vmess') {
    lines.push(`  uuid: ${yq(node.uuid)}`)
    lines.push('  alterId: 0')
    lines.push('  cipher: auto')
    lines.push(`  network: ${safeEnum(node.network, NETWORKS, 'tcp')}`)
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
    lines.push(`  cipher: ${safeEnum(node.cipher, CIPHERS, 'aes-256-gcm')}`)
    lines.push(`  password: ${yq(node.password)}`)
    if (node.udp) lines.push('  udp: true')
    return lines.join('\n')
  }

  return lines.join('\n')
}

function buildProxyGroups(config) {
  const enabled = config.nodes.filter(node => node.enabled)
  const groups = resolveGroups(config)
  const buckets = []

  groups.forEach(group => {
    const inGroup = enabled.filter(node => nodeGroupId(node, groups) === group.id)
    if (!inGroup.length) return
    // 各分组按独立的 regionOrder 排序，未收录的节点保持全局相对顺序（sort 稳定）
    const rank = new Map((((config.regionOrder || {})[group.id]) || []).map((id, i) => [id, i]))
    const far = Number.MAX_SAFE_INTEGER
    const members = inGroup
      .slice()
      .sort((a, b) => {
        const ra = rank.has(a.id) ? rank.get(a.id) : far
        const rb = rank.has(b.id) ? rank.get(b.id) : far
        return ra - rb
      })
      .map(node => node.name)
    buckets.push({ id: group.id, name: group.name, icon: group.icon, members })
  })

  const mainProxies = [
    'DIRECT',
    ...buckets.map(bucket => bucket.name),
    ...enabled.filter(node => node.showInMain !== false).map(node => node.name),
  ]
  const out = [{
    name: MAIN_GROUP,
    icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Global.png',
    proxies: mainProxies,
  }]

  buckets.forEach(bucket => {
    out.push({ name: bucket.name, icon: bucket.icon, proxies: bucket.members })
  })

  // 分组名是用户可改的：应用策略组按 id 查当前名字，分组被删掉就不再引用它
  const nameById = new Map(buckets.map(bucket => [bucket.id, bucket.name]))

  APP_GROUPS.forEach(app => {
    const proxies = []
    const push = value => {
      if (value && !proxies.includes(value)) proxies.push(value)
    }
    app.bases.forEach(base => {
      if (base === MAIN_GROUP) push(MAIN_GROUP)
      else if (nameById.has(base)) push(nameById.get(base))
    })
    enabled.forEach(node => {
      // tags 可能来自旧数据 / 手工编辑的 KV，缺字段不能让整份订阅 500
      if (Array.isArray(node.tags) && node.tags.includes(app.key)) push(node.name)
    })
    if (!proxies.length) push(MAIN_GROUP)
    out.push({ name: app.name, icon: app.icon, proxies })
  })

  return out
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

function serveAdmin(headOnly = false) {
  const nonce = randomNonce()
  const html = ADMIN_HTML.split('__CSP_NONCE__').join(nonce)
  return new Response(pageBody(headOnly, html), {
    headers: {
      ...htmlHeaders(),
      'content-type': 'text/html;charset=UTF-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'content-security-policy': [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        `style-src 'nonce-${nonce}'`,
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self'",
        "object-src 'none'",
        "worker-src 'none'",
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

function decoyCsp(nonce) {
  // default-src 'none' 已覆盖 object / worker / connect，这里只显式列出可能被放宽的指令。
  // style 也用 nonce 而不是 'unsafe-inline'：样式内联一旦放开，CSS 选择器 + 外部 url()
  // 就能在不执行脚本的前提下把页面里的属性值一位一位漏出去。
  return "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'nonce-" + nonce + "'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
}

function renderDecoy(request, headOnly = false) {
  const headers = request.headers
  const nonce = randomNonce()
  // HEAD 只要状态与头部：跳过整页模板拼装，省掉最贵的一段 CPU
  if (headOnly) {
    return new Response(null, {
      status: 200,
      headers: {
        ...htmlHeaders(),
        'content-type': 'text/html;charset=UTF-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow',
        // HEAD 不返回正文，但头部仍与 GET 保持一致，避免探测差异
        'content-security-policy': decoyCsp(nonce),
      },
    })
  }
  const cf = request.cf || {}
  const known = value => (value === undefined || value === null || value === '' ? '' : String(value))
  const or = (value, label) => known(value) || label

  const ip = or(headers.get('cf-connecting-ip'), '未知')
  const country = or(cf.country, '未知')
  const city = or(cf.city, '未知')
  const isp = or(cf.asOrganization, '未知运营商')
  const colo = or(cf.colo, '未知节点')
  const ua = headers.get('user-agent') || '未知浏览器'
  const location = [city, country].filter(value => value && value !== '未知').join(', ') || '未知'
  const version = /:/.test(ip) ? 'IPv6' : 'IPv4'
  const uaShort = ua.length > 120 ? ua.slice(0, 120) + '…' : ua

  const net = {
    ip,
    version,
    country: or(cf.country, ''),
    region: or(cf.region, ''),
    continent: or(cf.continent, ''),
    postal: or(cf.postalCode, ''),
    lat: or(cf.latitude, ''),
    lon: or(cf.longitude, ''),
    timezone: or(cf.timezone, ''),
    asn: or(cf.asn, ''),
    isp,
    colo,
    tls: or(cf.tlsVersion, ''),
    cipher: or(cf.tlsCipher, ''),
    httpProtocol: or(cf.httpProtocol, ''),
    tcpPort: or(cf.clientTcpPort, ''),
    keepAlive: or(headers.get('keep-alive'), ''),
    priority: or(headers.get('priority'), ''),
    acceptLanguage: ua === '未知浏览器' ? '' : or(headers.get('accept-language'), ''),
    cfRay: or(headers.get('cf-ray'), ''),
    ua,
  }
  const row = (label, value, id) => {
    const text = known(value)
    if (!text) return ''
    return '<div class="row"><dt>' + esc(label) + '</dt><dd' +
      (id ? ' id="' + id + '"' : '') + ' data-copy="' + esc(label) + '">' + esc(text) + '</dd></div>'
  }

  /* 请求头白名单取值：不回显 cookie / authorization，折叠控制字符并按 120 字符截断 */
  const hdr = (name, label) => {
    const raw = known(headers.get(name))
    if (!raw) return ''
    const flat = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/ {2,}/g, ' ').trim()
    if (!flat) return ''
    return row(label, flat.length > 120 ? flat.slice(0, 120) + '…' : flat)
  }

  const connRows = [
    row('IP 类型', net.version),
    row('HTTP 协议', net.httpProtocol),
    row('TLS 版本', net.tls),
    row('TLS 加密套件', net.cipher),
    row('客户端端口', net.tcpPort),
    row('连接复用', net.keepAlive),
    row('请求优先级', net.priority),
    row('Accept-Language', net.acceptLanguage),
    hdr('sec-ch-ua', 'Sec-CH-UA'),
    hdr('accept-encoding', 'Accept-Encoding'),
    hdr('referer', '来源页'),
    row('CF-Ray', net.cfRay),
    row('大洲', net.continent),
    row('省份 / 州', net.region),
    row('邮政编码', net.postal),
    row('经纬度', net.lat && net.lon ? net.lat + ', ' + net.lon : ''),
    row('识别运营商', net.isp),
    row('接入节点', net.colo),
  ].join('')

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>IP 地址查询</title>
<style nonce="${nonce}">
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
  .ip-meta { display: flex; align-items: center; gap: 10px; color: var(--faint); font-size: 12px; margin-bottom: 14px; }
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
  .stack { position: relative; z-index: 1; width: 100%; max-width: 570px; display: flex; flex-direction: column; gap: 14px; }
  .top-status { gap: 12px; }
  .clock { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .tabs {
    display: flex; gap: 3px; padding: 4px;
    border: 1px solid var(--line); border-radius: 15px; background: var(--panel);
    backdrop-filter: blur(18px) saturate(140%); -webkit-backdrop-filter: blur(18px) saturate(140%);
  }
  .tab {
    flex: 1; padding: 8px 6px; border: 0; border-radius: 11px; background: transparent;
    color: var(--muted); font: inherit; font-size: 12.5px; font-weight: 600; letter-spacing: .01em;
    cursor: pointer; transition: background .18s ease, color .18s ease;
  }
  .tab:hover { color: var(--text); }
  .tab.is-on { background: var(--soft); color: var(--accent); }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
  .card-head h2 { margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -.01em; }
  .ghost-btn {
    display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px;
    border: 1px solid var(--line-strong); border-radius: 9px; background: transparent;
    color: var(--muted); font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer;
  }
  .ghost-btn:hover { color: var(--text); border-color: var(--accent); }
  .rows { margin: 0; border: 1px solid var(--line); border-radius: 15px; overflow: hidden; background: var(--panel-solid); }
  .row { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; padding: 11px 15px; border-bottom: 1px solid var(--line); }
  .row:last-child { border-bottom: 0; }
  .row dt { color: var(--muted); font-size: 12.5px; white-space: nowrap; }
  .row dd { margin: 0; font-size: 13px; font-weight: 600; text-align: right; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
  .rows-note { margin: 10px 2px 0; color: var(--faint); font-size: 11.5px; }
  .ip-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 26px; }
  .card[hidden], .panel-block[hidden] { display: none; }
  .sub-head { margin: 20px 0 9px; font-size: 11px; font-weight: 650; letter-spacing: .12em; text-transform: uppercase; color: var(--faint); }
  .tool + .tool { margin-top: 12px; }
  .tool { display: flex; flex-direction: column; gap: 10px; padding: 15px 16px; border: 1px solid var(--line); border-radius: 16px; background: var(--panel-solid); }
  .tool h3 { margin: 0; font-size: 13px; font-weight: 650; }
  .tool-desc { margin: 0; color: var(--faint); font-size: 11.5px; }
  .tool-row { display: flex; gap: 8px; }
  .field {
    flex: 1; min-width: 0; padding: 9px 12px; border: 1px solid var(--line-strong); border-radius: 10px;
    background: var(--bg); color: var(--text); font: inherit; font-size: 13px;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  .field:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
  .out {
    margin: 0; padding: 11px 13px; border-radius: 10px; background: var(--soft);
    color: var(--text); font-size: 12px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  .out.is-empty { background: transparent; border: 1px dashed var(--line-strong); color: var(--faint); }
  .out.is-error { background: color-mix(in srgb, #ef4444 12%, transparent); color: #b91c1c; }
  @media (prefers-color-scheme: dark) { .out.is-error { color: #fca5a5; } }
  @media (prefers-reduced-motion: reduce) { .tab { transition: none; } }
  @media (max-width: 540px) {
    .topbar { padding: 20px; }
    .brand-tag { display: none; }
    .card { padding: 26px 22px 24px; border-radius: 20px; }
    .grid { grid-template-columns: 1fr; }
    .info.span-2 { grid-column: auto; }
    .card-foot { flex-direction: column; align-items: flex-start; gap: 8px; }
    .top-status .status-label { display: none; }
    .tab { padding: 8px 4px; font-size: 12px; }
    .card-head { flex-direction: column; align-items: flex-start; gap: 10px; }
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
  <div class="top-status"><span class="pulse"></span><span class="status-label">节点运行中</span><span class="clock" id="clock">--:--:--</span></div>
</header>
<main>
<div class="stack">
  <nav class="tabs" role="tablist" aria-label="诊断信息分类">
    <button class="tab is-on" type="button" role="tab" data-tab="overview" aria-selected="true" aria-controls="panel-overview">概览</button>
    <button class="tab" type="button" role="tab" data-tab="conn" aria-selected="false" aria-controls="panel-conn" tabindex="-1">连接</button>
    <button class="tab" type="button" role="tab" data-tab="browser" aria-selected="false" aria-controls="panel-browser" tabindex="-1">浏览器</button>
    <button class="tab" type="button" role="tab" data-tab="tools" aria-selected="false" aria-controls="panel-tools" tabindex="-1">工具</button>
  </nav>
  <section class="card" id="panel-overview" role="tabpanel" aria-labelledby="ip-title">
    <div class="eyebrow"><span class="line"></span>Network Diagnostics</div>
    <p class="ip-label" id="ip-title">您的公网 IP 地址</p>
    <div class="ip" id="ip-line" data-copy="公网 IP">${esc(ip)}</div>
    <div class="ip-meta"><span class="chip">${version}</span><span>由 Cloudflare 边缘网络识别</span></div>
    <div class="ip-actions">
      <button class="ghost-btn" type="button" id="ip-mask"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4l16 16"/><path d="M9.9 5.2A9.8 9.8 0 0 1 12 5c6 0 9.5 7 9.5 7a17.7 17.7 0 0 1-3.3 4.1M6.1 6.6A17.5 17.5 0 0 0 2.5 12S6 19 12 19a9.7 9.7 0 0 0 4.2-.9"/></svg><span id="ip-mask-label">打码显示</span></button>
      <button class="ghost-btn" type="button" id="ip-copy"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15.5 9V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5H9"/></svg><span id="ip-copy-label">复制 IP</span></button>
      <button class="ghost-btn" type="button" id="reload"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 11a8 8 0 0 0-14-4.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4.5L20 15M20 20v-5h-5"/></svg><span>重新识别</span></button>
    </div>
    <div class="grid">
      <div class="info">
        <span class="info-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/></svg>
          地理位置
        </span>
        <span class="info-value" data-copy="地理位置">${esc(location)}</span>
      </div>
      <div class="info">
        <span class="info-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.6 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.6-3.8-9S9.5 5.5 12 3Z"/></svg>
          接入节点
        </span>
        <span class="info-value" data-copy="接入节点">${esc(colo)}</span>
      </div>
      <div class="info span-2">
        <span class="info-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M3.5 9.5h17M8 14.5h5"/></svg>
          运营商
        </span>
        <span class="info-value" data-copy="运营商">${esc(isp)}</span>
      </div>
      <div class="info">
        <span class="info-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>
          所在时区
        </span>
        <span class="info-value" data-copy="所在时区">${esc(or(cf.timezone, '未知'))}</span>
      </div>
      <div class="info">
        <span class="info-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 18V9M9.5 18V4M15 18v-7M20.5 18v-11"/></svg>
          自治系统
        </span>
        <span class="info-value" data-copy="自治系统">${esc(or(cf.asn, '未知'))}</span>
      </div>
    </div>
    <div class="ua">
      <div class="ua-label">浏览器信息</div>
      <div class="ua-text" data-copy="浏览器 UA">${esc(uaShort)}</div>
    </div>
    <div class="card-foot">
      <span class="ok"><span class="dot"></span>服务运行正常</span>
      <button class="ghost-btn" type="button" id="copy-page"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15.5 9V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5H9"/></svg><span id="copy-page-label">复制本页信息</span></button>
    </div>
  </section>
  <section class="card" id="panel-conn" role="tabpanel" aria-labelledby="conn-title" hidden>
    <div class="card-head"><h2 id="conn-title">本次连接</h2></div>
    <dl class="rows">${connRows}</dl>
    <p class="rows-note">以上信息由 Cloudflare 边缘节点从本次请求中识别，服务端不保存任何访问记录。</p>
  </section>
  <section class="card" id="panel-browser" role="tabpanel" aria-labelledby="browser-title" hidden>
    <div class="card-head"><h2 id="browser-title">浏览器环境</h2></div>
    <dl class="rows" id="env-rows"></dl>
    <div class="sub-head" id="perf-head">网络与加载计时</div>
    <dl class="rows" id="perf-rows"></dl>
    <p class="rows-note">本标签页的数据由浏览器本地读取，不会发送到服务器。</p>
  </section>
  <section class="card" id="panel-tools" role="tabpanel" aria-labelledby="tools-title" hidden>
    <div class="card-head"><h2 id="tools-title">本地小工具</h2></div>
    <div class="tool">
      <h3>IP 进制互转</h3>
      <p class="tool-desc">输入 IPv4 点分十进制，或对应的 32 位整数。</p>
      <div class="tool-row"><input class="field" id="ipconv" type="text" aria-label="IP 地址或整数" autocomplete="off" spellcheck="false" placeholder="例如 8.8.8.8 或 134744072"></div>
      <pre class="out is-empty" id="ipconv-out">等待输入</pre>
    </div>
    <div class="tool">
      <h3>CIDR 网段计算</h3>
      <p class="tool-desc">输入地址与前缀长度，例如 192.168.10.0/24。</p>
      <div class="tool-row"><input class="field" id="cidr" type="text" aria-label="CIDR 网段" autocomplete="off" spellcheck="false" placeholder="例如 192.168.10.0/24"></div>
      <pre class="out is-empty" id="cidr-out">等待输入</pre>
    </div>
    <div class="tool">
      <h3>时间戳与日期互转</h3>
      <p class="tool-desc">输入秒级或毫秒级时间戳，也可输入日期时间文本。</p>
      <div class="tool-row"><input class="field" id="ts" type="text" aria-label="时间戳或日期" autocomplete="off" spellcheck="false" placeholder="例如 1735689600 或 2026-01-01 08:00"></div>
      <pre class="out is-empty" id="ts-out">等待输入</pre>
    </div>
    <p class="rows-note">三项计算全部在你的浏览器本地完成，输入内容不会离开这台设备。</p>
  </section>
</div>
</main>
<footer>© ${new Date().getFullYear()} Transit Hub · Network Diagnostics</footer>
<script nonce="${nonce}">
(function () {
  var NL = String.fromCharCode(10);
  var EMPTY = '等待输入';

  function node(id) { return document.getElementById(id); }
  function setText(id, value) { var n = node(id); if (n) n.textContent = value; }
  function on(id, fn) { var n = node(id); if (n) n.addEventListener('click', fn); }
  function pad(value) { var x = String(value); return x.length < 2 ? '0' + x : x; }

  var flashTimers = {};
  function flash(id, label) {
    var n = node(id);
    if (!n) return;
    if (!n.getAttribute('data-label')) n.setAttribute('data-label', n.textContent);
    n.textContent = label;
    if (flashTimers[id]) window.clearTimeout(flashTimers[id]);
    flashTimers[id] = window.setTimeout(function () {
      n.textContent = n.getAttribute('data-label');
    }, 1600);
  }

  /* ---------- 复制 ---------- */
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-2400px';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(legacyCopy(text)); });
    } else {
      done(legacyCopy(text));
    }
  }

  /* ---------- 标签页 ---------- */
  var tabs = [];
  var tabEls = document.querySelectorAll('.tab');
  for (var i = 0; i < tabEls.length; i++) tabs.push(tabEls[i]);
  var envFilled = false;

  function activate(key, focus) {
    for (var t = 0; t < tabs.length; t++) {
      var isOn = tabs[t].getAttribute('data-tab') === key;
      tabs[t].classList.toggle('is-on', isOn);
      tabs[t].setAttribute('aria-selected', isOn ? 'true' : 'false');
      tabs[t].tabIndex = isOn ? 0 : -1;
      if (isOn && focus) tabs[t].focus();
    }
    var panels = document.querySelectorAll('[role="tabpanel"]');
    for (var p = 0; p < panels.length; p++) panels[p].hidden = panels[p].id !== 'panel-' + key;
    if (key === 'browser' && !envFilled) {
      envFilled = true;
      fillEnv();
    }
  }

  for (var b = 0; b < tabs.length; b++) {
    (function (tab, index) {
      tab.addEventListener('click', function () { activate(tab.getAttribute('data-tab'), false); });
      tab.addEventListener('keydown', function (ev) {
        var step = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
        if (step) {
          ev.preventDefault();
          activate(tabs[(index + step + tabs.length) % tabs.length].getAttribute('data-tab'), true);
        } else if (ev.key === 'Home' || ev.key === 'End') {
          ev.preventDefault();
          activate(tabs[ev.key === 'End' ? tabs.length - 1 : 0].getAttribute('data-tab'), true);
        }
      });
    })(tabs[b], b);
  }

  /* ---------- 时钟 ---------- */
  var clock = node('clock');
  function tick() {
    if (!clock) return;
    var d = new Date();
    clock.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  tick();
  window.setInterval(tick, 1000);

  /* ---------- IP 打码与复制 ---------- */
  var ipLine = node('ip-line');
  var realIp = ipLine ? String(ipLine.textContent).trim() : '';
  var masked = false;

  function maskIp(value) {
    if (!value || value === '未知') return value;
    if (value.indexOf(':') >= 0) {
      var g = value.split(':');
      return g.slice(0, 2).join(':') + ':…';
    }
    var parts = value.split('.');
    if (parts.length !== 4) return value;
    return parts[0] + '.' + parts[1] + '.*.*';
  }

  on('ip-mask', function () {
    if (!ipLine) return;
    masked = !masked;
    ipLine.textContent = masked ? maskIp(realIp) : realIp;
    setText('ip-mask-label', masked ? '显示完整' : '打码显示');
  });
  on('ip-copy', function () {
    if (!realIp || realIp === '未知') {
      flash('ip-copy-label', '暂无 IP');
      return;
    }
    copyText(realIp, function (ok) { flash('ip-copy-label', ok ? '已复制' : '复制失败'); });
  });
  on('reload', function () { window.location.reload(); });
  on('copy-page', function () {
    var items = document.querySelectorAll('[data-copy]');
    var lines = [];
    for (var c = 0; c < items.length; c++) {
      var value = String(items[c].textContent).trim();
      if (value && value !== '未知') lines.push(items[c].getAttribute('data-copy') + '  ' + value);
    }
    if (!lines.length) {
      flash('copy-page-label', '暂无内容');
      return;
    }
    copyText('Transit Hub 诊断信息' + NL + lines.join(NL), function (ok) {
      flash('copy-page-label', ok ? '已复制' : '复制失败');
    });
  });

  /* ---------- 浏览器环境 ---------- */
  function addRow(dl, label, value) {
    var text = value === undefined || value === null ? '' : String(value).trim();
    if (!text) return;
    var wrap = document.createElement('div');
    wrap.className = 'row';
    var dt = document.createElement('dt');
    dt.textContent = label;
    var dd = document.createElement('dd');
    dd.textContent = text;
    dd.setAttribute('data-copy', label);
    wrap.appendChild(dt);
    wrap.appendChild(dd);
    dl.appendChild(wrap);
  }
  function mq(query) { return window.matchMedia ? window.matchMedia(query).matches : false; }
  function brandText(brands) {
    var out = [];
    for (var r = 0; r < brands.length; r++) out.push(brands[r].brand + ' ' + brands[r].version);
    return out.join(', ');
  }
  function offsetText() {
    var minutes = -new Date().getTimezoneOffset();
    var abs = Math.abs(minutes);
    return (minutes < 0 ? '-' : '+') + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
  }

  function fillEnv() {
    var env = node('env-rows');
    if (!env) return;
    var n = navigator;
    var timeZone = '';
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (err) {
      timeZone = '';
    }
    var hints = n.userAgentData || null;
    addRow(env, '平台', (hints && hints.platform) || n.platform || '');
    addRow(env, '浏览器内核', hints && hints.brands && hints.brands.length ? brandText(hints.brands) : '');
    addRow(env, '移动设备', hints ? (hints.mobile ? '是' : '否') : '');
    addRow(env, 'CPU 核心', n.hardwareConcurrency || '');
    addRow(env, '内存', n.deviceMemory ? n.deviceMemory + ' GB' : '');
    addRow(env, '界面语言', n.languages && n.languages.length ? n.languages.join(', ') : n.language || '');
    addRow(env, '时区', timeZone ? timeZone + ' (UTC' + offsetText() + ')' : '');
    addRow(env, '屏幕', window.screen ? screen.width + ' × ' + screen.height : '');
    addRow(env, '可用区域', window.screen ? screen.availWidth + ' × ' + screen.availHeight : '');
    addRow(env, '视口', window.innerWidth + ' × ' + window.innerHeight);
    addRow(env, '像素比', window.devicePixelRatio ? window.devicePixelRatio + 'x' : '');
    addRow(env, '色深', window.screen && screen.colorDepth ? screen.colorDepth + ' bit' : '');
    addRow(env, '触摸点', typeof n.maxTouchPoints === 'number' ? n.maxTouchPoints : '');
    addRow(env, '在线状态', n.onLine ? '在线' : '离线');
    addRow(env, 'Cookie', n.cookieEnabled ? '已启用' : '已禁用');
    addRow(env, '外观偏好', mq('(prefers-color-scheme: dark)') ? '深色' : '浅色');
    addRow(env, '减少动效', mq('(prefers-reduced-motion: reduce)') ? '已开启' : '未开启');
    addRow(env, '网络类型', n.connection && n.connection.effectiveType ? n.connection.effectiveType : '');
    addRow(env, '来源页', document.referrer || '');
    fillPerf();
  }

  function fillPerf() {
    var dl = node('perf-rows');
    if (!dl) return;
    var list = window.performance && performance.getEntriesByType ? performance.getEntriesByType('navigation') : [];
    var nav = list.length ? list[0] : null;
    if (nav) {
      var ms = function (value) { return value > 0 && isFinite(value) ? Math.round(value) + ' ms' : ''; };
      addRow(dl, 'DNS 解析', ms(nav.domainLookupEnd - nav.domainLookupStart));
      addRow(dl, 'TCP 连接', ms(nav.connectEnd - nav.connectStart));
      addRow(dl, 'TLS 握手', nav.secureConnectionStart ? ms(nav.connectEnd - nav.secureConnectionStart) : '');
      addRow(dl, '等待首字节', ms(nav.responseStart - nav.requestStart));
      addRow(dl, '内容下载', ms(nav.responseEnd - nav.responseStart));
      addRow(dl, 'DOM 就绪', ms(nav.domContentLoadedEventEnd));
      addRow(dl, '完全加载', ms(nav.duration));
      addRow(dl, 'HTTP 协议', nav.protocol || '');
    }
    if (!dl.children.length) {
      dl.hidden = true;
      var head = node('perf-head');
      if (head) head.hidden = true;
    }
  }

  /* ---------- 小工具 ---------- */
  function setOut(id, state, content) {
    var n = node(id);
    if (!n) return;
    n.textContent = content;
    n.classList.toggle('is-empty', state === 'empty');
    n.classList.toggle('is-error', state === 'error');
  }
  function isDigits(text) {
    if (!text.length) return false;
    for (var d = 0; d < text.length; d++) {
      var code = text.charCodeAt(d);
      if (code < 48 || code > 57) return false;
    }
    return true;
  }
  function parseV4(text) {
    var parts = text.split('.');
    if (parts.length !== 4) return null;
    var out = [];
    for (var o = 0; o < 4; o++) {
      if (!isDigits(parts[o]) || parts[o].length > 3) return null;
      var value = parseInt(parts[o], 10);
      if (value > 255) return null;
      out.push(value);
    }
    return out;
  }
  function toLong(octets) { return ((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]; }
  function toOctets(long) {
    var out = [];
    for (var s = 3; s >= 0; s--) out.push(Math.floor(long / Math.pow(256, s)) % 256);
    return out;
  }
  function ipOf(long) { return toOctets(long).join('.'); }
  function bin8(value) { var s = value.toString(2); while (s.length < 8) s = '0' + s; return s; }
  function hex2(value) { var s = value.toString(16); return s.length < 2 ? '0' + s : s; }

  function runConv(raw) {
    var text = raw.trim();
    if (!text) return setOut('ipconv-out', 'empty', EMPTY);
    if (text.indexOf(':') >= 0) return setOut('ipconv-out', 'error', '仅换算 IPv4，请输入点分十进制或 32 位整数');
    var octets = text.indexOf('.') >= 0 ? parseV4(text) : null;
    var origin = 'IPv4 地址';
    var long = 0;
    if (!octets && isDigits(text) && text.length <= 10) {
      long = parseInt(text, 10);
      if (long > 4294967295) return setOut('ipconv-out', 'error', '十进制超出 IPv4 范围（0 – 4294967295）');
      octets = toOctets(long);
      origin = '十进制整数';
    }
    if (!octets) return setOut('ipconv-out', 'error', '格式不正确，示例：8.8.8.8 或 134744072');
    long = toLong(octets);
    setOut('ipconv-out', 'ok', [
      '识别为      ' + origin,
      '点分十进制  ' + octets.join('.'),
      '十进制      ' + long,
      '十六进制    0x' + octets.map(hex2).join(''),
      '二进制      ' + octets.map(bin8).join('.'),
      'IPv6 映射   ::ffff:' + octets.join('.'),
    ].join(NL));
  }

  function runCidr(raw) {
    var text = raw.trim();
    if (!text) return setOut('cidr-out', 'empty', EMPTY);
    var parts = text.split('/');
    if (parts.length !== 2) return setOut('cidr-out', 'error', '格式：地址/前缀，例如 192.168.10.0/24');
    var octets = parseV4(parts[0].trim());
    if (!octets) return setOut('cidr-out', 'error', '仅支持 IPv4 地址，例如 192.168.10.0/24');
    if (!isDigits(parts[1]) || parts[1].length > 2) return setOut('cidr-out', 'error', '前缀长度需为 0 – 32');
    var prefix = parseInt(parts[1], 10);
    if (prefix > 32) return setOut('cidr-out', 'error', '前缀长度需为 0 – 32');
    var size = Math.pow(2, 32 - prefix);
    var network = Math.floor(toLong(octets) / size) * size;
    var broadcast = network + size - 1;
    var mask = prefix === 0 ? 0 : 4294967296 - size;
    setOut('cidr-out', 'ok', [
      'CIDR 表示   ' + ipOf(network) + '/' + prefix,
      '网络地址    ' + ipOf(network),
      '子网掩码    ' + ipOf(mask),
      '通配符掩码  ' + ipOf(size - 1),
      '广播地址    ' + ipOf(broadcast),
      '地址总数    ' + size,
      '可用主机    ' + (prefix >= 31 ? (prefix === 32 ? 1 : 2) : size - 2),
      '首个可用    ' + (prefix <= 30 ? ipOf(network + 1) : ipOf(network)),
      '末个可用    ' + (prefix <= 30 ? ipOf(broadcast - 1) : ipOf(broadcast)),
    ].join(NL));
  }

  function textToDate(text) {
    var groups = text.split(' ');
    var ymd = groups[0].split('-');
    if (ymd.length !== 3) ymd = groups[0].split('/');
    if (ymd.length !== 3 || !isDigits(ymd[0]) || !isDigits(ymd[1]) || !isDigits(ymd[2])) return null;
    var hms = [0, 0, 0];
    if (groups[1]) {
      var pieces = groups[1].split(':');
      for (var h = 0; h < pieces.length && h < 3; h++) {
        if (!isDigits(pieces[h])) return null;
        hms[h] = parseInt(pieces[h], 10);
      }
    }
    var date = new Date(parseInt(ymd[0], 10), parseInt(ymd[1], 10) - 1, parseInt(ymd[2], 10), hms[0], hms[1], hms[2]);
    return isNaN(date.getTime()) ? null : date.getTime();
  }
  function humanDiff(delta) {
    var units = [[31536000, '年'], [2592000, '个月'], [86400, '天'], [3600, '小时'], [60, '分钟']];
    var rest = Math.abs(delta) / 1000;
    var parts = [];
    for (var u = 0; u < units.length; u++) {
      var count = Math.floor(rest / units[u][0]);
      if (count) {
        parts.push(count + units[u][1]);
        rest -= count * units[u][0];
      }
      if (parts.length === 2) break;
    }
    if (!parts.length) parts.push('不到 1 分钟');
    return parts.join(' ') + (delta > 0 ? '前' : '后');
  }
  function runStamp(raw) {
    var text = raw.trim();
    if (!text) return setOut('ts-out', 'empty', EMPTY);
    var digits = text.charAt(0) === '-' ? text.slice(1) : text;
    var milliseconds = null;
    if (isDigits(digits)) {
      var numeric = Number(text);
      if (Math.abs(numeric) > 86400000000000) return setOut('ts-out', 'error', '时间戳超出可处理范围');
      milliseconds = digits.length > 10 ? numeric : numeric * 1000;
    } else {
      var parsed = Date.parse(text);
      milliseconds = isNaN(parsed) ? textToDate(text) : parsed;
      if (milliseconds === null || isNaN(milliseconds)) {
        return setOut('ts-out', 'error', '无法识别，示例：1735689600 或 2026-01-01 08:00');
      }
    }
    var date = new Date(milliseconds);
    if (isNaN(date.getTime())) return setOut('ts-out', 'error', '时间超出可处理范围');
    var weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
    var local = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
    setOut('ts-out', 'ok', [
      '秒级        ' + Math.round(milliseconds / 1000),
      '毫秒级      ' + Math.round(milliseconds),
      'UTC         ' + date.toISOString().replace('T', ' ').slice(0, 19),
      '本地时间    ' + local + ' ' + weekday,
      '相对当前    ' + humanDiff(Date.now() - milliseconds),
    ].join(NL));
  }

  function bindTool(id, fn) {
    var n = node(id);
    if (n) n.addEventListener('input', function () { fn(n.value); });
  }
  bindTool('ipconv', runConv);
  bindTool('cidr', runCidr);
  bindTool('ts', runStamp);
})();
</script>
</body>
</html>`

  return new Response(pageBody(headOnly, html), {
    headers: {
      ...htmlHeaders(),
      'content-type': 'text/html;charset=UTF-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'content-security-policy': decoyCsp(nonce),
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
