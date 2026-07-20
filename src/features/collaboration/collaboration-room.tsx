'use client'

import {
  HocuspocusProviderWebsocketComponent,
  HocuspocusRoom,
  useHocuspocusProvider,
} from '@hocuspocus/provider-react'
import { useEffect, useMemo, type ReactNode } from 'react'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import { resolveCollaborationWebSocketUrl } from './websocket-url'

const DEFAULT_WEBSOCKET_URL = 'ws://127.0.0.1:1234'

export interface CollaborationRoomProps {
  children: ReactNode
  initialState?: string
  issueId: string
}

export interface CollaborationSocketProviderProps {
  children: ReactNode
  websocketUrl?: string
}

function DocumentPersistence({
  children,
  disabled = false,
  issueId,
}: CollaborationRoomProps & { disabled?: boolean }) {
  const provider = useHocuspocusProvider()

  useEffect(() => {
    if (disabled) return
    const persistence = new IndexeddbPersistence(issueId, provider.document)
    return () => {
      void persistence.destroy()
    }
  }, [disabled, issueId, provider.document])

  return children
}

export function CollaborationSocketProvider({
  children,
  websocketUrl,
}: CollaborationSocketProviderProps) {
  const configuredUrl = websocketUrl ?? process.env.NEXT_PUBLIC_COLLAB_URL
  const resolvedWebsocketUrl = typeof window === 'undefined'
    ? configuredUrl ?? DEFAULT_WEBSOCKET_URL
    : resolveCollaborationWebSocketUrl(configuredUrl, window.location)

  return (
    <HocuspocusProviderWebsocketComponent url={resolvedWebsocketUrl}>
      {children}
    </HocuspocusProviderWebsocketComponent>
  )
}

export function CollaborationRoom({ children, initialState, issueId }: CollaborationRoomProps) {
  const initialDocument = useMemo(() => {
    if (!initialState) return undefined
    const binary = Uint8Array.from(atob(initialState), (character) => character.charCodeAt(0))
    const document = new Y.Doc()
    Y.applyUpdate(document, binary)
    return document
  }, [initialState])

  return (
    <HocuspocusRoom
      key={issueId}
      name={issueId}
      document={initialDocument}
      sessionAwareness
    >
      <DocumentPersistence disabled={Boolean(initialState)} issueId={issueId}>
        {children}
      </DocumentPersistence>
    </HocuspocusRoom>
  )
}
