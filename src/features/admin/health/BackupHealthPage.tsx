import { useEffect, useState } from 'react'
import { Link, useRouteLoaderData } from 'react-router'
import { PageHeading, Panel } from '../../../components/Page'
import { isGuest, type WorkspaceContext } from '../../auth/gateway'
import type { BackupHealth, BackupState, ReadBackupHealth } from './api'
import { formatDateTime } from '../../shared/dates'
import { HowThisWorks } from '../../shared/HowThisWorks'
import { RefreshButton } from '../../shared/RefreshButton'
import '../privacy/privacy.css'

const labels: Record<BackupState, string> = {
  missing: 'No verification recorded', started: 'Verification in progress', interrupted: 'Verification interrupted',
  verified: 'Verified', failed: 'Verification failed', blocked: 'Verification blocked',
  stale: 'Backup is older than 24 hours', pending: 'Current backup still needs a restore check',
}
const actions = {
  device: 'Reconnect the approved backup device.',
  provider: 'Check that the backup provider is working and the operator can sign in.',
  key: 'Ask whoever holds the recovery key to make it available.',
  ledger: 'Match the restored data against the deletion log before opening it.',
  target: 'Set up a fresh, separate copy to restore into.',
  custody: 'Confirm who the current recovery operator and second reviewer are.',
}
const format = (value: string | null) => formatDateTime(value, 'None yet')

export function BackupHealthPage({ read }: { read: ReadBackupHealth }) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext
  if (isGuest(context)) return <p role="alert">Guests can\'t view backup health.</p>
  return <Health key={context.termId + ':' + context.termMembershipId} term={context.termId} read={read} />
}

function Health({ term, read }: { term: string; read: ReadBackupHealth }) {
  const [loaded, setLoaded] = useState<{ data: BackupHealth; request: number; elapsed: number } | null>(null)
  const [state, setState] = useState<'checking' | 'ready' | 'denied' | 'error'>('checking')
  const [request, setRequest] = useState(0)
  const data = loaded?.request === request ? loaded.data : null

  useEffect(() => {
    let current = true
    setLoaded(null)
    setState('checking')
    const startedAt = performance.now()
    void read(term).then(result => {
      if (current) {
        setLoaded({ data: result, request, elapsed: performance.now() - startedAt })
        setState('ready')
      }
    }).catch(error => {
      if (current) setState(error?.code === '42501' ? 'denied' : 'error')
    })
    return () => { current = false }
  }, [read, term, request])

  useEffect(() => {
    const refresh = () => setRequest(n => n + 1)
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  useEffect(() => {
    if (!loaded?.data.backupFreshUntil) return
    const remaining = Date.parse(loaded.data.backupFreshUntil) - Date.parse(loaded.data.checkedAt) - loaded.elapsed
    const timeout = window.setTimeout(() => {
      setLoaded(current => current === loaded ? { ...current, data: {
        ...current.data, backupStatus: 'stale', backupFreshUntil: null, restoreEvidence: null,
        restoreStatus: current.data.restoreStatus === 'verified' ? 'pending' : current.data.restoreStatus,
      } } : current)
    }, Math.max(0, remaining))
    return () => window.clearTimeout(timeout)
  }, [loaded])

  return <section className="privacy-editor">
    <PageHeading title="Backup and recovery health" description="Check the latest verified backup and see what recovery still needs." />
    <Link to="/admin/privacy">Privacy custodian tools</Link>
    <div><RefreshButton onRefresh={() => setRequest(n => n + 1)} updatedAt={data?.checkedAt} /></div>
    <HowThisWorks><p>A backup counts as healthy once a recent encrypted copy is verified and a test restore into a separate copy succeeds. A restore is only done once login access, private files and the deletion log have all been checked.</p></HowThisWorks>
    {state === 'checking' && <p role="status">Loading…</p>}
    {state === 'denied' && <p role="alert">Only the recovery operator or privacy custodian can see this. Ask an admin to assign the role in <Link to="/admin/access">Roles & access</Link>.</p>}
    {state === 'error' && <p role="alert">Couldn\'t load backup status. Check your connection and try again.</p>}
    {data && <>
      <Panel title="Encrypted backup">
        <p role="status">{labels[data.backupStatus]}</p>
        {data.backupBlocker ? <p>{actions[data.backupBlocker]}</p>
          : data.backupStatus !== 'verified' && <p>Ask the recovery operator to check a current backup and record the result.</p>}
        <p>Last verified backup · {format(data.lastVerifiedBackupAt)}</p>
        <p>Latest backup attempt · {format(data.lastBackupAttemptAt)}</p>
      </Panel>
      <Panel title="Test restore">
        <p role="status">{labels[data.restoreStatus]}</p>
        <p>Latest restore attempt · {format(data.lastRestoreAttemptAt)}</p>
        {data.restoreBlocker && <p>{actions[data.restoreBlocker]}</p>}
        
      </Panel>
      <details>
        <summary>Verification details</summary>
        <p>Last checked · {format(data.checkedAt)}</p>
        {data.backupEvidence && <p>Backup fingerprint · <code>{data.backupEvidence}</code></p>}
        {data.restoreEvidence && <p>Restore fingerprint · <code>{data.restoreEvidence}</code></p>}
        <Link to="/admin/privacy/disposition">Deletion log</Link>
      </details>
    </>}
  </section>
}
