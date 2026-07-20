# Railway Single-Domain Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the design-weekly application as one Railway service with one public domain, persistent SQLite/media storage, and same-origin WebSocket collaboration.

**Architecture:** Caddy listens on Railway's public `PORT`, strips `/collaboration` and proxies that WebSocket traffic to Hocuspocus on `1234`, while proxying all other traffic to Next.js on `3000`. A multi-stage Docker image contains Node.js 22, the built application, Caddy, and three supervised runtime processes; a Railway volume mounted at `/data` stores SQLite and uploads.

**Tech Stack:** Next.js 16, Hocuspocus 4, Caddy 2, Docker, Railway, pnpm, Vitest

## Global Constraints

- Use one Railway Service, one Railway-provided public domain, and one replica.
- The public collaboration URL is `wss://<current-host>/collaboration` unless `NEXT_PUBLIC_COLLAB_URL` is explicitly configured.
- Next.js listens on internal port `3000`; Hocuspocus listens on internal port `1234`; Caddy alone listens on public `PORT`.
- Persist SQLite at `/data/design-weekly.sqlite` and media at `/data/uploads`.
- Keep internal lifecycle and restore RPCs on `http://127.0.0.1:1234` and protect them with `COLLAB_INTERNAL_TOKEN`.
- Any critical runtime process exit must terminate the container so Railway can restart it.
- Do not enable multiple replicas or Serverless sleep while the application uses SQLite and local media storage.

---

### Task 1: Same-origin collaboration URL

**Files:**
- Create: `src/features/collaboration/websocket-url.ts`
- Modify: `src/features/collaboration/collaboration-room.tsx`
- Create: `tests/unit/websocket-url.test.ts`

**Interfaces:**
- Produces: `resolveCollaborationWebSocketUrl(configuredUrl: string | undefined, location: Pick<Location, 'host' | 'protocol'>): string`.
- Consumed by: `CollaborationSocketProvider` when no explicit prop is supplied.

- [ ] **Step 1: Write the failing URL-resolution test**

```ts
import { describe, expect, it } from 'vitest'
import { resolveCollaborationWebSocketUrl } from '@/features/collaboration/websocket-url'

describe('resolveCollaborationWebSocketUrl', () => {
  it.each([
    ['https:', 'weekly.up.railway.app', 'wss://weekly.up.railway.app/collaboration'],
    ['http:', '127.0.0.1:3000', 'ws://127.0.0.1:3000/collaboration'],
  ])('derives a same-origin URL for %s', (protocol, host, expected) => {
    expect(resolveCollaborationWebSocketUrl(undefined, { protocol, host })).toBe(expected)
  })

  it('preserves an explicit URL', () => {
    expect(resolveCollaborationWebSocketUrl('wss://collab.example.com', {
      protocol: 'https:',
      host: 'weekly.example.com',
    })).toBe('wss://collab.example.com')
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run tests/unit/websocket-url.test.ts`

Expected: FAIL because `@/features/collaboration/websocket-url` does not exist.

- [ ] **Step 3: Implement URL resolution and wire it into the provider**

```ts
export function resolveCollaborationWebSocketUrl(
  configuredUrl: string | undefined,
  location: Pick<Location, 'host' | 'protocol'>,
): string {
  if (configuredUrl) return configuredUrl
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/collaboration`
}
```

In `CollaborationSocketProvider`, retain `ws://127.0.0.1:1234` as the server-side fallback and call the resolver with `window.location` in the browser. Explicit props and `NEXT_PUBLIC_COLLAB_URL` remain higher priority.

- [ ] **Step 4: Verify GREEN and regressions**

Run: `pnpm vitest run tests/unit/websocket-url.test.ts tests/unit/collaboration-room.test.tsx`

Expected: both files PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/collaboration/websocket-url.ts src/features/collaboration/collaboration-room.tsx tests/unit/websocket-url.test.ts
git commit -m "feat: derive same-origin collaboration URL"
```

### Task 2: Production container and process supervision

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `Caddyfile`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `tests/unit/railway-deployment.test.ts`

**Interfaces:**
- Produces: `pnpm start:railway`, which supervises `start:proxy`, `start:web`, and `start:collab`.
- Produces: one public Caddy listener on `${PORT:-8080}` and internal listeners on `3000` and `1234`.
- Consumes: Task 1's `/collaboration` browser URL.

- [ ] **Step 1: Write failing deployment-contract tests**

Create tests that read `Dockerfile`, `Caddyfile`, `.dockerignore`, and `package.json`, then assert:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, 'utf8')

describe('Railway deployment contract', () => {
  it('routes one public domain to web and collaboration services', () => {
    const caddyfile = read('Caddyfile')
    expect(caddyfile).toContain('path /collaboration*')
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
})
```

- [ ] **Step 2: Run the deployment test and verify RED**

Run: `pnpm vitest run tests/unit/railway-deployment.test.ts`

Expected: FAIL because the container and proxy files do not exist.

