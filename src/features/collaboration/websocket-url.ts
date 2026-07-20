export function resolveCollaborationWebSocketUrl(
  configuredUrl: string | undefined,
  location: Pick<Location, 'host' | 'protocol'>,
): string {
  if (configuredUrl) return configuredUrl
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/collaboration`
}
