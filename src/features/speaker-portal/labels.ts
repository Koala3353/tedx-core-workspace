import type { InvitationState, RequirementKind, RequirementStatus } from './api'

/** Speakers read warm, plain words; the team reads short status names. */
export function requirementStatusLabel(status: RequirementStatus, audience: 'speaker' | 'team'): string {
  if (audience === 'speaker') return { not_started: 'To do', submitted: 'Sent, we\'ll check it', changes_requested: 'Needs a small change', done: 'Done' }[status]
  return { not_started: 'Not sent', submitted: 'Sent, check it', changes_requested: 'Asked for changes', done: 'Done' }[status]
}

export const requirementKinds: { kind: RequirementKind; label: string }[] = [
  { kind: 'bio', label: 'Short bio' },
  { kind: 'headshot', label: 'Headshot photo' },
  { kind: 'outline', label: 'Talk outline' },
  { kind: 'script', label: 'Script draft' },
  { kind: 'slides', label: 'Slides' },
  { kind: 'rehearsal_rsvp', label: 'Rehearsal RSVP' },
  { kind: 'other', label: 'Something else' },
]

export const invitationLabels: Record<InvitationState, { state: string; label: string }> = {
  pending: { state: 'pending', label: 'Invite not accepted yet' },
  accepted: { state: 'done', label: 'Invite accepted' },
  expired: { state: 'overdue', label: 'Invite expired' },
  revoked: { state: 'cancelled', label: 'Invite revoked' },
}
