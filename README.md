<div align="center">

# Transit Hub

**Clash / Mihomo 订阅生成器 · 可视化管理控制台**

整个后端就是一个 Cloudflare Worker，节点只存在你自己的 KV 里。

<img src="https://img.shields.io/badge/Cloudflare-Workers-f6821f?logo=cloudflare&logoColor=white" alt="Cloudflare Workers">
<img src="https://img.shields.io/badge/存储-KV-2b2f36?logo=cloudflare&logoColor=white" alt="Cloudflare KV">
<img src="https://img.shields.io/badge/运行时依赖-0-brightgreen" alt="零依赖">
<img src="https://img.shields.io/badge/version-2.8.0-4f46e5" alt="v2.8.0">
<img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">

</div>

> **仓库不含任何节点** —— 没有服务器地址、UUID、密码或公钥。首次部署拿到的是一份空配置，节点全部由你在控制台里添加。

```
浏览器 ──► Cloudflare Worker ──► KV
              ├─ /?token=…   →  Clash / Mihomo YAML
              ├─ /admin      →  控制台（HTML 内联在 Worker 里）
              └─ /api/*      →  配置 / 账号 / 预览
```

---

## ✨ 特性

| 模块 | 能力 |
| :--- | :--- |
| **订阅** | `/?token=…` 直接输出 Clash / Mihomo 可用的 YAML，带 `subscription-userinfo` 与更新间隔；成员另有专属链接 |
| **节点** | 增删改、启停、↑↓ 排序、搜索与协议 / 分组筛选、Shift 连选、批量操作 + 一键撤销 |
| **导入导出** | VLESS / Hysteria2 / Trojan / VMess / SS 分享链接批量互转 |
| **预览** | 实时 YAML、分组统计、全文搜索（命中计数与跳转）、复制 / 下载 |
| **账号** | 所有者 / 成员两级；成员只能管自己的节点，共享节点由所有者分配（上限 20 人） |
| **伪装** | 令牌不对时返回一个像模像样的「IP 地址查询」页，四个标签页含 IP 进制、CIDR、时间戳换算 |
| **安全** | PBKDF2 口令哈希、HMAC 会话、CSP nonce、双层限流；证书校验默认开启，跳过需逐个节点勾选 |

**协议**：VLESS（Reality / WS / gRPC，可配 TLS、SNI、Flow、指纹）· Hysteria2（上下行速率）· Trojan · VMess（WS / TCP / gRPC）· Shadowsocks（SIP002）

---

## 🚀 部署

### ① 创建 Worker

**一键部署**：[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jinhuaitao/Clash)

**或连接仓库**：Workers & Pages → **Create** → **Workers** → **Import a repository**，然后填：

| 项 | 值 |
| :--- | :--- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

KV 命名空间会在首次部署时自动创建并绑定（`wrangler.toml` 里故意不写 `id`），之后每次部署复用同一个。Wrangler 若报 `Missing id`，手动建一个填进去：`npx wrangler kv namespace create SUB_KV`。

### ② 配置 `ADMIN_TOKEN`（必须）

```bash
npx wrangler secret put ADMIN_TOKEN     # 16 位以上的随机字符串
```

> ⚠️ **没配这个，`/api/setup` 直接返回 `503`。** 未初始化的实例不会给任何人抢注所有者的机会 —— 这是当前版本的默认行为。只有在本地开发或一次性实例上，才用 `ALLOW_OPEN_SETUP=1` 回到旧的零配置模式。

### ③ 初始化

打开 `https://<worker>.<子域>.workers.dev/admin` → 填上刚才的 `ADMIN_TOKEN` → 创建所有者账号 → 设置页「生成」并保存 `AUTH_TOKEN` → 添加节点。

保存即写入 KV，客户端下次刷新订阅就能拿到新配置。要分享给他人时，在左侧「用户管理」新建成员并勾选共享节点，成员登录后能看到自己的订阅链接，也可以添加只对自己生效的个人节点。

---

## ⚙️ 环境变量

| 名称 | 说明 | 必填 |
| :--- | :--- | :--- |
| `ADMIN_TOKEN` | 初始化校验 + 忘记密码的恢复通道，**不参与日常登录**。少于 16 位、含空白或控制字符会被直接忽略（恢复通道随之失效） | 是 |
| `ALLOW_OPEN_SETUP` | 设为 `1` 允许「没有 `ADMIN_TOKEN` 也能初始化」。仅限本地 / 一次性实例 | 否 |
| `AUTH_TOKEN` | 订阅令牌，也可以只在设置页生成。设置页的值优先于环境变量 | 否 |
| `SESSION_SECRET` | 会话签名密钥，32–256 位。配置后 KV 被读走也无法伪造会话；改动它会立刻让所有已登录会话失效 | 否 |
| `SESSION_TTL_HOURS` | 会话有效期，默认 `168`（7 天），可调 1–168 | 否 |
| `PASSWORD_ITERATIONS` | PBKDF2 迭代次数，默认 `10000`（免费版 CPU 限制），付费计划建议 `200000` | 否 |

