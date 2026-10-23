# Transit Hub

运行在 Cloudflare Workers 上的 **Clash / Mihomo 订阅生成器 + 可视化管理控制台**。零运行时依赖，构建产物只有一个文件。

节点数据全部存放在 Cloudflare KV，仓库里**不含任何节点**：没有服务器地址、UUID、密码、公钥，也没有预置模板。首次部署后订阅是一份空配置（`proxies: []`），所有节点都由你在 `/admin` 控制台里自己添加。

---

## 功能总览

| 模块 | 能力 |
| --- | --- |
| 订阅输出 | `GET /?token=<AUTH_TOKEN>` 返回 Clash / Mihomo 可直接使用的 YAML，带 `subscription-userinfo` 与 `profile-update-interval` 响应头 |
| 概览 | 节点在线数、协议分布、策略组构成、系统状态与常用快捷入口 |
| 节点管理 | 搜索、协议 / 分组筛选、增删改、启用停用、↑↓ 排序，以及行尾菜单（复制分享链接 / 复制服务器地址 / 创建副本 / 删除） |
| 批量操作 | Shift 连选、全选当前筛选结果；批量启用、停用、换分组、删除，操作完成后可一键撤销 |
| 分享链接 | 批量导入或导出 VLESS / Hysteria2 / Trojan / VMess / Shadowsocks 链接，自动识别分组并跳过无效行 |
| 订阅预览 | 实时 YAML、分组统计、全文搜索（命中计数与跳转）、一键复制 / 下载 |
| 账号与用户 | 首次打开创建管理员账号，之后用用户名或邮箱登录；设置页可添加用户、重置密码、删除账号（最多 20 个） |
| 设置 | 用户管理、AUTH_TOKEN 订阅令牌、VLESS 参数预设、订阅流量与到期日、浅色 / 深色 / 跟随系统外观 |
| 备份恢复 | 导出 / 导入 JSON（节点、参数预设、订阅信息、分组排序），导入前二次确认 |
| 策略组 | 按欧美 / 日韩 / 港台 / 中转自动生成分组，并挂载 ChatGPT / Google / YouTube / Telegram 分流组 |
| 安全 | PBKDF2 密码哈希、HMAC 会话、可选 `ADMIN_TOKEN` 恢复通道、CSP nonce、`noindex`、登录与接口限流 |
| 伪装页 | 未携带正确令牌访问根路径时，返回普通的「IP 地址查询」页面 |
| 部署 | Wrangler 自动创建并复用 KV，无需手动绑定 |

### 协议支持

| 协议 | 传输 / 认证 |
| --- | --- |
| VLESS | Reality、WebSocket、gRPC，可配置 TLS、SNI、Flow、指纹 |
| Hysteria2 | 密码、SNI、跳过证书校验、上下行速率 |
| Trojan | TLS、SNI、跳过证书校验 |
| VMess | WebSocket、TCP、gRPC |
| Shadowsocks | SIP002 链接与 Clash 配置 |

### 节点与分组

- **排序**：未筛选时 ↑↓ 调整全局顺序；按分组筛选后只调整该分组内的顺序，不影响其他分组与 🌍选择节点。
- **🌍 选择节点开关**：添加 / 编辑节点时可关闭「在🌍选择节点中显示」。节点仍会保留在所属分组与应用策略组中，只是不再列入全局选择列表。
- **分组归属**：每个节点归属于 欧美 / 日韩 / 港台 / 中转 之一，策略组与订阅输出会自动跟随。

---

## 控制台

### 概览

登录后的首页集中展示节点总数、启用比例、协议类型、策略组数量，以及协议分布、分组构成、KV 连接状态与最近更新的节点；常用操作（添加节点、订阅预览、复制订阅链接）都在首屏可达。

### 节点管理

