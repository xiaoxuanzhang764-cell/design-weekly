import { getRepositories } from '@/server/db/client'
import { ensureCurrentIssue } from '@/features/issues/server-lifecycle'
import type { IssueRepository } from '@/server/db/issues-repository'
import type { SnapshotRepository, SnapshotSummary } from '@/server/db/snapshots-repository'

interface RouteContext {
  params: Promise<{ issueId: string }>
}

export interface RestoreClient {
  restore(issueId: string, snapshotId: number): Promise<SnapshotSummary>
}

export class RestoreConfigurationError extends Error {}

interface SnapshotRouteDependencies {
  issues: Pick<IssueRepository, 'find'>
  restoreClient: RestoreClient
  snapshots: Pick<SnapshotRepository, 'get' | 'list'>
}

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status })
}

export function createSnapshotRouteHandlers(dependencies: SnapshotRouteDependencies) {
  return {
    async GET(request: Request, context: RouteContext): Promise<Response> {
      const { issueId } = await context.params
      if (!dependencies.issues.find(issueId)) {
        return errorResponse(404, 'ISSUE_NOT_FOUND', '未找到这期周刊')
      }
      const selectedId = new URL(request.url).searchParams.get('snapshotId')
      if (selectedId) {
        const snapshot = dependencies.snapshots.get(Number(selectedId))
        if (!snapshot || snapshot.issueId !== issueId) {
          return errorResponse(404, 'SNAPSHOT_NOT_FOUND', '未找到这个历史版本')
        }
        const { state, issueId: _issueId, ...summary } = snapshot
        void _issueId
        return Response.json({
          snapshot: { ...summary, stateBase64: Buffer.from(state).toString('base64') },
        })
      }
      return Response.json({ snapshots: dependencies.snapshots.list(issueId) })
    },

    async POST(request: Request, context: RouteContext): Promise<Response> {
      const { issueId } = await context.params
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return errorResponse(400, 'INVALID_REQUEST', '请求格式不正确')
      }
      if (!body || typeof body !== 'object') {
        return errorResponse(400, 'INVALID_REQUEST', '请求格式不正确')
      }
      const { snapshotId, confirm } = body as { snapshotId?: unknown; confirm?: unknown }
      if (confirm !== true) {
        return errorResponse(400, 'CONFIRM_REQUIRED', '恢复版本需要再次确认')
      }
      if (!Number.isInteger(snapshotId) || Number(snapshotId) < 1) {
        return errorResponse(400, 'INVALID_SNAPSHOT_ID', '版本标识不正确')
      }
      const issue = dependencies.issues.find(issueId)
      if (!issue) return errorResponse(404, 'ISSUE_NOT_FOUND', '未找到这期周刊')
      if (issue.status !== 'current') {
        return errorResponse(403, 'ISSUE_READ_ONLY', '历史周刊不能恢复版本')
      }
      const selected = dependencies.snapshots.get(Number(snapshotId))
      if (!selected || selected.issueId !== issueId) {
        return errorResponse(404, 'SNAPSHOT_NOT_FOUND', '未找到这个历史版本')
      }

      try {
        const snapshot = await dependencies.restoreClient.restore(issueId, Number(snapshotId))
        return Response.json({ snapshot }, { status: 201 })
      } catch (error) {
        if (error instanceof RestoreConfigurationError) {
          return errorResponse(503, 'RESTORE_NOT_CONFIGURED', '版本恢复服务尚未配置')
        }
        return errorResponse(503, 'RESTORE_FAILED', '版本暂时无法恢复，请稍后重试')
      }
    },
  }
}

export function createHttpRestoreClient(): RestoreClient {
  return {
    async restore(issueId, snapshotId) {
      const token = process.env.COLLAB_INTERNAL_TOKEN
      if (!token) throw new RestoreConfigurationError('COLLAB_INTERNAL_TOKEN is required')
      const port = process.env.COLLABORATION_PORT ?? '1234'
      const response = await fetch(
        process.env.COLLAB_INTERNAL_URL ?? `http://127.0.0.1:${port}/internal/restore`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ issueId, snapshotId }),
        },
      )
      if (!response.ok) throw new Error(`Restore RPC failed: ${response.status}`)
      return ((await response.json()) as { snapshot: SnapshotSummary }).snapshot
    },
  }
}

let handlers: ReturnType<typeof createSnapshotRouteHandlers> | undefined

function getHandlers() {
  if (handlers) return handlers
  const repositories = getRepositories()
  handlers = createSnapshotRouteHandlers({
    issues: repositories.issues,
    restoreClient: createHttpRestoreClient(),
    snapshots: repositories.snapshots,
  })
  return handlers
}

export async function GET(request: Request, context: RouteContext) {
  await ensureCurrentIssue()
  return getHandlers().GET(request, context)
}

export async function POST(request: Request, context: RouteContext) {
  await ensureCurrentIssue()
  return getHandlers().POST(request, context)
}