<details>
<summary><b>边缘限流绑定</b>（可选，删掉不报错，只是限流变弱）</summary>

`wrangler.toml` 里声明了两个 `[[ratelimits]]`：`/api/*` 120 次/分钟、订阅与伪装页 240 次/分钟。Worker 内存里的桶按 isolate 计数，换个 isolate 就重置；这两个绑定把计数放到 Cloudflare 边缘，按 IP 跨 isolate 生效。Wrangler 版本太老不支持时，升级到 4.x 或直接注释掉。

</details>

---

## 👥 账号模型

- **所有者**：管理账号、增删全部节点、修改设置，用 `AUTH_TOKEN` 拉取全量订阅。
- **成员**：只看得到分配给他的共享节点，可以添加 / 编辑自己的个人节点（存在 `user_nodes:<id>`，最多 100 个），能自助改密。
- **每账号独立订阅链接**：`sub_<定位段>.<签名>` 由 `secret` 与账号版本派生，不落库；改密（版本 +1）后旧链接立即失效。
- **会话**：HMAC 签名的令牌，存 `sessionStorage`，关标签页即失效。重置或自助改密会作废该账号的全部旧会话。
- **`ADMIN_TOKEN` ≠ `AUTH_TOKEN`**：前者是恢复通道，后者只能拉订阅、不能登录控制台，不要复用同一个值。

<details>
<summary><b>忘记密码 / 用户数据损坏</b></summary>

- 配了 `ADMIN_TOKEN`：登录页点「使用部署恢复令牌」进控制台，到设置页重置密码。
- 没配过：先补一个 16 位以上的 Secret，再在 Cloudflare 控制台的 KV 里删除 `users` 记录，重新打开 `/admin` 用该令牌创建账号，最后「导入备份」恢复节点。
- 提示「用户数据已损坏」时 `/api/setup` 会拒绝自动初始化，防止任意访问者覆盖原数据，需由持有 KV 写权限的人手动处理。

</details>

---

## 🛠 本地开发

```bash
npm install
npm test           # 零依赖接口回归，274 项断言，不联网
npm run build      # 把 admin/ 内联进 src/worker.js，产出 dist/1.js
npm run dev        # 先构建再 wrangler dev → http://127.0.0.1:8787/admin
```

`npm run check` 是零依赖静态检查器，专拦「语法合法、运行时才炸」的问题（声明前使用、`el.x` 未缓存、id 缺失或重复、空 `catch`、CSS 类未覆盖）。它随 `build` 自动执行；`check:strict` 有 error 即非零退出，适合放进 CI；`check:selftest` 自测检查器本身。

`npm test` 用 Node 的 `Request` / `Response` / Web Crypto 直接调 `worker.fetch`，KV 用内存 Map 模拟，覆盖订阅渲染、鉴权边界、限流、乐观锁、YAML 注入兜底与 KV 异常降级。改接口行为时顺手补一条断言，比手工点击可靠。

---

## 📁 目录结构

```
admin/                 控制台前端，构建时内联进 Worker
src/worker.js          Worker 入口（ES Module）
src/static-head.yaml   订阅 YAML 固定头部（端口 / DNS / 模式）
src/rules.yaml         分流规则与 rule-providers
build.mjs              内联前端，输出 dist/1.js
scripts/check.mjs      零依赖静态检查器
scripts/api.test.mjs   零依赖接口回归测试
wrangler.toml          Worker 配置 + KV / 限流绑定声明
```

`dist/1.js` 是唯一被部署的文件，由构建现场生成，不进仓库。

---

## 🔌 接口

| 方法 | 路径 | 鉴权 | 说明 |
| :--- | :--- | :--- | :--- |
| GET | `/?token=…` | 查询令牌或 `Bearer` | 订阅 YAML；令牌错误或缺失返回伪装页 |
| HEAD | `/?token=…` | 同上 | 只回头部（含 `subscription-userinfo`），适合客户端探活 |
| GET | `/admin`、`/console` | 页面内登录 | 控制台 |
| GET | `/api/auth` | 公开 | `needsSetup` / `setupLocked` / `setupDisabled` / `recovery` / `corrupted` |
| POST | `/api/setup` | 公开 | 创建第一个管理员；**未配 `ADMIN_TOKEN` 时 `503`**，已初始化返回 `409` |
| POST | `/api/login` | 公开 | 用户名或邮箱 + 密码 |
| GET | `/api/config` | 会话 | 配置与运行状态；成员的响应只含其可见节点，`config.authToken` 不回显 |
| PUT | `/api/config` | 所有者 | 整体保存，`rev` 乐观锁 |
| PUT | `/api/nodes` | 成员 | 保存个人节点，`personalRev` 乐观锁，id 约束在 `p_` 命名空间 |
| GET | `/api/preview` | 会话 | 当前配置渲染出的 YAML |
| POST | `/api/password` | 会话 | 自助改密，成功后返回新会话令牌 |
| GET/POST | `/api/users`、`/update`、`/delete` | 所有者 | 账号列表、新建、改角色 / 范围 / 密码、删除 |

