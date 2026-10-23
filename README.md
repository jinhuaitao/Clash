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
| 设置 | AUTH_TOKEN 订阅令牌、VLESS 参数预设、订阅流量与到期日、浅色 / 深色 / 跟随系统外观 |
| 备份恢复 | 导出 / 导入 JSON（节点、参数预设、订阅信息、分组排序），导入前二次确认 |
| 策略组 | 按欧美 / 日韩 / 港台 / 中转自动生成分组，并挂载 ChatGPT / Google / YouTube / Telegram 分流组 |
| 安全 | 令牌登录、CSP nonce、`noindex`、管理接口内置限流 |
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

### 设置

- **访问令牌**：订阅令牌（`AUTH_TOKEN`）直接在设置页填写或随机生成，保存后立即生效，无需修改 Cloudflare 环境变量。设置页中的令牌优先于环境变量；修改后旧订阅链接立即失效。未单独配置 `ADMIN_TOKEN` 时，该令牌也可以登录控制台。
- **VLESS 默认参数**：UUID、Reality 公钥、Short ID、SNI / 回落域名；新建 VLESS 节点时自动填入。
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

3. 登录凭据（**必须写成 Secret，不要用明文变量**）：

   | 名称 | 作用 | 必填 |
   | --- | --- | --- |
   | `ADMIN_TOKEN` | 控制台登录令牌；建议始终配置 | 建议 |
   | `AUTH_TOKEN` | 订阅令牌；可在设置页生成和修改，无需环境变量 | 否 |

   - 首次登录需要 `ADMIN_TOKEN`，或环境变量中的 `AUTH_TOKEN`。登录后可在「设置 → 访问令牌」中生成并保存订阅令牌，之后即使删除环境变量 `AUTH_TOKEN` 也不影响订阅，设置页中的令牌同样支持登录。
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

所以整个流程不需要手动去「存储和数据库 → KV」点任何按钮。首次打开控制台时，Worker 会自动往 KV 写入一份空配置。

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

首次用 `ADMIN_TOKEN`（或环境变量 `AUTH_TOKEN`）登录；进入「设置 → 访问令牌」生成并保存 `AUTH_TOKEN` 后，就可以只靠 KV 中的订阅令牌登录和生成订阅链接。之后「添加节点」，保存即写入 KV，客户端下次刷新订阅就会拿到新配置。

---

## 本地开发

```bash
npm install
npm run build      # 产出 dist/1.js
```

用 Wrangler 的本地运行时与本地 KV 起服务：

```bash
cp .dev.vars.example .dev.vars   # 填入令牌，该文件已被 git 忽略
npm run build
npx wrangler dev
```

`package.json` 里只有 `build` / `deploy` / `tail` 三个脚本，不引用任何本地工具。如果你本地保留了 `test/` 目录（不随仓库分发），可以直接用 node 运行：

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
| GET | `/api/config` | `Authorization: Bearer <管理令牌>` | 读取当前配置与运行状态；管理令牌为 `ADMIN_TOKEN`，未配置时可用订阅令牌 |
| PUT | `/api/config` | 同上 | 整体覆盖保存，需带 `rev` 做乐观锁；可通过 `authToken` 字段更新订阅令牌 |
| GET | `/api/preview` | 同上 | 返回当前配置渲染出的 YAML |

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
    "vlessServername": "…"
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

---

## 更新日志

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
- `ADMIN_TOKEN` 与 `AUTH_TOKEN` 分开设置更安全：`AUTH_TOKEN` 会出现在订阅 URL 里，可能被客户端或日志记录。设置页中的订阅令牌保存在 KV，修改后旧链接立即失效；建议保留独立的 `ADMIN_TOKEN` 作为登录凭据。
- 首次登录需要 `ADMIN_TOKEN` 或环境变量 `AUTH_TOKEN`。如果两者都没有，控制台无法完成首次认证；登录一次并保存设置页令牌后，即可只依赖 KV 中的订阅令牌登录。
- 订阅接口返回 `access-control-allow-origin: *` 以便各类客户端拉取；令牌即凭据，泄露后请立刻更换 Secret 并重新部署。
- 控制台页面带 CSP（`script-src 'nonce-…'`、`frame-ancestors 'none'`）与 `noindex`，不会进入搜索引擎。
- 管理接口（`/api/*`）内置轻量限流：同一出口 IP 每分钟最多 120 次请求，超限返回 `429` + `Retry-After`。Worker 内存按 isolate 隔离，这是尽力而为的防护；如需严格限流，可在 Cloudflare 控制台为该 Worker 添加边缘 Rate Limiting 规则（路径匹配 `/api/*`，建议阈值 60 次/分钟），与内置限流叠加生效。
- 定期用「导出备份」保存一份 JSON 到本地：KV 数据只存在云端，误删或账号异常时可凭备份恢复。
