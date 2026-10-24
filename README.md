# Transit Hub

<p align="center">
  <img src="https://img.shields.io/badge/Cloudflare-Workers-f6821f?logo=cloudflare&logoColor=white" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/存储-KV-2b2f36?logo=cloudflare&logoColor=white" alt="Cloudflare KV">
  <img src="https://img.shields.io/badge/运行时依赖-0-brightgreen" alt="零依赖">
  <img src="https://img.shields.io/badge/version-2.8.0-4f46e5" alt="v2.8.0">
</p>

> **Clash / Mihomo 订阅生成器 + 可视化管理控制台**，整个后端就是一个 Cloudflare Worker。
> 节点只存在你自己的 KV 里 —— **仓库不含任何节点**：没有服务器地址、UUID、密码或公钥，首次部署的订阅是空配置。

---

## 功能

| 模块 | 能力 |
| --- | --- |
| 订阅输出 | `GET /?token=<AUTH_TOKEN>` 直接给出 Clash / Mihomo 可用的 YAML，带 `subscription-userinfo` 与 `profile-update-interval`；成员另有专属链接，输出分配给自己的共享节点与个人节点 |
| 节点管理 | 搜索、协议 / 分组筛选、增删改、启停、↑↓ 排序、行尾菜单（复制链接 / 复制地址 / 建副本 / 删除）；成员可添加个人节点，共享节点由所有者维护 |
| 批量与分享 | Shift 连选、批量启停换组删除、**一键撤销**；VLESS / Hysteria2 / Trojan / VMess / SS 链接批量导入导出 |
| 订阅预览 | 实时 YAML、分组统计、全文搜索（命中计数与跳转）、复制 / 下载 |
| 账号 | 首次打开创建所有者，用户名或邮箱 + 密码登录；所有者可增删账号、重置密码、分配共享节点（最多 20 个），成员可管理自己的节点并自行改密 |
| 设置 | 订阅令牌（页面只显示掩码，不回显明文）、VLESS 参数预设、流量与到期日、分流规则镜像源、浅色 / 深色 / 跟随系统、JSON 备份与恢复 |
| 策略组 | 欧美 / 日韩 / 港台 / 中转自动分组，另挂 ChatGPT、Google、YouTube、Telegram 分流组 |
| 伪装页 | 令牌不对时返回一个正常的「IP 地址查询」页：概览 / 连接 / 浏览器 / 工具四个标签页，含 IP 进制、CIDR、时间戳换算 |
| 安全 | PBKDF2 口令哈希（随机盐、迭代次数可调）、HMAC 会话、CSP nonce、`noindex`、接口与订阅独立限流；TLS 证书校验默认开启，跳过校验需逐个节点显式勾选 |
| 部署 | Wrangler 自动创建并复用 KV，全程不用手动绑定 |

**协议**：VLESS（Reality / WebSocket / gRPC，可配 TLS、SNI、Flow、指纹）· Hysteria2（密码、SNI、跳过校验、上下行速率）· Trojan · VMess（WS / TCP / gRPC）· Shadowsocks（SIP002）。

---

## 部署

### 1. 推到 GitHub

```bash
git init && git add . && git commit -m "chore: init transit-hub"
git branch -M main
git remote add origin git@github.com:<你的账号>/<仓库名>.git
git push -u origin main
```

仓库已带 `.gitignore`（忽略 `node_modules/`、`dist/`、`.wrangler/`、`.dev.vars` 等），无需手动补；先 `npm test` 跑一遍接口回归，确认本地能跑通再推。

### 2. Cloudflare 连接仓库

Workers & Pages → **Create** → **Workers** → **Import a repository**，选中仓库后填：

| 项 | 值 |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

### 3. 环境变量（可选，建议写成 Secret）

| 名称 | 作用 | 必填 |
| --- | --- | --- |
| `ADMIN_TOKEN` | 初始化校验（`/api/setup` 需带 `Authorization: Bearer <ADMIN_TOKEN>`）+ 忘记密码时的恢复通道，不参与日常登录。**少于 16 位、含空白或控制字符的值会被直接忽略**（恢复通道随之不可用），并在日志里提示一次 | 否（公开部署建议配） |
| `AUTH_TOKEN` | 订阅令牌；也可以只在设置页生成，无需环境变量。少于 16 位或含空白 / 控制字符的值会被忽略 | 否 |
| `SESSION_SECRET` | 会话签名密钥，32–256 位随机字符串。配置后会话签名不再依赖 KV 里的 secret，**KV 被读走也无法伪造会话**；改动它会立刻让所有已登录会话失效（等价于「强制全员重新登录」） | 否 |
| `SESSION_TTL_HOURS` | 会话有效期，默认 `168`（7 天），可调范围 1–168。缩短只影响之后签发的令牌，已签发的仍在各自 `exp` 到期后失效 | 否 |
| `PASSWORD_ITERATIONS` | PBKDF2 迭代次数，默认 `10000`（免费版 CPU 限制），付费计划可提到 `200000`；只影响新建 / 改密的账号 | 否 |

