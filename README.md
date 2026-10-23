# Transit Hub

<p align="center">
  <img src="https://img.shields.io/badge/Cloudflare-Workers-f6821f?logo=cloudflare&logoColor=white" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/存储-KV-2b2f36?logo=cloudflare&logoColor=white" alt="Cloudflare KV">
  <img src="https://img.shields.io/badge/运行时依赖-0-brightgreen" alt="零依赖">
  <img src="https://img.shields.io/badge/version-2.6.2-4f46e5" alt="v2.6.2">
</p>

> **Clash / Mihomo 订阅生成器 + 可视化管理控制台**，整个后端就是一个 Cloudflare Worker。
> 节点只存在你自己的 KV 里 —— **仓库不含任何节点**：没有服务器地址、UUID、密码或公钥，首次部署的订阅是空配置。

---

## 功能

| 模块 | 能力 |
| --- | --- |
| 订阅输出 | `GET /?token=<AUTH_TOKEN>` 直接给出 Clash / Mihomo 可用的 YAML，带 `subscription-userinfo` 与 `profile-update-interval` |
| 节点管理 | 搜索、协议 / 分组筛选、增删改、启停、↑↓ 排序、行尾菜单（复制链接 / 复制地址 / 建副本 / 删除） |
| 批量与分享 | Shift 连选、批量启停换组删除、**一键撤销**；VLESS / Hysteria2 / Trojan / VMess / SS 链接批量导入导出 |
| 订阅预览 | 实时 YAML、分组统计、全文搜索（命中计数与跳转）、复制 / 下载 |
| 账号 | 首次打开创建管理员，用户名或邮箱 + 密码登录；多用户、重置密码、删除账号（最多 20 个） |
| 设置 | 订阅令牌、VLESS 参数预设、流量与到期日、浅色 / 深色 / 跟随系统、JSON 备份与恢复 |
| 策略组 | 欧美 / 日韩 / 港台 / 中转自动分组，另挂 ChatGPT、Google、YouTube、Telegram 分流组 |
| 伪装页 | 令牌不对时返回一个正常的「IP 地址查询」页：概览 / 连接 / 浏览器 / 工具四个标签页，含 IP 进制、CIDR、时间戳换算 |
| 安全 | PBKDF2 口令哈希、HMAC 会话、CSP nonce、`noindex`、接口与订阅独立限流 |
| 部署 | Wrangler 自动创建并复用 KV，全程不用手动绑定 |

**协议**：VLESS（Reality / WebSocket / gRPC，可配 TLS、SNI、Flow、指纹）· Hysteria2（密码、SNI、跳过校验、上下行速率）· Trojan · VMess（WS / TCP / gRPC）· Shadowsocks（SIP002）。

---

## 部署

### 1. 推到 GitHub

```bash
printf 'node_modules/\ndist/\n.wrangler/\n.dev.vars\n' > .gitignore   # 仓库未附带，先补一个
git init && git add . && git commit -m "chore: init transit-hub"
git branch -M main
git remote add origin git@github.com:<你的账号>/<仓库名>.git
git push -u origin main
```

### 2. Cloudflare 连接仓库

Workers & Pages → **Create** → **Workers** → **Import a repository**，选中仓库后填：

| 项 | 值 |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

### 3. 环境变量（可选，建议写成 Secret）

| 名称 | 作用 | 必填 |
| --- | --- | --- |
| `ADMIN_TOKEN` | 初始化校验 + 忘记密码时的恢复通道，不参与日常登录 | 否（公开部署建议配） |
| `AUTH_TOKEN` | 订阅令牌；也可以只在设置页生成，无需环境变量 | 否 |

### 4. KV 自动创建

`wrangler.toml` 里的 KV 声明故意不写 `id`，首次部署自动创建命名空间并绑定，之后每次部署复用同名空间：

```toml
[[kv_namespaces]]
binding = "SUB_KV"
```

若你的 Wrangler 版本报 `Missing id`，手动建一个再填进 `id`：`npx wrangler kv namespace create SUB_KV`。

### 5. 开始使用

打开 `https://<worker>.<子域>.workers.dev/admin` → 按提示创建管理员 → 「设置 → 访问令牌」生成并保存 `AUTH_TOKEN` → 添加节点。保存即写入 KV，客户端下次刷新订阅就拿到新配置。

---

## 账号与令牌