- 搜索框支持名称、服务器、协议、分组关键字；协议与分组下拉可叠加筛选。
- 行尾菜单提供复制分享链接、复制服务器地址、创建副本、删除节点；点击行内其他区域直接打开编辑抽屉。
- 表头复选框与行复选框支持 Shift 连选；选中后底部浮动操作条出现，可批量启用 / 停用 / 换组 / 删除，并通过 Toast 里的「撤销」恢复。
- 导出备份会下载包含节点、预设、订阅信息与分组排序的 JSON；导入前会显示节点数量并二次确认。

### 订阅预览

右侧预览区实时渲染当前配置的完整 YAML，顶部统计各分组与策略组的节点数量。搜索框支持全文查找、命中计数、上一条 / 下一条跳转；复制与下载均使用本地生成的内容。

### 认证与账号

- **首次使用**：直接打开 `/admin`，按页面提示设置管理员用户名（或邮箱）和密码即可，不需要事先配置任何环境变量。账号和密码哈希保存在 KV 的 `users` 键中，与订阅配置完全分离。
- **日常登录**：用户名或邮箱 + 密码。登录成功后签发 7 天有效的 HMAC 会话，保存在浏览器 `sessionStorage`，关闭标签页即失效；重置自己的密码会立即刷新会话，其他账号被修改后旧会话自动作废。
- **邮箱账号**：用户名位置可直接填写邮箱地址，支持字母、数字及 `. _ + @ -`，最长 254 位；邮箱只作为账号标识，不会发送验证邮件，登录时不区分大小写。
- **部署恢复令牌**：如果配置了 `ADMIN_TOKEN`，首次初始化必须同时填写该令牌，防止公开部署被陌生人抢先注册；账号创建后，`ADMIN_TOKEN` 只作为「恢复令牌」应急登录，不参与日常登录。未配置 `ADMIN_TOKEN` 时不会有恢复通道，请妥善保管密码。
- **订阅令牌不是登录凭据**：`AUTH_TOKEN`（设置页或环境变量）只能拉取订阅，无法进入控制台。
- **用户管理**：设置页顶部列出所有账号，可添加、重置任意账号的密码、删除账号；当前登录账号和最后一个账号不能删除。所有账号权限相同。

### 设置

- **访问令牌**：订阅令牌（`AUTH_TOKEN`）直接在设置页填写或随机生成，保存后立即生效，无需修改 Cloudflare 环境变量。设置页中的令牌优先于环境变量；修改后旧订阅链接立即失效。该令牌仅用于订阅访问，不能登录控制台。
- **VLESS 默认参数**：UUID、Reality 公钥、Short ID、SNI / 回落域名、默认端口；新建 VLESS 节点时自动填入，端口留空则使用 443。
- **订阅信息**：填写总流量（GB）与到期日后，订阅响应头会携带 `subscription-userinfo`，客户端可展示流量条与到期提示；留空则不发送。
- **外观**：跟随系统 / 浅色 / 深色三档，选择结果保存在浏览器本地。

### 分享链接

「分享链接」弹窗分为两个标签页：

- **批量导入**：每行一条链接，空行与 `#` 开头的行会被忽略；重复节点自动跳过。解析失败的行会标注行号与原因，成功的节点可预览、逐条移除，并选择「自动分组」或指定分组。
- **导出链接**：仅导出已启用节点，可一键复制全部或下载 `.txt`；链接在浏览器本地生成，不会上传到服务器。

支持的链接格式：

```text
vless://uuid@example.com:443?security=reality&pbk=...&sni=...&type=tcp#HK-01
hysteria2://password@example.com:443?sni=bing.com#JP-01
trojan://password@example.com:443?sni=example.com#US-01
vmess://<base64-json>
ss://<base64>@example.com:8388#RELAY-01
```

### 键盘快捷键

| 按键 | 作用 |
| --- | --- |
| `/` | 聚焦当前页搜索框（节点管理 / 订阅预览） |
| `Esc` | 关闭弹窗、抽屉、行菜单，或清空预览搜索 |
| `Shift` + 点击复选框 | 连续选择一段节点 |
| `Cmd / Ctrl + S` | 在节点编辑抽屉内保存 |
| `Enter` / `Space` | 聚焦节点行时打开编辑抽屉 |
| 行菜单内 `↑` `↓` `Home` `End` | 在菜单项之间移动焦点 |

