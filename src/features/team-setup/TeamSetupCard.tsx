import { Link } from 'react-router'
import { ChevronRight, UsersRound } from 'lucide-react'
import type { TeamSetupApi } from './api'
import { useRosterManager, useTeamSetup, useTeamSetupApi } from './TeamSetupPage'
import './team-setup.css'

/**
 * Summary tile for the Team hub (slot `team.setup`) and Admin home: "Signed in 18/24" plus a
 * link to the full page. Renders nothing for people who can't manage the roster.
 */
export function TeamSetupCard({ api: apiProp, href = '/team/setup' }: { api?: TeamSetupApi; href?: string }) {
  const manager = useRosterManager()
  const api = useTeamSetupApi(apiProp)
  const { load } = useTeamSetup(manager ? api : undefined, manager?.termId)
  if (!manager) return null
  const totals = load.state === 'ready' ? load.data.totals : null
  const detail = load.state === 'loading' ? 'Loading…'
    : load.state === 'failed' ? (load.reason === 'not_deployed' ? "Not switched on yet. The database update is pending." : "Couldn't load the roster right now.")
      : totals && totals.people === 0 ? 'No one on the roster yet. Add your team.'
        : totals ? [totals.neverOpened ? `${totals.neverOpened} never opened` : null, `${totals.tutorialDone} finished the tour`].filter(Boolean).join(' · ') : ''
  return <Link className="ts-tile" to={href}>
    <UsersRound className="icon ts-tile__icon" size={20} strokeWidth={1.5} aria-hidden="true" />
    <span className="ts-tile__text">
      <span className="ts-tile__label">Team setup</span>
      {totals && totals.people > 0
        ? <span className="ts-tile__value"><span className="numeric">{totals.signedIn}</span><span className="ts-kpi__total">/{totals.people}</span> signed in</span>
        : null}
      <span className={`ts-tile__detail${totals && totals.neverOpened > 0 ? ' ts-tile__detail--alert' : ''}`}>{detail}</span>
    </span>
    <ChevronRight className="icon ts-tile__chevron" size={16} strokeWidth={1.75} aria-hidden="true" />
  </Link>
}
