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
      async delete(key) {
        if (options.failWrite) throw new Error('kv write boom')
        data.delete(key)
      },
    },
  }
  if (options.AUTH_TOKEN) env.AUTH_TOKEN = options.AUTH_TOKEN
  if (options.ADMIN_TOKEN) env.ADMIN_TOKEN = options.ADMIN_TOKEN
  /* 生产默认是 fail-closed（没有 ADMIN_TOKEN 就不允许初始化），
     但绝大多数用例只关心初始化之后的行为，所以测试环境默认打开开放初始化；
     专门验证「闸门」的用例会显式关掉它。 */
  env.ALLOW_OPEN_SETUP = options.ALLOW_OPEN_SETUP === undefined ? '1' : options.ALLOW_OPEN_SETUP
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

group('分组管理')
{
  const env = makeEnv()
  const token = await initConsole(env)

  // 空配置也要有内置四组：升级后控制台与订阅输出与旧版一致
  const empty = await getConfig(env, token)
  eq('默认返回内置四组', empty.body.config.groups.length, 4)
  eq('内置组 id 沿用 region 键', empty.body.config.groups.map(g => g.id).join(','), 'us,jp,hk,relay')

  // 旧数据只有 region：读出来要折成 groupId，且分组不变
  const legacy = await putConfig(env, token, { rev: 0, nodes: fullNodes() })
  eq('旧 region 数据保存成功', legacy.status, 200)
  const legacyNode = legacy.body.config.nodes.find(n => n.id === 'n_hk1')
  eq('region 折算为 groupId', legacyNode.groupId, 'hk')
  eq('不再写回 region 字段', Object.prototype.hasOwnProperty.call(legacyNode, 'region'), false)

  // 自定义分组 + 节点归属
  const custom = await putConfig(env, token, {
    rev: 1,
    authToken: SUB_TOKEN,
    groups: [
      { id: 'hk', name: '🇭🇰港台节点' },
      { id: 'g_game', name: '🎮 游戏节点', icon: 'https://cdn.example.com/game.png' },
    ],
    nodes: [
      { id: 'n_hk1', name: 'HK-01', type: 'ss', server: 'hk.example.com', port: 8388, groupId: 'hk', enabled: true, cipher: 'aes-256-gcm', password: 'p1' },
      { id: 'n_g1', name: 'GAME-01', type: 'ss', server: 'g.example.com', port: 8388, groupId: 'g_game', enabled: true, cipher: 'aes-256-gcm', password: 'p2' },
      { id: 'n_free', name: 'FREE-01', type: 'ss', server: 'f.example.com', port: 8388, groupId: 'g_missing', enabled: true, cipher: 'aes-256-gcm', password: 'p3' },
    ],
  })
  eq('自定义分组保存成功', custom.status, 200)
  eq('未知分组 id 折成未分组', custom.body.config.nodes.find(n => n.id === 'n_free').groupId, '')

  const sub = await call(env, '/?token=' + SUB_TOKEN)
  const groupSection = sub.body.split('proxy-groups:')[1].split('rule-providers:')[0]
  check('自定义分组写入策略组', groupSection.includes('- name: "🎮 游戏节点"'), '未找到自定义分组')
  check('自定义分组带自定义图标', groupSection.includes('icon: "https://cdn.example.com/game.png"'))
  check('自定义分组包含其节点', groupSection.split('🎮 游戏节点')[1].split('- name:')[0].includes('"GAME-01"'))
  check('已删除的内置分组不再输出', !groupSection.includes('🇯🇵日韩节点'))
  check('未分组节点只出现在主组', groupSection.split('- name: "🇭🇰港台节点"')[0].includes('"FREE-01"'))

  // 改名不改归属
  const renamed = await putConfig(env, token, {
    rev: 2,
    groups: [
      { id: 'hk', name: '🇭🇰 香港专线' },
      { id: 'g_game', name: '🎮 游戏加速' },
    ],
    nodes: custom.body.config.nodes,
  })
  eq('分组改名成功', renamed.status, 200)
  const renamedSub = await call(env, '/?token=' + SUB_TOKEN)
  check('改名后策略组用新名字', renamedSub.body.includes('- name: "🎮 游戏加速"'))
  check('改名后节点仍在原分组', renamedSub.body.split('🎮 游戏加速')[1].split('- name:')[0].includes('"GAME-01"'))

  // 写入校验
  const badName = await putConfig(env, token, { rev: 3, groups: [{ id: 'a', name: 'X' }, { id: 'b', name: 'X' }], nodes: [] })
  eq('分组名重复 400', badName.status, 400)
  const reserved = await putConfig(env, token, { rev: 3, groups: [{ id: 'a', name: 'DIRECT' }], nodes: [] })
  eq('分组名占用内置策略 400', reserved.status, 400)
  const clashNode = await putConfig(env, token, {
    rev: 3,
    groups: [{ id: 'a', name: '🎮 游戏加速' }],
    nodes: [{ id: 'n_x', name: '🎮 游戏加速', type: 'ss', server: 'x.example.com', port: 8388, enabled: true, cipher: 'aes-256-gcm', password: 'p' }],
  })
  eq('节点与分组同名 400', clashNode.status, 400)
  const badIcon = await putConfig(env, token, { rev: 3, groups: [{ id: 'a', name: 'A', icon: 'javascript:alert(1)' }], nodes: [] })
  eq('非 https 图标 400', badIcon.status, 400)
  const tooMany = await putConfig(env, token, {
    rev: 3,
    groups: Array.from({ length: 25 }, (_, i) => ({ id: 'g' + i, name: 'G' + i })),
    nodes: [],
  })
  eq('分组数量超限 400', tooMany.status, 400)
  const noName = await putConfig(env, token, { rev: 3, groups: [{ id: 'a' }], nodes: [] })
  eq('分组名缺失 400', noName.status, 400)
  const noGroups = await putConfig(env, token, { rev: 3, groups: [], nodes: [] })
  eq('空分组表 400', noGroups.status, 400)

  // 删除分组：节点保留、regionOrder 里的旧键被清掉
  const dropped = await putConfig(env, token, {
    rev: 3,
    groups: [{ id: 'g_game', name: '🎮 游戏加速' }],
    nodes: renamed.body.config.nodes,
    regionOrder: { hk: ['n_hk1'], g_game: ['n_g1'] },
  })
  eq('删除分组成功', dropped.status, 200)
  check('regionOrder 只保留现存分组', !Object.prototype.hasOwnProperty.call(dropped.body.config.regionOrder, 'hk'),
    JSON.stringify(dropped.body.config.regionOrder))
  eq('被删分组的节点仍保留', dropped.body.config.nodes.some(n => n.id === 'n_hk1'), true)
  eq('被删分组的节点归入未分组', dropped.body.config.nodes.find(n => n.id === 'n_hk1').groupId, '')
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

group('角色与节点范围')
{
  const env = makeEnv()
  const ownerToken = await initConsole(env)
  await putConfig(env, ownerToken, { rev: 0, nodes: fullNodes(), authToken: SUB_TOKEN })

  const ownerLogin = await login(env)
  eq('初始化账号是所有者', ownerLogin.body.user.role, 'owner')
  const list = (await call(env, '/api/users', { headers: bearer(ownerToken) })).body
  eq('账号列表带角色', list.users[0].role, 'owner')

  const createUser = async (username, password, extra) => {
    const users = (await call(env, '/api/users', { headers: bearer(ownerToken) })).body
    return call(env, '/api/users', {
      method: 'POST',
      headers: { ...bearer(ownerToken), 'content-type': 'application/json' },
      body: JSON.stringify({ rev: users.rev, username, password, ...extra }),
    })
  }

  const created = await createUser('member', 'Member-Pass-77', {
    role: 'member',
    scope: { allNodes: false, nodeIds: ['n_hk1', 'n_hk2', 'n_hk1'] },
  })
  eq('创建成员 200', created.status, 200)
  const member = created.body.users.find(user => user.username === 'member')
  eq('指定范围去重后生效', member.scope.nodeIds.length, 2)

  const bare = await createUser('bare', 'Bare-Pass-123')
  const bareUser = bare.body.users.find(user => user.username === 'bare')
  eq('新成员默认不分配节点', bareUser.role === 'member' && bareUser.scope.allNodes === false && bareUser.scope.nodeIds.length === 0, true)

  const memberLogin = await login(env, 'member', 'Member-Pass-77')
  const memberToken = memberLogin.body.token
  eq('成员登录成功', typeof memberToken, 'string')
  eq('登录响应带角色', memberLogin.body.user.role, 'member')

  const cfg = await getConfig(env, memberToken)
  eq('成员只看到授权节点', cfg.body.config.nodes.length, 2)
  check('成员配置里没有全局令牌', !JSON.stringify(cfg.body).includes(SUB_TOKEN))
  eq('成员可以写自己的节点', cfg.body.meta.canWrite, true)
  eq('成员 meta 角色', cfg.body.meta.role, 'member')
  check('成员订阅链接是独立令牌', cfg.body.meta.subUrl.includes('token=sub_'), cfg.body.meta.subUrl)

  const preview = await call(env, '/api/preview', { headers: bearer(memberToken) })
  check('成员预览只含授权节点', preview.body.includes('HK-01') && !preview.body.includes('US-01'))

  const saveAsMember = await putConfig(env, memberToken, { rev: cfg.body.config.rev, nodes: [] })
  eq('成员不能保存配置', saveAsMember.status, 403)
  eq('成员不能列出账号', (await call(env, '/api/users', { headers: bearer(memberToken) })).status, 403)
  eq('成员不能创建账号', (await call(env, '/api/users', {
    method: 'POST',
    headers: { ...bearer(memberToken), 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'evil', password: 'Evil-Pass-1234' }),
  })).status, 403)

  const memberSubToken = new URL(cfg.body.meta.subUrl).searchParams.get('token')
  const memberSub = await call(env, '/?token=' + encodeURIComponent(memberSubToken))
  eq('成员独立订阅 200', memberSub.status, 200)
  check('成员订阅只含授权节点', memberSub.body.includes('HK-01') && !memberSub.body.includes('US-01'))
  eq('成员订阅 HEAD 200', (await call(env, '/?token=' + encodeURIComponent(memberSubToken), { method: 'HEAD' })).status, 200)
  check('全局令牌仍是全部节点', (await call(env, '/?token=' + SUB_TOKEN)).body.includes('US-01'))

  const before = (await call(env, '/api/users', { headers: bearer(ownerToken) })).body
  const memberId = before.users.find(user => user.username === 'member').id
  const expanded = await call(env, '/api/users/update', {
    method: 'POST',
    headers: { ...bearer(ownerToken), 'content-type': 'application/json' },
    body: JSON.stringify({ rev: before.rev, id: memberId, scope: { allNodes: true, nodeIds: [] } }),
  })
  eq('所有者调整节点范围 200', expanded.status, 200)
  const cfgExpanded = await getConfig(env, memberToken)
  eq('范围调整后成员可见全部节点', cfgExpanded.body.config.nodes.length, fullNodes().length)
  eq('范围调整不轮换订阅令牌', new URL(cfgExpanded.body.meta.subUrl).searchParams.get('token'), memberSubToken)

  const badPassword = await call(env, '/api/password', {
    method: 'POST',
    headers: { ...bearer(memberToken), 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'wrong-password', newPassword: 'Member-Pass-88' }),
  })
  eq('当前密码错误被拒', badPassword.status, 400)

  const changed = await call(env, '/api/password', {
    method: 'POST',
    headers: { ...bearer(memberToken), 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'Member-Pass-77', newPassword: 'Member-Pass-88' }),
  })
  eq('成员自助改密 200', changed.status, 200)
  check('改密返回新会话', typeof changed.body.token === 'string' && changed.body.token !== memberToken)
  eq('旧会话立即失效', (await getConfig(env, memberToken)).status, 401)
  check('旧订阅链接不再下发节点', !(await call(env, '/?token=' + encodeURIComponent(memberSubToken))).body.includes('HK-01'))
  const cfgRotated = await getConfig(env, changed.body.token)
  const rotatedSub = new URL(cfgRotated.body.meta.subUrl).searchParams.get('token')
  check('新订阅链接立即可用', (await call(env, '/?token=' + encodeURIComponent(rotatedSub))).body.includes('HK-01'))

  const ownerId = before.users.find(user => user.role === 'owner').id
  const latestUsers = (await call(env, '/api/users', { headers: bearer(ownerToken) })).body
  const demote = await call(env, '/api/users/update', {
    method: 'POST',
    headers: { ...bearer(ownerToken), 'content-type': 'application/json' },
    body: JSON.stringify({ rev: latestUsers.rev, id: ownerId, role: 'member' }),
  })
  eq('最后一个所有者不能降级', demote.status, 400)
}