---

## 目录结构

```
.
├── admin/                 # 控制台前端源码（构建时内联进 Worker）
│   ├── index.html         # 页面骨架，含 /*__CSS__*/ 与 /*__JS__*/ 占位符
│   ├── app.css
│   └── app.js
├── src/
│   ├── worker.js          # Worker 入口（ES Module，export default { fetch }）
│   ├── static-head.yaml   # 订阅 YAML 的固定头部（端口 / DNS / 模式）
│   └── rules.yaml         # 分流规则与 rule-providers
├── build.mjs              # 把 admin/* 内联进 worker.js，输出 dist/1.js
├── wrangler.toml          # Worker 配置 + KV 绑定声明
└── package.json
```

构建产物 `dist/1.js` 是唯一被部署的文件，已在 `.gitignore` 中忽略，由 CI 现场生成。

本地开发用的 `test/` 目录（接口测试、本地服务器、截图脚本）同样不纳入版本控制，因此仓库里看不到它。如果你 clone 下来想跑测试，需要自行准备这三个脚本；不跑测试对部署没有任何影响。

---

## 部署：GitHub → Cloudflare 自动部署

### 1. 推送到 GitHub

```bash
git init
git add .
git commit -m "chore: init transit-hub"
git branch -M main
git remote add origin git@github.com:<你的账号>/<仓库名>.git
git push -u origin main
```

### 2. 在 Cloudflare 连接仓库

1. 打开 Cloudflare Dashboard → **Workers & Pages** → **Create** → **Workers** → **Import a repository**（连接 GitHub，授权后选择刚推送的仓库）。
2. 构建配置填写：

   | 项 | 值 |
   | --- | --- |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` |

   `npm run build` 会执行 `node build.mjs`，把控制台前端内联进 `src/worker.js` 并产出 `dist/1.js`（即 `wrangler.toml` 里的 `main`）。

3. 可选环境变量（**如需配置请写成 Secret，不要用明文变量**）：

   | 名称 | 作用 | 必填 |
   | --- | --- | --- |
   | `ADMIN_TOKEN` | 初始化与应急恢复令牌，不用于日常登录 | 否（建议配置） |
   | `AUTH_TOKEN` | 订阅令牌；可在设置页生成和修改，无需环境变量 | 否 |

   - **首次打开 `/admin` 时创建管理员账号**，不需要任何环境变量。若配置了 `ADMIN_TOKEN`，初始化页面会多一个「部署恢复令牌」输入框，填入后才能创建第一个账号，避免公开部署被抢先注册。
   - 之后用账号密码登录。`ADMIN_TOKEN` 仅作为应急入口：忘记密码时可在登录页切换到「使用恢复令牌」，凭它进入控制台并重置账号密码。
   - 订阅令牌可在「设置 → 访问令牌」中生成并保存，保存后即使删除环境变量 `AUTH_TOKEN` 也不影响订阅；它只用于订阅访问，不能登录控制台。
   - 设置页中的 `AUTH_TOKEN` 优先于环境变量：保存新值后，环境变量里的旧订阅令牌会立即失效。
   - 令牌请用足够长的随机串，设置页的「生成」按钮会生成 32 位随机令牌。

4. 点击 **Deploy**。

### 3. KV 自动创建与绑定

`wrangler.toml` 里的 KV 声明故意不写 `id`：

```toml
[[kv_namespaces]]
binding = "SUB_KV"
```

Wrangler 在部署时（Cloudflare Workers Builds 会自动注入 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`）会：

- 首次部署：**自动创建一个 KV 命名空间**并写入绑定关系；
- 之后每次部署：识别到同名命名空间，**直接复用**，不会重复创建。

所以整个流程不需要手动去「存储和数据库 → KV」点任何按钮。首次登录控制台时，Worker 会自动往 KV 写入一份空配置，并单独保存管理员账号。

