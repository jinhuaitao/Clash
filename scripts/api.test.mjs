/*
 * Transit Hub 接口回归测试（零依赖）
 *
 * 目的：把「语法合法、运行时才炸」以及「读路径不再校验」这类问题钉死。
 * 用 Node 的 Request/Response/Web Crypto 直接调用 worker.fetch，KV 用内存 Map 模拟，
 * 不依赖 wrangler，也不发任何网络请求。
 *
 *   node scripts/api.test.mjs        # 全部通过时只打印统计
 *   VERBOSE=1 node scripts/api.test.mjs
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = name => readFile(path.join(root, name), 'utf8')

/* ---------------- 断言与统计 ---------------- */

let passed = 0
const failures = []
let currentGroup = ''

function group(name) {
  currentGroup = name
  if (process.env.VERBOSE) console.log(`\n${name}`)
}

function check(label, condition, detail) {
  if (condition) {
    passed += 1
    if (process.env.VERBOSE) console.log('  ✓ ' + label)
    return true
  }
  failures.push(`${currentGroup} · ${label}${detail ? ' → ' + detail : ''}`)
  console.error(`  ✗ ${currentGroup} · ${label}${detail ? ' → ' + detail : ''}`)
  return false
}

function eq(label, actual, expected) {
  return check(label, actual === expected, `得到 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`)
}

/* ---------------- 组装 worker（与 build.mjs 同样的标记替换） ---------------- */

const escapeTemplate = value => value
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${')

const [workerSource, staticHead, staticRules] = await Promise.all([
  read('src/worker.js'),
  read('src/static-head.yaml'),
  read('src/rules.yaml'),
])

const source = workerSource
  .replace('__STATIC_HEAD__', () => escapeTemplate(staticHead.trimEnd()))
  .replace('__STATIC_RULES__', () => escapeTemplate(staticRules.trim()))
  // 控制台 HTML 与本题测试无关，占位即可
  .replace('__ADMIN_HTML__', () => '<html>ADMIN __CSP_NONCE__</html>')

const { default: worker } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
)

/* ---------------- mock KV 与请求助手 ---------------- */

function makeEnv(options = {}) {
  const data = new Map()
  const env = {
    data,
    SUB_KV: {
      async get(key) {
        if (options.failRead) throw new Error('kv read boom')
        return data.has(key) ? data.get(key) : null
      },
      async put(key, value) {
        if (options.failWrite) throw new Error('kv write boom')
        data.set(key, String(value))
      },
    },
  }
  if (options.AUTH_TOKEN) env.AUTH_TOKEN = options.AUTH_TOKEN
  if (options.ADMIN_TOKEN) env.ADMIN_TOKEN = options.ADMIN_TOKEN
  return env
}

let ipSeed = 0
const nextIp = () => '10.0.' + Math.floor(++ipSeed / 254) + '.' + (ipSeed % 254)

async function call(env, pathWithQuery, init = {}) {
  const headers = new Headers(init.headers || {})
  if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', init.ip || nextIp())
  const request = new Request('https://hub.example.workers.dev' + pathWithQuery, { ...init, headers })
  const response = await worker.fetch(request, env)
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('json') ? await response.json().catch(() => null) : await response.text()
  return { status: response.status, headers: response.headers, contentType, body }
}

// 配置了 ADMIN_TOKEN 的实例，初始化必须带上恢复令牌（放在 Authorization 头里）
const asAdmin = (env, username = 'owner@example.com', password = 'Correct Horse 1') => call(env, '/api/setup', {
  method: 'POST',
  headers: env.ADMIN_TOKEN ? bearer(env.ADMIN_TOKEN) : {},
  body: JSON.stringify({ username, password }),
})
const login = (env, username = 'owner@example.com', password = 'Correct Horse 1', ip) =>
  call(env, '/api/login', { method: 'POST', body: JSON.stringify({ username, password }), ip })

async function initConsole(env) {
  await asAdmin(env)
  const res = login(env)
  return (await res).body.token
}

const bearer = token => ({ authorization: 'Bearer ' + token })
const putConfig = (env, token, payload, ip) => call(env, '/api/config', {
  method: 'PUT',
  ip,
  headers: { ...bearer(token), 'content-type': 'application/json' },
  body: JSON.stringify(payload),
})
const getConfig = (env, token, ip) => call(env, '/api/config', { headers: bearer(token), ip })

async function currentRev(env, token) {
  const res = await getConfig(env, token)
  return res.body.config.rev
}

/* ---------------- 测试数据 ---------------- */

