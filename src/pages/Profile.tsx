import { useState } from 'react'
import { useSession } from '../lib/session'
import { supabase } from '../lib/supabase'
import { useSubmit } from '../lib/data'
import type { Cat, Sex } from '../lib/types'
import { Badge, Button, Card, Field, inputCls, PageFade, Segmented } from '../components/ui'
import { useLoad } from '../lib/data'
import { connectorUrl, generateKey, sha256Hex } from '../lib/keys'

export default function Profile() {
  const { session, cats, reloadCats, timezone } = useSession()
  const [editing, setEditing] = useState<Cat | 'new' | null>(cats.length === 0 ? 'new' : null)
  const [tz, setTz] = useState(timezone)
  const { submit } = useSubmit()
  const saveTz = async () => {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }) } catch { alert('Not a valid time zone, e.g. America/Chicago'); return }
    if (await submit(async () => supabase.from('profiles').update({ timezone: tz }).eq('id', session!.user.id))) reloadCats()
  }
  return (
    <PageFade>
      <h1 className="text-xl font-semibold">Profile</h1>
      {cats.length === 0 && <p className="text-muted">Add your first cat to get started.</p>}
      <ul className="space-y-2">
        {cats.map(c => (
          <li key={c.id}><Card className="flex items-center justify-between">
            <div><p className="font-medium">{c.name}</p><p className="text-sm text-muted num">{c.daily_kcal_target ? `${c.daily_kcal_target} kcal/day target` : 'No kcal target'}</p></div>
            <Button variant="ghost" onClick={() => setEditing(c)}>Edit</Button>
          </Card></li>
        ))}
      </ul>
      {editing ? <CatForm row={editing === 'new' ? undefined : editing} onDone={() => { setEditing(null); reloadCats() }} canCancel={cats.length > 0} />
        : <Button variant="secondary" onClick={() => setEditing('new')}>+ Add cat</Button>}

      <Card className="space-y-3">
        <Field label="Time zone" hint="Daily totals and weekly windows use this.">{id => <input id={id} className={inputCls} value={tz} onChange={e => setTz(e.target.value)} />}</Field>
        <Button variant="secondary" onClick={saveTz}>Save time zone</Button>
      </Card>
      <ConnectClaude />
      <Card className="flex items-center justify-between">
        <span className="text-sm text-muted">{session?.user.email}</span>
        <Button variant="secondary" onClick={() => supabase.auth.signOut()}>Sign out</Button>
      </Card>
    </PageFade>
  )
}

function CatForm({ row, onDone, canCancel }: { row?: Cat; onDone: () => void; canCancel: boolean }) {
  const [name, setName] = useState(row?.name ?? '')
  const [sex, setSex] = useState<Sex>(row?.sex ?? 'unknown')
  const [neutered, setNeutered] = useState<'yes' | 'no' | 'unknown'>(row?.neutered == null ? 'unknown' : row.neutered ? 'yes' : 'no')
  const [birth, setBirth] = useState(row?.birth_date ?? '')
  const [target, setTarget] = useState(row?.daily_kcal_target ? String(row.daily_kcal_target) : '')
  const [err, setErr] = useState<string>()
  const { busy, error, submit } = useSubmit()
  const save = async () => {
    if (!name.trim()) { setErr('Name is required.'); return }
    if (target && !(Number(target) > 0)) { setErr('Target must be more than 0.'); return }
    setErr(undefined)
    const body = { name: name.trim(), sex, neutered: neutered === 'unknown' ? null : neutered === 'yes', birth_date: birth || null, daily_kcal_target: target ? Number(target) : null }
    if (await submit(async () => row ? supabase.from('cats').update(body).eq('id', row.id) : supabase.from('cats').insert(body))) onDone()
  }
  const archive = async () => { if (row && confirm(`Archive ${row.name}? Their logs are kept.`) && await submit(async () => supabase.from('cats').update({ archived_at: new Date().toISOString() }).eq('id', row.id))) onDone() }
  return (
    <Card>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); save() }}>
        <h2 className="font-semibold">{row ? `Edit ${row.name}` : 'New cat'}</h2>
        <Field label="Name" error={err}>{id => <input id={id} className={inputCls} value={name} onChange={e => setName(e.target.value)} />}</Field>
        <div><p className="mb-1.5 text-sm font-medium">Sex</p><Segmented label="Sex" value={sex} onChange={setSex} options={[{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'unknown', label: 'Unknown' }]} /></div>
        <div><p className="mb-1.5 text-sm font-medium">Spayed / neutered</p><Segmented label="Neutered" value={neutered} onChange={setNeutered} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unknown', label: 'Unknown' }]} /></div>
        <Field label="Birth date (optional)">{id => <input id={id} type="date" className={inputCls} value={birth} onChange={e => setBirth(e.target.value)} />}</Field>
        <Field label="Daily kcal target (optional)" hint="Set by you or your vet. The app doesn't calculate one.">{id => <input id={id} inputMode="decimal" className={inputCls} value={target} onChange={e => setTarget(e.target.value)} />}</Field>
        {error && <p role="alert" className="text-sm">⚠ Not saved: {error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy} className="flex-1">{busy ? 'Saving…' : 'Save'}</Button>
          {canCancel && <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>}
          {row && <Button type="button" variant="danger" onClick={archive}>Archive</Button>}
        </div>
      </form>
    </Card>
  )
}