`/api/*` 也接受 `Bearer <ADMIN_TOKEN>` 作为恢复通道。限流：`/api/*` 每 IP 120 次/分钟，订阅与伪装页 240 次/分钟，登录失败按 IP + 用户名 10 分钟 8 次，同 IP 换用户名批量试探另有 10 分钟 60 次总闸。

<details>
<summary><b>KV 数据结构</b></summary>

```json
{
  "v": 1, "rev": 3, "updatedAt": "2026-01-01T00:00:00.000Z",
  "authToken": "…", "providerBase": "",
  "defaults": { "vlessUuid": "…", "vlessPublicKey": "…", "vlessServername": "…", "vlessPort": 443 },
  "subscription": { "totalGB": 500, "expire": "2026-12-31" },
  "regionOrder": { "hk": ["n_xxx"] },
  "nodes": [{ "id": "n_xxx", "name": "HK-01", "type": "vless", "server": "example.com",
              "port": 443, "region": "hk", "enabled": true, "uuid": "…", "reality": true }]
}
```

`config` 键存上面这份；`users` 键单独存账号（`role` / `scope` / `passwordSalt` / `passwordHash` / `passwordIterations` / `version`）与会话签名用的 `secret`。`rev` 用于并发保护，不一致返回 `409`。令牌只存在 KV —— YAML、备份文件与 `/api/config` 响应都不带 `authToken`，完整令牌只出现在 `meta.subUrl`。

字段残缺或类型不对的节点（缺 UUID、缺密码、非法端口、混入 `null`）会在渲染时被跳过，不会把 `"undefined"` 写进订阅，也不会让整条订阅 500。`showInMain: false` 表示不在「🌍选择节点」里列出；`skipCertVerify` 默认 `false`。

</details>

---

## 🔐 安全要点

- **初始化 fail-closed**：没有 `ADMIN_TOKEN` 时 `/api/setup` 返回 `503`。部署顺序是「先配 Secret → 再开 `/admin` → 创建所有者」。
- **凭据形态是硬门槛**：`AUTH_TOKEN`、`ADMIN_TOKEN` 少于 16 位、含空白或控制字符时一律忽略，不会「将就着用」。
- **口令**：最短 12 位，拒绝常见弱口令、单字符重复、键盘序列与「等于用户名」；不强制大小写数字符号组合，长口令短语照样可用。免费版 1 万次 PBKDF2 只有 OWASP 建议值的 1/60，请用长密码，付费计划把 `PASSWORD_ITERATIONS` 提到 `200000`。
- **令牌不外泄**：设置页与 `/api/config` 都不回显订阅令牌，界面上默认打码；备份 JSON 不含令牌。唯一明文是 `meta.subUrl`（等价于订阅链接本身），别转发。订阅支持 `Authorization: Bearer`，比 `?token=` 更安全（不进日志与浏览器历史）。
- **成员边界**：专属令牌只能取到 `scope` 内的共享节点与自己的个人节点，不能登录控制台；`/api/config` 对成员返回的 `defaults` 恒为空，`regionOrder` 也只含其可见节点。链接外泄就让成员改密，旧链接立刻失效。
- **TLS 校验默认开启**：只有自签证书且确认链路可信时才勾「跳过证书校验」，否则等于把加密通道降级成明文可中间人。
- **响应头**：CSP（`script-src` / `style-src` 均走 nonce，不用 `unsafe-inline`）、`X-Frame-Options: DENY`、COOP / CORP、HSTS、最小化 `permissions-policy`、`noindex`。
- **限流与体积**：边缘限流跨 isolate 生效，内存桶只是兜底；请求体边读边计数，超过 256 KB 立即 `413`，不先整块读进内存。
- **不可见字符会被拒**：节点名、用户名、服务器地址里的零宽 / 双向控制符（U+200B、U+202E）写入与渲染两处都会拦掉。
- 别把 `dist/`、`.dev.vars`、导出的订阅 YAML 或备份 JSON 提交进仓库（`.gitignore` 已覆盖）。定期导出备份 —— KV 数据只在云端。

---

## 📄 许可

MIT，见 [`LICENSE`](LICENSE)。再分发时保留版权行即可，换成自己的署名请一并修改。