const SUB_TOKEN = 'sub-token-abcdefghijklmnop'
const UUID_A = '11111111-2222-3333-4444-555555555555'
const UUID_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

const ssNode = extra => ({
  type: 'ss', server: 'ss.example.com', port: 8388, region: 'other',
  enabled: true, cipher: 'aes-256-gcm', password: 'ss-password', ...extra,
})

const fullNodes = () => [
  { id: 'n_hk1', name: 'HK-01', type: 'vless', server: 'hk.example.com', port: 443, region: 'hk', enabled: true, tags: ['chatgpt'], uuid: UUID_A, network: 'tcp', tls: true, reality: true, publicKey: 'REALITY_PUB', shortId: 'ab12', flow: 'xtls-rprx-vision', fingerprint: 'chrome', udp: true },
  { id: 'n_hk2', name: 'HK-02', type: 'trojan', server: 't.example.com', port: 443, region: 'hk', enabled: true, tags: [], password: 'trojan-pass', sni: 't.example.com', udp: true },
  { id: 'n_us1', name: 'US-01', type: 'vmess', server: 'us.example.com', port: 443, region: 'us', enabled: true, tags: ['google'], uuid: UUID_B, network: 'ws', wsPath: '/vmess', tls: false, udp: true },
  { id: 'n_jp1', name: 'JP-01', type: 'hysteria2', server: 'jp.example.com', port: 8443, region: 'jp', enabled: true, tags: [], password: 'hy2-pass', sni: 'jp.example.com', up: '80 mbps', down: '500 mbps' },
  { id: 'n_hidden', name: 'JP-02', type: 'ss', server: 'h.example.com', port: 8389, region: 'jp', enabled: true, showInMain: false, tags: ['telegram'], cipher: 'aes-256-gcm', password: 'p2' },
  { id: 'n_off', name: 'OFF-01', type: 'ss', server: 'off.example.com', port: 8390, region: 'hk', enabled: false, tags: [], cipher: 'aes-256-gcm', password: 'p3' },
]

/* 静默 worker 自身的 console 输出，失败时再打印，避免噪音掩盖断言 */
const logs = []
const realError = console.error
const realWarn = console.warn
console.error = (...args) => logs.push(args.join(' '))
console.warn = (...args) => logs.push(args.join(' '))

function flushLogs(label) {
  if (logs.length && process.env.VERBOSE) realWarn(`  (worker 日志 @${label}) ${logs.join(' | ')}`)
  logs.length = 0
}

/* ================= 用例 ================= */

group('伪装页与路由')
{
  const env = makeEnv()
  const res = await call(env, '/')
  eq('无令牌 GET / 返回 200', res.status, 200)
  check('返回 HTML 伪装页', res.contentType.startsWith('text/html'), res.contentType)
  check('伪装页不含订阅字段', !/proxies:|proxy-groups:/.test(res.body))
  check('伪装页 noindex', String(res.headers.get('x-robots-tag')).includes('noindex'))
  check('HTML 带 CSP nonce', /script-src 'nonce-[0-9a-f]{32}'/.test(String(res.headers.get('content-security-policy'))))
  check('两次请求 nonce 不同', (await call(env, '/')).headers.get('content-security-policy') !== res.headers.get('content-security-policy'))
  check('HTML 带 permissions-policy', String(res.headers.get('permissions-policy')).includes('camera=()'))
  eq('HTML 带 cross-origin-resource-policy', res.headers.get('cross-origin-resource-policy'), 'same-origin')
  eq('未鉴权 GET / 不再写 KV（防写放大）', env.data.size, 0)

  const head = await call(env, '/', { method: 'HEAD' })
  eq('HEAD / 返回 200', head.status, 200)
  eq('HEAD / 无正文', head.body, '')

  const adminQuery = await call(env, '/?admin=1')
  check('?admin=1 不再暴露控制台入口（返回伪装页而非 ADMIN）', !adminQuery.body.includes('ADMIN __CSP_NONCE__'), adminQuery.body.slice(0, 40))
}

group('控制台 HTML')
{
  const env = makeEnv()
  const res = await call(env, '/admin')
  eq('GET /admin 200', res.status, 200)
  const csp = String(res.headers.get('content-security-policy'))
  check('CSP 含 frame-ancestors none', csp.includes("frame-ancestors 'none'"))
  check('CSP 含 object-src none', csp.includes("object-src 'none'"))
  check('nonce 已注入 HTML', res.body.includes('ADMIN') && !csp.includes('nonce-__'))
  eq('HEAD /admin 无正文', (await call(env, '/admin', { method: 'HEAD' })).body, '')
  eq('POST /admin 405', (await call(env, '/admin', { method: 'POST', body: '{}' })).status, 405)
}

