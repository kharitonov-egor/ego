import type { CanvasItem } from '@ego/core'

export interface StudyAssignment extends CanvasItem {
  /** When this was checked off. Canvas does not report submissions, so the mark is ours. */
  doneAt: string | null
}

export interface StudyAssignmentList {
  assignments: StudyAssignment[]
  fetchedAt: string
}

export interface StudyMarkRequest {
  done: boolean
}

export interface StudyMark {
  id: string
  doneAt: string | null
}

export const MAX_STUDY_ID_LENGTH = 255