### 4. KV 自动创建

`wrangler.toml` 里的 KV 声明故意不写 `id`，首次部署自动创建命名空间并绑定，之后每次部署复用同名空间：

```toml
[[kv_namespaces]]
binding = "SUB_KV"
```

若你的 Wrangler 版本报 `Missing id`，手动建一个再填进 `id`：`npx wrangler kv namespace create SUB_KV`。

同一个文件里还声明了两个边缘限流绑定（`RATE_LIMITER` 120 次/分钟、`SUB_RATE_LIMITER` 240 次/分钟）：

```toml
[[ratelimits]]
name = "RATE_LIMITER"
namespace_id = "1001"
simple = { limit = 120, period = 60 }
```

Worker 内的内存限流按 isolate 计数，换个 isolate 就重置；这两个绑定把计数放到 Cloudflare 边缘，按 IP 跨 isolate 生效。删掉这段不会报错（代码会自动回落到内存桶），只是限流强度下降。若你的 Wrangler 不支持 `[[ratelimits]]`，先升级到 4.x 或直接注释掉。

### 5. 开始使用

打开 `https://<worker>.<子域>.workers.dev/admin` → 按提示创建所有者账号 → 「设置 → 访问令牌」生成并保存 `AUTH_TOKEN` → 添加节点。需要共享给他人时，在左侧「用户管理」新建成员并勾选共享节点，成员登录后即可看到自己的订阅链接，也可以添加只对自己生效的个人节点。保存即写入 KV，客户端下次刷新订阅就拿到新配置。

---

## 账号与令牌

- **账号**保存在 KV 的 `users` 键，与订阅配置分离；每个账号带 `role`（`owner` / `member`）和 `scope`（可用节点）。密码只存 PBKDF2-SHA256 哈希（随机盐、默认 10 000 次迭代，可用 `PASSWORD_ITERATIONS` 提高），最短 12 位，并且会拒绝「必然被秒破」的口令：常见弱口令、单/双字符重复（`aaaaaaaaaaaa`）、整体为键盘或数字序列（`qwertyuiop12`）、与用户名完全相同。不强制大小写数字符号组合，长口令短语（如 `correct horse battery staple`）照样可用。
- **所有者**可管理账号、增删全部节点、修改设置，并使用 `AUTH_TOKEN` 拉取全部节点的订阅。**成员**可以查看所有者分配的共享节点，并添加 / 编辑自己的节点；个人节点存在独立的 `user_nodes:<id>` 键里，只合并进该成员的配置、预览与订阅，不会改动管理员配置，也不能修改共享节点。成员可在设置页自行改密。
- **首个账号自动成为所有者**，之后新建的账号默认是成员。旧版本升级上来的账号库按同一规则补齐：第一个账号升为所有者，其余账号降为成员，并暂时保留全部节点访问，所有者可以在左侧「用户管理」里逐个收窄。
- **每账号独立订阅链接**：成员的链接由 `secret` 与账号版本派生，形如 `sub_<账号定位段>.<签名>`，输出 `scope` 内的共享节点以及该成员的个人节点；链接不在 KV 里单独存储，改密（版本 +1）后旧链接立即失效，重新登录即可拿到新链接。带定位段是为了让校验只做一次 HMAC + 一次查表，未鉴权请求无法用 `sub_` 前缀放大 CPU，也不再有「匹配到哪个账号」的时序信号；不带定位段的旧链接仍然可用，改密后自然轮换到新格式。`AUTH_TOKEN` 仍是只含管理员配置的全局链接。
- **会话**为 HMAC 签名的令牌（默认 7 天，可用 `SESSION_TTL_HOURS` 缩短），存在 `sessionStorage`，关闭标签页即失效；重置密码或成员自助改密都会让该账号的旧会话与旧订阅链接立即作废。签名密钥优先取环境变量 `SESSION_SECRET`，未配置时才用 KV 内的随机 secret。
- **`ADMIN_TOKEN` ≠ `AUTH_TOKEN`**：前者是恢复通道，后者只能拉取订阅、不能登录控制台；两者都不要复用同一个值。
- 订阅令牌保存在设置页时优先于环境变量，改完旧链接立即失效。`/api/config` 不再返回 `config.authToken` 明文，`meta.authTokenHint` 只给掩码（`•…•` + 末 4 位）与令牌来源，设置页输入框也不回显；完整令牌只出现在 `meta.subUrl`（订阅链接本身）这一处，界面上默认打码、点「显示令牌」才展开。需要换新令牌时点「生成」或粘贴完整令牌再保存，输入框留空即保持原值；掩码字符不会被当作合法令牌写入，误粘回输入框会在保存时被拒绝。

