export type SnapshotTriggerReason = 'interval' | 'volume'

export interface SnapshotDecision {
  shouldSnapshot: boolean
  updateCount: number
  reason: SnapshotTriggerReason | null
}

interface SnapshotState {
  updateCount: number
  snapshottedAt: number
}

const UPDATE_THRESHOLD = 200
const INTERVAL_MS = 5 * 60 * 1_000

export class SnapshotPolicy {
  private readonly states = new Map<string, SnapshotState>()

  recordUpdate(issueId: string, now: Date): SnapshotDecision {
    const timestamp = now.getTime()
    const state = this.states.get(issueId) ?? {
      updateCount: 0,
      snapshottedAt: timestamp,
    }

    state.updateCount += 1
    this.states.set(issueId, state)

    if (state.updateCount >= UPDATE_THRESHOLD) {
      return { shouldSnapshot: true, updateCount: state.updateCount, reason: 'volume' }
    }

    if (timestamp - state.snapshottedAt >= INTERVAL_MS) {
      return { shouldSnapshot: true, updateCount: state.updateCount, reason: 'interval' }
    }

    return { shouldSnapshot: false, updateCount: state.updateCount, reason: null }
  }

  markSnapshotted(issueId: string, now: Date): void {
    this.states.set(issueId, { updateCount: 0, snapshottedAt: now.getTime() })
  }
}
