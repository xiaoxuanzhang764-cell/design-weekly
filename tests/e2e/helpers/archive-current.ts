function argument(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index < 0 ? undefined : process.argv[index + 1]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

async function main(): Promise<void> {
  const port = argument('--port')
  const response = await fetch(`http://127.0.0.1:${port}/internal/test/rollover`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${argument('--token')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ now: argument('--now') }),
  })
  if (!response.ok) throw new Error(`Rollover RPC failed: ${response.status}`)
  process.stdout.write(await response.text())
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