group('初始化与登录')
{
  const env = makeEnv()
  eq('KV 未初始化时 seed 也不写库', env.data.size, 0)
  const auth = await call(env, '/api/auth')
  eq('/api/auth needsSetup', auth.body.needsSetup, true)
  eq('报告最大账号数', auth.body.maxUsers, 20)

  const setup = await asAdmin(env)
  eq('创建管理员返回 200', setup.status, 200)
  check('返回会话令牌', typeof setup.body.token === 'string' && setup.body.token.split('.').length === 2)
  check('响应不含口令哈希', !JSON.stringify(setup.body).includes('passwordHash'))

  eq('重复初始化 409', (await asAdmin(env)).status, 409)
  eq('needsSetup 变为 false', (await call(env, '/api/auth')).body.needsSetup, false)

  const ok = await login(env)
  eq('正确口令登录 200', ok.status, 200)
  eq('错误口令 401', (await login(env, 'owner@example.com', 'wrong-password-x')).status, 401)
  eq('未知用户名 401（等时虚耗）', (await login(env, 'nobody', 'wrong-password-x')).status, 401)

  const ip = nextIp()
  const codes = []
  for (let i = 0; i < 10; i++) codes.push((await login(env, 'owner@example.com', 'nope-' + i, ip)).status)
  check('同 IP 同账号 8 次后限流', codes.slice(0, 8).every(c => c === 401) && codes[8] === 429 && codes[9] === 429, codes.join(','))
  const limited = await login(env, 'owner@example.com', 'Correct Horse 1', ip)
  eq('限流窗口内正确口令也被挡', limited.status, 429)
  check('429 带 Retry-After', Number(limited.headers.get('retry-after')) > 0)
  flushLogs('login')
}

group('鉴权边界')
{
  const env = makeEnv({ ADMIN_TOKEN: 'deploy-recovery-token-1' })
  const token = await initConsole(env)

  eq('会话令牌可用', (await getConfig(env, token)).status, 200)
  eq('伪造 Bearer 401', (await getConfig(env, 'aGVsbG8.dGVzdA')).status, 401)
  eq('恢复令牌可用', (await getConfig(env, 'deploy-recovery-token-1')).status, 200)
  eq('订阅令牌不能登录控制台', (await getConfig(env, 'sub-token-abcdefghijklmnop')).status, 401)

  const ip = nextIp()
  const codes = []
  for (let i = 0; i < 10; i++) codes.push((await getConfig(env, 'guess-' + i, ip)).status)
  check('恢复令牌爆破 8 次后限流', codes[8] === 429 && codes[9] === 429, codes.join(','))
  eq('恢复通道 meta 标记 recovery', (await getConfig(env, 'deploy-recovery-token-1')).body.meta.authType, 'recovery')
  eq('未配置 ADMIN_TOKEN 时旧令牌不受影响', (await getConfig(makeEnv(), 'x')).status, 401)
}

group('保存与读取配置')
{
  const env = makeEnv()
  const token = await initConsole(env)

  const first = await putConfig(env, token, { rev: 0, nodes: fullNodes(), subscription: { totalGB: 500, expire: '2026-12-31' }, authToken: SUB_TOKEN })
  eq('保存成功', first.status, 200)
  eq('rev 自增', first.body.config.rev, 1)
  check('保存后不回显明文令牌', !JSON.stringify(first.body.config).includes(SUB_TOKEN))
  check('meta 只给掩码提示', /\u2022/.test(String(first.body.meta.authTokenHint)) && String(first.body.meta.authTokenHint).endsWith(SUB_TOKEN.slice(-4)), first.body.meta.authTokenHint)
  eq('令牌来源为设置页', first.body.meta.authSource, 'settings')
  check('订阅链接含明文令牌（展示用）', String(first.body.meta.subUrl).includes(SUB_TOKEN))

  const got = await getConfig(env, token)
  eq('GET /api/config 200', got.status, 200)
  eq('读取也不含 authToken 字段', Object.prototype.hasOwnProperty.call(got.body.config, 'authToken'), false)
  eq('节点数一致', got.body.config.nodes.length, fullNodes().length)

  eq('过期 rev 409', (await putConfig(env, token, { rev: 0, nodes: [] })).status, 409)
  eq('409 带回最新 rev', (await putConfig(env, token, { rev: 0, nodes: [] })).body.rev, 1)
}

