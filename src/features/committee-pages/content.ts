/**
 * Committee one-pager text, from the TEDx Primer. Edit freely: this is plain content, not logic.
 *
 * `codes` are matched against the live committee codes (org units) in order, ignoring case and
 * punctuation, so "RECSEC", "RecSec" and "rec-sec" all match. A team whose own code does not exist
 * as a committee (for example Creatives inside MarkStrat) is shown on its `parent` committee's page.
 */
export type CommitteeContent = {
  key: string
  codes: string[]
  name: string
  short: string
  parent?: string
  description: string
  deliverables: string[]
  skills: string[]
}

export const committeeContent: CommitteeContent[] = [
  {
    key: 'markstrat', codes: ['MARKSTRAT', 'MARKETING'], name: 'Marketing Strategy', short: 'MarkStrat',
    description: 'Handles how the event looks and how people hear about it: branding, the campaign, the stage, and photo and video coverage. Runs as four teams: Creatives, Productions, Promotions and Documentations.',
    deliverables: ['Brand book and pubmats', 'Stage design and installations', 'Campaign and promo videos', 'Photos, videos and the TED submission'],
    skills: ['Graphic design', 'Copywriting', 'Video', 'Photography', 'Planning a campaign'],
  },
  {
    key: 'creatives', codes: ['CREATIVES', 'CRE', 'CREA'], parent: 'markstrat', name: 'Creatives', short: 'Creatives',
    description: 'Owns the visual identity: the brand book, every pubmat and the merch.',
    deliverables: ['Brand book', 'Pubmats', 'Merch'],
    skills: ['Graphic design', 'Typography', 'Illustration', 'Canva or Figma'],
  },
  {
    key: 'productions', codes: ['PRODUCTIONS', 'PROD'], parent: 'markstrat', name: 'Productions', short: 'Productions',
    description: 'Builds what people see at the venue: stage design, installations and exhibits.',
    deliverables: ['Stage design', 'Installations', 'Exhibits'],
    skills: ['Set and spatial design', 'Building and crafts', 'Working with suppliers'],
  },
  {
    key: 'promotions', codes: ['PROMOTIONS', 'PROMO'], parent: 'markstrat', name: 'Promotions', short: 'Promotions',
    description: 'Runs the campaign and the content calendar, including promo videos and the online contest.',
    deliverables: ['Campaign plan', 'Content calendar and posts', 'Promo videos', 'Online contest'],
    skills: ['Social media', 'Copywriting', 'Video editing', 'Scheduling'],
  },
  {
    key: 'documentations', codes: ['DOCUMENTATIONS', 'DOCUMENTATION', 'DOCU', 'DOCS'], parent: 'markstrat', name: 'Documentations', short: 'Documentations',
    description: 'Covers photos, videos and DP shoots, and submits the talks to TED after the event.',
    deliverables: ['Event photos and videos', 'DP shoots', 'TED submission'],
    skills: ['Photography', 'Videography', 'Editing', 'File organisation'],
  },
  {
    key: 'recsec', codes: ['RECSEC', 'REC'], name: 'Recruitment Secretariat', short: 'RecSec',
    description: 'Looks after participants from sign-up to check-in: registration, email blasts and everything participants hear from us.',
    deliverables: ['Registration form and list', 'Email blasts', 'Participant communications', 'Onsite registration'],
    skills: ['Clear writing', 'Spreadsheets', 'Attention to detail', 'Customer care'],
  },
  {
    key: 'webdev', codes: ['WEBDEV', 'WEB'], parent: 'recsec', name: 'Website Development', short: 'WebDev',
    description: 'Builds and runs the event website and its payment integration.',
    deliverables: ['Event website', 'Payment integration'],
    skills: ['Web development', 'UI design', 'Testing'],
  },
  {
    key: 'progact', codes: ['PROGACT', 'PROGRAMS'], name: 'Programs & Activities', short: 'ProgAct',
    description: 'Designs what participants do outside the talks: TEDify, the intermission, the online contest and activations.',
    deliverables: ['TEDify', 'Intermission program', 'Online contest mechanics', 'Activations'],
    skills: ['Event design', 'Facilitation', 'Hosting games', 'Logistics planning'],
  },
  {
    key: 'talrec', codes: ['TALREC', 'TALENT'], name: 'Talent Recruitment', short: 'TalRec',
    description: 'Finds and supports the speakers: nominations, outreach, and scripts from first draft to rehearsal.',
    deliverables: ['Speaker nominations and shortlist', 'Speaker outreach', 'Scripts and rehearsals'],
    skills: ['Research', 'Professional emails', 'Coaching and feedback', 'Editing'],
  },
  {
    key: 'log', codes: ['LOG', 'LOGISTICS'], name: 'Logistics', short: 'Logistics',
    description: 'Makes the venue work: booking, floorplan, procurement, ushers and first aid.',
    deliverables: ['Venue booking', 'Floorplan', 'Procurement', 'Ushers', 'First aid'],
    skills: ['Planning', 'Working with suppliers', 'Inventory', 'Staying calm on the day'],
  },
  {
    key: 'stageman', codes: ['STAGEMAN', 'STAGE'], name: 'Stage Management', short: 'StageMan',
    description: 'Runs the show: lights and sound, hosts, slides and the operational schedule (OpSched).',
    deliverables: ['Lights and sound', 'Hosts and spiels', 'Slides', 'OpSched and run of show'],
    skills: ['Technical setup', 'Timing and cues', 'Scriptwriting', 'Calm communication'],
  },
  {
    key: 'fin', codes: ['FIN', 'FINANCE'], name: 'Finance', short: 'FIN',
    description: 'Plans and tracks the money: budget plans, reimbursements, and the FIN reviews with MEA.',
    deliverables: ['Budget plan', 'Reimbursements', 'FIN reviews with MEA'],
    skills: ['Spreadsheets', 'Budgeting', 'Careful records'],
  },
  {
    key: 'exrel', codes: ['EXREL', 'EXTERNAL'], name: 'External Relations', short: 'ExRel',
    description: 'Brings in sponsors and partners and looks after them through the event.',
    deliverables: ['Sponsorship deck', 'Sponsor and partner deals', 'Partner deliverables'],
    skills: ['Pitching', 'Professional emails', 'Negotiation', 'Relationship building'],
  },
]

const normal = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** The content for a live committee code, if any. */
export function contentForCode(code: string): CommitteeContent | null {
  const key = normal(code)
  return committeeContent.find(c => c.codes.some(x => normal(x) === key)) ?? null
}

export function contentByKey(key: string): CommitteeContent | null {
  return committeeContent.find(c => c.key === key) ?? null
}
