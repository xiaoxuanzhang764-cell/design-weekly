import {
  fetchLinkPreview,
  type LinkPreview,
} from '@/server/link-preview/fetch-preview'
import {
  LinkUrlValidationError,
  validatePublicHttpUrl,
} from '@/server/link-preview/validate-url'

interface LinkPreviewBody {
  url?: unknown
}

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status })
}

export function createLinkPreviewPostHandler(dependencies: {
  fetchPreview: (url: string) => Promise<LinkPreview>
}) {
  return async function post(request: Request) {
    let body: LinkPreviewBody
    try {
      body = (await request.json()) as LinkPreviewBody
    } catch {
      return errorResponse(400, 'INVALID_LINK_URL', '请输入有效的网页链接')
    }

    if (typeof body.url !== 'string') {
      return errorResponse(400, 'INVALID_LINK_URL', '请输入有效的网页链接')
    }

    let url: URL
    try {
      url = validatePublicHttpUrl(body.url)
    } catch (error) {
      if (error instanceof LinkUrlValidationError) {
        return errorResponse(400, error.code, error.message)
      }
      return errorResponse(400, 'INVALID_LINK_URL', '请输入有效的网页链接')
    }

    try {
      return Response.json(await dependencies.fetchPreview(url.href))
    } catch (error) {
      if (error instanceof LinkUrlValidationError) {
        return errorResponse(400, error.code, error.message)
      }
      return errorResponse(502, 'LINK_PREVIEW_UNAVAILABLE', '链接预览暂时不可用')
    }
  }
}

export const POST = createLinkPreviewPostHandler({ fetchPreview: fetchLinkPreview })
