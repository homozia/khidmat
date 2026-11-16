import { Fragment, useState } from 'react';
import { api, get, newIdempotencyKey, openSigned, post } from '../lib/api.ts';
import { useRoute, go, type Me } from '../lib/route.ts';
import { Empty, Field, JourneyRail, Loading, Notice, pkr, StatusPill, useAction, useLoad, when } from '../lib/ui.tsx';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SECTIONS: { key: string; label: string; roles: string[]; group: string }[] = [
  { key: 'dispatch', label: 'Dispatch', roles: ['dispatcher'], group: 'Daily work' },
  { key: 'bookings', label: 'Bookings', roles: ['dispatcher', 'finance'], group: 'Daily work' },
  { key: 'complaints', label: 'Complaints', roles: ['dispatcher', 'finance'], group: 'Daily work' },
  { key: 'providers', label: 'Providers', roles: ['verification', 'dispatcher', 'finance'], group: 'People' },
  { key: 'finance', label: 'Money', roles: ['finance'], group: 'Money' },
  { key: 'reports', label: 'Reports', roles: ['dispatcher', 'finance'], group: 'Money' },
  { key: 'catalogue', label: 'Services and prices', roles: ['config_admin'], group: 'Setup' },
  { key: 'zones', label: 'Service areas', roles: ['config_admin'], group: 'Setup' },
];

export function AdminApp({ me }: { me: Me }) {
  const r = useRoute();
  const allowed = SECTIONS.filter((s) => me.roles.includes('super_admin') || s.roles.some((x) => me.roles.includes(x)));
  const section = allowed.find((s) => s.key === r[0])?.key ?? allowed[0]?.key;
  let lastGroup = '';
  return (
    <div className="layout">
      <nav className="sidenav" aria-label="Operations">
        {allowed.map((s) => {
          const header = s.group !== lastGroup ? <p className="group">{s.group}</p> : null;
          lastGroup = s.group;
          return <Fragment key={s.key}>{header}<a href={`#/${s.key}`} aria-current={section === s.key ? 'page' : undefined}>{s.label}</a></Fragment>;
        })}
      </nav>
      <main className="content">
        {section === 'dispatch' && <Dispatch />}
        {section === 'bookings' && (r[1] ? <BookingDetail id={r[1]} /> : <Bookings />)}
        {section === 'complaints' && <Complaints />}
        {section === 'providers' && <Providers me={me} />}
        {section === 'finance' && <Finance />}
        {section === 'reports' && <Reports />}
        {section === 'catalogue' && <Catalogue />}
        {section === 'zones' && <Zones />}
      </main>
    </div>
  );
}

// ---------------- Dispatch ----------------

