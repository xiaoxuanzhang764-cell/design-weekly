import { notFound } from 'next/navigation'
import { Buffer } from 'node:buffer'

import { DocumentShell } from '@/components/document/document-shell'
import {
  CollaborationRoom,
  CollaborationSocketProvider,
} from '@/features/collaboration/collaboration-room'
import { getRepositories } from '@/server/db/client'

export const dynamic = 'force-dynamic'

export default async function IssuePage({
  params,
}: {
  params: Promise<{ issueId: string }>
}) {
  const { issueId } = await params
  const { documents, issues } = getRepositories()
  const issue = issues.find(issueId)
  if (!issue) notFound()
  const archivedState = issue.status === 'archived' ? documents.load(issue.id) : null
  const initialState = archivedState
    ? Buffer.from(archivedState).toString('base64')
    : undefined

  if (issue.status === 'archived') {
    return <DocumentShell archivedState={initialState ?? null} issue={issue} issues={issues.list()} />
  }

  return (
    <CollaborationSocketProvider>
      <CollaborationRoom issueId={issue.id}>
        <DocumentShell issue={issue} issues={issues.list()} />
      </CollaborationRoom>
    </CollaborationSocketProvider>
  )
}