group('成员个人节点')
{
  const env = makeEnv()
  const ownerToken = await initConsole(env)
  await putConfig(env, ownerToken, { rev: 0, nodes: fullNodes(), authToken: SUB_TOKEN })

  const users = (await call(env, '/api/users', { headers: bearer(ownerToken) })).body
  await call(env, '/api/users', {
    method: 'POST',
    headers: { ...bearer(ownerToken), 'content-type': 'application/json' },
    body: JSON.stringify({
      rev: users.rev,
      username: 'personal',
      password: 'Personal-Pass-1',
      role: 'member',
      scope: { allNodes: false, nodeIds: ['n_hk1', 'n_hk2'] },
    }),
  })
  const memberToken = (await login(env, 'personal', 'Personal-Pass-1')).body.token

  const putPersonal = (token, payload) => call(env, '/api/nodes', {
    method: 'PUT',
    headers: { ...bearer(token), 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const first = await putPersonal(memberToken, {
    rev: 0,
    nodes: [{ ...ssNode(), id: 'p_mine1', name: 'MINE-01', server: 'mine.example.net' }],
  })
  eq('成员保存个人节点 200', first.status, 200)
  eq('合并后包含共享与个人节点', first.body.config.nodes.length, 3)
  eq('管理员配置 rev 不变', first.body.config.rev, 1)
  eq('meta 返回个人节点 rev', first.body.meta.personalRev, 1)
  eq('meta 标记个人节点', first.body.meta.personalNodeIds.join(','), 'p_mine1')
  eq('meta 给出个人节点上限', first.body.meta.maxPersonalNodes, 100)

  const adminCfg = await getConfig(env, ownerToken)
  eq('管理员配置未被个人节点污染', adminCfg.body.config.nodes.length, fullNodes().length)
  eq('管理员 rev 未被个人保存推进', adminCfg.body.config.rev, 1)
  check('管理员配置看不到个人节点', !JSON.stringify(adminCfg.body.config).includes('MINE-01'))

  const memberCfg = await getConfig(env, memberToken)
  check('成员配置看到个人节点', memberCfg.body.config.nodes.some(node => node.name === 'MINE-01'))
  const memberSub = new URL(memberCfg.body.meta.subUrl).searchParams.get('token')
  const memberYaml = await call(env, '/?token=' + encodeURIComponent(memberSub))
  check('成员订阅包含个人节点', memberYaml.body.includes('MINE-01'))
  check('成员预览包含个人节点', (await call(env, '/api/preview', { headers: bearer(memberToken) })).body.includes('MINE-01'))
  check('全局订阅不包含个人节点', !(await call(env, '/?token=' + SUB_TOKEN)).body.includes('MINE-01'))

  const updated = await putPersonal(memberToken, {
    rev: 1,
    nodes: [{ ...ssNode(), id: 'p_mine1', name: 'MINE-02', server: 'mine.example.net' }],
  })
  eq('修改个人节点 200', updated.status, 200)
  eq('个人节点 rev 自增', updated.body.meta.personalRev, 2)
  check('修改后旧名称消失', !updated.body.config.nodes.some(node => node.name === 'MINE-01'))

  const stale = await putPersonal(memberToken, { rev: 1, nodes: [] })
  eq('过期个人 rev 409', stale.status, 409)
  eq('409 带回最新个人 rev', stale.body.rev, 2)

  const hijack = await putPersonal(memberToken, {
    rev: 2,
    nodes: [{ ...ssNode(), id: 'n_hk1', name: 'HIJACK-HK' }],
  })
  eq('提交共享节点 id 仍可保存为个人节点', hijack.status, 200)
  const hijacked = hijack.body.config.nodes.find(node => node.name === 'HIJACK-HK')
  check('共享节点 id 被重写为 p_', hijacked && hijacked.id.startsWith('p_') && hijacked.id !== 'n_hk1', hijacked && hijacked.id)
  eq('原共享节点保持不变', hijack.body.config.nodes.find(node => node.id === 'n_hk1').name, 'HK-01')
  eq('管理员节点仍为原数量', (await getConfig(env, ownerToken)).body.config.nodes.length, fullNodes().length)

  const collide = await putPersonal(memberToken, {
    rev: 3,
    nodes: [{ ...ssNode(), id: 'p_dup', name: 'HK-01' }],
  })
  eq('与共享节点重名仍可保存', collide.status, 200)
  check('重名个人节点自动加后缀', collide.body.config.nodes.some(node => node.name === 'HK-01 · 个人'))

  const tooMany = Array.from({ length: 101 }, (_, i) => ({
    ...ssNode(),
    id: 'p_bulk_' + i,
    name: 'BULK-' + i,
  }))
  eq('个人节点超过 100 个被拒', (await putPersonal(memberToken, { rev: 4, nodes: tooMany })).status, 400)
  eq('所有者不能走个人节点接口', (await putPersonal(ownerToken, { rev: 0, nodes: [] })).status, 400)
  eq('个人节点接口拒绝非 PUT', (await call(env, '/api/nodes', { headers: bearer(memberToken) })).status, 405)

  const currentUsers = (await call(env, '/api/users', { headers: bearer(ownerToken) })).body
  const memberId = currentUsers.users.find(user => user.username === 'personal').id
  check('个人节点键已写入', env.data.has('user_nodes:' + memberId))
  await call(env, '/api/users/delete', {
    method: 'POST',
    headers: { ...bearer(ownerToken), 'content-type': 'application/json' },
    body: JSON.stringify({ rev: currentUsers.rev, id: memberId }),
  })
  check('删除账号时清理个人节点', !env.data.has('user_nodes:' + memberId))
}

group('成员个人分组')
{
  const env = makeEnv()
  const ownerToken = await initConsole(env)
  await putConfig(env, ownerToken, { rev: 0, nodes: fullNodes(), authToken: SUB_TOKEN })

  const users = (await call(env, '/api/users', { headers: bearer(ownerToken) })).body
  await call(env, '/api/users', {
    method: 'POST',
    headers: { ...bearer(ownerToken), 'content-type': 'application/json' },
    body: JSON.stringify({
      rev: users.rev,
      username: 'grouper',
      password: 'Grouper-Pass-1',
      role: 'member',
      scope: { allNodes: false, nodeIds: ['n_hk1'] },
    }),
  })
  const memberToken = (await login(env, 'grouper', 'Grouper-Pass-1')).body.token
  const putPersonal = (token, payload) => call(env, '/api/nodes', {
    method: 'PUT',
    headers: { ...bearer(token), 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const first = await putPersonal(memberToken, {
    rev: 0,
    groups: [{ id: 'mg_game', name: '🎮 我的游戏' }],
    nodes: [{ ...ssNode(), id: 'p_g1', name: 'MY-GAME-1', groupId: 'mg_game' }],
  })
  eq('成员保存个人分组 200', first.status, 200)
  const firstIds = first.body.config.groups.map(g => g.id)
  check('个人分组进入合并分组表', firstIds.includes('mg_game'), firstIds.join(','))
  check('共享分组仍在', firstIds.includes('hk') || firstIds.includes('us'), firstIds.join(','))
  eq('meta 返回个人分组 id', first.body.meta.personalGroupIds.join(','), 'mg_game')
  eq('meta 给出个人分组数量', first.body.meta.personalGroupCount, 1)
  eq('meta 给出个人分组上限', first.body.meta.maxPersonalGroups, 12)

  const memberCfg = await getConfig(env, memberToken)
  check('成员配置含个人分组', memberCfg.body.config.groups.some(g => g.id === 'mg_game'))
  const memberSub = new URL(memberCfg.body.meta.subUrl).searchParams.get('token')
  const yaml = await call(env, '/?token=' + encodeURIComponent(memberSub))
  check('成员订阅输出个人分组', yaml.body.includes('- name: "🎮 我的游戏"'))
  check('个人节点落在个人分组',
    yaml.body.split('🎮 我的游戏')[1].split('- name:')[0].includes('"MY-GAME-1"'))

  const adminCfg = await getConfig(env, ownerToken)
  check('所有者看不到成员分组', !adminCfg.body.config.groups.some(g => g.id === 'mg_game'))
  check('全局订阅不含成员分组', !(await call(env, '/?token=' + SUB_TOKEN)).body.includes('🎮 我的游戏'))

  // 旧版前端只传 nodes：已存的个人分组不能被顺手清空
  const nodesOnly = await putPersonal(memberToken, {
    rev: 1,
    nodes: [{ ...ssNode(), id: 'p_g1', name: 'MY-GAME-1', groupId: 'mg_game' }],
  })
  eq('只传节点也能保存', nodesOnly.status, 200)
  eq('未传 groups 时保留个人分组', nodesOnly.body.meta.personalGroupIds.join(','), 'mg_game')

  // 写入校验
  const dupShared = await putPersonal(memberToken, {
    rev: 2,
    groups: [{ id: 'mg_a', name: '🇭🇰港台节点' }],
    nodes: [],
  })
  eq('与共享分组重名 400', dupShared.status, 400)
  const reserved = await putPersonal(memberToken, {
    rev: 2,
    groups: [{ id: 'mg_a', name: 'DIRECT' }],
    nodes: [],
  })
  eq('占用内置策略名 400', reserved.status, 400)
  const tooMany = await putPersonal(memberToken, {
    rev: 2,
    groups: Array.from({ length: 13 }, (_, i) => ({ id: 'mg_' + i, name: 'MG-' + i })),
    nodes: [],
  })
  eq('个人分组超过 12 个 400', tooMany.status, 400)
  const hijack = await putPersonal(memberToken, {
    rev: 2,
    groups: [{ id: 'hk', name: '我的香港' }],
    nodes: [],
  })
  eq('提交共享分组 id 仍可保存', hijack.status, 200)
  const hijacked = hijack.body.config.groups.find(g => g.name === '我的香港')
  check('共享分组 id 被重写为 mg_', hijacked && hijacked.id.startsWith('mg_') && hijacked.id !== 'hk', hijacked && hijacked.id)
  eq('原共享分组未被改名',
    (await getConfig(env, ownerToken)).body.config.groups.find(g => g.id === 'hk').name, '🇭🇰港台节点')

  const clash = await putPersonal(memberToken, {
    rev: 3,
    groups: [{ id: 'mg_b', name: 'HK-01' }],
    nodes: [],
  })
  eq('个人分组与共享节点同名 400', clash.status, 400)

  // 删除分组：节点保留，归入未分组
  const dropped = await putPersonal(memberToken, {
    rev: 3,
    groups: [],
    nodes: [{ ...ssNode(), id: 'p_g1', name: 'MY-GAME-1', groupId: 'mg_game' }],
  })
  eq('清空个人分组 200', dropped.status, 200)
  eq('被删分组下的节点归入未分组', dropped.body.config.nodes.find(n => n.id === 'p_g1').groupId, '')
  check('订阅不再输出个人分组', !(await call(env, '/?token=' + encodeURIComponent(memberSub))).body.includes('🎮 我的游戏'))

  // 手工改坏的 KV：坏分组丢弃，好分组保留
  const currentUsers = (await call(env, '/api/users', { headers: bearer(ownerToken) })).body
  const memberId = currentUsers.users.find(user => user.username === 'grouper').id
  env.data.set('user_nodes:' + memberId, JSON.stringify({
    v: 1,
    rev: 9,
    nodes: [],
    groups: [{ id: 'bad', name: '' }, { id: 'mg_ok', name: '正常分组' }, { id: 'mg_ok', name: '重复 id' }],
  }))
  const recovered = await getConfig(env, memberToken)
  eq('坏分组被丢弃，好分组保留',
    recovered.body.config.groups.filter(g => g.id === 'mg_ok').length, 1)
  check('空名分组不会进入配置', !recovered.body.config.groups.some(g => g.id === 'bad'))
}

group('旧账号库迁移')
{
  const env = makeEnv()
  const token = await initConsole(env)
  await putConfig(env, token, { rev: 0, nodes: fullNodes() })
  const raw = JSON.parse(env.data.get('users'))
  delete raw.users[0].role
  delete raw.users[0].scope
  raw.users.push({
    ...raw.users[0],
    id: 'u_legacy_second',
    username: 'legacy2',
    usernameKey: 'legacy2',
  })
  env.data.set('users', JSON.stringify(raw))

  const first = await login(env)
  eq('旧库首个账号成为所有者', first.body.user.role, 'owner')
  const second = await login(env, 'legacy2', 'Correct Horse 1')
  eq('旧库其余账号成为成员', second.body.user.role, 'member')
  eq('旧成员默认保留全部节点', second.body.user.scope.allNodes, true)
  const cfg = await getConfig(env, second.body.token)
  eq('旧成员订阅不被收窄', cfg.body.config.nodes.length, fullNodes().length)
  eq('旧成员默认可管理个人节点', cfg.body.meta.canWrite, true)
  eq('旧成员不能管理账号', (await call(env, '/api/users', { headers: bearer(second.body.token) })).status, 403)
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
  eq('伪装页带 HSTS', decoy.headers.get('strict-transport-security'), 'max-age=15552000; includeSubDomains')
  eq('伪装页带 COOP', decoy.headers.get('cross-origin-opener-policy'), 'same-origin')
  const head = await call(env, '/', { method: 'HEAD' })
  check('HEAD 伪装页也带 CSP', /script-src 'nonce-[0-9a-f]{32}'/.test(String(head.headers.get('content-security-policy'))))
  const csp = String(decoy.headers.get('content-security-policy'))
  const decoyNonce = (csp.match(/script-src 'nonce-([0-9a-f]{32})'/) || [])[1]
  check('伪装页不再放开 style unsafe-inline', !csp.includes("style-src 'unsafe-inline'"), csp)
  check('伪装页 style 标签带同一 nonce', !!decoyNonce && decoy.body.includes('<style nonce="' + decoyNonce + '">'))

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
  eq('12 位单字符重复口令被拒', (await create('x'.repeat(12))).status, 400)
  eq('12 位正常口令通过', (await create('Qv7#tR2$wLp9')).status, 200)
  eq('常见弱口令被拒', (await create('password1234')).status, 400)
  eq('键盘序列口令被拒', (await create('qwertyuiop12')).status, 400)

  const weak = makeEnv({ AUTH_TOKEN: 'short-token' })
  check('过短的 AUTH_TOKEN 被忽略', (await call(weak, '/?token=short-token')).contentType.startsWith('text/html'))

  const strong = makeEnv()
  strong.PASSWORD_ITERATIONS = 20000
  await asAdmin(strong)
  const stored = JSON.parse(strong.data.get('users'))
  eq('PASSWORD_ITERATIONS 写入新账号', stored.users[0].passwordIterations, 20000)
  eq('提高迭代后仍能登录', (await login(strong)).status, 200)
}

group('令牌与会话加固')
{
  const env = makeEnv()
  const token = await initConsole(env)
  await putConfig(env, token, { rev: 0, nodes: [ssNode({ id: 'n_a', name: 'A-01' })], authToken: SUB_TOKEN })

  // 形态不符的 Bearer 必须在读 KV 之前被拒，否则未鉴权请求能放大成 KV 读
  let kvReads = 0
  const originalGet = env.SUB_KV.get
  env.SUB_KV.get = async key => { kvReads += 1; return originalGet(key) }
  eq('畸形会话令牌返回 401', (await call(env, '/api/config', { headers: bearer('plain-token-without-dot') })).status, 401)
  eq('畸形会话令牌不读 KV', kvReads, 0)
  eq('超长会话令牌返回 401', (await call(env, '/api/config', { headers: bearer('a'.repeat(600) + '.' + 'b'.repeat(600)) })).status, 401)
  eq('超长会话令牌不读 KV', kvReads, 0)
  env.SUB_KV.get = originalGet

  const users = (await call(env, '/api/users', { headers: bearer(token) })).body
  await call(env, '/api/users', {
    method: 'POST',
    headers: { ...bearer(token), 'content-type': 'application/json' },
    body: JSON.stringify({
      rev: users.rev,
      username: 'subscriber',
      password: 'Subscriber-99',
      role: 'member',
      scope: { allNodes: true },
    }),
  })
  const memberToken = (await login(env, 'subscriber', 'Subscriber-99')).body.token
  const memberCfg = (await getConfig(env, memberToken)).body
  const memberSub = new URL(memberCfg.meta.subUrl).searchParams.get('token')
  check('成员订阅令牌带账号定位段', /^sub_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(memberSub), memberSub)
  eq('新格式订阅令牌可拉取', (await call(env, '/?token=' + encodeURIComponent(memberSub))).status, 200)
  const forged = 'sub_' + Buffer.from('u_does-not-exist').toString('base64url') + '.' + 'A'.repeat(43)
  check('伪造账号段拿不到订阅', (await call(env, '/?token=' + encodeURIComponent(forged))).contentType.startsWith('text/html'))
  const legacy = 'sub_' + 'B'.repeat(43)
  check('旧格式订阅令牌不会误判通过', (await call(env, '/?token=' + encodeURIComponent(legacy))).contentType.startsWith('text/html'))

  const hashBase = await putConfig(env, token, {
    rev: await currentRev(env, token),
    nodes: [ssNode({ id: 'n_a', name: 'A-01' })],
    providerBase: 'https://cdn.example.com/rules#frag',
  })
  eq('镜像地址含 # 被拒', hashBase.status, 400)

  const zeroWidth = await putConfig(env, token, {
    rev: await currentRev(env, token),
    nodes: [ssNode({ id: 'n_a', name: 'A-01\u200b' })],
  })
  eq('节点名含零宽字符被拒', zeroWidth.status, 400)

  const hugeStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"username":"x","password":"' + 'a'.repeat(64) + '","pad":"'))
      controller.enqueue(new Uint8Array(300 * 1024).fill(97))
      controller.enqueue(new TextEncoder().encode('"}'))
      controller.close()
    },
  })
  // 未初始化的实例才会走到读请求体那一步（初始化闸门在解析之前就拦住了）
  const bodyEnv = makeEnv()
  const huge = await call(bodyEnv, '/api/setup', { method: 'POST', body: hugeStream, duplex: 'half' })
  eq('无 content-length 的超大请求体被 413', huge.status, 413)

  const shortAdmin = makeEnv({ ADMIN_TOKEN: 'short' })
  const authInfo = (await call(shortAdmin, '/api/auth')).body
  check('过短的 ADMIN_TOKEN 被忽略', authInfo.recovery === false && authInfo.setupLocked === false, JSON.stringify(authInfo))

  const ttlEnv = makeEnv()
  ttlEnv.SESSION_TTL_HOURS = '1'
  await asAdmin(ttlEnv)
  const ttlToken = (await login(ttlEnv)).body.token
  const ttlPayload = JSON.parse(Buffer.from(ttlToken.split('.')[0], 'base64url').toString())
  eq('SESSION_TTL_HOURS 生效', ttlPayload.exp - ttlPayload.iat, 3600)

  const secEnv = makeEnv()
  const beforeSecret = await initConsole(secEnv)
  eq('未配置 SESSION_SECRET 时会话可用', (await getConfig(secEnv, beforeSecret)).status, 200)
  secEnv.SESSION_SECRET = 'k'.repeat(40)
  eq('配置 SESSION_SECRET 后旧会话立即失效', (await getConfig(secEnv, beforeSecret)).status, 401)
  const afterSecret = (await login(secEnv)).body.token
  eq('配置 SESSION_SECRET 后可正常登录', (await getConfig(secEnv, afterSecret)).status, 200)
}

group('初始化闸门')
{
  /* 生产默认 fail-closed：没有 ADMIN_TOKEN 时，未初始化的实例不允许任何人初始化，
     否则扫描器可以直接抢注所有者。 */
  const locked = makeEnv({ ALLOW_OPEN_SETUP: '' })
  const info = (await call(locked, '/api/auth')).body
  eq('未配置 ADMIN_TOKEN 时 setupDisabled', info.setupDisabled, true)
  eq('未配置 ADMIN_TOKEN 时不需要令牌（因为根本不允许初始化）', info.setupLocked, false)
  eq('未配置 ADMIN_TOKEN 时 allowOpenSetup', info.allowOpenSetup, false)
  const denied = await call(locked, '/api/setup', {
    method: 'POST',
    body: JSON.stringify({ username: 'intruder@example.com', password: 'Intruder-Pass-99' }),
  })
  eq('默认拒绝开放初始化', denied.status, 503)
  eq('被拒后没有写入任何账号', locked.data.has('users'), false)
  check('拒绝信息指明要配 ADMIN_TOKEN', String(denied.body.error).includes('ADMIN_TOKEN'), denied.body.error)

  // 显式打开 ALLOW_OPEN_SETUP 才回到旧的零配置行为
  const open = makeEnv()
  eq('ALLOW_OPEN_SETUP=1 时可初始化', (await asAdmin(open)).status, 200)
  const openInfo = (await call(open, '/api/auth')).body
  eq('开放初始化时 setupDisabled 为 false', openInfo.setupDisabled, false)

  // 配了 ADMIN_TOKEN：不带令牌一律 403，带了才放行
  const gated = makeEnv({ ADMIN_TOKEN: 'admin-token-0123456789abcdef', ALLOW_OPEN_SETUP: '' })
  const gatedInfo = (await call(gated, '/api/auth')).body
  eq('配了 ADMIN_TOKEN 时 setupLocked', gatedInfo.setupLocked, true)
  eq('配了 ADMIN_TOKEN 时 setupDisabled', gatedInfo.setupDisabled, false)
  const noToken = await call(gated, '/api/setup', {
    method: 'POST',
    body: JSON.stringify({ username: 'x@example.com', password: 'X-Pass-1234567' }),
  })
  eq('不带令牌初始化被 403', noToken.status, 403)
  eq('带令牌可以初始化', (await asAdmin(gated)).status, 200)
  eq('初始化后不再需要令牌', (await call(gated, '/api/setup', {
    method: 'POST',
    headers: bearer('admin-token-0123456789abcdef'),
    body: JSON.stringify({ username: 'y@example.com', password: 'Y-Pass-1234567' }),
  })).status, 409)
}

group('成员可见面收敛')
{
  const env = makeEnv()
  const ownerToken = await initConsole(env)
  await putConfig(env, ownerToken, {
    rev: 0,
    nodes: fullNodes(),
    authToken: SUB_TOKEN,
    defaults: { vlessUuid: UUID_B, vlessPublicKey: 'OWNER-PRESET-PBK', vlessServername: 'preset.example.com', vlessPort: 443 },
  })

  const users = (await call(env, '/api/users', { headers: bearer(ownerToken) })).body
  await call(env, '/api/users', {
    method: 'POST',
    headers: { ...bearer(ownerToken), 'content-type': 'application/json' },
    body: JSON.stringify({
      rev: users.rev, username: 'scoped', password: 'Scoped-Pass-123',
      role: 'member', scope: { allNodes: false, nodeIds: ['n_hk1'] },
    }),
  })

  const scopedToken = (await login(env, 'scoped', 'Scoped-Pass-123')).body.token
  const cfg = (await getConfig(env, scopedToken)).body
  eq('成员拿不到所有者的预设 UUID', cfg.config.defaults.vlessUuid, undefined)
  eq('成员预设整体为空', Object.keys(cfg.config.defaults).length, 0)
  check('regionOrder 只含授权节点', JSON.stringify(cfg.config.regionOrder) === JSON.stringify({ hk: ['n_hk1'] }), JSON.stringify(cfg.config.regionOrder))
  check('成员响应里不出现所有者凭据', !JSON.stringify(cfg).includes('OWNER-PRESET-PBK'))

  const ownerCfg = (await getConfig(env, ownerToken)).body
  eq('所有者仍能读回预设 UUID', ownerCfg.config.defaults.vlessUuid, UUID_B)
  eq('所有者 regionOrder 完整', Object.keys(ownerCfg.config.regionOrder).length, 3)

  const sub = await call(env, '/?token=' + encodeURIComponent(new URL(cfg.meta.subUrl).searchParams.get('token')))
  check('成员订阅不含未授权节点', sub.body.includes('HK-01') && !sub.body.includes('US-01'))
}

group('脏数据与令牌形态')
{
  // nodes 数组里混入 null / 原始值：旧版本、手工编辑都会留下这种数据，
  // 不能让一句 node.enabled 把整条订阅打成 500
  const dirty = makeEnv()
  const token = await initConsole(dirty)
  await putConfig(dirty, token, { rev: 0, nodes: [ssNode({ id: 'a', name: 'A-01' })], authToken: SUB_TOKEN })
  const raw = JSON.parse(dirty.data.get('config'))
  raw.nodes = [null, 42, 'x', { id: 'n_ok', name: 'OK-01', type: 'ss', server: 'ok.example.com', port: 8388, enabled: true, cipher: 'aes-256-gcm', password: 'p' }]
  dirty.data.set('config', JSON.stringify(raw))

  const sub = await call(dirty, '/?token=' + SUB_TOKEN)
  eq('脏元素不拖垮订阅', sub.status, 200)
  check('订阅跳过脏元素并渲染正常节点', sub.body.includes('OK-01') && !sub.body.includes('null'), sub.body.slice(0, 80))
  eq('预览同样不 500', (await call(dirty, '/api/preview', { headers: bearer(token) })).status, 200)
  eq('成员视角读配置也不 500', (await getConfig(dirty, token)).status, 200)
  flushLogs('dirty-nodes')

  // 读路径必须和写路径一样卡令牌长度，否则 KV 被改坏后几位字符就能拉走订阅
  const shortTok = makeEnv()
  const st = await initConsole(shortTok)
  await putConfig(shortTok, st, { rev: 0, nodes: [], authToken: SUB_TOKEN })
  const shortRaw = JSON.parse(shortTok.data.get('config'))
  shortRaw.authToken = 'abc'
  shortTok.data.set('config', JSON.stringify(shortRaw))
  check('KV 里的短令牌被忽略', (await call(shortTok, '/?token=abc')).contentType.startsWith('text/html'))
  check('短令牌被忽略后原令牌也失效（说明读的是 KV 值）', (await call(shortTok, '/?token=' + SUB_TOKEN)).contentType.startsWith('text/html'))
  flushLogs('short-token')

  // 错误令牌只应扣一次配额：否则爆破预算只剩配置值的一半
  const rl = makeEnv()
  const ip = nextIp()
  const codes = []
  for (let i = 0; i < 150; i++) codes.push((await call(rl, '/?token=wrong-token-xxxx', { ip })).status)
  eq('错误令牌每次只扣一次配额', codes.every(code => code === 200), true)
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