> 如果你的 Wrangler 版本不支持自动预置（部署报 `Missing id` 之类错误），退回手动模式即可：
>
> ```bash
> npx wrangler kv namespace create SUB_KV
> ```
>
> 把输出的 `id` 填进 `wrangler.toml` 的 `id = "..."`，提交后重新部署。

### 4. 开始使用

- 控制台：`https://<worker名>.<你的子域>.workers.dev/admin`
- 订阅链接：`https://<worker名>.<你的子域>.workers.dev/?token=<AUTH_TOKEN>`

首次打开控制台会引导你创建管理员账号（配置了 `ADMIN_TOKEN` 时需填写该令牌）。进入「设置 → 访问令牌」生成并保存 `AUTH_TOKEN`，订阅链接即可使用；需要多人协作时在同一页面添加用户。之后「添加节点」，保存即写入 KV，客户端下次刷新订阅就会拿到新配置。

---

## 本地开发

```bash
npm install
npm run build      # 产出 dist/1.js
```

用 Wrangler 的本地运行时与本地 KV 起服务：

```bash
npm run build
npx wrangler dev
# 打开 http://127.0.0.1:8787/admin 创建管理员账号
```

本地调试不需要预先准备令牌。想测试「部署恢复令牌」流程时，把 `ADMIN_TOKEN` 写进 `.dev.vars`（该文件已被 git 忽略）；`AUTH_TOKEN` 可以在设置页生成。

`package.json` 里只有 `check` / `build` / `deploy` / `tail` 四个脚本，不引用任何本地工具。

`npm run check` 是一个零依赖的静态检查器（`scripts/check.mjs`），专门拦「语法合法、运行时才炸」的问题：

| 规则 | 拦什么 |
| --- | --- |
| `use-before-declare` | `var` 提升后读属性抛 TypeError、`let/const` 的 TDZ |
| `unknown-el` | `el.xxx` 从未在 `cacheElements()` 里赋值（运行时是 undefined） |
| `missing-id` / `duplicate-id` | JS 引用了不存在的 id、HTML 里 id 重复 |
| `missing-error-anchor` | 校验 key 没有对应的 `data-error`，字段不会标红 |
| `duplicate-error-anchor` | 同一 key 有多个锚点，`$()` 只取第一个，跨表单会标错字段 |
| `class-without-style` / `unused-class` | 用了但没样式、定义了但没人用 |
| `duplicate-binding` / `empty-catch` | 同一事件重复绑定、异常被静默吞掉 |

检查器是**可选**的：`build.mjs` 只在 `scripts/check.mjs` 存在时才会调用它。这样本地开发能享受前置检查，而只包含构建必需文件的 CI 环境不会因为缺这个脚本而失败（构建日志会打印「跳过静态检查」）。如果希望 CI 也执行检查，把 `scripts/check.mjs` 一并提交即可。

检查器本身带自测：

```bash
npm run check            # 检查当前代码
npm run check:selftest   # 验证检查器能真的抓到这些问题
```

如果你本地保留了 `test/` 目录（不随仓库分发），可以直接用 node 运行：

```bash
node build.mjs && node test/server.mjs      # 本地服务器，内存 KV，默认 127.0.0.1:8787
node build.mjs && node test/worker.test.mjs # 接口 / 安全回归测试
```

---

