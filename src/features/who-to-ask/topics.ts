/**
 * "Who do I ask" mapping. Edit freely: plain content, no logic.
 *
 * `codes` are tried in order against the live committee codes (then names), so the first committee
 * that exists wins. Example: a poster goes to Creatives if that committee exists, else MarkStrat.
 * Keywords come from the TEDx Primer's main deliverables and drive the free-text filter.
 */
export type Need = { id: string; label: string; codes: string[]; keywords: string[] }
export type TopicGroup = { codes: string[]; name: string; keywords: string[] }

/** The "I need…" chips, in the order they appear. */
export const needs: Need[] = [
  { id: 'poster', label: 'a poster or visual', codes: ['CREATIVES', 'MARKSTRAT'], keywords: ['poster', 'pubmat', 'visual', 'graphic', 'design', 'layout', 'brand'] },
  { id: 'room', label: 'a room or venue', codes: ['LOG', 'LOGISTICS'], keywords: ['room', 'venue', 'hall', 'booking', 'floorplan'] },
  { id: 'money', label: 'money or a budget', codes: ['FIN', 'FINANCE'], keywords: ['money', 'budget', 'reimbursement', 'cash', 'payment', 'fund'] },
  { id: 'speaker', label: 'a speaker contact', codes: ['TALREC', 'TALENT'], keywords: ['speaker', 'talk', 'nomination', 'script'] },
  { id: 'stage', label: 'stage time or hosts', codes: ['STAGEMAN', 'STAGE'], keywords: ['stage', 'host', 'emcee', 'slides', 'opsched', 'run of show', 'lights', 'sound'] },
  { id: 'media', label: 'photos or video', codes: ['DOCUMENTATIONS', 'DOCU', 'MARKSTRAT'], keywords: ['photo', 'video', 'camera', 'shoot', 'coverage'] },
  { id: 'registration', label: 'registration or participants', codes: ['RECSEC'], keywords: ['registration', 'participant', 'attendee', 'ticket', 'email blast', 'sign-up'] },
  { id: 'website', label: 'the website', codes: ['WEBDEV', 'RECSEC'], keywords: ['website', 'web', 'site', 'payment integration', 'link'] },
  { id: 'equipment', label: 'equipment', codes: ['LOG', 'LOGISTICS'], keywords: ['equipment', 'tables', 'chairs', 'supplies', 'procurement', 'inventory'] },
  { id: 'activity', label: 'an event activity', codes: ['PROGACT'], keywords: ['activity', 'game', 'tedify', 'intermission', 'activation', 'booth'] },
]

/** Topic keywords per committee, from the Primer's main deliverables. */
export const topicGroups: TopicGroup[] = [
  { codes: ['CREATIVES', 'MARKSTRAT'], name: 'Creatives', keywords: ['brand book', 'pubmats', 'posters', 'merch', 'visuals', 'logo'] },
  { codes: ['PRODUCTIONS', 'MARKSTRAT'], name: 'Productions', keywords: ['stage design', 'installations', 'exhibits', 'set', 'props'] },
  { codes: ['PROMOTIONS', 'MARKSTRAT'], name: 'Promotions', keywords: ['campaign', 'content', 'social media', 'promo videos', 'online contest', 'captions'] },
  { codes: ['DOCUMENTATIONS', 'DOCU', 'MARKSTRAT'], name: 'Documentations', keywords: ['photos', 'videos', 'dp shoots', 'ted submission', 'coverage'] },
  { codes: ['RECSEC'], name: 'RecSec', keywords: ['registration', 'email blasts', 'participant comms', 'onsite registration', 'attendees', 'tickets'] },
  { codes: ['WEBDEV', 'RECSEC'], name: 'WebDev', keywords: ['website', 'payment integration', 'online payment', 'web page'] },
  { codes: ['PROGACT'], name: 'ProgAct', keywords: ['tedify', 'intermission', 'online contest', 'activations', 'games', 'booths'] },
  { codes: ['TALREC'], name: 'TalRec', keywords: ['speakers', 'nominations', 'scripts', 'speaker outreach', 'rehearsals'] },
  { codes: ['LOG', 'LOGISTICS'], name: 'Logistics', keywords: ['venue', 'floorplan', 'procurement', 'ushers', 'first aid', 'rooms', 'equipment', 'led wall', 'food'] },
  { codes: ['STAGEMAN'], name: 'StageMan', keywords: ['lights and sound', 'hosts', 'slides', 'opsched', 'run of show', 'cues'] },
  { codes: ['FIN', 'FINANCE'], name: 'Finance', keywords: ['budget', 'reimbursements', 'fin review', 'mea', 'liquidation', 'receipts'] },
  { codes: ['EXREL'], name: 'ExRel', keywords: ['sponsors', 'partners', 'sponsorship deck', 'media partners', 'donations'] },
]

const normal = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/** Groups whose keywords (or name) match the query. Matching is case- and punctuation-insensitive. */
export function matchTopics(query: string): { group: TopicGroup; hits: string[] }[] {
  const q = normal(query)
  if (!q) return []
  return topicGroups.flatMap(group => {
    const hits = group.keywords.filter(k => normal(k).includes(q) || q.split(' ').every(word => normal(k).includes(word)))
    const named = normal(group.name).includes(q)
    return hits.length || named ? [{ group, hits }] : []
  })
}
