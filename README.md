# 设计周刊

设计周刊是一份公开、匿名、实时协作的周刊文档。任何拿到链接的人都能编辑当前期；历史期数永久只读。它由两个长期运行的进程和两类持久数据组成：Next.js 提供网页与上传接口，Hocuspocus 提供 WebSocket 协作，SQLite 保存文档状态，文件系统保存媒体原件与派生文件。

## 本地启动

需要 Node.js 22 或更高版本，以及 Node 自带的 Corepack。首次启动：

```bash
corepack enable
pnpm install
cp .env.example .env.local
openssl rand -hex 32
```

把最后一条命令输出的 64 位十六进制随机值填入 `.env.local` 的 `COLLAB_INTERNAL_TOKEN`。这是 Next.js 与 Hocuspocus 共享的内部令牌；不要提交真实值，也不要在多个环境复用同一个值。

然后同时启动网页与协作服务：

```bash
pnpm dev
```

默认网页地址是 `http://127.0.0.1:3000`，协作 WebSocket 是 `ws://127.0.0.1:1234`。若修改 `COLLABORATION_PORT`，必须同时修改 `NEXT_PUBLIC_COLLAB_URL` 与 `COLLAB_INTERNAL_URL` 中的端口，并重启两个进程。

## 验证

首次运行浏览器测试前安装项目固定使用的 Chromium：

```bash
pnpm test:e2e:install
```

分别运行检查：

```bash
pnpm test
pnpm lint
pnpm build
pnpm test:e2e
```

也可以运行完整门禁：

```bash
pnpm verify
```

E2E 会启动 Web 与 Hocuspocus，并使用临时、隔离的 SQLite 数据库和媒体目录，不会读写本地开发或生产数据。测试配置会显式启用受 `COLLAB_INTERNAL_TOKEN` 保护的内部 rollover RPC，以便让正在运行的真实协作协调器推进时钟；常规开发与生产配置不会注册这个改时钟端点。生产 Web 访问使用另一个受相同令牌保护、不可指定时间的内部 `ensure-current` RPC，确保跨周时先冻结并刷盘活跃协作文档，再归档。

## 权限与数据

当前版本有意允许公开匿名编辑：当前期不要求登录、账号、审核或成员权限。匿名名称只用于协作状态和版本记录，不是授权凭据。历史期数在 UI、上传接口和协作服务中均为只读。

默认持久数据位于：

- `data/design-weekly.sqlite`：期数、Yjs 文档状态、快照与媒体索引。
- `storage/uploads/`：媒体原件和派生文件。

备份和恢复必须把 `data/` 与 `storage/` 当作同一个一致性单元。可靠的做法是短暂停止 Web 与 Hocuspocus 两个写入进程，复制两个目录，再一起恢复；只备份数据库会留下缺失媒体，只备份文件会丢失文档引用和版本历史。恢复演练也应同时验证历史文档与上传 URL。

## 生产部署

这不是纯静态站点，也不能部署成无状态的单进程 Serverless 应用。生产环境必须提供：

- 两个长期运行的进程：`pnpm start` 运行构建后的 Next.js，`pnpm start:collab` 运行 Hocuspocus。
- 同一台主机的持久化本地块存储上的 `DATABASE_PATH` 与 `MEDIA_ROOT`，并按上节一起备份。不要把 SQLite WAL 放到无法保证 POSIX 文件锁与 WAL 语义的普通网络共享目录；如必须使用网络文件系统，需先验证其锁与崩溃恢复兼容性。
- 反向代理把 HTTP 流量转给 Next.js，并为 Hocuspocus 路径或独立域名启用 WebSocket Upgrade、长连接和合适的空闲超时。
- 若采用独立协作域名，把浏览器可访问的 `wss://` 地址写入构建时的 `NEXT_PUBLIC_COLLAB_URL`；TLS 页面不能连接明文 `ws://`。本仓库的 Railway 单服务方案改用同源 `/collaboration`，不设置该变量。
- 仅在服务端注入的强随机 `COLLAB_INTERNAL_TOKEN`，以及 `APP_TIMEZONE=Asia/Shanghai`。Web 与协作进程不在同一网络命名空间时，还必须把 `COLLAB_INTERNAL_URL` 设置为 Web 进程可访问的协作服务私有地址（完整路径为 `/internal/restore`）；默认值只适用于同机的 `127.0.0.1:${COLLABORATION_PORT}`。

因此，纯静态导出以及默认的无状态 Vercel 部署都不满足 SQLite、媒体持久卷和常驻 Hocuspocus 的运行条件。若使用 Vercel 承载 Web 层，仍需另行提供有状态协作服务、共享持久存储和相应的数据一致性方案；本仓库没有声明这种拆分拓扑可直接使用。

### Railway 部署

Railway 使用仓库根目录的 `Dockerfile` 构建一个长期运行的服务。为该服务生成一个公开域名即可：Caddy 把普通 HTTP 请求转给 Next.js，并把同一域名下的 `/collaboration` 转给 Hocuspocus，因此 `NEXT_PUBLIC_COLLAB_URL` 留空（不要在 Railway 中创建这个变量）。

在服务的 Variables 中逐项设置：

```dotenv
DATABASE_PATH=/data/design-weekly.sqlite
MEDIA_ROOT=/data/uploads
COLLABORATION_PORT=1234
COLLAB_INTERNAL_URL=http://127.0.0.1:1234/internal/restore
COLLAB_INTERNAL_TOKEN=<64-character-random-hex>
APP_TIMEZONE=Asia/Shanghai
```

用 `openssl rand -hex 32` 生成每个环境独有的 64 位十六进制强随机值，替换 `COLLAB_INTERNAL_TOKEN` 的占位符；不要提交或跨环境复用真实令牌。

为同一个服务挂载一个 Railway Volume，挂载路径必须精确为 `/data`。数据库和上传都位于该卷中，必须作为一个一致性单元备份和恢复。SQLite 与本地文件上传要求服务只能保持一个副本，禁止设置大于 1 的副本数；同时关闭 Serverless 和休眠，确保 WebSocket 协作进程常驻。

容器的 runtime entrypoint 会短暂以 `root` 启动，只用于修复新挂载 `/data` 卷的所有权，随后立即降权为 `node` 用户，再启动 Web、Hocuspocus 与 Caddy。不要在 Railway 中覆盖镜像的启动命令，否则会绕过这一步。

首次部署并生成公开域名后，完成以下验收：

1. 用两个浏览器窗口打开同一个公开域名，确认双方输入和在线状态实时同步。
2. 上传一张图片，确认编辑器和公开上传 URL 都能读取它。
3. 触发一次重新部署或服务重启，再次打开文档和上传 URL，确认协作文档与图片仍然存在。

## 已知限制与构建提示

第一版刻意不包含登录与权限系统、投稿审核、评论/点赞/关注/通知、复杂表格或数据库视图、流程图/白板、钉钉导入、推荐算法和分析后台；这些是产品规格明确列出的非目标。

Next.js 的文件追踪（NFT，Node File Trace）在分析 `better-sqlite3`、`sharp` 等原生或动态依赖时可能输出依赖追踪 warning。只要 `pnpm build` 成功且部署产物保留完整的 pnpm 依赖与原生二进制，这个 warning 本身不表示构建失败；若采用裁剪后的 standalone 镜像，必须实际启动产物并验证数据库与图片上传，不能仅凭 warning 文案判断可部署。
