'use client'

import {
  useHocuspocusConnectionStatus,
  useHocuspocusSyncStatus,
} from '@hocuspocus/provider-react'

import styles from './document.module.css'

export function SyncStatus() {
  const connectionStatus = useHocuspocusConnectionStatus()
  const syncStatus = useHocuspocusSyncStatus()
  const connected = connectionStatus === 'connected'
  const label = !connected ? '离线编辑' : syncStatus === 'synced' ? '已保存' : '正在同步'

  return (
    <span
      className={styles.syncStatus}
      data-state={!connected ? 'offline' : syncStatus}
      role="status"
    >
      <span className={styles.statusDot} aria-hidden="true" />
      {label}
    </span>
  )
}