- [ ] **Step 3: Add runtime scripts and production dependencies**

Add these scripts:

```json
{
  "start:web": "next start -H 0.0.0.0 -p 3000",
  "start:proxy": "caddy run --config Caddyfile --adapter caddyfile",
  "start:railway": "concurrently -k -n proxy,web,collab 'pnpm start:proxy' 'pnpm start:web' 'pnpm start:collab'"
}
```

Move `concurrently` and `tsx` from `devDependencies` to `dependencies`, then run `pnpm install --lockfile-only` to refresh the lockfile without changing resolved versions.

- [ ] **Step 4: Add Caddy and Docker configuration**

`Caddyfile`:

```caddyfile
:{$PORT:8080} {
  @collaboration path /collaboration*
  handle @collaboration {
    uri strip_prefix /collaboration
    reverse_proxy 127.0.0.1:1234
  }
  handle {
    reverse_proxy 127.0.0.1:3000
  }
}
```

`Dockerfile`:

```dockerfile
FROM caddy:2.10.2 AS caddy

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV DATABASE_PATH=/data/design-weekly.sqlite
ENV MEDIA_ROOT=/data/uploads
ENV COLLABORATION_PORT=1234
ENV COLLAB_INTERNAL_URL=http://127.0.0.1:1234/internal/restore
ENV APP_TIMEZONE=Asia/Shanghai
RUN corepack enable
WORKDIR /app
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY --from=build /app /app
RUN mkdir -p /data/uploads
EXPOSE 8080 3000 1234
CMD ["pnpm", "start:railway"]
```

`.dockerignore`:

```dockerignore
.git
.next
node_modules
data
storage
test-results
playwright-report
.env
.env.local
.env.*.local
```

- [ ] **Step 5: Verify GREEN and production build**

Run: `pnpm vitest run tests/unit/railway-deployment.test.ts && pnpm lint && pnpm build`

Expected: tests PASS, lint exits 0, and Next.js production build exits 0.

- [ ] **Step 6: Build and smoke-test the image when Docker is available**

Run: `docker build -t design-weekly:railway .`

Then run it with a temporary `/data` volume, a 64-character token, and port `8080`; verify `GET /` returns HTTP 200 and a WebSocket handshake reaches `/collaboration`. If Docker is unavailable, record that environment limitation and rely on the static contract test plus production build.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore Caddyfile package.json pnpm-lock.yaml tests/unit/railway-deployment.test.ts
git commit -m "build: add Railway production container"
```

### Task 3: Railway service metadata and operator handoff

**Files:**
- Create: `railway.toml`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `tests/unit/railway-deployment.test.ts`

**Interfaces:**
- Produces: Railway Dockerfile builder metadata, `/` health check, and on-failure restart policy.
- Documents: exact `/data` volume mount, required token, one-replica rule, public-domain generation, and post-deploy acceptance tests.

- [ ] **Step 1: Extend deployment-contract tests and verify RED**

Assert that `railway.toml` selects the Dockerfile builder, health checks `/`, and restarts on failure. Assert `.env.example` contains `/data` production examples in comments or a dedicated Railway block, and README lists the exact Railway variables and explicitly prohibits replicas greater than one.

Run: `pnpm vitest run tests/unit/railway-deployment.test.ts`

Expected: FAIL because `railway.toml` and the operator instructions are absent.

- [ ] **Step 2: Add Railway metadata**

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

- [ ] **Step 3: Add exact deployment instructions**

Document these Railway variables:

```dotenv
DATABASE_PATH=/data/design-weekly.sqlite
MEDIA_ROOT=/data/uploads
COLLABORATION_PORT=1234
COLLAB_INTERNAL_URL=http://127.0.0.1:1234/internal/restore
COLLAB_INTERNAL_TOKEN=<64-character-random-hex>
APP_TIMEZONE=Asia/Shanghai
```

Document mounting one Volume at `/data`, generating one public domain, leaving `NEXT_PUBLIC_COLLAB_URL` unset for same-origin mode, keeping one replica, disabling Serverless sleep, and validating two-browser editing plus upload persistence after a redeploy.

- [ ] **Step 4: Run complete verification**

Run: `pnpm test && pnpm lint && pnpm build && pnpm exec playwright test --list && git diff --check`

Expected: all Vitest tests PASS, lint and build exit 0, nine Playwright cases are discovered, and the diff check is clean.

- [ ] **Step 5: Commit and refresh deliverables**

```bash
git add railway.toml .env.example README.md tests/unit/railway-deployment.test.ts
git commit -m "docs: add Railway deployment handoff"
git archive --format=zip --output=../outputs/design-weekly-site.zip HEAD
```

After verification, proceed to account authorization: create or connect a GitHub repository, deploy it from Railway, attach `/data`, set secrets, generate the domain, and run the post-deploy acceptance checks. Do not publish publicly until the user has completed the GitHub and Railway authorization prompts.