group('订阅输出')
{
  const env = makeEnv()
  const token = await initConsole(env)
  await putConfig(env, token, { rev: 0, nodes: fullNodes(), subscription: { totalGB: 500, expire: '2026-12-31' }, authToken: SUB_TOKEN })

  const sub = await call(env, '/?token=' + SUB_TOKEN)
  eq('正确令牌 200', sub.status, 200)
  eq('内容类型是 YAML', sub.contentType, 'text/yaml;charset=UTF-8')
  eq('profile-update-interval', sub.headers.get('profile-update-interval'), '12')
  eq('CORS 允许任意客户端拉取', sub.headers.get('access-control-allow-origin'), '*')
  check('subscription-userinfo 额度换算正确', String(sub.headers.get('subscription-userinfo')).includes('total=' + 500 * 1024 ** 3), sub.headers.get('subscription-userinfo'))
  check('subscription-userinfo 含到期时间戳', /expire=\d{10}/.test(String(sub.headers.get('subscription-userinfo'))))
  check('YAML 三段齐备', ['proxies:', 'proxy-groups:', 'rules:'].every(k => sub.body.includes(k)), '缺段')
  eq('已停用节点不渲染', sub.body.includes('OFF-01'), false)
  check('Reality 参数渲染', sub.body.includes('public-key: "REALITY_PUB"') && sub.body.includes('flow: xtls-rprx-vision'))
  check('WS 参数渲染', sub.body.includes('grpc') === false && sub.body.includes('path: "/vmess"'))
  check('Hysteria2 带宽渲染', sub.body.includes('up: "80 mbps"'))
  check('未声明跳过校验时不输出 skip-cert-verify', !/skip-cert-verify/.test(sub.body), '发现 skip-cert-verify')
  check('YAML 中不含 undefined 字面量', !sub.body.includes('"undefined"') && !sub.body.includes(': undefined'))

  const groups = sub.body.split('proxy-groups:')[1]
  const mainGroup = groups.split('- name: "🇺🇸欧美节点"')[0]
  check('🌍 主组含 DIRECT', mainGroup.includes('"DIRECT"'))
  check('showInMain:false 不进主组', !mainGroup.includes('"JP-02"'))
  check('💬ChatGPT 组带 tag 节点', sub.body.includes('- "HK-01"'))
  check('ⒼGoogle 组带 tag 节点', groups.split('ⒼGoogle')[1].split('- name:')[0].includes('"US-01"'))
  check('📲 电报信息 组带 tag 节点', groups.split('电报信息')[1].split('rule-providers:')[0].includes('"JP-02"'))

  const head = await call(env, '/?token=' + SUB_TOKEN, { method: 'HEAD' })
  eq('HEAD 订阅探活 200', head.status, 200)
  eq('HEAD 订阅不渲染正文', head.body, '')
  check('HEAD 仍返回 userinfo 头', !!head.headers.get('subscription-userinfo'))

  const wrong = await call(env, '/?token=wrong-token-xxxx')
  eq('错误令牌走伪装页', wrong.status, 200)
  check('错误令牌不泄露配置', wrong.contentType.startsWith('text/html') && !wrong.body.includes('proxies:'))

  const preview = await call(env, '/api/preview', { headers: bearer(token) })
  eq('预览接口 200', preview.status, 200)
  check('预览与订阅一致', preview.body.includes('HK-01'))
}

group('环境变量令牌')
{
  const env = makeEnv({ AUTH_TOKEN: 'env-token-abcdefghijklmn' })
  const token = await initConsole(env)
  const res = await call(env, '/?token=env-token-abcdefghijklmn')
  eq('环境变量令牌可用', res.contentType, 'text/yaml;charset=UTF-8')
  eq('来源标记 environment', (await getConfig(env, token)).body.meta.authSource, 'environment')
  await putConfig(env, token, { rev: await currentRev(env, token), nodes: [], authToken: null })
  eq('清除设置页令牌后仍不回落 env？', (await call(env, '/?token=env-token-abcdefghijklmn')).status, 200)
  eq('authSource 回落 environment', (await getConfig(env, token)).body.meta.authSource, 'environment')
}

