export type IssueStatus = 'current' | 'archived'

export interface IssueWindow {
  start: Date
  end: Date
}

export interface IssueSummary {
  id: string
  title: string
  startsAt: string
  endsAt: string
  status: IssueStatus
  coverUrl: string | null
  itemCount: number
}