- **管理员账号**保存在 KV 的 `users` 键，与订阅配置分离；密码只存 PBKDF2-SHA256 哈希（随机盐、10 000 次迭代）。
- **会话**为 HMAC 签名的 7 天令牌，存在 `sessionStorage`，关闭标签页即失效；重置密码会让该账号的旧会话立即作废。
- **`ADMIN_TOKEN` ≠ `AUTH_TOKEN`**：前者是恢复通道，后者只能拉取订阅、不能登录控制台；两者都不要复用同一个值。
- 订阅令牌保存在设置页时优先于环境变量，改完旧链接立即失效。

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
npm run build      # 把 admin/ 内联进 src/worker.js，产出 dist/1.js
npx wrangler dev   # http://127.0.0.1:8787/admin，本地 KV 自动持久化
```

`npm run check` 是零依赖静态检查器，专拦「语法合法、运行时才炸」的问题：声明前使用、`el.x` 未缓存、id 缺失或重复、表单错误锚点缺失、重复绑定、空 `catch`、CSS 类未覆盖。它随 `build` 自动执行，文件缺失时打印「跳过静态检查」继续构建，不阻断 CI；`npm run check:selftest` 可自测检查器本身。

---

## 目录结构

```
admin/                 控制台前端，构建时内联进 Worker
src/worker.js          Worker 入口（ES Module）
src/static-head.yaml   订阅 YAML 固定头部（端口 / DNS / 模式）
src/rules.yaml         分流规则与 rule-providers
build.mjs              内联前端，输出 dist/1.js
scripts/check.mjs      零依赖静态检查器（可选）
wrangler.toml          Worker 配置 + KV 绑定声明
package.json
```

`dist/1.js` 是唯一被部署的文件，由构建现场生成。

---

## 接口

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/?token=<AUTH_TOKEN>` | 查询令牌 | 订阅 YAML；令牌错误或缺失返回伪装页 |
| GET | `/admin`、`/console` | 页面内登录 | 控制台 |
| GET | `/api/auth` | 公开 | `needsSetup` / `setupLocked` / `recovery` / `maxUsers` |
| POST | `/api/setup` | 公开（配了 `ADMIN_TOKEN` 时需带令牌） | 创建第一个管理员，已初始化返回 `409` |
| POST | `/api/login` | 公开 | 用户名或邮箱 + 密码，返回会话令牌 |
| GET | `/api/config` | `Bearer <会话>` | 读取配置与运行状态 |
| PUT | `/api/config` | `Bearer <会话>` | 整体保存，带 `rev` 乐观锁；可同时更新订阅令牌 |
| GET | `/api/preview` | `Bearer <会话>` | 当前配置渲染出的 YAML |
| GET/POST | `/api/users`、`/api/users/update`、`/api/users/delete` | `Bearer <会话>` | 用户列表、新建、重置密码、删除 |

`/api/*` 同时接受 `Bearer <ADMIN_TOKEN>` 作为恢复通道。限流：`/api/*` 每 IP 120 次/分钟，订阅与伪装页单独 240 次/分钟，登录失败按 IP + 用户名 10 分钟 8 次（按 isolate 尽力而为，需严格限流请在控制台加边缘 Rate Limiting 规则）。

<details>
<summary><b>KV 数据结构</b></summary>

```json
{
  "v": 1, "rev": 3, "updatedAt": "2026-01-01T00:00:00.000Z",
  "authToken": "…",
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

`config` 键存上面这份，`users` 键单独存账号（`id` / `username` / `passwordSalt` / `passwordHash` / `passwordIterations` / `version` / `createdAt`）与签发会话用的 `secret`。`rev` 用于并发保护，PUT 时不一致返回 `409`；订阅令牌不会出现在 YAML 或备份文件里。

**节点字段**：`showInMain: false` 表示不在「🌍选择节点」里列出，但仍保留在所属分组与应用分流组中；`tags` 取值 `chatgpt` / `google` / `youtube` / `telegram`。
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

- 不要把 `dist/`、`.dev.vars`、导出的订阅 YAML 或备份 JSON 提交进仓库（部署第 1 步已给出 `.gitignore`）。
- 如果曾公开过含节点的旧版本（例如单文件 `1.js`），**立即作废并更换**其中出现过的 UUID、Reality 公私钥与各协议密码。
- 免费版 Worker CPU 受限，迭代次数低于桌面软件：用长密码，不要复用其他站点的密码。
- 订阅接口返回 `access-control-allow-origin: *` 以便各类客户端拉取，令牌即凭据，泄露后立刻更换。
- 控制台与伪装页都带 CSP（`script-src 'nonce-…'`、`frame-ancestors 'none'`）和 `noindex`，不进搜索引擎。
- 定期「导出备份」到本地：KV 数据只在云端，误删或账号异常时凭备份恢复。

---

## 更新日志

**v2.6.2**

- 修复节点编辑抽屉打不开（`openEditor()` 里端口回写在 `var preset` 声明之前）；修复脚本异常兜底失效（`el.toastStack` 从未赋值），错误提示不再静默。
- 修复表单错误标错位置（`wsPath` / `grpcService` 被 vless 与 vmess 共用锚点）、保存遇 `409` 丢表单、批量换组失败后下拉已复位。
- `bindEvents()` 的 50+ 处裸 `addEventListener` 收口到 `on()`，并加全局 `error` / `unhandledrejection` 兜底。
- 订阅渲染加白名单最后一道防线：非法值整条跳过，策略组只引用实际渲染出的节点；用户库损坏时禁止 `/api/setup` 抢占初始化；订阅路径独立限流。
- 新增零依赖静态检查器 `scripts/check.mjs` 及自测。

<details>
<summary><b>更早版本</b></summary>

- **v2.6.1** VLESS 默认参数新增默认端口；去掉顶栏重复按钮；控制台视觉系统重做（统一设计令牌、深浅主题分层、表格与设置页布局优化）。
- **v2.6.0** 用户名支持邮箱地址（含 `+` 别名，大小写不敏感），初始化 / 登录 / 用户管理同步适配。
- **v2.5.1** 修正应用策略组角标多计的问题，只统计已勾选标签的启用节点。
- **v2.5.0** 改为首次打开创建管理员账号；新增用户管理、7 天会话、PBKDF2 口令存储、登录限流与乐观锁；`AUTH_TOKEN` 明确只能拉取订阅。
- **v2.4.0** 新增「设置 → 访问令牌」，令牌可在线生成并即时生效，设置页优先于环境变量。
- **v2.3.0** 新增概览仪表盘、批量操作与撤销、分享链接导入导出、订阅预览搜索、三种外观模式。
- **v2.2.0** 参数预设、分组排序、🌍选择节点开关、JSON 备份与恢复。
</details>
