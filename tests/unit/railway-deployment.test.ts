import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, 'utf8')

describe('Railway deployment contract', () => {
  it('configures Railway to build the Dockerfile and restart unhealthy services', () => {
    const railway = read('railway.toml')

    expect(railway).toContain('builder = "DOCKERFILE"')
    expect(railway).toContain('dockerfilePath = "Dockerfile"')
    expect(railway).toContain('healthcheckPath = "/"')
    expect(railway).toContain('healthcheckTimeout = 300')
    expect(railway).toContain('restartPolicyType = "ON_FAILURE"')
    expect(railway).toContain('restartPolicyMaxRetries = 10')
  })

  it('provides Railway production environment examples with persistent paths', () => {
    const envExample = read('.env.example')

    expect(envExample).toContain('DATABASE_PATH=/data/design-weekly.sqlite')
    expect(envExample).toContain('MEDIA_ROOT=/data/uploads')
    expect(envExample).toContain('COLLABORATION_PORT=1234')
    expect(envExample).toContain(
      'COLLAB_INTERNAL_URL=http://127.0.0.1:1234/internal/restore',
    )
    expect(envExample).toContain(
      'COLLAB_INTERNAL_TOKEN=<64-character-random-hex>',
    )
    expect(envExample).toContain('APP_TIMEZONE=Asia/Shanghai')
  })

  it('documents the Railway topology and post-deploy acceptance checks', () => {
    const readme = read('README.md')

    expect(readme).toContain('Railway')
    expect(readme).toContain('`/data`')
    expect(readme).toContain('只能保持一个副本')
    expect(readme).toContain('关闭 Serverless')
    expect(readme).toContain('`NEXT_PUBLIC_COLLAB_URL` 留空')
    expect(readme).toContain('`openssl rand -hex 32`')
    expect(readme).toContain('两个浏览器')
    expect(readme).toContain('重新部署')
    expect(readme).toContain('短暂以 `root` 启动')
    expect(readme).toContain('降权')
  })

  it('routes one public domain to web and collaboration services', () => {
    const caddyfile = read('Caddyfile')
    expect(caddyfile).toContain('path /collaboration')
    expect(caddyfile).not.toContain('path /collaboration*')
    expect(caddyfile).toContain('header Connection *Upgrade*')
    expect(caddyfile).toContain('header Upgrade websocket')
    expect(caddyfile).toContain('path /collaboration/internal/*')
    expect(caddyfile).toContain('respond @collaboration_internal 404')
    expect(caddyfile).toContain('uri strip_prefix /collaboration')
    expect(caddyfile).toContain('reverse_proxy 127.0.0.1:1234')
    expect(caddyfile).toContain('reverse_proxy 127.0.0.1:3000')
  })

  it('ships production runtime dependencies and persistent paths', () => {
    const dockerfile = read('Dockerfile')
    const packageJson = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>
      scripts: Record<string, string>
    }
    expect(dockerfile).toContain('FROM node:22-bookworm-slim')
    expect(dockerfile).toContain('COPY --from=caddy /usr/bin/caddy /usr/bin/caddy')
    expect(dockerfile).toContain('DATABASE_PATH=/data/design-weekly.sqlite')
    expect(dockerfile).toContain('MEDIA_ROOT=/data/uploads')
    expect(packageJson.scripts['start:railway']).toContain('concurrently -k')
    expect(packageJson.dependencies.concurrently).toBeTruthy()
    expect(packageJson.dependencies.tsx).toBeTruthy()
  })

  it('excludes environment files except the checked-in example', () => {
    const dockerignore = read('.dockerignore')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    expect(dockerignore).toContain('.env*')
    expect(dockerignore.filter((line) => line.startsWith('!.env'))).toEqual([
      '!.env.example',
    ])
  })

  it('pins and prepares pnpm in every Node image stage', () => {
    const dockerfile = read('Dockerfile')
    const packageJson = JSON.parse(read('package.json')) as {
      packageManager?: string
    }

    expect(packageJson.packageManager).toBe('pnpm@10.32.1')
    expect(
      dockerfile.match(/RUN npm install --global pnpm@10\.32\.1/g),
    ).toHaveLength(2)
  })

  it('repairs the mounted volume before permanently dropping root privileges', () => {
    const dockerfile = read('Dockerfile')
    const entrypoint = read('server/railway-entrypoint.mjs')

    expect(dockerfile).toContain(
      'COPY --chown=node:node --from=build /app /app',
    )
    expect(dockerfile).not.toContain('USER node')
    expect(dockerfile).toContain('CMD ["node", "server/railway-entrypoint.mjs"]')

    const validation = entrypoint.indexOf('requireRailwayVolumeMountPath(')
    const repair = entrypoint.indexOf('chownSync(volumeRoot, NODE_UID, NODE_GID)')
    const setGroup = entrypoint.indexOf('process.setgid(NODE_GID)')
    const setUser = entrypoint.indexOf('process.setuid(NODE_UID)')
    const spawn = entrypoint.lastIndexOf('startRailwayServices()')
    expect(repair).toBeGreaterThan(-1)
    expect(validation).toBeGreaterThan(-1)
    expect(repair).toBeGreaterThan(validation)
    expect(setGroup).toBeGreaterThan(repair)
    expect(setUser).toBeGreaterThan(setGroup)
    expect(spawn).toBeGreaterThan(setUser)
  })

  it('starts Railway services in a process group and forwards termination to the group', () => {
    const entrypoint = read('server/railway-entrypoint.mjs')

    expect(entrypoint).toContain("spawnProcess('pnpm', ['start:railway'], {")
    expect(entrypoint).toContain("detached: true")
    expect(entrypoint).toContain('process.kill(-child.pid, signal)')
  })
})
