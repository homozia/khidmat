import { Fragment, useState } from 'react';
import { api, get, newIdempotencyKey, post } from '../lib/api.ts';
import { useI18n, useName } from '../lib/i18n.tsx';
import { go, useRoute } from '../lib/route.ts';
import { Empty, Field, JourneyRail, Loading, Notice, pkr, StatusPill, useAction, useLoad, when } from '../lib/ui.tsx';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function ProviderApp() {
  const r = useRoute();
  const { t } = useI18n();
  const tab = r[0] ?? 'offers';
  const tabs: [string, string][] = [['offers', 'Offers'], ['jobs', 'My jobs'], ['earnings', 'Earnings'], ['profile', 'Profile']];
  return (
    <>
      <main className="mobile">
        {tab === 'offers' && <Offers />}
        {tab === 'jobs' && !r[1] && <Jobs />}
        {tab === 'jobs' && r[1] && <JobDetail id={r[1]} />}
        {tab === 'earnings' && <Earnings />}
        {tab === 'profile' && <Profile />}
      </main>
      <nav className="tabbar" aria-label="Provider">
        {tabs.map(([k, label]) => <a key={k} href={`#/${k}`} aria-current={tab === k ? 'page' : undefined}>{t(label)}</a>)}
      </nav>
    </>
  );
}

