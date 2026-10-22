# Transit Hub

运行在 Cloudflare Workers 上的 **Clash 订阅生成器 + 可视化管理控制台**。

节点数据全部存放在 Cloudflare KV，仓库里**不含任何节点**：没有服务器地址、UUID、密码、公钥，也没有任何预置模板。首次部署后订阅是一份空配置（`proxies: []`），所有节点都由你在 `/admin` 控制台里自己添加。

---

## 功能

- **订阅输出**：`GET /?token=<AUTH_TOKEN>` 返回 Clash / Mihomo 可直接使用的 YAML，带 `subscription-userinfo` 与 `profile-update-interval` 响应头。
- **管理控制台**：`/admin`，令牌登录，支持节点增删改、启用/停用、一键复制、协议筛选、订阅实时预览与下载。
- **节点排序**：节点管理页用 ↑ ↓ 调整节点顺序，顺序会直接反映到订阅 YAML 与策略组中。
- **🌍 选择节点显示开关**：添加/编辑节点时可关闭「在🌍选择节点中显示」，该节点仍保留在所属分组与应用策略组中，只是不再列入全局选择列表。
- **参数预设**：控制台新增「参数预设」页，可设置固定的 UUID、Reality 公钥、Short ID、SNI / 回落域名；新建 VLESS 节点时自动填入，不用每次重复粘贴。
- **协议支持**：VLESS（Reality / WS / gRPC）、Hysteria2、Trojan、VMess、Shadowsocks。
- **策略组自动编排**：按分组（欧美 / 日韩 / 港台 / 中转）自动生成策略组，并自动挂载 ChatGPT / Google / YouTube / Telegram 应用分流组。
- **伪装的访客页面**：未携带正确令牌访问根路径时，返回一个普通的「IP 地址查询」页面，不暴露服务性质。
- **零手动配置部署**：KV 命名空间由 Wrangler 在部署时自动创建并绑定。

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

3. 在同一页面的 **Variables and Secrets** 中添加两个密钥（**必须是 Secret，不要写成明文变量**）：

   | 名称 | 作用 | 必填 |
   | --- | --- | --- |
   | `AUTH_TOKEN` | 订阅链接的访问令牌，出现在 `?token=` 中 | 是 |
   | `ADMIN_TOKEN` | 控制台登录令牌；不填则回退使用 `AUTH_TOKEN` | 建议填 |

   令牌请用足够长的随机串，例如 `openssl rand -hex 32`。

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

登录控制台后「添加节点」，保存即写入 KV，客户端下次刷新订阅就会拿到新配置。

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
node build.mjs && node test/worker.test.mjs # 20 项接口/安全测试
```

---

## 接口

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/?token=<AUTH_TOKEN>` | 查询参数令牌 | 返回 Clash YAML 订阅 |
| GET | `/admin`、`/console` | 页面内登录 | 管理控制台 |
| GET | `/api/config` | `Authorization: Bearer <ADMIN_TOKEN>` | 读取当前配置与运行状态 |
| PUT | `/api/config` | 同上 | 整体覆盖保存，需带 `rev` 做乐观锁 |
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

`rev` 用于并发保护：PUT 时若 `rev` 与 KV 中不一致会返回 `409`，避免多标签页互相覆盖。

---

## 安全须知

- **仓库里没有任何节点凭据**，节点只存在于 Cloudflare KV。不要把 `dist/`、`.dev.vars`、导出的订阅 YAML 提交进仓库（前两者已加入 `.gitignore`）。
- 如果你之前把带节点信息的旧版本（例如单文件的 `1.js`）公开过，请**立即作废并更换**其中出现过的 UUID、Reality 公私钥、Hysteria2 / Trojan / SS 密码——它们应当被视为已泄露。
- `ADMIN_TOKEN` 与 `AUTH_TOKEN` 分开设置更安全：`AUTH_TOKEN` 会出现在订阅 URL 里，可能被客户端或日志记录。
- 订阅接口返回 `access-control-allow-origin: *` 以便各类客户端拉取；令牌即凭据，泄露后请立刻更换 Secret 并重新部署。
- 控制台页面带 CSP（`script-src 'nonce-…'`、`frame-ancestors 'none'`）与 `noindex`，不会进入搜索引擎。