function Dispatch() {
  const q = useLoad(() => get<any[]>('/v1/admin/dispatch/queue'));
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}><h1>Dispatch</h1><button className="small" onClick={q.reload}>Refresh</button></div>
      <Loading error={q.error} loading={q.loading && !q.data} />
      {q.data?.length === 0 && <Empty title="Nothing waiting">New bookings that need a provider appear here, oldest first.</Empty>}
      {q.data && q.data.length > 0 && (
        <div className="panel table-wrap"><table>
          <thead><tr><th>Booking</th><th>Job</th><th>Area</th><th>When</th><th>Waiting</th><th>Status</th><th /></tr></thead>
          <tbody>{q.data.map((b) => (
            <Fragment key={b.id}>
              <tr>
                <td><a href={`#/bookings/${b.id}`}>{b.ref}</a></td><td>{b.job}</td><td>{b.zone}</td><td>{when(b.scheduled_start)}</td>
                <td className="num">{b.age_minutes} min</td>
                <td><StatusPill status={b.status} />{b.needs_location_confirmation && <span className="pill pill-pending" style={{ marginInlineStart: 4 }}>Confirm pin</span>}{b.open_offers > 0 && <span className="muted"> · offer out</span>}</td>
                <td><button className="small" onClick={() => setOpen(open === b.id ? null : b.id)}>{open === b.id ? 'Close' : 'Find provider'}</button></td>
              </tr>
              {open === b.id && <tr><td colSpan={7}><OfferPanel booking={b} onChange={q.reload} /></td></tr>}
            </Fragment>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

function OfferPanel({ booking, onChange }: { booking: any; onChange: () => void }) {
  const el = useLoad(() => get<any[]>(`/v1/admin/bookings/${booking.id}/eligible-providers`), [booking.id]);
  const a = useAction();
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  return (
    <div className="stack" style={{ padding: '.5rem 0' }}>
      {booking.needs_location_confirmation && (
        <div className="row">
          <input className="grow" dir="ltr" placeholder="Confirmed pin: 33.6762, 73.0128" value={pin} onChange={(e) => setPin(e.target.value)} aria-label="Confirmed location" />
          <button className="small" disabled={a.busy} onClick={() => {
            const [lat, lng] = pin.split(',').map((x) => Number(x.trim()));
            void a.run(() => post(`/v1/admin/bookings/${booking.id}/confirm-location`, { lat, lng }), 'Location confirmed').then(onChange);
          }}>Confirm location after calling the customer</button>
        </div>
      )}
      <Loading error={el.error} loading={el.loading} />
      {el.data?.length === 0 && <p className="muted">No eligible provider: nobody with an approved skill covers this area and time, or they are at their limit or owe overdue fees.</p>}
      {el.data && el.data.length > 0 && (
        <table><thead><tr><th>Provider</th><th className="money">Distance</th><th className="money">Jobs that day</th><th>Rating</th><th /></tr></thead>
          <tbody>{el.data.map((p) => (
            <tr key={p.provider_id}><td>{p.display_name}</td><td className="money">{p.distance_m != null ? `${(p.distance_m / 1000).toFixed(1)} km` : '—'}</td>
              <td className="money">{p.jobs_today}</td><td>{p.rating_avg ?? '—'}</td>
              <td><button className="small primary" disabled={a.busy} onClick={() => a.run(() => post(`/v1/admin/bookings/${booking.id}/offers`, { provider_id: p.provider_id }), `Offer sent to ${p.display_name}; it expires in 10 minutes.`).then(onChange)}>Send offer</button></td></tr>
          ))}</tbody></table>
      )}
      <div className="row">
        <input className="grow" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
        <button className="small danger" disabled={a.busy || reason.length < 3} onClick={() => a.run(() => post(`/v1/admin/bookings/${booking.id}/no-provider`, { reason }), 'Marked as no provider. Call the customer to offer another time.').then(onChange)}>No provider available</button>
      </div>
      <Notice msg={a.msg} />
    </div>
  );
}

// ---------------- Bookings ----------------

function Bookings() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const list = useLoad(() => get<any[]>(`/v1/admin/bookings?${new URLSearchParams({ ...(status && { status }), ...(q && { q }) })}`), [status, q]);
  return (
    <section className="stack">
      <h1>Bookings</h1>
      <div className="row">
        <input className="grow" placeholder="Search by reference, e.g. KH-1004" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <select style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {['requested', 'assigned', 'en_route', 'on_site', 'awaiting_approval', 'in_progress', 'completed', 'closed', 'cancelled', 'no_provider'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>
      <Loading error={list.error} loading={list.loading && !list.data} />
      {list.data && (
        <div className="panel table-wrap"><table>
          <thead><tr><th>Ref</th><th>Job</th><th>Customer</th><th>Provider</th><th>Area</th><th>When</th><th>Status</th></tr></thead>
          <tbody>{list.data.map((b) => (
            <tr key={b.id}><td><a href={`#/bookings/${b.id}`}>{b.ref}</a></td><td>{b.job}</td><td>{b.customer ?? '—'}</td><td>{b.provider ?? '—'}</td>
              <td>{b.zone}</td><td>{when(b.scheduled_start)}</td><td><StatusPill status={b.status} />{b.open_complaints > 0 && <span className="pill pill-cancelled" style={{ marginInlineStart: 4 }}>complaint</span>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

function BookingDetail({ id }: { id: string }) {
  const b = useLoad(() => get<any>(`/v1/bookings/${id}`), [id]);
  const tl = useLoad(() => get<any[]>(`/v1/admin/bookings/${id}/timeline`), [id]);
  const files = useLoad(() => get<any[]>(`/v1/bookings/${id}/attachments`), [id]);
  const a = useAction();
  const [reason, setReason] = useState('');
  const [visit, setVisit] = useState('500');
  const [refund, setRefund] = useState({ charge_type: 'labour', amount: '', reason: '' });
  const [refundKey] = useState(newIdempotencyKey);
  const reload = () => { void b.reload(); void tl.reload(); };
  if (!b.data) return <Loading error={b.error} loading={b.loading} />;
  const d = b.data;
  return (
    <section className="stack">
      <button className="link" onClick={() => go('bookings')}>Back to bookings</button>
      <div className="row" style={{ justifyContent: 'space-between' }}><h1>{d.ref} · {d.job.name_en}</h1><StatusPill status={d.status} /></div>
      <JourneyRail status={d.status} />
      <div className="panel">
        <dl className="facts">
          <dt>Customer</dt><dd>{d.customer?.name} <span dir="ltr">{d.customer?.phone}</span></dd>
          <dt>Address</dt><dd>{d.address_line}{d.landmark && ` (${d.landmark})`}</dd>
          {d.destination_text && <><dt>Destination</dt><dd>{d.destination_text}</dd></>}
          <dt>When</dt><dd>{when(d.scheduled_start)} · {d.timing.replace('_', ' ')}</dd>
          <dt>Provider</dt><dd>{d.provider?.name ?? '—'}</dd>
          <dt>Price terms</dt><dd>{d.booking_mode} · commission {d.terms_snapshot.commission.rate_bps / 100}% {d.terms_snapshot.pricing_is_demo && <span className="pill pill-pending">demo price</span>}</dd>
          <dt>Customer total</dt><dd className="num">{pkr(d.totals.customer_total_paisa)}{d.totals.refunded_paisa > 0 && ` (refunded ${pkr(d.totals.refunded_paisa)})`}</dd>
          {d.provider_money && <><dt>Platform fee</dt><dd className="num">{pkr(d.provider_money.fee_paisa)}</dd></>}
        </dl>
      </div>
      {files.data && files.data.length > 0 && (
        <div className="panel"><h2>Photos and voice notes</h2>
          <div className="row">{files.data.map((f) => <button key={f.id} className="small" onClick={() => openSigned(`/v1/attachments/${f.id}/url`)}>{f.kind.replace('_', ' ')} · {Math.round(f.size_bytes / 1024)} KB</button>)}</div>
        </div>
      )}
      <div className="panel">
        <h2>Actions</h2>
        <Field label="Reason (kept in the audit log)"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="row">
          {['assigned', 'en_route', 'no_provider'].includes(d.status) && <button disabled={a.busy || reason.length < 3} onClick={() => a.run(() => post(`/v1/admin/bookings/${id}/reassign`, { reason }), 'Taken back from the provider; offer it again from Dispatch.').then(reload)}>Reassign</button>}
          {['requested', 'assigned', 'en_route', 'no_provider', 'awaiting_approval'].includes(d.status) && <button className="danger" disabled={a.busy || reason.length < 3} onClick={() => a.run(() => post(`/v1/bookings/${id}/cancel`, { reason }), 'Booking cancelled').then(reload)}>Cancel booking</button>}
          {d.status === 'on_site' && <>
            <input style={{ width: '8rem' }} dir="ltr" value={visit} onChange={(e) => setVisit(e.target.value)} aria-label="Visit charge (PKR)" />
            <button disabled={a.busy || reason.length < 5} onClick={() => a.run(() => post(`/v1/admin/bookings/${id}/visit-charge`, { amount_paisa: Math.round(Number(visit) * 100), reason }), 'Only the visit charge will be billed.').then(reload)}>Bill visit charge only</button>
          </>}
        </div>
        {['completed', 'closed'].includes(d.status) && (
          <form className="row" style={{ marginTop: '1rem' }} onSubmit={(e) => { e.preventDefault(); void a.run(() => post(`/v1/admin/bookings/${id}/refunds`, { charge_type: refund.charge_type, amount_paisa: Math.round(Number(refund.amount) * 100), reason: refund.reason }, refundKey), 'Refund recorded; commission recalculated.').then(reload); }}>
            <select style={{ width: 'auto' }} value={refund.charge_type} onChange={(e) => setRefund({ ...refund, charge_type: e.target.value })} aria-label="Charge type">
              {['labour', 'inspection_fee', 'driver_hours', 'overtime', 'visit_charge', 'travel_charge', 'materials', 'reimbursement'].map((c) => <option key={c}>{c}</option>)}
            </select>
            <input style={{ width: '8rem' }} dir="ltr" placeholder="Amount (PKR)" value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} aria-label="Refund amount" required />
            <input className="grow" placeholder="Refund reason" value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} aria-label="Refund reason" required minLength={3} />
            <button disabled={a.busy}>Record refund</button>
          </form>
        )}
        <Notice msg={a.msg} />
      </div>
      <div className="panel table-wrap">
        <h2>Timeline</h2>
        <table><tbody>{tl.data?.map((e, i) => (
          <tr key={i}><td>{when(e.created_at)}</td><td>{e.event_type.replace(/_/g, ' ')}</td><td>{e.actor ?? 'system'}</td><td className="muted">{e.data?.reason ?? ''}</td></tr>
        ))}</tbody></table>
      </div>
    </section>
  );
}

// ---------------- Complaints ----------------

function Complaints() {
  const [status, setStatus] = useState('open');
  const list = useLoad(() => get<any[]>(`/v1/admin/complaints${status ? `?status=${status}` : ''}`), [status]);
  const a = useAction();
  const [form, setForm] = useState<Record<string, { resolution: string; note: string; amount: string }>>({});
  const f = (id: string) => form[id] ?? { resolution: 'no_action', note: '', amount: '' };
  return (
    <section className="stack">
      <h1>Complaints</h1>
      <select style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
        <option value="open">Open</option><option value="under_review">Under review</option><option value="resolved">Resolved</option><option value="">All</option>
      </select>
      <Notice msg={a.msg} />
      {list.data?.length === 0 && <Empty title="No complaints here">Customers can complain up to 30 days after a job.</Empty>}
      {list.data?.map((c) => (
        <article key={c.id} className="panel">
          <p className="row"><StatusPill status={c.status} /><a href={`#/bookings/${c.booking_id}`}>{c.ref}</a><span className="muted">{c.job} · {c.provider ?? 'no provider'} · {when(c.created_at)}</span></p>
          <p><strong>{c.category}</strong>: {c.description}</p>
          {c.resolution && <p className="muted">Resolved: {c.resolution}. {c.resolution_note}</p>}
          {c.status !== 'resolved' && (
            <div className="row">
              {c.status === 'open' && <button className="small" onClick={() => a.run(() => post(`/v1/admin/complaints/${c.id}/resolve`, { status: 'under_review' })).then(list.reload)}>Start review</button>}
              <select style={{ width: 'auto' }} value={f(c.id).resolution} onChange={(e) => setForm({ ...form, [c.id]: { ...f(c.id), resolution: e.target.value } })} aria-label="Resolution">
                <option value="no_action">No action</option><option value="adjustment">Adjustment</option><option value="refund">Refund labour</option>
              </select>
              {f(c.id).resolution === 'refund' && <input style={{ width: '8rem' }} dir="ltr" placeholder="PKR" value={f(c.id).amount} onChange={(e) => setForm({ ...form, [c.id]: { ...f(c.id), amount: e.target.value } })} aria-label="Refund amount" />}
              <input className="grow" placeholder="What was decided and why" value={f(c.id).note} onChange={(e) => setForm({ ...form, [c.id]: { ...f(c.id), note: e.target.value } })} aria-label="Resolution note" />
              <button className="small primary" disabled={a.busy} onClick={() => a.run(() => post(`/v1/admin/complaints/${c.id}/resolve`, {
                status: 'resolved', resolution: f(c.id).resolution, note: f(c.id).note,
                ...(f(c.id).resolution === 'refund' && { refund: { charge_type: 'labour', amount_paisa: Math.round(Number(f(c.id).amount) * 100) } }),
              }), 'Complaint resolved').then(list.reload)}>Resolve</button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

// ---------------- Providers ----------------

function Providers({ me }: { me: Me }) {
  const [status, setStatus] = useState('');
  const list = useLoad(() => get<any[]>(`/v1/admin/providers${status ? `?status=${status}` : ''}`), [status]);
  const zones = useLoad(() => get<any[]>('/v1/admin/zones').catch(() => []));
  const [open, setOpen] = useState<string | null>(null);
  const canVerify = me.roles.includes('verification') || me.roles.includes('super_admin');
  return (
    <section className="stack">
      <h1>Providers</h1>
      <select style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
        <option value="">All</option><option value="applicant">Applicants</option><option value="approved">Approved</option><option value="suspended">Suspended</option>
      </select>
      {canVerify && <Onboard zones={zones.data ?? []} onDone={list.reload} />}
      <Loading error={list.error} loading={list.loading && !list.data} />
      {list.data && (
        <div className="panel table-wrap"><table>
          <thead><tr><th>Name</th><th>Phone</th><th>Status</th><th>Skills</th><th>Areas</th><th className="money">Owes</th><th /></tr></thead>
          <tbody>{list.data.map((p) => (
            <Fragment key={p.id}>
              <tr>
                <td>{p.display_name}<br /><span className="muted">{p.full_name}</span></td><td dir="ltr">{p.phone}</td><td><StatusPill status={p.status} /></td>
                <td>{(p.skills ?? []).map((s: any) => <span key={s.skill} className={`pill pill-${s.status}`} style={{ marginInlineEnd: 4 }}>{s.skill}</span>)}</td>
                <td>{(p.zones ?? []).join(', ')}</td><td className="money">{pkr(p.balance_paisa)}</td>
                <td>{canVerify && <button className="small" onClick={() => setOpen(open === p.id ? null : p.id)}>{p.pending_documents > 0 ? `Review (${p.pending_documents})` : 'Manage'}</button>}</td>
              </tr>
              {open === p.id && <tr><td colSpan={7}><ProviderPanel p={p} onChange={list.reload} /></td></tr>}
            </Fragment>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

function Onboard({ zones, onDone }: { zones: any[]; onDone: () => void }) {
  const a = useAction();
  const [f, setF] = useState({ phone: '', full_name: '', display_name: '', skill: 'plumbing', zones: [] as string[] });
  const [show, setShow] = useState(false);
  if (!show) return <button onClick={() => setShow(true)}>Register a new provider</button>;
  return (
    <form className="panel" onSubmit={async (e) => {
      e.preventDefault();
      if (await a.run(() => post('/v1/admin/providers', { phone: f.phone, full_name: f.full_name, display_name: f.display_name, skills: [f.skill], zone_ids: f.zones }), 'Registered. Ask them to sign in and upload documents.')) onDone();
    }}>
      <h2>Register a new provider</h2>
      <div className="row">
        <Field label="Mobile number"><input dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required /></Field>
        <Field label="Full name (as on CNIC)"><input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} required /></Field>
        <Field label="Name shown to customers"><input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} required /></Field>
        <Field label="Skill">
          <select value={f.skill} onChange={(e) => setF({ ...f, skill: e.target.value })}>
            {['plumbing', 'electrical', 'carpentry', 'painting', 'ac_technician', 'appliance_technician', 'cleaning', 'handyman', 'driver', 'locksmith', 'solar_ups'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <fieldset style={{ border: 'none', padding: 0 }}><legend className="field-label">Service areas</legend>
        <div className="row">{zones.map((z) => <label key={z.id} className="row"><input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={f.zones.includes(z.id)}
          onChange={(e) => setF({ ...f, zones: e.target.checked ? [...f.zones, z.id] : f.zones.filter((x) => x !== z.id) })} />{z.code}</label>)}</div>
      </fieldset>
      <Notice msg={a.msg} />
      <div className="row"><button className="primary" disabled={a.busy}>Register</button><button type="button" onClick={() => setShow(false)}>Close</button></div>
    </form>
  );
}

function ProviderPanel({ p, onChange }: { p: any; onChange: () => void }) {
  const docs = useLoad(() => get<any[]>(`/v1/admin/providers/${p.id}/documents`), [p.id]);
  const a = useAction();
  const [note, setNote] = useState('');
  const [expiry, setExpiry] = useState('');
  return (
    <div className="stack" style={{ padding: '.5rem 0' }}>
      <h3>Documents</h3>
      {docs.data?.length === 0 && <p className="muted">No documents uploaded yet.</p>}
      {docs.data?.map((d) => (
        <div key={d.id} className="row">
          <span>{d.doc_type.replace(/_/g, ' ')}</span><StatusPill status={d.status} />
          <button className="small" onClick={() => a.run(() => openSigned(`/v1/admin/documents/${d.id}/url`, { reason: `Verifying ${p.display_name}` }))}>View (logged)</button>
          {d.status === 'pending' && <>
            <button className="small" disabled={a.busy || note.length < 3} onClick={() => a.run(() => post(`/v1/admin/documents/${d.id}/review`, { status: 'accepted', note })).then(docs.reload)}>Accept</button>
            <button className="small danger" disabled={a.busy || note.length < 3} onClick={() => a.run(() => post(`/v1/admin/documents/${d.id}/review`, { status: 'rejected', note })).then(docs.reload)}>Reject</button>
          </>}
        </div>
      ))}
      <Field label="What you checked (licence or certificate number, CNIC match)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Field label="Licence or certificate expiry (required for driver, electrical, locksmith, solar)"><input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
      <div className="row">
        {(p.skills ?? []).filter((s: any) => s.status !== 'approved').map((s: any) => (
          <button key={s.skill} className="small" disabled={a.busy || note.length < 3} onClick={() => a.run(() => post(`/v1/admin/providers/${p.id}/skills/${s.skill}`, { decision: 'approved', check_note: note, ...(expiry && { expires_at: expiry }) }), `Skill ${s.skill} approved`).then(onChange)}>Approve skill: {s.skill}</button>
        ))}
        {p.status !== 'approved' && <button className="small primary" disabled={a.busy || note.length < 3} onClick={() => a.run(() => post(`/v1/admin/providers/${p.id}/status`, { status: 'approved', reason: note }), 'Provider approved').then(onChange)}>Approve provider</button>}
        {p.status === 'approved' && <button className="small danger" disabled={a.busy || note.length < 3} onClick={() => a.run(() => post(`/v1/admin/providers/${p.id}/status`, { status: 'suspended', reason: note }), 'Suspended; open offers withdrawn').then(onChange)}>Suspend</button>}
      </div>
      <Notice msg={a.msg} />
    </div>
  );
}

// ---------------- Money ----------------

function lastMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7);
  return d.toISOString().slice(0, 10);
}

function Finance() {
  const providers = useLoad(() => get<any[]>('/v1/admin/providers?status=approved'));
  const rules = useLoad(() => get<any[]>('/v1/admin/commission-rules'));
  const a = useAction();
  const [week, setWeek] = useState(lastMonday);
  const [closed, setClosed] = useState<any[] | null>(null);
  const [s, setS] = useState({ provider_id: '', amount: '', method: 'jazzcash', reference: '' });
  return (
    <section className="stack">
      <h1>Money</h1>
      <div className="panel">
        <h2>Close a statement week</h2>
        <p className="muted">Weeks run Monday to Sunday (Pakistan time). Closing is safe to repeat.</p>
        <div className="row"><input type="date" style={{ width: 'auto' }} value={week} onChange={(e) => setWeek(e.target.value)} aria-label="Week starting" />
          <button className="primary" disabled={a.busy} onClick={() => a.run(async () => setClosed(await post('/v1/admin/statements/close', { week_start: week })), 'Week closed')}>Close week</button></div>
        {closed && <table style={{ marginTop: '1rem' }}><thead><tr><th>Provider</th><th className="money">Opening</th><th className="money">Fees</th><th className="money">Reductions</th><th className="money">Paid</th><th className="money">Closing</th></tr></thead>
          <tbody>{closed.map((r) => <tr key={r.id}><td>{providers.data?.find((p) => p.id === r.provider_id)?.display_name ?? r.provider_id.slice(0, 8)}</td>
            <td className="money">{pkr(r.opening_balance_paisa)}</td><td className="money">{pkr(r.charges_paisa)}</td><td className="money">{pkr(r.reversals_paisa)}</td><td className="money">{pkr(r.settlements_paisa)}</td><td className="money">{pkr(r.closing_balance_paisa)}</td></tr>)}</tbody></table>}
      </div>
      <form className="panel" onSubmit={(e) => { e.preventDefault(); void a.run(() => post('/v1/admin/settlements', { provider_id: s.provider_id, amount_paisa: Math.round(Number(s.amount) * 100), method: s.method, reference: s.reference, received_at: new Date().toISOString() }), 'Payment recorded').then(providers.reload); }}>
        <h2>Record a provider payment</h2>
        <div className="row">
          <select className="grow" value={s.provider_id} onChange={(e) => setS({ ...s, provider_id: e.target.value })} required aria-label="Provider">
            <option value="">Choose provider</option>{providers.data?.map((p) => <option key={p.id} value={p.id}>{p.display_name} (owes {pkr(p.balance_paisa)})</option>)}
          </select>
          <input style={{ width: '8rem' }} dir="ltr" placeholder="PKR" value={s.amount} onChange={(e) => setS({ ...s, amount: e.target.value })} required aria-label="Amount" />
          <select style={{ width: 'auto' }} value={s.method} onChange={(e) => setS({ ...s, method: e.target.value })} aria-label="Method">
            <option value="jazzcash">JazzCash</option><option value="easypaisa">Easypaisa</option><option value="bank_transfer">Bank transfer</option><option value="cash_office">Cash at office</option>
          </select>
          <input className="grow" placeholder="Transaction reference" value={s.reference} onChange={(e) => setS({ ...s, reference: e.target.value })} required minLength={3} aria-label="Reference" />
          <button className="primary" disabled={a.busy}>Record payment</button>
        </div>
      </form>
      <Notice msg={a.msg} />
      <div className="panel table-wrap">
        <h2>Commission rules</h2>
        <p className="muted">The most specific rule wins: job and district, job, category and district, category, district, then the default.</p>
        <table><thead><tr><th>Applies to</th><th className="money">Rate</th><th>From</th></tr></thead>
          <tbody>{rules.data?.map((r) => <tr key={r.id}><td>{[r.job_code, r.category_code, r.district].filter(Boolean).join(' · ') || 'Default (all services)'}</td><td className="money">{r.rate_bps / 100}%</td><td>{when(r.effective_from)}</td></tr>)}</tbody></table>
      </div>
    </section>
  );
}

function Reports() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const r = useLoad(() => get<any>(`/v1/admin/reports/summary?from=${from}&to=${to}`), [from, to]);
  const d = r.data;
  return (
    <section className="stack">
      <h1>Reports</h1>
      <div className="row"><Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
      <Loading error={r.error} loading={r.loading && !d} />
      {d && (
        <>
          <div className="panel"><dl className="facts">
            <dt>Bookings</dt><dd className="num">{d.bookings} ({d.completed} completed, {d.cancelled} cancelled, {d.no_provider} without a provider)</dd>
            <dt>Average time to assign</dt><dd className="num">{d.avg_minutes_to_assign} min</dd>
            <dt>Cash collected by providers</dt><dd className="num">{pkr(d.cash_collected_paisa)}</dd>
            <dt>Commission earned</dt><dd className="num">{pkr(d.commission_paisa)}</dd>
            <dt>Commission paid in</dt><dd className="num">{pkr(d.settled_paisa)}</dd>
            <dt>Outstanding (all time)</dt><dd className="num">{pkr(d.outstanding_paisa)}</dd>
            <dt>Complaints</dt><dd className="num">{d.complaints.opened} opened, {d.complaints.still_open} still open</dd>
          </dl></div>
          <div className="panel table-wrap"><h2>By service</h2><table><thead><tr><th>Service</th><th className="money">Bookings</th><th className="money">Completed</th></tr></thead>
            <tbody>{d.by_category.map((c: any) => <tr key={c.code}><td>{c.name_en}</td><td className="money">{c.bookings}</td><td className="money">{c.completed}</td></tr>)}</tbody></table></div>
        </>
      )}
    </section>
  );
}

// ---------------- Setup ----------------

function Catalogue() {
  const cat = useLoad(() => get<any[]>('/v1/admin/catalogue'));
  const zones = useLoad(() => get<any[]>('/v1/admin/zones'));
  const a = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const move = (ids: string[], i: number, dir: -1 | 1) => { const n = [...ids]; [n[i], n[i + dir]] = [n[i + dir]!, n[i]!]; return n; };
  if (!cat.data) return <Loading error={cat.error} loading={cat.loading} />;
  const catIds = cat.data.map((c) => c.id);
  return (
    <section className="stack">
      <h1>Services and prices</h1>
      <p className="muted">Changes reach the customer app immediately. Existing bookings keep the price and terms they were booked with.</p>
      <Notice msg={a.msg} />
      {cat.data.map((c, i) => (
        <div key={c.id} className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>{c.name_en} <span className="muted" lang="ur">{c.name_ur}</span></h2>
            <div className="row">
              <StatusPill status={c.status} />
              <button className="small" aria-label="Move up" disabled={i === 0} onClick={() => a.run(() => post('/v1/admin/categories/reorder', { ids: move(catIds, i, -1) })).then(cat.reload)}>↑</button>
              <button className="small" aria-label="Move down" disabled={i === catIds.length - 1} onClick={() => a.run(() => post('/v1/admin/categories/reorder', { ids: move(catIds, i, 1) })).then(cat.reload)}>↓</button>
              <button className="small" onClick={() => a.run(() => api('PATCH', `/v1/admin/categories/${c.id}`, { status: c.status === 'active' ? 'paused' : 'active' })).then(cat.reload)}>{c.status === 'active' ? 'Pause' : 'Activate'}</button>
              <button className="small" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Hide jobs' : `Jobs (${c.jobs.length})`}</button>
            </div>
          </div>
          {open === c.id && (
            <table style={{ marginTop: '.6rem' }}><thead><tr><th>Job</th><th>Booking</th><th className="money">Price</th><th>Areas</th><th>Status</th><th /></tr></thead>
              <tbody>{c.jobs.map((j: any) => <JobRow key={j.id} j={j} zones={zones.data ?? []} onChange={cat.reload} />)}</tbody></table>
          )}
        </div>
      ))}
    </section>
  );
}

function JobRow({ j, zones, onChange }: { j: any; zones: any[]; onChange: () => void }) {
  const a = useAction();
  const [edit, setEdit] = useState(false);
  const [price, setPrice] = useState({ base: String((j.price?.base_labour_paisa ?? 0) / 100), unit: String((j.price?.unit_labour_paisa ?? 0) / 100), inspection: String((j.price?.inspection_fee_paisa ?? 0) / 100) });
  const p = j.price;
  return (
    <>
      <tr>
        <td>{j.name_en}<br /><span className="muted" lang="ur">{j.name_ur}</span></td>
        <td>{j.booking_modes.join(', ')}</td>
        <td className="money">{p ? <>{p.base_labour_paisa > 0 && pkr(p.base_labour_paisa)}{p.unit_labour_paisa > 0 && ` + ${pkr(p.unit_labour_paisa)}/${p.unit_label}`}{p.inspection_fee_paisa > 0 && `inspection ${pkr(p.inspection_fee_paisa)}`}{p.is_demo && <span className="pill pill-pending" style={{ marginInlineStart: 4 }}>demo</span>}</> : '—'}</td>
        <td>{j.zones.join(', ') || <span className="muted">none</span>}</td>
        <td><StatusPill status={j.status} /></td>
        <td className="row">
          <button className="small" onClick={() => a.run(() => post(`/v1/admin/jobs/${j.id}/status`, { status: j.status === 'active' ? 'paused' : 'active' })).then(onChange)}>{j.status === 'active' ? 'Pause' : 'Activate'}</button>
          <button className="small" onClick={() => setEdit(!edit)}>{edit ? 'Close' : 'Price and areas'}</button>
        </td>
      </tr>
      {edit && (
        <tr><td colSpan={6}>
          <div className="row">
            <Field label="Base labour (PKR)"><input dir="ltr" value={price.base} onChange={(e) => setPrice({ ...price, base: e.target.value })} /></Field>
            <Field label={`Per extra ${p?.unit_label ?? 'unit'} (PKR)`}><input dir="ltr" value={price.unit} onChange={(e) => setPrice({ ...price, unit: e.target.value })} /></Field>
            <Field label="Inspection fee (PKR)"><input dir="ltr" value={price.inspection} onChange={(e) => setPrice({ ...price, inspection: e.target.value })} /></Field>
            <button className="primary" disabled={a.busy} onClick={() => a.run(() => post('/v1/admin/pricing-rules', {
              job_id: j.id, base_labour_paisa: Math.round(Number(price.base) * 100), unit_labour_paisa: Math.round(Number(price.unit) * 100),
              inspection_fee_paisa: Math.round(Number(price.inspection) * 100), included_units: p?.included_units ?? 1,
              ...(p?.unit_label && { unit_label: p.unit_label }),
            }), 'New price applies to new bookings from now').then(onChange)}>Save new price</button>
          </div>
          <div className="row">{zones.map((z) => {
            const on = j.zones.includes(z.code);
            return <button key={z.id} className="small" aria-pressed={on} onClick={() => a.run(() => api('PUT', `/v1/admin/jobs/${j.id}/zones/${z.id}`, { status: on ? 'paused' : 'enabled' })).then(onChange)}>{on ? '✓ ' : ''}{z.code}</button>;
          })}</div>
          <Notice msg={a.msg} />
        </td></tr>
      )}
    </>
  );
}

/** Draws a zone outline (no map tiles needed) so the shape can be sanity-checked. */
function ZoneShape({ geo }: { geo: any }) {
  const polys: number[][][][] = geo.type === 'MultiPolygon' ? geo.coordinates : [geo.coordinates];
  const pts = polys.flat(2);
  const xs = pts.map((p) => p[0]!), ys = pts.map((p) => p[1]!);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = 200 / Math.max(x1 - x0, y1 - y0, 1e-6);
  const d = polys.map((poly) => poly.map((ring) => 'M' + ring.map((p) => `${((p[0]! - x0) * s + 10).toFixed(1)} ${((y1 - p[1]!) * s + 10).toFixed(1)}`).join('L') + 'Z').join('')).join('');
  return <svg className="zone-shape" viewBox={`0 0 ${(x1 - x0) * s + 20} ${(y1 - y0) * s + 20}`} role="img" aria-label="Zone outline"><path d={d} fill="rgba(31,92,153,.18)" stroke="#1F5C99" strokeWidth="2" /></svg>;
}

function Zones() {
  const zones = useLoad(() => get<any[]>('/v1/admin/zones'));
  const a = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [nz, setNz] = useState({ code: '', name_en: '', name_ur: '', city_code: 'ISB', geo: '', travel: '0' });
  return (
    <section className="stack">
      <h1>Service areas</h1>
      <p className="muted">A zone serves customers only when it is verified on the ground and active. Changing its boundary pauses it until it is verified again. See docs/owner/zone-field-checklist.md.</p>
      <Notice msg={a.msg} />
      {zones.data?.map((z) => (
        <div key={z.id} className="panel row" style={{ alignItems: 'flex-start' }}>
          <ZoneShape geo={z.boundary} />
          <div className="grow stack">
            <h2>{z.code} · {z.name_en} <span className="muted" lang="ur">{z.name_ur}</span></h2>
            <p className="row"><StatusPill status={z.status} />{z.is_demo && <span className="pill pill-pending">demo boundary</span>}{z.verified_at ? <span className="muted">verified {when(z.verified_at)}</span> : <span className="muted">not verified</span>}</p>
            <p className="muted num">{z.area_km2} km² · {z.opens_at.slice(0, 5)}–{z.closes_at.slice(0, 5)} · travel {pkr(z.travel_charge_paisa)} · {z.providers} providers · {z.jobs} jobs · precedence {z.precedence}</p>
            <div className="row">
              <input className="grow" placeholder="Who checked the boundary, and when" value={notes[z.id] ?? ''} onChange={(e) => setNotes({ ...notes, [z.id]: e.target.value })} aria-label="Verification note" />
              <button className="small" disabled={a.busy || (notes[z.id] ?? '').length < 5} onClick={() => a.run(() => post(`/v1/admin/zones/${z.id}/verify`, { note: notes[z.id] }), 'Verified').then(zones.reload)}>Mark verified</button>
              <button className="small" onClick={() => a.run(() => post(`/v1/admin/zones/${z.id}/status`, { status: z.status === 'active' ? 'paused' : 'active' })).then(zones.reload)}>{z.status === 'active' ? 'Pause' : 'Activate'}</button>
            </div>
          </div>
        </div>
      ))}
      <form className="panel" onSubmit={(e) => {
        e.preventDefault();
        let boundary: unknown;
        try { const g = JSON.parse(nz.geo); boundary = g.type === 'Feature' ? g.geometry : g.type === 'FeatureCollection' ? g.features[0].geometry : g; }
        catch { void a.run(async () => { throw new Error('The boundary must be GeoJSON (a Polygon, MultiPolygon or a Feature).'); }); return; }
        void a.run(() => post('/v1/admin/zones', { code: nz.code, name_en: nz.name_en, name_ur: nz.name_ur, city_code: nz.city_code, boundary, travel_charge_paisa: Math.round(Number(nz.travel) * 100) }), 'Zone saved as a draft').then(zones.reload);
      }}>
        <h2>Add a zone</h2>
        <div className="row">
          <Field label="Code"><input value={nz.code} onChange={(e) => setNz({ ...nz, code: e.target.value.toUpperCase() })} placeholder="ISB-I8" required /></Field>
          <Field label="Name (English)"><input value={nz.name_en} onChange={(e) => setNz({ ...nz, name_en: e.target.value })} required /></Field>
          <Field label="Name (Urdu)"><input lang="ur" dir="rtl" value={nz.name_ur} onChange={(e) => setNz({ ...nz, name_ur: e.target.value })} required /></Field>
          <Field label="City"><select value={nz.city_code} onChange={(e) => setNz({ ...nz, city_code: e.target.value })}><option value="ISB">Islamabad</option><option value="RWP">Rawalpindi</option></select></Field>
          <Field label="Travel charge (PKR)"><input dir="ltr" value={nz.travel} onChange={(e) => setNz({ ...nz, travel: e.target.value })} /></Field>
        </div>
        <Field label="Boundary (GeoJSON from geojson.io or a GPS app export)" hint="Longitude first, then latitude, e.g. [73.07, 33.66]. You can also choose a .geojson file.">
          <textarea dir="ltr" value={nz.geo} onChange={(e) => setNz({ ...nz, geo: e.target.value })} required />
        </Field>
        <input type="file" accept=".geojson,.json,application/geo+json,application/json" aria-label="Import GeoJSON file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setNz({ ...nz, geo: await f.text() }); }} />
        <p style={{ marginTop: '1rem' }}><button className="primary" disabled={a.busy}>Save as draft</button></p>
      </form>
    </section>
  );
}