group('YAML 注入与脏数据兜底')
{
  const env = makeEnv()
  const token = await initConsole(env)
  await putConfig(env, token, { rev: 0, nodes: [ssNode({ id: 'a', name: 'OK-01' })], authToken: SUB_TOKEN })

  const inject = node => {
    const raw = JSON.parse(env.data.get('config'))
    raw.nodes = [node]
    env.data.set('config', JSON.stringify(raw))
  }

  inject(ssNode({ id: 'a', name: 'x\n  password: pwned\n  type: ss' }))
  let res = await call(env, '/?token=' + SUB_TOKEN)
  eq('含换行的节点名不会打断订阅接口', res.status, 200)
  check('换行注入未被原样拼进 YAML', !res.body.includes('\n  password: pwned'))
  check('注入节点被跳过而非渲染', !res.body.includes('pwned'))

  inject(ssNode({ id: 'a', name: 'Bad-UUID', type: 'vless', uuid: 'not-a-uuid' }))
  res = await call(env, '/?token=' + SUB_TOKEN)
  check('非法 UUID 节点跳过', !res.body.includes('Bad-UUID') && res.body.includes('proxies: []'))

  inject({ ...fullNodes()[0], publicKey: '' })
  res = await call(env, '/?token=' + SUB_TOKEN)
  check('Reality 缺公钥跳过', !res.body.includes('public-key: "undefined"') && !res.body.includes('HK-01'))

  inject(ssNode({ id: 'a', name: 'No-Pass', password: undefined }))
  res = await call(env, '/?token=' + SUB_TOKEN)
  check('缺密码跳过', !res.body.includes('password: "undefined"'))

  const missingTags = ssNode({ id: 'a', name: 'No-Tags' })
  delete missingTags.tags
  inject(missingTags)
  res = await call(env, '/?token=' + SUB_TOKEN)
  eq('缺 tags 字段不再 500（回归）', res.status, 200)
  check('缺 tags 节点仍正常渲染', res.body.includes('"No-Tags"'))

  inject(ssNode({ id: 'a', name: 'Bad-Port', port: 99999 }))
  res = await call(env, '/?token=' + SUB_TOKEN)
  check('非法端口跳过', !res.body.includes('Bad-Port'))

  const raw = JSON.parse(env.data.get('config'))
  raw.nodes = 'not-an-array'
  env.data.set('config', JSON.stringify(raw))
  res = await call(env, '/?token=' + SUB_TOKEN)
  eq('config 结构损坏时降级为空配置而非 500', res.status, 200)
  check('损坏配置不渲染节点', !res.body.includes('proxies:\n- name'))

  const badUsers = makeEnv()
  const live = await initConsole(badUsers)
  eq('损坏前账号接口可用', (await call(badUsers, '/api/users', { headers: bearer(live) })).status, 200)
  badUsers.data.set('users', '{"users":"broken"}')
  eq('users 损坏上报 corrupted', (await call(badUsers, '/api/auth')).body.corrupted, true)
  eq('users 损坏时禁止自动初始化', (await call(badUsers, '/api/setup', { method: 'POST', body: JSON.stringify({ username: 'takeover', password: 'Passw0rd12345!' }) })).status, 409)
  eq('users 损坏时登录明确报错而非提示初始化', (await login(badUsers, 'owner@example.com', 'whatever123')).status, 500)
  // 会话版本取自用户库，库损坏时一律失效：宁可 401 也不能让旧令牌继续生效
  eq('users 损坏时会话立即失效（fail closed）', (await call(badUsers, '/api/users', { headers: bearer(live) })).status, 401)

  // 恢复令牌不依赖用户库，损坏时能给出 409 诊断而不是笼统的 401
  const locked = makeEnv({ ADMIN_TOKEN: 'deploy-recovery-token-2' })
  await initConsole(locked)
  locked.data.set('users', '{"users":"broken"}')
  eq('users 损坏时用恢复令牌可拿到 409 诊断', (await call(locked, '/api/users', { headers: bearer('deploy-recovery-token-2') })).status, 409)
  flushLogs('corrupt')
}

