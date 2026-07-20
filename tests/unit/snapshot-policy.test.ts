import { describe, expect, it } from 'vitest'

import { SnapshotPolicy } from '@/features/snapshots/policy'

describe('SnapshotPolicy', () => {
  it('snapshots on the 200th update and resets after persistence', () => {
    const policy = new SnapshotPolicy()

    for (let update = 1; update < 200; update += 1) {
      expect(policy.recordUpdate('issue-a', new Date(0))).toEqual({
        shouldSnapshot: false,
        updateCount: update,
        reason: null,
      })
    }

    expect(policy.recordUpdate('issue-a', new Date(0))).toEqual({
      shouldSnapshot: true,
      updateCount: 200,
      reason: 'volume',
    })

    policy.markSnapshotted('issue-a', new Date(1_000))
    expect(policy.recordUpdate('issue-a', new Date(1_000))).toEqual({
      shouldSnapshot: false,
      updateCount: 1,
      reason: null,
    })
  })

  it('snapshots after five elapsed minutes', () => {
    const policy = new SnapshotPolicy()

    expect(policy.recordUpdate('issue-a', new Date(0)).shouldSnapshot).toBe(false)
    expect(policy.recordUpdate('issue-a', new Date(299_999)).shouldSnapshot).toBe(false)
    expect(policy.recordUpdate('issue-a', new Date(300_000))).toEqual({
      shouldSnapshot: true,
      updateCount: 3,
      reason: 'interval',
    })
  })

  it('isolates counters and snapshot clocks by issue', () => {
    const policy = new SnapshotPolicy()

    for (let update = 0; update < 199; update += 1) {
      policy.recordUpdate('issue-a', new Date(0))
    }

    expect(policy.recordUpdate('issue-b', new Date(0)).updateCount).toBe(1)
    expect(policy.recordUpdate('issue-a', new Date(0))).toMatchObject({
      shouldSnapshot: true,
      updateCount: 200,
    })
    expect(policy.recordUpdate('issue-b', new Date(300_000))).toMatchObject({
      shouldSnapshot: true,
      updateCount: 2,
      reason: 'interval',
    })
  })
})
