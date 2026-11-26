import type { BoardId } from './api'

export type BoardDate = { day: string; label: string; suggested?: boolean }
export type BoardConfig = {
  id: BoardId
  title: string
  description: string
  /** Inclusive Manila calendar days. */
  start: string
  end: string
  keyword: string
  committees: { name: string; role: string }[]
  dates: BoardDate[]
  checklist: { id: string; text: string; owner: string }[]
}

// Committee names are the current org units: Programs & Activities (ProgAct), Marketing Strategy
// (MarkStrat, who run promotions) and Talent Recruitment (TalRec).
export const boards: Record<BoardId, BoardConfig> = {
  contest: {
    id: 'contest',
    title: 'Online contest',
    description: 'Everything for the online contest in one place: who runs it, what\'s due and what to check before it opens.',
    start: '2027-02-28',
    end: '2027-03-12',
    keyword: 'contest',
    committees: [
      { name: 'Programs & Activities', role: 'Runs the contest: mechanics, judging, winners' },
      { name: 'Marketing Strategy', role: 'Promotes it: posts, reminders, results' },
    ],
    dates: [
      { day: '2027-02-14', label: 'Mechanics, prizes and promo posts ready', suggested: true },
      { day: '2027-02-28', label: 'Contest opens' },
      { day: '2027-03-12', label: 'Last day for entries' },
      { day: '2027-03-19', label: 'Winners announced', suggested: true },
    ],
    checklist: [
      { id: 'mechanics', text: 'Mechanics and prizes written and approved', owner: 'ProgAct' },
      { id: 'form', text: 'Entry form made and tested with a dummy entry', owner: 'ProgAct' },
      { id: 'posts', text: 'Launch, reminder and last-call posts scheduled', owner: 'MarkStrat' },
      { id: 'judges', text: 'Judges and scoring sheet confirmed', owner: 'ProgAct' },
      { id: 'inbox', text: 'Someone assigned to answer questions every day it runs', owner: 'MarkStrat' },
      { id: 'results', text: 'Results post drafted and prizes ready to hand over', owner: 'ProgAct + MarkStrat' },
    ],
  },
  tedify: {
    id: 'tedify',
    title: 'TEDify',
    description: 'TEDify day at a glance: breakout sessions, what\'s due and the run checklist.',
    start: '2027-03-20',
    end: '2027-03-20',
    keyword: 'TEDify',
    committees: [
      { name: 'Programs & Activities', role: 'Runs the day: venue, flow, hosts' },
      { name: 'Talent Recruitment', role: 'Brings the speakers and looks after them' },
    ],
    dates: [
      { day: '2027-03-06', label: 'Breakout speakers confirmed', suggested: true },
      { day: '2027-03-13', label: 'Session list, rooms and times final', suggested: true },
      { day: '2027-03-20', label: 'TEDify day' },
    ],
    checklist: [
      { id: 'rooms', text: 'Venue and breakout rooms booked', owner: 'ProgAct' },
      { id: 'speakers', text: 'Every breakout speaker confirmed with a time and room', owner: 'TalRec' },
      { id: 'list', text: 'Session list shared with hosts and speakers', owner: 'ProgAct' },
      { id: 'tech', text: 'Mic, projector and slides checked in each room', owner: 'ProgAct' },
      { id: 'hosts', text: 'Hosts briefed on intros, timing and Q&A', owner: 'ProgAct' },
      { id: 'thanks', text: 'Thank-you notes sent to speakers the day after', owner: 'TalRec' },
    ],
  },
}