group('rule-providers 镜像')
{
  const env = makeEnv()
  const token = await initConsole(env)
  await putConfig(env, token, { rev: 0, nodes: [ssNode({ id: 'a', name: 'A-01' })], authToken: SUB_TOKEN })
  eq('默认使用 jsDelivr', (await call(env, '/?token=' + SUB_TOKEN)).body.includes('https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/reject.txt'), true)

  const mirror = 'https://rules.example.com/clash'
  eq('设置镜像保存成功', (await putConfig(env, token, { rev: await currentRev(env, token), nodes: [ssNode({ id: 'a', name: 'A-01' })], providerBase: mirror })).status, 200)
  const sub = await call(env, '/?token=' + SUB_TOKEN)
  check('所有规则集 URL 换到镜像', sub.body.includes('https://rules.example.com/clash/reject.txt') && !sub.body.includes('cdn.jsdelivr.net/gh/Loyalsoldier'), sub.body.match(/url: "[^"]+"/)?.[0])
  eq('镜像末尾斜杠自动裁剪', (await putConfig(env, token, { rev: await currentRev(env, token), nodes: [], providerBase: mirror + '/' })).body.config.providerBase, mirror)
  eq('非法镜像 400', (await putConfig(env, token, { rev: await currentRev(env, token), nodes: [], providerBase: 'http://insecure.example.com' })).status, 400)
  eq('含空格的镜像 400', (await putConfig(env, token, { rev: await currentRev(env, token), nodes: [], providerBase: 'https://ok.example.com/a b' })).status, 400)
  eq('注入 YAML 引号的镜像 400', (await putConfig(env, token, { rev: await currentRev(env, token), nodes: [], providerBase: 'https://x.example.com/"\n  evil: 1' })).status, 400)
  eq('清空镜像回落默认', (await call(env, '/?token=' + SUB_TOKEN)).body.includes('cdn.jsdelivr.net/gh/Loyalsoldier'), false)
  await putConfig(env, token, { rev: await currentRev(env, token), nodes: [ssNode({ id: 'a', name: 'A-01' })], providerBase: '' })
  check('留空即恢复默认 CDN', (await call(env, '/?token=' + SUB_TOKEN)).body.includes('https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/gfw.txt'))
}

group('证书校验默认值')
{
  const env = makeEnv()
  const token = await initConsole(env)
  const trojan = { id: 't1', name: 'T-01', type: 'trojan', server: 't.example.com', port: 443, region: 'hk', enabled: true, password: 'pass123456' }
  await putConfig(env, token, { rev: 0, nodes: [trojan], authToken: SUB_TOKEN })
  let saved = (await getConfig(env, token)).body.config.nodes[0]
  eq('Trojan 默认不跳过校验', saved.skipCertVerify, false)
  eq('YAML 不含 skip-cert-verify', (await call(env, '/?token=' + SUB_TOKEN)).body.includes('skip-cert-verify'), false)

  await putConfig(env, token, { rev: await currentRev(env, token), nodes: [{ ...trojan, skipCertVerify: true }], authToken: SUB_TOKEN })
  check('显式开启才输出 skip-cert-verify', (await call(env, '/?token=' + SUB_TOKEN)).body.includes('skip-cert-verify: true'))
}

group('写入校验')
{
  const env = makeEnv()
  const token = await initConsole(env)
  const save = async nodes => putConfig(env, token, { rev: await currentRev(env, token), nodes })
  const status = async res => (await res).status
  const error = async res => (await res).body.error

  eq('300 个节点通过', await status(save(Array.from({ length: 300 }, (_, i) => ssNode({ id: 'x' + i, name: 'N' + i })))), 200)
  eq('301 个节点拒绝', await status(save(Array.from({ length: 301 }, (_, i) => ssNode({ id: 'y' + i, name: 'M' + i })))), 400)
  eq('超大请求体 413', (await call(env, '/api/config', { method: 'PUT', headers: { ...bearer(token), 'content-type': 'application/json' }, body: JSON.stringify({ nodes: [], pad: 'x'.repeat(300 * 1024) }) })).status, 413)
  eq('非 JSON 请求体 400', (await call(env, '/api/config', { method: 'PUT', headers: { ...bearer(token), 'content-type': 'application/json' }, body: '{oops' })).status, 400)
  eq('不支持的协议被拒', await error(save([ssNode({ id: 'a', name: 'X-01', type: 'snell' })])), '节点「X-01」的协议类型不受支持')
  eq('与策略组同名被拒', await error(save([ssNode({ id: 'a', name: '🌍选择节点' })])).then(v => v.slice(0, 4)), '节点名称')
  eq('大小写重复名被拒', await error(save([ssNode({ id: 'a', name: 'Dup' }), ssNode({ id: 'b', name: 'dup' })])).then(v => v.includes('重复')), true)
  eq('Reality 只允许 TCP', await error(save([{ ...fullNodes()[0], network: 'ws' }])).then(v => v.includes('仅支持 TCP')), true)
  eq('非法 UUID 被拒', await error(save([{ ...fullNodes()[0], uuid: 'zzz' }])).then(v => v.includes('UUID')), true)
  eq('带宽格式被拒', await error(save([ssNode({ id: 'a', name: 'H-01', type: 'hysteria2', password: 'p1234567', up: 'fast' })])).then(v => v.includes('上行带宽')), true)
  eq('服务器地址含空格被拒', await error(save([ssNode({ id: 'a', name: 'S-01', server: 'a b.example.com' })])).then(v => v.includes('服务器地址')), true)
  eq('节点名含换行被拒', await error(save([ssNode({ id: 'a', name: 'a\nb' })])).then(v => v.includes('非法字符')), true)
  eq('端口越界被拒', await error(save([ssNode({ id: 'a', name: 'P-01', port: 70000 })])).then(v => v.includes('端口')), true)
  eq('短订阅令牌被拒', await error((async () => putConfig(env, token, { rev: await currentRev(env, token), nodes: [], authToken: 'short' }))()).then(v => v.includes('16')), true)
  eq('掩码令牌被拒', await error((async () => putConfig(env, token, { rev: await currentRev(env, token), nodes: [], authToken: '•'.repeat(20) + 'mnop' }))()).then(v => v.includes('掩码')), true)
  eq('短掩码同样提示掩码而非长度', await error((async () => putConfig(env, token, { rev: await currentRev(env, token), nodes: [], authToken: '••••ab' }))()).then(v => v.includes('掩码')), true)
  eq('节点上限 300 生效', (await getConfig(env, token)).body.config.nodes.length <= 300, true)
}

group('账号管理')
{
  const env = makeEnv()
  const token = await initConsole(env)
  eq('缺少 rev 的创建请求被拒', (await call(env, '/api/users', { method: 'POST', headers: { ...bearer(token), 'content-type': 'application/json' }, body: JSON.stringify({ username: 'second' }) })).status, 400)

  const currentRevUsers = async (e, t) => (await call(e, '/api/users', { headers: bearer(t) })).body.rev
  const create = async (username, password) => call(env, '/api/users', {
    method: 'POST',
    headers: { ...bearer(token), 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, rev: await currentRevUsers(env, token) }),
  })

  eq('合法创建 200', (await create('second', 'Another-Pass-1')).status, 200)
  check('响应不含敏感字段', !JSON.stringify((await call(env, '/api/users', { headers: bearer(token) })).body).includes('passwordHash'))
  eq('大小写重复用户名被拒', (await create('SECOND', 'Another-Pass-1')).body.error.includes('已存在'), true)
  eq('弱密码被拒', (await create('third', 'short')).status, 400)
  eq('用户名过短被拒', (await create('ab', 'Another-Pass-1')).status, 400)

  const list = (await call(env, '/api/users', { headers: bearer(token) })).body
  eq('账号数 2', list.users.length, 2)

  const second = list.users.find(u => u.username === 'second')
  const secondToken = (await login(env, 'second', 'Another-Pass-1')).body.token
  const upd = await call(env, '/api/users/update', {
    method: 'POST',
    headers: { ...bearer(token), 'content-type': 'application/json' },
    body: JSON.stringify({ id: second.id, password: 'Rotated-Pass-99' }),
  })
  eq('重置密码 200', upd.status, 200)
  eq('旧会话立即作废', (await getConfig(env, secondToken)).status, 401)
  eq('新口令可登录', (await login(env, 'second', 'Rotated-Pass-99')).status, 200)

  const self = upd.body.currentUserId
  eq('不能删除当前登录账号', (await call(env, '/api/users/delete', { method: 'POST', headers: { ...bearer(token), 'content-type': 'application/json' }, body: JSON.stringify({ id: self }) })).body.error.includes('不能删除当前登录账号'), true)
  eq('删除他人 200', (await call(env, '/api/users/delete', { method: 'POST', headers: { ...bearer(token), 'content-type': 'application/json' }, body: JSON.stringify({ id: second.id }) })).status, 200)

  const last = (await call(env, '/api/users', { headers: bearer(token) })).body.users[0]
  const other = await login(env, 'owner@example.com', 'Correct Horse 1')
  eq('不能删掉最后一个账号（用恢复通道试）', (await call(env, '/api/users/delete', { method: 'POST', headers: { authorization: 'Bearer ' + other.body.token, 'content-type': 'application/json' }, body: JSON.stringify({ id: last.id }) })).body.error.includes('至少需要保留'), true)
}