<details>
<summary><b>忘记密码 / 用户数据损坏怎么办</b></summary>

- 配了 `ADMIN_TOKEN`：在登录页点「使用部署恢复令牌」进入控制台，到设置页重置密码。
- 没配过 `ADMIN_TOKEN`：在 Cloudflare 控制台的 KV 里删除 `users` 记录，重新打开 `/admin` 创建账号，再用「导入备份」恢复节点。
- 控制台提示「用户数据已损坏」时 `/api/setup` 会拒绝自动初始化，这是防止任意访问者抢占管理员，需由持有 KV 写权限的人手动处理。
</details>

---

## 本地开发

```bash
npm install
npm test           # 接口回归测试，零依赖、不联网，226 项断言
npm run build      # 把 admin/ 内联进 src/worker.js，产出 dist/1.js
npm run dev        # 等价于 npx wrangler dev → http://127.0.0.1:8787/admin
```

`npm run check` 是零依赖静态检查器，专拦「语法合法、运行时才炸」的问题：声明前使用、`el.x` 未缓存、id 缺失或重复、表单错误锚点缺失、重复绑定、空 `catch`、CSS 类未覆盖。它随 `build` 自动执行，文件缺失时打印「跳过静态检查」继续构建，不阻断 CI；`npm run check:strict` 会在存在 error 级问题时以非零退出码结束，适合放进 CI；`npm run check:selftest` 可自测检查器本身。

`npm test`（`scripts/api.test.mjs`）用 Node 的 `Request` / `Response` / Web Crypto 直接调用 `worker.fetch`，KV 由内存 Map 模拟，覆盖订阅渲染、鉴权边界、限流、乐观锁、YAML 注入兜底、KV 异常降级与账号管理。新增接口行为时顺手补一条断言，比手工点击可靠。

`.github/workflows/ci.yml` 把静态检查、检查器自测、接口测试、构建与产物语法校验串成一条流水线，全程不需要装依赖，推上去就能看到红绿灯。

---

## 目录结构

```
admin/                 控制台前端，构建时内联进 Worker
src/worker.js          Worker 入口（ES Module）
src/static-head.yaml   订阅 YAML 固定头部（端口 / DNS / 模式）
src/rules.yaml         分流规则与 rule-providers
build.mjs              内联前端，输出 dist/1.js
scripts/check.mjs      零依赖静态检查器（可选）
scripts/api.test.mjs   零依赖接口回归测试（npm test）
wrangler.toml          Worker 配置 + KV 绑定声明
package.json
.gitignore             忽略依赖、构建产物与本地密钥
.github/workflows/     CI：静态检查 + 接口测试 + 构建
LICENSE / CHANGELOG.md 许可与变更记录
```

`dist/1.js` 是唯一被部署的文件，由构建现场生成。

---

