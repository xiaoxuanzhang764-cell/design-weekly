import { readFileSync } from 'node:fs'

import { act, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

const mocks = vi.hoisted(() => ({
  editorOptions: [] as Array<Record<string, unknown>>,
  persistences: [] as Array<{
    name: string
    document: unknown
    destroy: ReturnType<typeof vi.fn>
  }>,
  defaultProvider: { document: { clientID: 42 } },
  documents: {} as Record<string, { clientID: number }>,
  providedDocuments: [] as Y.Doc[],
}))

vi.mock('@hocuspocus/provider-react', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const ProviderContext = React.createContext(mocks.defaultProvider)

  return {
    HocuspocusProviderWebsocketComponent: ({
      children,
      url,
    }: {
      children: ReactNode
      url: string
    }) => (
      <div data-testid="websocket-provider" data-url={url}>
        {children}
      </div>
    ),
    HocuspocusRoom: ({
      children,
      document,
      name,
      sessionAwareness,
    }: {
      children: ReactNode
      document?: Y.Doc
      name: string
      sessionAwareness?: boolean
    }) => {
      const roomDocument =
        document ??
        (mocks.documents[name] ??= { clientID: Object.keys(mocks.documents).length + 1 })
      if (document) mocks.providedDocuments.push(document)
      return (
        <ProviderContext value={{ document: roomDocument }}>
          <div data-testid="hocuspocus-room" data-name={name} data-session={sessionAwareness}>
            {children}
          </div>
        </ProviderContext>
      )
    },
    useHocuspocusProvider: () => React.useContext(ProviderContext),
  }
})

vi.mock('@tiptap/react', () => ({
  EditorContent: ({ className }: { className?: string }) => (
    <div data-testid="editor-content" className={className} />
  ),
  useEditor: (options: Record<string, unknown>) => {
    mocks.editorOptions.push(options)
    return { isEditable: options.editable }
  },
}))

vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    name: string
    document: unknown
    destroy = vi.fn()

    constructor(name: string, document: unknown) {
      this.name = name
      this.document = document
      mocks.persistences.push(this)
    }
  },
}))

import { ArchivedEditor } from '@/components/editor/archived-editor'
import { CollaborativeEditor } from '@/components/editor/collaborative-editor'
import {
  CollaborationRoom,
  CollaborationSocketProvider,
} from '@/features/collaboration/collaboration-room'

describe('CollaborativeEditor', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.editorOptions.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['archived', true, false],
    ['current', false, true],
  ])('sets %s issues to editable: %s', async (_kind, readOnly, editable) => {
    render(<CollaborativeEditor issueId="issue-2026-07-13" readOnly={readOnly} />)

    await waitFor(() => expect(mocks.editorOptions).not.toHaveLength(0))
    expect(mocks.editorOptions.at(-1)).toMatchObject({
      editable,
      immediatelyRender: false,
    })
  })

  it('configures collaborative history once and uses the exact Chinese placeholder', async () => {
    render(<CollaborativeEditor issueId="issue-2026-07-13" readOnly={false} />)

    await waitFor(() => expect(mocks.editorOptions).not.toHaveLength(0))
    const extensions = mocks.editorOptions.at(-1)?.extensions as Array<{
      name: string
      options: Record<string, unknown>
    }>
    const byName = new Map(extensions.map((extension) => [extension.name, extension]))

    expect(byName.get('starterKit')?.options.undoRedo).toBe(false)
    expect(byName.get('collaboration')?.options.document).toBe(
      mocks.defaultProvider.document,
    )
    expect(byName.get('collaborationCaret')?.options.provider).toBe(
      mocks.defaultProvider,
    )
    expect(byName.get('placeholder')?.options.placeholder).toBe(
      '输入 “/” 插入内容，或直接粘贴图片、视频和链接…',
    )
    expect(byName.has('image')).toBe(true)
    expect(byName.has('video')).toBe(true)
    expect(screen.getByRole('toolbar', { name: '编辑工具栏' })).toBeInTheDocument()
  })

  it('does not render media controls for read-only issues', async () => {
    render(<CollaborativeEditor issueId="issue-2026-07-06" readOnly />)
    await waitFor(() => expect(mocks.editorOptions).not.toHaveLength(0))
    expect(screen.queryByRole('toolbar', { name: '媒体工具栏' })).not.toBeInTheDocument()
  })

  it('does not access browser identity storage while rendering on the server', () => {
    expect(() =>
      renderToString(
        <CollaborativeEditor issueId="issue-2026-07-13" readOnly={false} />,
      ),
    ).not.toThrow()
  })
})

