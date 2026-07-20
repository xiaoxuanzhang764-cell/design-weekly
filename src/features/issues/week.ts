import { addWeeks, startOfWeek } from 'date-fns'
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz'

import type { IssueWindow } from './types'

const ISSUE_TIME_ZONE = 'Asia/Shanghai'

export function getIssueWindow(now: Date): IssueWindow {
  const localNow = toZonedTime(now, ISSUE_TIME_ZONE)
  const localStart = startOfWeek(localNow, { weekStartsOn: 1 })

  return {
    start: fromZonedTime(localStart, ISSUE_TIME_ZONE),
    end: fromZonedTime(addWeeks(localStart, 1), ISSUE_TIME_ZONE),
  }
}

export function getIssueId(window: IssueWindow): string {
  return `issue-${formatInTimeZone(window.start, ISSUE_TIME_ZONE, 'yyyy-MM-dd')}`
}
