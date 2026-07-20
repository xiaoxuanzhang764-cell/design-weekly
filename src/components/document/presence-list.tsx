'use client'

import {
  useHocuspocusAwareness,
  useHocuspocusProvider,
  type CollabUser,
} from '@hocuspocus/provider-react'

import styles from './document.module.css'

interface PresenceIdentity {
  color: string
  name: string
}

function getIdentity(state: CollabUser): PresenceIdentity | null {
  const value = state.user
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const user = value as Record<string, unknown>
  if (typeof user.name !== 'string' || typeof user.color !== 'string') return null
  return { color: user.color, name: user.name }
}

export function PresenceList() {
  const provider = useHocuspocusProvider()
  const awareness = useHocuspocusAwareness()
  const collaborators = awareness.flatMap((state) => {
    if (state.clientId === provider.document.clientID) return []
    const identity = getIdentity(state)
    return identity ? [{ ...identity, clientId: state.clientId }] : []
  })

  return (
    <div>
      <h2 className={styles.panelHeading}>在线协作者</h2>
      <ul className={styles.presenceList} aria-label="在线协作者">
        {collaborators.map((collaborator) => (
          <li key={collaborator.clientId}>
            <span
              className={styles.presenceSwatch}
              data-testid={`presence-swatch-${collaborator.clientId}`}
              style={{ backgroundColor: collaborator.color }}
              aria-hidden="true"
            />
            <span>{collaborator.name}</span>
          </li>
        ))}
      </ul>
      {collaborators.length === 0 ? (
        <p className={styles.emptyPresence}>暂无其他协作者</p>
      ) : null}
    </div>
  )
}
