# Railway 单域名部署设计

## 目标

把现有设计周刊作为一个有状态实时应用部署到 Railway，并使用一个 Railway 免费公网域名同时承载网页、上传接口和实时协作。用户不需要购买域名，也不需要手工维护服务器。

## 架构

一个 Railway Service 内运行三个长期进程：

1. Caddy 监听 Railway 注入的公网 `PORT`，作为唯一入口。
2. Next.js 监听容器内部 `3000` 端口，处理网页、API、媒体上传和历史归档。
3. Hocuspocus 监听容器内部 `1234` 端口，处理实时协作和内部生命周期 RPC。

Caddy 将 `/collaboration` 的 WebSocket Upgrade 请求转发到 Hocuspocus，并将其他请求转发到 Next.js。转发时移除 `/collaboration` 前缀。浏览器在未显式配置 `NEXT_PUBLIC_COLLAB_URL` 时，根据当前页面地址自动生成 `wss://当前域名/collaboration`，因此 Railway 分配域名后不需要重新构建。

## 数据与配置

Railway Volume 挂载到 `/data`。运行时使用：

- `DATABASE_PATH=/data/design-weekly.sqlite`
- `MEDIA_ROOT=/data/uploads`
- `COLLABORATION_PORT=1234`
- `COLLAB_INTERNAL_URL=http://127.0.0.1:1234/internal/restore`
- `APP_TIMEZONE=Asia/Shanghai`
- `COLLAB_INTERNAL_TOKEN` 由 Railway Secret 提供，必须是 64 位随机十六进制字符串。

SQLite、快照和媒体文件都保留在同一容器挂载的本地持久卷中。服务保持单副本，避免多个实例同时写同一 SQLite 文件。

## 构建与启动

仓库新增 Dockerfile、Caddyfile 和 Railway 配置。Docker 镜像使用 Node.js 22、pnpm 和固定版本 Caddy。构建阶段安装锁定依赖并运行 `pnpm build`；运行阶段同时启动 Caddy、Next.js 和 Hocuspocus。任一关键进程退出时，容器整体退出，由 Railway 的重启策略恢复，避免网页看似在线但实时协作已经停止。

生产运行所需的 `tsx` 与进程管理工具必须放在生产依赖中，不能只存在于开发依赖。

## 错误处理与安全

- Caddy 自动保留 WebSocket Upgrade 语义，公网仅暴露入口端口。
- Hocuspocus 与内部恢复接口不会单独生成公网域名。
- 内部 RPC 继续使用强随机 token，并只通过容器 loopback 访问。
- 服务启动前校验必需 token；缺失时快速失败，不以不安全配置运行。
- Volume 未挂载或不可写时服务启动/首次写入失败，并在 Railway 日志中显示原因。
- 不启用多副本或 Serverless 睡眠，避免 SQLite 锁冲突和首次访问时实时连接中断。

## 验证

新增测试覆盖同域名 WebSocket URL 推导；部署配置检查验证路由、端口、持久化路径和生产启动命令。完成后运行现有 210 项测试、lint、生产构建，并在本地容器可用时执行容器启动健康检查。Railway 发布后验证：首页可访问、两窗口编辑同步、图片上传后刷新仍存在、WebSocket 断开后可自动恢复。

## 发布流程

1. 完成并验证部署配置。
2. 将代码放入用户 GitHub 仓库。
3. 在 Railway 从 GitHub 创建 Service。
4. 挂载 `/data` Volume，设置 token 和固定运行变量，保持单副本。
5. 生成一个 Railway 公网域名并等待部署成功。
6. 打开公网地址完成协作、上传与持久化验收。

GitHub 或 Railway 登录授权属于用户账户操作；执行到该步骤时由用户在浏览器完成授权，之后继续自动配置和验证。