group('KV 异常降级')
{
  const dead = makeEnv({ failWrite: true })
  const setup = await asAdmin(dead)
  eq('写库失败 502', setup.status, 502)

  const broken = makeEnv()
  const token = await initConsole(broken)
  await putConfig(broken, token, { rev: 0, nodes: [ssNode({ id: 'a', name: 'A-01' })], authToken: SUB_TOKEN })
  broken.SUB_KV.get = async () => { throw new Error('boom') }
  // KV 读失败要给明确的 502 语义，而不是让异常冒泡成 Worker 平台的裸 500
  const sub = await call(broken, '/?token=' + SUB_TOKEN)
  eq('KV 读失败时订阅返回 502', sub.status, 502)
  check('502 带可读错误信息', String(sub.body.error).includes('KV'))
  eq('KV 读失败时接口同样 502', (await call(broken, '/api/config', { headers: bearer(token) })).status, 502)
  eq('伪装页不依赖 KV，仍 200', (await call(broken, '/')).status, 200)
  flushLogs('kv-fail')
}

group('限流')
{
  const env = makeEnv()
  const ip = nextIp()
  const codes = []
  for (let i = 0; i < 125; i++) codes.push((await call(env, '/api/auth', { ip })).status)
  eq('前 120 次放行', codes.slice(0, 120).every(c => c === 200), true)
  eq('第 121 次起 429', codes[120], 429)

  const subIp = nextIp()
  let decoy429 = 0
  for (let i = 0; i < 250; i++) if ((await call(env, '/', { ip: subIp })).status === 429) decoy429 += 1
  check('伪装页 240/分钟后限流', decoy429 > 0 && decoy429 < 30, '429 次数 ' + decoy429)

  const otherIp = nextIp()
  eq('限流按 IP 隔离', (await call(env, '/api/auth', { ip: otherIp })).status, 200)
}

