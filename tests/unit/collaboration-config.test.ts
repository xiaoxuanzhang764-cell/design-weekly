import { describe, expect, it } from 'vitest'

import { getCollaborationPort } from '../../server/config'

describe('getCollaborationPort', () => {
  it('uses the documented default and accepts a valid configured port', () => {
    expect(getCollaborationPort(undefined)).toBe(1234)
    expect(getCollaborationPort('4321')).toBe(4321)
  })

  it.each(['0', '65536', '12.5', 'not-a-port'])('rejects invalid port %s', (value) => {
    expect(() => getCollaborationPort(value)).toThrow(/COLLABORATION_PORT/)
  })
})