## 接口

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/?token=<AUTH_TOKEN>` | 查询令牌或 `Authorization: Bearer` | 订阅 YAML，带 `subscription-userinfo`；也接受成员的专属订阅令牌（只含其可用节点）；令牌错误或缺失返回伪装页 |
| HEAD | `/?token=<AUTH_TOKEN>` | 查询令牌或 `Authorization: Bearer` | 只返回头部（含 `subscription-userinfo`），不生成 YAML 正文，适合客户端探活 |
| GET | `/admin`、`/console` | 页面内登录 | 控制台 |
| GET | `/api/auth` | 公开 | `needsSetup` / `setupLocked` / `recovery` / `maxUsers` / `corrupted` |
| POST | `/api/setup` | 公开（配了 `ADMIN_TOKEN` 时 `Bearer` 需带令牌） | 创建第一个管理员，已初始化或用户库损坏返回 `409` |
| POST | `/api/login` | 公开 | 用户名或邮箱 + 密码，返回会话令牌 |
| GET | `/api/config` | `Bearer <会话>` | 读取配置与运行状态；成员的响应为 `scope` 内的共享节点 + 个人节点，`meta` 带 `role` / `canWrite` / `canManageUsers` / `scope` / `personalNodeIds` / `personalRev`；`config.authToken` 不回显，订阅链接在 `meta.subUrl` |
| PUT | `/api/config` | `Bearer <会话>`（仅所有者） | 整体保存，带 `rev` 乐观锁；可同时更新订阅令牌与规则镜像源 |
| PUT | `/api/nodes` | `Bearer <会话>`（仅成员） | 保存个人节点，带 `personalRev` 乐观锁；单个账号最多 100 个，id 由服务端约束在 `p_` 命名空间 |
| GET | `/api/preview` | `Bearer <会话>` | 当前配置渲染出的 YAML（成员为共享 + 个人节点） |
| POST | `/api/password` | `Bearer <会话>` | 自助改密：`currentPassword` + `newPassword`，成功后返回新会话令牌 |
| GET/POST | `/api/users`、`/api/users/update`、`/api/users/delete` | `Bearer <会话>`（仅所有者） | 用户列表、新建、修改角色 / 节点范围 / 密码、删除；`scope: { allNodes, nodeIds }` |

`/api/*` 同时接受 `Bearer <ADMIN_TOKEN>` 作为恢复通道。限流：`/api/*` 每 IP 120 次/分钟，订阅与伪装页单独 240 次/分钟，登录失败按 IP + 用户名 10 分钟 8 次，同一 IP 换用户名批量试探另有一道 10 分钟 60 次的总闸（按 isolate 尽力而为，需严格限流请在控制台加边缘 Rate Limiting 规则）。

<details>
<summary><b>KV 数据结构</b></summary>

```json
{
  "v": 1, "rev": 3, "updatedAt": "2026-01-01T00:00:00.000Z",
  "authToken": "…",
  "providerBase": "",
  "defaults": { "vlessUuid": "…", "vlessPublicKey": "…", "vlessShortId": "…", "vlessServername": "…", "vlessPort": 443 },
  "subscription": { "totalGB": 500, "expire": "2026-12-31" },
  "regionOrder": { "hk": ["n_xxx", "n_yyy"] },
  "nodes": [
    { "id": "n_xxx", "name": "HK-01", "type": "vless", "server": "example.com", "port": 443,
      "region": "hk", "enabled": true, "showInMain": true, "tags": ["chatgpt"],
      "uuid": "…", "network": "tcp", "tls": true, "reality": true, "publicKey": "…", "shortId": "…" }
  ]
}
```

`config` 键存上面这份，`users` 键单独存账号（`id` / `username` / `role` / `scope` / `passwordSalt` / `passwordHash` / `passwordIterations` / `version` / `createdAt`）与签发会话用的 `secret`；`role` 为 `owner` 或 `member`，`scope` 形如 `{ "allNodes": false, "nodeIds": ["n_xxx"] }`，所有者始终为 `allNodes: true`。旧账号库缺少这两个字段时在读取时自动迁移，不需要手工改 KV。`rev` 用于并发保护，PUT 时不一致返回 `409`。令牌只存在 KV：YAML、备份文件与 `/api/config` 响应都不带 `authToken` 字段，读取配置时只在 `meta.subUrl` 拼出含令牌的订阅链接。`providerBase` 为空时用 Loyalsoldier 的 jsDelivr 镜像，填自己的 `https` 前缀可换源（规则内容仍由该来源提供，换源前确认其可信）。

**个人节点**存在 `user_nodes:<userId>`，结构为 `{ "v": 1, "rev": 2, "updatedAt": "…", "nodes": [...] }`，节点 id 统一使用 `p_` 前缀。成员的配置、预览与订阅在读取时把这份节点追加到共享节点之后；若名称与共享节点重复，渲染时自动追加「· 个人」后缀，不会覆盖管理员节点。删除账号会同时删除对应的 `user_nodes` 键。

**节点字段**：`showInMain: false` 表示不在「🌍选择节点」里列出，但仍保留在所属分组与应用分流组中；`tags` 取值 `chatgpt` / `google` / `youtube` / `telegram`；`skipCertVerify` 默认 `false`，只有显式勾选才在 YAML 里输出 `skip-cert-verify: true`。字段残缺或类型不对的节点（缺 UUID、缺密码、非法端口等）会在渲染时被跳过并计入告警，不会把 `"undefined"` 写进订阅，也不会让整条订阅 500。
</details>

---

## 键盘快捷键

| 按键 | 作用 |
| --- | --- |
| `/` | 聚焦搜索框（节点管理 / 订阅预览） |
| `Esc` | 关闭弹窗、抽屉、行菜单，或清空预览搜索 |
| `Shift` + 点击 | 连续选择一段节点 |
| `Cmd / Ctrl + S` | 在编辑抽屉内保存 |
| `Enter` / `Space` | 聚焦节点行时打开编辑抽屉 |

---

## 安全须知

- 不要把 `dist/`、`.dev.vars`、导出的订阅 YAML 或备份 JSON 提交进仓库（`.gitignore` 已默认忽略，别用 `git add -f` 绕过）。
- 如果曾公开过含节点的旧版本（例如单文件 `1.js`），**立即作废并更换**其中出现过的 UUID、Reality 公私钥与各协议密码。
- 免费版 Worker CPU 受限，PBKDF2 默认 1 万次迭代：请用 12 位以上的长密码，不要复用其他站点的密码；付费计划可把 `PASSWORD_ITERATIONS` 提到 `200000`，显著提高 KV 泄漏后的离线破解成本。
- 订阅令牌支持 `Authorization: Bearer` 头（客户端若支持请优先使用），这样令牌不会出现在 URL、CDN / Worker 日志与浏览器历史里；查询参数 `?token=` 只为兼容保留。
- 订阅接口返回 `access-control-allow-origin: *` 以便各类客户端拉取，令牌即凭据，泄露后立刻更换。
- 成员的专属订阅令牌只能取到 `scope` 内的共享节点与自己的个人节点，且不能登录控制台；如链接外泄，让成员在设置页改密（或所有者重置密码）即可让旧链接立即失效，代价只是重新分发一次新链接。
- TLS 证书校验默认开启。只有在自签证书且确认链路可信时才勾选「跳过证书校验」，否则等于把加密通道降级成明文可中间人。
- 设置页与 `/api/config` 都不回显订阅令牌（`config.authToken` 已移除，界面上订阅链接默认打码），录屏、截图、贴设置响应时不会顺手泄漏凭据；备份 JSON 同样不含令牌，恢复后需重新设置。唯一含明文的是 `meta.subUrl`，它等价于订阅链接本身，不要转发或贴进公开渠道。
- 控制台与伪装页都带 CSP（`script-src 'nonce-…'`、`style-src 'nonce-…'`、`object-src 'none'`、`worker-src 'none'`、`frame-ancestors 'none'`）、`X-Frame-Options: DENY`、`cross-origin-resource-policy: same-origin`、`cross-origin-opener-policy: same-origin`、`strict-transport-security`、最小化的 `permissions-policy` 和 `noindex`，不进搜索引擎、不能被嵌套、也不给第三方页借用资源。样式同样走 nonce 而不是 `'unsafe-inline'`：样式一旦可内联，CSS 选择器配外部 `url()` 就能在不执行脚本的前提下把页面里的属性值逐位漏出去。
- KV 绑定异常或读写失败时接口返回 `502` 并带可读说明，订阅降级为空配置而不是让请求裸 500 掉进 Worker 错误页；`/api/auth` 的 `corrupted` 字段用来区分「没绑 KV」「未初始化」「数据损坏」三种状态。
- **凭据类环境变量的形态是硬门槛**：`AUTH_TOKEN`、`ADMIN_TOKEN` 少于 16 位、含空白或控制字符时会被直接忽略（日志提示一次），不会「将就着用」。`ADMIN_TOKEN` 被忽略意味着恢复通道不可用，请配 16 位以上的随机值并写进 Secret。
- **未配置 `ADMIN_TOKEN` 的公开实例，第一个打开 `/admin` 的人就是所有者**。部署后请立刻完成初始化，或先配好 `ADMIN_TOKEN` 再公开域名；初始化成功时若未配置该变量，日志会明确提示。
- **边缘限流**：`wrangler.toml` 里的 `[[ratelimits]]` 把 `/api/*`（120 次/分钟）与订阅 / 伪装页（240 次/分钟）的计数放到 Cloudflare 边缘，跨 isolate 生效。内存桶只是兜底，删掉绑定后攻击者换个 isolate 就能重置计数。
- **请求体边读边限长**：`content-length` 可以缺失或撒谎，服务端在读的过程中累计字节数，超过 256 KB 立即取消读取并返回 `413`，不会先把整个请求体读进内存。
- **不可见字符会被拒**：节点名、用户名、服务器地址里的零宽 / 双向控制符（如 U+200B、U+202E）会让界面显示成另一串字符（把 `evil.com` 伪装成 `moc.live`），写入与渲染两处都会拦掉。
- **rule-providers 镜像地址不接受 `#` 与 `?`**：前者会把该行后面的 `path:` / `interval:` 注释掉，后者不参与取文件，两者都只会产出坏配置。
- 定期「导出备份」到本地：KV 数据只在云端，误删或账号异常时凭备份恢复。

---

## 许可与变更

- 代码以 MIT 许可提供，见 `LICENSE`；再分发时保留版权行即可，如需换成你自己的署名请一并修改。