## 接口

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/?token=<AUTH_TOKEN>` | 查询参数令牌 | 返回 Clash YAML 订阅 |
| GET | `/admin`、`/console` | 页面内登录 | 管理控制台 |
| GET | `/api/auth` | 公开 | 返回初始化状态：`needsSetup`、`setupLocked`、`recovery`、`maxUsers` |
| POST | `/api/setup` | 公开（配置 `ADMIN_TOKEN` 时需 `Bearer` 部署令牌） | 创建第一个管理员账号；已初始化返回 `409` |
| POST | `/api/login` | 公开 | 用户名或邮箱 + 密码登录，返回会话令牌与用户信息 |
| GET | `/api/config` | `Authorization: Bearer <会话令牌>` | 读取当前配置与运行状态 |
| PUT | `/api/config` | 同上 | 整体覆盖保存，需带 `rev` 做乐观锁；可通过 `authToken` 字段更新订阅令牌 |
| GET | `/api/preview` | 同上 | 返回当前配置渲染出的 YAML |
| GET | `/api/users` | 会话 / 恢复令牌 | 用户列表、当前账号 `currentUserId` 与 `rev` |
| POST | `/api/users` | 同上 | 新建用户；可带 `rev` 做乐观锁 |
| POST | `/api/users/update` | 同上 | 重置指定用户密码；重置自己会返回新会话令牌 |
| POST | `/api/users/delete` | 同上 | 删除指定用户；不能删除自己或最后一个账号 |

`/api/config` 与 `/api/users/*` 也接受 `Authorization: Bearer <ADMIN_TOKEN>` 作为恢复通道。会话令牌有效期 7 天，修改密码后旧会话失效。

配置数据结构（存在 KV 的 `config` 键）：

```json
{
  "v": 1,
  "rev": 3,
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "defaults": {
    "vlessUuid": "…",
    "vlessPublicKey": "…",
    "vlessShortId": "…",
    "vlessServername": "…",
    "vlessPort": 443
  },
  "subscription": {
    "totalGB": 500,
    "expire": "2026-12-31"
  },
  "authToken": "…",
  "regionOrder": {
    "hk": ["n_xxx", "n_yyy"]
  },
  "nodes": [
    {
      "id": "n_xxx",
      "name": "HK-01",
      "type": "vless",
      "server": "example.com",
      "port": 443,
      "region": "hk",
      "enabled": true,
      "showInMain": true,
      "tags": ["chatgpt"],
      "uuid": "…",
      "network": "tcp",
      "tls": true,
      "reality": true,
      "publicKey": "…",
      "shortId": "…"
    }
  ]
}
```

`rev` 用于并发保护：PUT 时若 `rev` 与 KV 中不一致会返回 `409`，避免多标签页互相覆盖。`authToken` 仅通过已鉴权的配置接口返回，不会出现在订阅 YAML 或备份文件中；PUT 时留空表示沿用当前令牌。

账号存在 KV 的 `users` 键，与 `config` 分离，不包含在配置接口或备份文件中：

```json
{
  "v": 1,
  "rev": 1,
  "secret": "…",
  "users": [
    {
      "id": "u_xxx",
      "username": "admin",
      "usernameKey": "admin",
      "passwordSalt": "…",
      "passwordHash": "…",
      "passwordIterations": 10000,
      "version": 1,
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

密码使用 PBKDF2-SHA256（16 字节随机盐、10,000 次迭代）哈希后存储，接口只返回 `id` / `username` / `createdAt`；`secret` 用于签发会话，重置密码会提升 `version` 使旧会话与旧令牌失效。

---

## 更新日志

### v2.6.2

**修复**

- 修复节点编辑抽屉打不开：`openEditor()` 里端口回填写在了 `var preset` 声明之前，`var` 提升导致读 `preset.vlessPort` 抛 TypeError，新建与编辑同时失效。
- 修复脚本异常兜底失效：`el.toastStack` 从未赋值（实际是 `el.toasts`），错误提示一直是静默的。
- 修复表单错误标错位置：`wsPath` / `grpcService` 被 vless 与 vmess 共用同一个 `data-error` 锚点，而 `$()` 只取第一个，vmess 的报错会标到 vless 的隐藏字段上。vmess 改用 `vmWsPath` / `vmGrpcService`，并补齐四个缺失的锚点。
- 修复「Reality 仅支持 TCP」的错误提示没有落点，改为标红传输方式字段。
- 修复保存遇 409 冲突时直接关闭抽屉、已填内容全部丢失：现在保留表单并提示「再次保存即可覆盖」。
- 修复批量修改分组失败时下拉框已复位、节点却没移动：失败时保留下拉选择，可直接重试。

**加固**

- `bindEvents()` 里 50+ 处裸 `el.X.addEventListener` 统一收口到 `on()`，单个元素缺失不再让后续所有按钮一起失效。
- 新增全局 `error` / `unhandledrejection` 兜底，脚本异常会直接弹提示并打到控制台，不再「点了没反应」。
- 订阅 YAML 渲染增加最后一道防线：`type` / `network` / `flow` / `fingerprint` / `cipher` / `port` 只接受白名单值，非法节点整条跳过；策略组只引用实际渲染出来的节点，避免 Clash 报 `proxy not found`。KV 里存在旧版本或手工写入的脏数据时不会再破坏 YAML 结构。
- 用户库解析失败（`corrupted`）时禁止通过 `/api/setup` 重新初始化，防止任何访问者覆盖原数据抢占管理员；恢复需由持有 KV 写权限的人删除 `users` 记录。
- 订阅路径（`/?token=`）增加独立限流（240 次/分钟/IP），与 `/api/*` 的 120 次分开计数，不影响客户端周期性刷新。
- 新增零依赖静态检查器 `scripts/check.mjs` 与自测，把「声明前使用」「el 缓存缺失」「错误锚点缺失/重复」这类语法合法、运行时才炸的问题拦在构建期。它是**可选**依赖：`build.mjs` 仅在文件存在时调用，缺失时打印「跳过静态检查」继续构建，不会阻断只含构建必需文件的 CI。

### v2.6.1

- 设置页「VLESS 默认参数」新增**默认端口**：新建 VLESS 节点时自动填入，留空回落到 443；接口同步校验 1–65535。
- 去掉顶栏与页面内重复的操作按钮：「添加节点」只保留在概览首屏与节点管理，「订阅链接」只保留在概览卡片与订阅预览，顶栏改为纯状态栏。
- 控制台视觉系统重做：统一圆角、间距、字阶与阴影层级，浅色与深色主题共用同一套设计令牌，卡片、表格、代码面板与浮层的层次关系保持一致。
- 状态文字改用更深的同色系（「已连接」「正常」「只读」等），小字号下的对比度明显提升；深色主题的开关轨道、面板边框与代码区背景重新分层，不再糊成一片。
- 概览页统计卡新增跟随语义的强调色与悬停高光，节点速览改为显示「地址:端口」。
- 节点表格：表头字号与字距调整、滚动时吸顶，标题与操作按钮在窄屏下自动换行，不再挤压描述文字；卡片式布局在平板上不再截断节点名称。
- 设置页内容列居中，保存栏改为底部悬浮条，长表单无需滚到底部即可保存。
- 分享链接弹窗去掉重复的协议说明，页脚改为操作提示；订阅预览的代码区高度随视口自适应。

### v2.6.0

- 用户名支持邮箱地址：可直接用 `name@example.com` 创建账号并登录，支持 `+` 别名，最长 254 位，大小写不敏感。
- 首次初始化、登录页和设置页用户管理同步更新提示与校验；邮箱仅作为账号标识，不发送验证邮件。
- 用户列表中的长邮箱会省略显示，悬停可查看完整地址。

### v2.5.1

- 修复订阅预览策略组角标：ChatGPT / Google / YouTube / Telegram 组此前把地区分组自动带入的节点也计入，数字偏大；现在只统计已勾选对应标签的启用节点，提示文案标明「标记节点」。
- 地区分组与「🌍选择节点」仍按各自实际成员统计；节点启用、停用或改标签后角标即时更新。

### v2.5.0

- 首次打开控制台改为创建管理员账号（用户名 + 密码），无需提前配置 `ADMIN_TOKEN`；已配置 `ADMIN_TOKEN` 时需填写该令牌才能初始化。
- 新增设置页「用户管理」：账号列表、添加用户、重置密码、删除账号，当前账号与最后一个账号不可删除；所有账号权限相同。
- 新增账号登录、7 天会话、登录失效自动跳转；`ADMIN_TOKEN` 降级为可选的初始化 / 恢复令牌。
- 明确 `AUTH_TOKEN` 仅用于订阅，不能登录控制台；原有「订阅令牌兼作登录」的行为已移除。
- 密码使用 PBKDF2-SHA256 + 随机盐存储，账号数据单独存放于 KV 的 `users` 键，不出现在配置、备份或订阅 YAML 中。
- 新增登录失败限流（同一 IP + 用户名 10 分钟 8 次）与用户接口乐观锁，设置页用户操作实时刷新。

### v2.4.0

- 新增「设置 → 访问令牌」：可在控制台生成、查看并保存 `AUTH_TOKEN`，保存后立即生效，无需修改环境变量或重新部署。
- 设置页令牌优先于环境变量 `AUTH_TOKEN`；未配置 `ADMIN_TOKEN` 时，该令牌也可用于登录控制台。
- 登录页、概览与设置页会标明当前订阅令牌来源（设置页 / 环境变量）。
- 修改令牌后自动更新当前会话，避免共用令牌模式下退出登录；备份文件不包含订阅令牌。

### v2.3.0

- 新增概览仪表盘：节点状态、协议分布、策略组构成与系统信息。
- 节点管理支持批量选择与批量启用 / 停用 / 换组 / 删除，支持撤销。
- 新增分享链接导入 / 导出与行尾操作菜单。
- 订阅预览支持全文搜索、命中计数与跳转。
- 设置页新增订阅流量 / 到期信息与三种外观模式。
- 移动端布局、键盘操作与无障碍细节优化。

### v2.2.0

- 参数预设、分组排序、🌍选择节点开关、JSON 备份与恢复。

---

## 安全须知

- **仓库里没有任何节点凭据**，节点只存在于 Cloudflare KV。不要把 `dist/`、`.dev.vars`、导出的订阅 YAML 或备份 JSON 提交进仓库（前两者已加入 `.gitignore`）。
- 如果你之前把带节点信息的旧版本（例如单文件的 `1.js`）公开过，请**立即作废并更换**其中出现过的 UUID、Reality 公私钥、Hysteria2 / Trojan / SS 密码——它们应当被视为已泄露。
- 首次部署请立即打开 `/admin` 创建管理员账号，并设置一个不复用的强密码；如果配置了 `ADMIN_TOKEN`，初始化页面会要求先验证该令牌，建议公开实例始终配置它作为恢复通道。
- 账号密码只保存 PBKDF2-SHA256 哈希（随机盐、10,000 次迭代），但 Workers 免费版 CPU 有限，迭代次数低于桌面软件；请使用长密码，不要复用其他站点密码。
- `ADMIN_TOKEN` 只用于初始化和忘记密码时的恢复，建议设置为足够长的随机串；`AUTH_TOKEN` 会出现在订阅 URL 里，可能被客户端或日志记录，两者不要复用同一个值。
- 订阅令牌只用于拉取订阅，不能登录控制台；修改设置页中的令牌后旧订阅链接立即失效。
- 订阅接口返回 `access-control-allow-origin: *` 以便各类客户端拉取；令牌即凭据，泄露后请立刻更换 Secret 或设置页令牌。
- 控制台页面带 CSP（`script-src 'nonce-…'`、`frame-ancestors 'none'`）与 `noindex`，不会进入搜索引擎。
- 管理接口（`/api/*`）内置轻量限流：同一出口 IP 每分钟最多 120 次请求；订阅路径（`/?token=`）单独计数，每分钟最多 240 次；登录失败另有按 IP + 用户名的限流（10 分钟 8 次）。Worker 内存按 isolate 隔离，这是尽力而为的防护；如需严格限流，可在 Cloudflare 控制台为该 Worker 添加边缘 Rate Limiting 规则（路径匹配 `/api/*`，建议阈值 60 次/分钟），与内置限流叠加生效。
- 如果 KV 里的用户记录损坏（控制台提示「用户数据已损坏」），`/api/setup` 会拒绝自动初始化，以免任何访问者覆盖原数据并抢占管理员。恢复方式是：在 Cloudflare 控制台的 KV 中删除 `users` 记录后重新打开 `/admin` 创建账号，或配置 `ADMIN_TOKEN` 作为恢复通道。
- 定期用「导出备份」保存一份 JSON 到本地：KV 数据只存在云端，误删或账号异常时可凭备份恢复。