function Offers() {
  const { t } = useI18n();
  const name = useName();
  const { data, error, loading, reload } = useLoad(() => get<any[]>('/v1/provider/offers'));
  const a = useAction();
  return (
    <section className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('Offers')}</h1>
        <button className="small" onClick={reload}>↻</button>
      </div>
      <Loading error={error} loading={loading && !data} />
      <Notice msg={a.msg} />
      {data?.length === 0 && <Empty title={t('No offers right now')}>{t('New offers appear here. Keep "Accepting jobs" on in your profile.')}</Empty>}
      {data?.map((o) => {
        const total = (o.price_lines ?? []).reduce((s: number, l: any) => s + l.amount_paisa, 0);
        return (
          <article key={o.assignment_id} className="panel">
            <h3>{name(o, 'job_name')}</h3>
            <p className="muted">{name(o, 'locality') || name(o, 'zone')} · {when(o.scheduled_start)}</p>
            {total > 0 && <p className="num">{pkr(total)}</p>}
            <p className="muted">{t('Address is shown after you accept.')} {t('Offer expires')} {when(o.expires_at)}</p>
            <div className="row">
              <button className="primary" disabled={a.busy} onClick={async () => {
                // The server re-checks licence, availability, area and overlapping jobs when you accept.
                let r: any = null;
                if (await a.run(async () => { r = await post(`/v1/provider/offers/${o.assignment_id}/accept`); })) {
                  if (r?.status === 'accepted') go(`jobs/${o.booking_id}`);
                  else { a.fail(r?.status === 'expired' ? t('This offer has expired.') : `${t('This offer is no longer available to you.')} ${r?.reason ?? ''}`); void reload(); }
                }
              }}>{t('Accept')}</button>
              <button disabled={a.busy} onClick={() => a.run(() => post(`/v1/provider/offers/${o.assignment_id}/decline`)).then(reload)}>{t('Decline')}</button>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function Jobs() {
  const { t } = useI18n();
  const name = useName();
  const { data, error, loading } = useLoad(() => get<any[]>('/v1/provider/jobs'));
  return (
    <section className="stack">
      <h1>{t('My jobs')}</h1>
      <Loading error={error} loading={loading} />
      {data?.length === 0 && <Empty title={t('No jobs yet')}>{t('Accepted jobs appear here.')}</Empty>}
      {data?.map((j) => (
        <a key={j.id} href={`#/jobs/${j.id}`} className="panel job-card">
          <div className="row" style={{ justifyContent: 'space-between' }}><h3>{name(j, 'job_name')}</h3><StatusPill status={j.status} /></div>
          <p className="muted">{j.ref} · {j.zone_en} · {when(j.scheduled_start)}</p>
        </a>
      ))}
    </section>
  );
}

const NEXT: Record<string, [string, string]> = {
  assigned: ['en_route', 'On my way'], en_route: ['on_site', 'I have arrived'], on_site: ['in_progress', 'Start work'],
};

function JobDetail({ id }: { id: string }) {
  const { t } = useI18n();
  const name = useName();
  const { data: b, error, loading, reload } = useLoad(() => get<any>(`/v1/bookings/${id}`), [id]);
  const a = useAction();
  const [showQuote, setShowQuote] = useState(false);
  const [cash, setCash] = useState('');
  const [completeKey] = useState(newIdempotencyKey);

  if (!b) return <Loading error={error} loading={loading} />;
  const next = NEXT[b.status];
  const working = ['on_site', 'in_progress', 'assigned', 'en_route'].includes(b.status);
  return (
    <section className="stack">
      <button className="link" onClick={() => go('jobs')}>{t('Back')}</button>
      <div className="row" style={{ justifyContent: 'space-between' }}><h1>{name(b.job)}</h1><StatusPill status={b.status} /></div>
      <JourneyRail status={b.status} />
      <div className="panel">
        <dl className="facts">
          <dt>{t('Customer')}</dt><dd>{b.customer?.name ?? '—'} {b.customer?.phone && <a href={`tel:${b.customer.phone}`} dir="ltr">{b.customer.phone}</a>}</dd>
          <dt>{t('Address')}</dt><dd>{b.address_line ?? '—'}</dd>
          {b.landmark && <><dt>{t('Landmark')}</dt><dd>{b.landmark}</dd></>}
          {b.destination_text && <><dt>{t('Destination')}</dt><dd>{b.destination_text}</dd></>}
          <dt>{t('Time')}</dt><dd>{when(b.scheduled_start)}</dd>
          <dt>{t('Reference')}</dt><dd>{b.ref}</dd>
        </dl>
        {b.location && <p style={{ marginTop: '.8rem' }}><a target="_blank" rel="noopener" href={`https://www.google.com/maps/dir/?api=1&destination=${b.location.lat},${b.location.lng}`}>{t('Open directions')}</a></p>}
      </div>

      <div className="panel">
        <h2>{t('Prices')}</h2>
        {b.quotes.map((q: any) => (
          <div key={q.id} style={{ marginBottom: '.8rem' }}>
            <p className="row"><strong>#{q.revision}</strong><StatusPill status={q.status === 'sent' ? 'pending' : q.status} />{q.note && <span className="muted">{q.note}</span>}</p>
            <div className="money-lines">{q.lines.map((l: any, i: number) => <Fragment key={i}><span>{l.description}</span><span className="num">{pkr(l.amount_paisa)}</span></Fragment>)}</div>
          </div>
        ))}
        {b.provider_money && (
          <div className="money-lines" style={{ marginTop: '1rem' }}>
            <span>{t('Customer total')}</span><span className="num">{pkr(b.totals.customer_total_paisa - b.totals.refunded_paisa)}</span>
            <span className="muted">{t('Fee charged on (labour)')}</span><span className="num muted">{pkr(b.provider_money.commissionable_paisa)}</span>
            <span className="muted">{t('No fee on (materials, travel, tolls)')}</span><span className="num muted">{pkr(b.totals.customer_total_paisa - b.totals.refunded_paisa - b.provider_money.commissionable_paisa)}</span>
            <span>{t('Platform fee')} ({b.provider_money.commission_rate_bps / 100}%)</span><span className="num">−{pkr(b.provider_money.fee_paisa)}</span>
            <span className="total">{t('Your earnings')}</span><span className="total num">{pkr(b.provider_money.net_paisa)}</span>
          </div>
        )}
      </div>

      {b.requires_authorization_check && <AuthorizationCheck booking={b} onDone={reload} />}
      <Notice msg={a.msg} />
      <div className="big-actions">
        {next && <button className="primary" disabled={a.busy || (next[0] === 'in_progress' && b.requires_authorization_check && !b.authorization_check?.verified)} onClick={() => a.run(() => post(`/v1/provider/bookings/${id}/status`, { to: next[0] })).then(reload)}>{t(next[1])}</button>}
        {working && !showQuote && <button disabled={a.busy} onClick={() => setShowQuote(true)}>{t('Send price for approval')}</button>}
      </div>
      {showQuote && <QuoteBuilder bookingId={id} onDone={() => { setShowQuote(false); void reload(); }} driver={b.job?.name_en?.toLowerCase().includes('driver') || b.destination_text} />}

      {['on_site', 'in_progress'].includes(b.status) && (
        <form className="panel" onSubmit={async (e) => {
          e.preventDefault();
          await a.run(() => post(`/v1/provider/bookings/${id}/complete`, { cash_collected_paisa: Math.round(Number(cash) * 100) }, completeKey));
          void reload();
        }}>
          <h2>{t('Complete and record cash')}</h2>
          <p className="muted">{t('Customer total')}: <strong className="num">{pkr(b.totals.customer_total_paisa)}</strong></p>
          <Field label={t('Cash collected (PKR)')}><input inputMode="decimal" dir="ltr" value={cash} onChange={(e) => setCash(e.target.value)} required /></Field>
          <button className="primary" disabled={a.busy}>{t('Complete and record cash')}</button>
        </form>
      )}
      {['in_progress', 'completed', 'on_site'].includes(b.status) && <PhotoUpload bookingId={id} />}
    </section>
  );
}

function QuoteBuilder({ bookingId, onDone, driver }: { bookingId: string; onDone: () => void; driver: boolean }) {
  const { t } = useI18n();
  const a = useAction();
  const [key] = useState(newIdempotencyKey);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([{ charge_type: driver ? 'overtime' : 'labour', description: '', quantity: '1', price: '' }]);
  const types: [string, string][] = driver
    ? [['overtime', 'Overtime'], ['driver_hours', 'Driver hours'], ['reimbursement', 'Tolls and parking']]
    : [['labour', 'Labour'], ['materials', 'Materials and parts']];
  const set = (i: number, k: string, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const total = lines.reduce((s, l) => s + Math.round(Number(l.quantity) * Number(l.price) * 100 || 0), 0);
  return (
    <form className="panel" onSubmit={async (e) => {
      e.preventDefault();
      const ok = await a.run(() => post(`/v1/provider/bookings/${bookingId}/quotes`, {
        kind: 'change_order', note: note || undefined,
        lines: lines.map((l) => ({ charge_type: l.charge_type, description: l.description, quantity: Number(l.quantity), unit_price_paisa: Math.round(Number(l.price) * 100) })),
      }, key));
      if (ok) onDone();
    }}>
      <h2>{t('Send price for approval')}</h2>
      {lines.map((l, i) => (
        <fieldset key={i} style={{ border: 'none', padding: 0, margin: '0 0 .8rem' }}>
          <div className="row">
            <select className="grow" aria-label={t('Type')} value={l.charge_type} onChange={(e) => set(i, 'charge_type', e.target.value)}>
              {types.map(([v, lab]) => <option key={v} value={v}>{t(lab)}</option>)}
            </select>
            <input className="grow" aria-label={t('Description')} placeholder={t('Description')} value={l.description} onChange={(e) => set(i, 'description', e.target.value)} required minLength={2} />
          </div>
          <div className="row" style={{ marginTop: '.4rem' }}>
            <input style={{ width: '6rem' }} aria-label={t('Quantity')} inputMode="decimal" dir="ltr" value={l.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} />
            <input className="grow" aria-label={t('Price (PKR)')} placeholder={t('Price (PKR)')} inputMode="decimal" dir="ltr" value={l.price} onChange={(e) => set(i, 'price', e.target.value)} required />
          </div>
        </fieldset>
      ))}
      <button type="button" className="small" onClick={() => setLines([...lines, { charge_type: types[0]![0], description: '', quantity: '1', price: '' }])}>{t('Add line')}</button>
      <Field label={t('Note for the customer')}><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
      <p className="num"><strong>{pkr(total)}</strong></p>
      <Notice msg={a.msg} />
      <button className="primary" disabled={a.busy}>{t('Send price for approval')}</button>
    </form>
  );
}

function PhotoUpload({ bookingId }: { bookingId: string }) {
  const { t } = useI18n();
  const a = useAction();
  return (
    <div className="panel">
      <Field label={t('Add completion photo')} hint="JPEG, PNG or WebP, up to 5 MB">
        <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) await a.run(() => api('POST', `/v1/bookings/${bookingId}/attachments?kind=completion_photo`, undefined, { raw: f }), 'Photo saved');
        }} />
      </Field>
      <Notice msg={a.msg} />
    </div>
  );
}

/** Lockouts: the provider records how occupancy was checked before opening anything. Work cannot start without it. */
function AuthorizationCheck({ booking, onDone }: { booking: any; onDone: () => void }) {
  const { t } = useI18n();
  const a = useAction();
  const [method, setMethod] = useState('');
  const [note, setNote] = useState('');
  const c = booking.authorization_check;
  if (c) {
    return <p className={`notice notice-${c.verified ? 'ok' : 'err'}`}>{c.verified ? t('Occupancy verified. You can start the work.') : t('Occupancy could not be verified. Do not open the lock. Call dispatch; the agreed visit charge applies.')}</p>;
  }
  if (booking.status !== 'on_site') return <p className="notice notice-err">{t('Lockout: when you arrive, check that the customer lives here before opening anything.')}</p>;
  return (
    <form className="panel" onSubmit={(e) => { e.preventDefault(); void a.run(() => post(`/v1/provider/bookings/${booking.id}/authorization-check`, { verified: method !== 'not_verifiable', method, note })).then(onDone); }}>
      <h2>{t('Check occupancy before opening')}</h2>
      <Field label={t('How did you check?')}>
        <select value={method} onChange={(e) => setMethod(e.target.value)} required>
          <option value="">{t('Choose one')}</option>
          <option value="photo_id_matches_address">{t('Photo ID shows this address')}</option>
          <option value="utility_bill">{t('Utility bill in their name for this address')}</option>
          <option value="tenancy_document">{t('Tenancy agreement for this address')}</option>
          <option value="guard_or_neighbour">{t('Guard or neighbour confirmed they live here')}</option>
          <option value="not_verifiable">{t('Could not verify')}</option>
        </select>
      </Field>
      <Field label={t('What you saw (no ID numbers)')}><input value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} /></Field>
      <button className="primary" disabled={a.busy || !method}>{t('Record check')}</button>
      <Notice msg={a.msg} />
    </form>
  );
}

function Earnings() {
  const { t } = useI18n();
  const ledger = useLoad(() => get<any>('/v1/provider/ledger'));
  const statements = useLoad(() => get<any[]>('/v1/provider/statements'));
  const label: Record<string, string> = { commission_charge: 'Platform fee', commission_reversal: 'Fee reduced (refund)', commission_increase: 'Fee increased',
    settlement_received: 'Payment received', manual_adjustment: 'Adjustment' };
  return (
    <section className="stack">
      <h1>{t('Earnings')}</h1>
      <Loading error={ledger.error} loading={ledger.loading} />
      {ledger.data && (
        <div className="panel">
          <p className="muted">{t('Amount you owe')}</p>
          <p className="num" style={{ fontSize: '2rem', fontWeight: 600, margin: 0 }}>{pkr(ledger.data.balance_paisa)}</p>
          <p className="muted">Pay weekly by Thursday to the company account (bank, JazzCash or Easypaisa) and keep the reference.</p>
        </div>
      )}
      {ledger.data?.entries?.length > 0 && (
        <div className="panel table-wrap"><table>
          <thead><tr><th>Date</th><th>Entry</th><th className="money">Amount</th></tr></thead>
          <tbody>{[...ledger.data.entries].reverse().map((e: any) => (
            <tr key={e.id}><td>{when(e.created_at)}</td><td>{label[e.entry_type] ?? e.entry_type}{e.booking_ref && <span className="muted"> · {e.booking_ref}</span>}</td><td className="money">{pkr(e.amount_paisa)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      <h2>{t('Weekly statements')}</h2>
      {statements.data?.length === 0 && <p className="muted">Statements appear after each week is closed on Monday.</p>}
      {statements.data?.map((s) => (
        <div key={s.id} className="panel money-lines">
          <span>Week of {s.period_start.slice(0, 10)}</span><span />
          <span>Opening balance</span><span className="num">{pkr(s.opening_balance_paisa)}</span>
          <span>Fees</span><span className="num">{pkr(s.charges_paisa)}</span>
          <span>Fee reductions</span><span className="num">{pkr(s.reversals_paisa)}</span>
          <span>Payments</span><span className="num">{pkr(s.settlements_paisa)}</span>
          <span className="total">Closing balance</span><span className="total num">{pkr(s.closing_balance_paisa)}</span>
        </div>
      ))}
    </section>
  );
}

function Profile() {
  const { t } = useI18n();
  const name = useName();
  const { data: p, error, loading, reload } = useLoad(() => get<any>('/v1/provider/profile'));
  const a = useAction();
  const [docType, setDocType] = useState('cnic_front');
  if (!p) return <Loading error={error} loading={loading} />;
  return (
    <section className="stack">
      <h1>{p.display_name}</h1>
      <p><StatusPill status={p.status} /> {p.rating_avg && <span className="muted">★ {p.rating_avg} ({p.review_count})</span>}</p>
      <label className="panel row" style={{ justifyContent: 'space-between' }}>
        <span>{t('Accepting jobs')}</span>
        <input type="checkbox" style={{ width: 28, minHeight: 28 }} checked={p.accepting_offers} onChange={(e) =>
          a.run(() => api('PUT', '/v1/provider/availability', { accepting_offers: e.target.checked })).then(reload)} />
      </label>
      <div className="panel">
        <h2>{t('Skills')}</h2>
        {(p.skills ?? []).map((s: any) => <p key={s.skill} className="row">{s.skill} <StatusPill status={s.status} /> {s.expires_at && <span className="muted">until {s.expires_at.slice(0, 10)}</span>}</p>)}
        <h2>{t('Areas')}</h2>
        <p>{(p.zones ?? []).map((z: any) => name(z)).join(', ') || '—'}</p>
      </div>
      <div className="panel">
        <h2>{t('Documents')}</h2>
        {p.documents.map((d: any) => <p key={d.id} className="row">{d.doc_type.replace(/_/g, ' ')} <StatusPill status={d.status} /> {d.note && <span className="muted">{d.note}</span>}</p>)}
        <div className="row">
          <select className="grow" value={docType} onChange={(e) => setDocType(e.target.value)} aria-label="Document type">
            {['cnic_front', 'cnic_back', 'selfie', 'police_certificate', 'driving_licence', 'trade_certificate', 'other'].map((d) => <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}
          </select>
          <input className="grow" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" aria-label={t('Upload document')} onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) { await a.run(() => api('POST', `/v1/provider/documents?doc_type=${docType}`, undefined, { raw: f }), 'Uploaded'); void reload(); }
          }} />
        </div>
        <Notice msg={a.msg} />
      </div>
    </section>
  );
}