group('安全加固')
{
  const env = makeEnv()
  const token = await initConsole(env)
  await putConfig(env, token, { rev: 0, nodes: [ssNode({ id: 'a', name: 'A-01' })], authToken: SUB_TOKEN })

  const decoy = await call(env, '/')
  eq('伪装页带 HSTS', decoy.headers.get('strict-transport-security'), 'max-age=15552000')
  eq('伪装页带 COOP', decoy.headers.get('cross-origin-opener-policy'), 'same-origin')
  const head = await call(env, '/', { method: 'HEAD' })
  check('HEAD 伪装页也带 CSP', /script-src 'nonce-[0-9a-f]{32}'/.test(String(head.headers.get('content-security-policy'))))

  const byHeader = await call(env, '/', { headers: bearer(SUB_TOKEN) })
  eq('Authorization 头可拉订阅', byHeader.status, 200)
  check('Authorization 头返回 YAML', byHeader.contentType.includes('yaml') && byHeader.body.includes('proxies:'), byHeader.contentType)
  eq('Authorization 头 HEAD 探活', (await call(env, '/', { method: 'HEAD', headers: bearer(SUB_TOKEN) })).status, 200)

  let kvReads = 0
  const originalGet = env.SUB_KV.get
  env.SUB_KV.get = async key => { kvReads += 1; return originalGet(key) }
  const overlong = await call(env, '/?token=' + 'x'.repeat(600))
  check('超长令牌返回伪装页', overlong.contentType.startsWith('text/html'))
  eq('超长令牌不触发 KV 读取', kvReads, 0)
  env.SUB_KV.get = originalGet

  const hugeName = await call(env, '/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'a'.repeat(60000), password: 'x' }),
  })
  eq('超长用户名按登录失败处理而非崩溃', hugeName.status, 401)

  let seq = 0
  const create = password => call(env, '/api/users', {
    method: 'POST',
    headers: { ...bearer(token), 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'guard' + (++seq), password }),
  })
  eq('11 位口令被拒', (await create('x'.repeat(11))).status, 400)
  eq('12 位口令通过', (await create('x'.repeat(12))).status, 200)

  const weak = makeEnv({ AUTH_TOKEN: 'short-token' })
  check('过短的 AUTH_TOKEN 被忽略', (await call(weak, '/?token=short-token')).contentType.startsWith('text/html'))

  const strong = makeEnv()
  strong.PASSWORD_ITERATIONS = 20000
  await asAdmin(strong)
  const stored = JSON.parse(strong.data.get('users'))
  eq('PASSWORD_ITERATIONS 写入新账号', stored.users[0].passwordIterations, 20000)
  eq('提高迭代后仍能登录', (await login(strong)).status, 200)
}

/* ================= 收尾 ================= */

console.error = realError
console.warn = realWarn

const total = passed + failures.length
if (failures.length) {
  console.error(`\n✗ ${failures.length}/${total} 项失败：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✓ 接口回归测试全部通过：${passed} 项`)
