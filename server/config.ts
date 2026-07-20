export function getCollaborationPort(value = process.env.COLLABORATION_PORT): number {
  if (value === undefined) return 1234
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('COLLABORATION_PORT must be an integer between 1 and 65535')
  }
  return port
}