describe('ArchivedEditor', () => {
  it('configures persisted Yjs content as read-only without a provider', async () => {
    const source = new Y.Doc()
    const initialState = Buffer.from(Y.encodeStateAsUpdate(source)).toString('base64')
    render(<ArchivedEditor initialState={initialState} />)

    await waitFor(() => expect(mocks.editorOptions).not.toHaveLength(0))
    expect(mocks.editorOptions.at(-1)).toMatchObject({ editable: false })
    const extensions = mocks.editorOptions.at(-1)?.extensions as Array<{ name: string }>
    expect(extensions.map((extension) => extension.name)).toEqual(
      expect.arrayContaining(['image', 'video']),
    )
    expect(screen.queryByRole('toolbar', { name: '媒体工具栏' })).not.toBeInTheDocument()
  })

  it('shows an explicit empty state when no archive exists', () => {
    render(<ArchivedEditor initialState={null} />)
    expect(screen.getByText('暂无可读内容')).toBeInTheDocument()
  })
})

describe('CollaborationRoom', () => {
  beforeEach(() => {
    mocks.persistences.length = 0
    mocks.documents = {}
    mocks.providedDocuments.length = 0
  })

  it('shares one application-level websocket across multiple document rooms', async () => {
    const { getAllByTestId, getByTestId } = render(
      <CollaborationSocketProvider websocketUrl="ws://collab.test">
        <CollaborationRoom issueId="issue-2026-07-13">
          <span>current document</span>
        </CollaborationRoom>
        <CollaborationRoom issueId="issue-2026-07-20">
          <span>next document</span>
        </CollaborationRoom>
      </CollaborationSocketProvider>,
    )

    expect(getAllByTestId('websocket-provider')).toHaveLength(1)
    expect(getByTestId('websocket-provider')).toHaveAttribute('data-url', 'ws://collab.test')
    expect(getAllByTestId('hocuspocus-room')).toHaveLength(2)
    expect(getAllByTestId('hocuspocus-room')[0]).toHaveAttribute('data-session', 'true')
    await waitFor(() => expect(mocks.persistences).toHaveLength(2))
  })

  it('destroys per-document IndexedDB persistence on unmount', async () => {
    const view = render(
      <CollaborationSocketProvider>
        <CollaborationRoom issueId="issue-2026-07-13">
          <span>document</span>
        </CollaborationRoom>
      </CollaborationSocketProvider>,
    )
    await waitFor(() => expect(mocks.persistences).toHaveLength(1))

    act(() => view.unmount())

    expect(mocks.persistences[0].destroy).toHaveBeenCalledOnce()
  })

  it('hydrates an archived room from a server-provided Yjs state', async () => {
    const source = new Y.Doc()
    source.getText('default').insert(0, '归档内容')
    const initialState = Buffer.from(Y.encodeStateAsUpdate(source)).toString('base64')

    render(
      <CollaborationSocketProvider>
        <CollaborationRoom issueId="issue-2026-07-06" initialState={initialState}>
          <span>archived document</span>
        </CollaborationRoom>
      </CollaborationSocketProvider>,
    )

    await waitFor(() => expect(mocks.providedDocuments).toHaveLength(1))
    expect(mocks.providedDocuments[0].getText('default').toString()).toBe('归档内容')
    expect(mocks.persistences).toHaveLength(0)
  })

  it('atomically replaces persistence and its Y.Doc when issueId changes', async () => {
    const view = render(
      <CollaborationSocketProvider>
        <CollaborationRoom issueId="issue-2026-07-13">
          <span>document</span>
        </CollaborationRoom>
      </CollaborationSocketProvider>,
    )
    await waitFor(() => expect(mocks.persistences).toHaveLength(1))
    const oldPersistence = mocks.persistences[0]

    view.rerender(
      <CollaborationSocketProvider>
        <CollaborationRoom issueId="issue-2026-07-20">
          <span>document</span>
        </CollaborationRoom>
      </CollaborationSocketProvider>,
    )

    await waitFor(() => expect(mocks.persistences).toHaveLength(2))
    expect(oldPersistence.destroy).toHaveBeenCalledOnce()
    expect(mocks.persistences[1]).toMatchObject({
      name: 'issue-2026-07-20',
      document: mocks.documents['issue-2026-07-20'],
    })
    expect(mocks.persistences[1].document).not.toBe(oldPersistence.document)
  })

  it('is client-only and does not initialize IndexedDB during server rendering', () => {
    const source = readFileSync(
      `${process.cwd()}/src/features/collaboration/collaboration-room.tsx`,
      'utf8',
    )

    expect(source).toMatch(/^['"]use client['"]/)
    expect(() =>
      renderToString(
        <CollaborationSocketProvider>
          <CollaborationRoom issueId="issue-2026-07-13">
            <span>document</span>
          </CollaborationRoom>
        </CollaborationSocketProvider>,
      ),
    ).not.toThrow()
    expect(mocks.persistences).toHaveLength(0)
  })
})