interface ApiKeyRow { id: string; label: string; key_prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null }

/** Lets Claude read this account's cat data through the app's connector, with a key the user can revoke. */
function ConnectClaude() {
  const keys = useLoad(async () => {
    const { data, error } = await supabase.from('api_keys').select('id,label,key_prefix,created_at,last_used_at,revoked_at').order('created_at', { ascending: false })
    if (error) throw new Error(error.message); return data as ApiKeyRow[]
  }, [])
  const [fresh, setFresh] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const { busy, error, submit } = useSubmit()
  const create = async () => {
    const key = generateKey()
    const ok = await submit(async () => supabase.from('api_keys').insert({ label: 'Claude', key_prefix: key.slice(0, 10), key_hash: await sha256Hex(key) }))
    if (ok) { setFresh(connectorUrl(key)); setCopied(false); keys.reload() }
  }
  const revoke = async (k: ApiKeyRow) => {
    if (confirm(`Disconnect key ${k.key_prefix}…? Claude will no longer be able to read your data with it.`) &&
        await submit(async () => supabase.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', k.id))) keys.reload()
  }
  const copy = async () => { try { await navigator.clipboard.writeText(fresh!); setCopied(true) } catch { alert('Copy failed. Select the address and copy it manually.') } }
  const active = keys.data?.filter(k => !k.revoked_at) ?? []
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="font-semibold">Connect Claude</h2>
        <p className="text-sm text-muted">Gives Claude read access to your cats' logs for the weekly review. It only ever sees your own data, and you can disconnect it at any time.</p>
      </div>
      {fresh ? (
        <div role="status" className="space-y-2 rounded-xl border-2 border-ink p-3">
          <p className="font-medium">Your connector address</p>
          <p className="text-sm">Copy it now. For your safety it is shown only once. In Claude: Settings → Connectors → Add custom connector → paste this address.</p>
          <textarea readOnly aria-label="Connector address" rows={3} className={inputCls + ' py-2 font-mono text-xs'} value={fresh} onFocus={e => e.currentTarget.select()} />
          <div className="flex gap-2"><Button onClick={copy}>{copied ? 'Copied ✓' : 'Copy address'}</Button><Button variant="secondary" onClick={() => setFresh(null)}>Done</Button></div>
          <p className="text-xs text-muted">Treat it like a password: anyone with this address can read your cat's logs.</p>
        </div>
      ) : <Button onClick={create} disabled={busy}>{busy ? 'Creating…' : active.length ? 'Create another connector key' : 'Create connector key'}</Button>}
      {error && <p role="alert" className="text-sm">⚠ {error}</p>}
      {(keys.data?.length ?? 0) > 0 && (
        <ul className="divide-y divide-line text-sm">
          {keys.data!.map(k => (
            <li key={k.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0"><span className="font-mono">{k.key_prefix}…</span> <span className="text-muted">· created {new Date(k.created_at).toLocaleDateString()}{k.last_used_at ? ` · last used ${new Date(k.last_used_at).toLocaleString()}` : ' · never used'}</span></span>
              {k.revoked_at ? <Badge>Disconnected</Badge> : <Button variant="ghost" className="px-3" onClick={() => revoke(k)}>Disconnect</Button>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
