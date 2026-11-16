import { useState } from 'react';
import { del, get, patch, post, put } from '../lib/api.ts';
import { Field, Loading, Notice, pkr, StatusPill, useAction, useLoad } from '../lib/ui.tsx';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Setup screens for staff. Everything here is data: adding a district, an alias, a skill or a service field
 * changes what the customer app and provider portal show without a new app release.
 */

const LEVELS = ['province', 'district', 'tehsil', 'city', 'locality'] as const;
const PARENT: Record<string, string[]> = { province: [], district: ['province'], tehsil: ['district'], city: ['district', 'tehsil'], locality: ['city'] };

// ---------------- Places ----------------

export function Places() {
  const regions = useLoad(() => get<any[]>('/v1/admin/regions'));
  const a = useAction();
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [alias, setAlias] = useState({ alias: '', lang: 'roman' });
  const [nr, setNr] = useState({ level: 'locality', parent_id: '', code: '', name_en: '', name_ur: '', lat: '', lng: '', geo: '', aliases: '', is_demo: false });
  if (!regions.data) return <Loading error={regions.error} loading={regions.loading} />;
  const all = regions.data;
  const byId = new Map(all.map((r) => [r.id, r]));
  const path = (r: any): string => (r.parent_id && byId.get(r.parent_id) ? `${path(byId.get(r.parent_id))} › ` : '') + r.name_en;
  const q = filter.trim().toLowerCase();
  const shown = all.filter((r) => !q || path(r).toLowerCase().includes(q) || r.name_ur.includes(filter.trim()) || r.code.toLowerCase().includes(q)
    || r.aliases.some((x: any) => x.alias.toLowerCase().includes(q)));
  const parents = all.filter((r) => PARENT[nr.level]!.includes(r.level));

  const create = () => {
    let boundary: unknown;
    if (nr.geo.trim()) {
      try { const g = JSON.parse(nr.geo); boundary = g.type === 'Feature' ? g.geometry : g; } catch { a.fail('Boundary is not valid GeoJSON.'); return; }
    }
    const aliases = nr.aliases.split(',').map((s) => s.trim()).filter(Boolean).map((s) => ({ alias: s, lang: /[؀-ۿ]/.test(s) ? 'ur' : 'roman' }));
    void a.run(() => post('/v1/admin/regions', {
      parent_id: nr.parent_id || null, level: nr.level, code: nr.code.trim().toUpperCase(), name_en: nr.name_en, name_ur: nr.name_ur, is_demo: nr.is_demo, aliases,
      ...(nr.lat && nr.lng && { centre: { lat: Number(nr.lat), lng: Number(nr.lng) } }), ...(boundary !== undefined && { boundary }),
    }), 'Place added. Customers can search for it now.').then((ok) => { if (ok) { setNr({ ...nr, code: '', name_en: '', name_ur: '', lat: '', lng: '', geo: '', aliases: '' }); void regions.reload(); } });
  };

  return (
    <section className="stack">
      <h1>Places</h1>
      <p className="muted">Provinces, districts, cities and localities that customers can search, in English, Urdu and Roman Urdu. A locality needs a centre point or a boundary. Selling in a place also needs a verified service area (see Service areas).</p>
      <div className="panel">
        <h2>Add a place</h2>
        <div className="row">
          <Field label="Level"><select value={nr.level} onChange={(e) => setNr({ ...nr, level: e.target.value, parent_id: '' })}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select></Field>
          {nr.level !== 'province' && (
            <Field label="Inside"><select value={nr.parent_id} onChange={(e) => setNr({ ...nr, parent_id: e.target.value })} required>
              <option value="">Choose…</option>{parents.map((p) => <option key={p.id} value={p.id}>{path(p)}</option>)}
            </select></Field>
          )}
          <Field label="Code"><input dir="ltr" placeholder="RWP-BAHRIA-8" value={nr.code} onChange={(e) => setNr({ ...nr, code: e.target.value })} /></Field>
          <Field label="Name (English)"><input value={nr.name_en} onChange={(e) => setNr({ ...nr, name_en: e.target.value })} /></Field>
          <Field label="Name (Urdu)"><input lang="ur" dir="rtl" value={nr.name_ur} onChange={(e) => setNr({ ...nr, name_ur: e.target.value })} /></Field>
        </div>
        {nr.level === 'locality' && (
          <div className="row">
            <Field label="Centre latitude"><input dir="ltr" inputMode="decimal" value={nr.lat} onChange={(e) => setNr({ ...nr, lat: e.target.value })} /></Field>
            <Field label="Centre longitude"><input dir="ltr" inputMode="decimal" value={nr.lng} onChange={(e) => setNr({ ...nr, lng: e.target.value })} /></Field>
          </div>
        )}
        <Field label="Other spellings, comma separated (Roman Urdu or Urdu)"><input placeholder="bahria phase 8, بحریہ فیز 8" value={nr.aliases} onChange={(e) => setNr({ ...nr, aliases: e.target.value })} /></Field>
        <Field label="Boundary (optional GeoJSON Polygon)"><textarea dir="ltr" rows={3} value={nr.geo} onChange={(e) => setNr({ ...nr, geo: e.target.value })} /></Field>
        <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={nr.is_demo} onChange={(e) => setNr({ ...nr, is_demo: e.target.checked })} /> Test data (hidden from real customers in production)</label>
        <button className="primary" disabled={a.busy || !nr.code || nr.name_en.length < 2 || nr.name_ur.length < 2 || (nr.level !== 'province' && !nr.parent_id)} onClick={create}>Add place</button>
        <Notice msg={a.msg} />
      </div>
      <input type="search" placeholder="Filter by name, code or spelling" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter places" />
      <div className="panel table-wrap">
        <table>
          <thead><tr><th>Place</th><th>Level</th><th>Other spellings</th><th>Status</th><th /></tr></thead>
          <tbody>{shown.slice(0, 200).map((r) => (
            <tr key={r.id}>
              <td>{path(r)}<br /><span className="muted" lang="ur">{r.name_ur}</span> <span className="muted" dir="ltr">{r.code}</span>{r.is_demo && <span className="pill pill-pending" style={{ marginInlineStart: 4 }}>test</span>}</td>
              <td>{r.level}</td>
              <td>
                {r.aliases.map((x: any) => (
                  <span key={x.id} className="pill" style={{ marginInlineEnd: 4 }}>{x.alias}
                    <button className="link" aria-label={`Remove ${x.alias}`} onClick={() => a.run(() => del(`/v1/admin/aliases/${x.id}`)).then(regions.reload)}>×</button>
                  </span>
                ))}
                {open === r.id && (
                  <form className="row" onSubmit={(e) => { e.preventDefault(); void a.run(() => post(`/v1/admin/regions/${r.id}/aliases`, alias), 'Spelling added').then(() => { setAlias({ ...alias, alias: '' }); void regions.reload(); }); }}>
                    <input style={{ width: '10rem' }} value={alias.alias} onChange={(e) => setAlias({ ...alias, alias: e.target.value })} aria-label="New spelling" required />
                    <select style={{ width: 'auto' }} value={alias.lang} onChange={(e) => setAlias({ ...alias, lang: e.target.value })} aria-label="Language">
                      <option value="roman">Roman Urdu</option><option value="ur">Urdu</option><option value="en">English</option>
                    </select>
                    <button className="small" disabled={a.busy}>Add</button>
                  </form>
                )}
              </td>
              <td><StatusPill status={r.status} /></td>
              <td className="row">
                <button className="small" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Done' : 'Add spelling'}</button>
                <button className="small" onClick={() => a.run(() => post(`/v1/admin/regions/${r.id}/status`, { status: r.status === 'active' ? 'hidden' : 'active' })).then(regions.reload)}>{r.status === 'active' ? 'Hide' : 'Show'}</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
        {shown.length > 200 && <p className="muted">Showing 200 of {shown.length}. Filter to narrow down.</p>}
      </div>
    </section>
  );
}

// ---------------- Skills ----------------

export function Skills() {
  const skills = useLoad(() => get<any[]>('/v1/admin/skills'));
  const a = useAction();
  const [s, setS] = useState({ code: '', name_en: '', name_ur: '', restricted: false });
  return (
    <section className="stack">
      <h1>Skills</h1>
      <p className="muted">A restricted skill (driving, electrical, locks, solar) can only be approved with an accepted licence or certificate and an expiry date.</p>
      <Loading error={skills.error} loading={skills.loading && !skills.data} />
      <div className="panel table-wrap"><table>
        <thead><tr><th>Code</th><th>Name</th><th>Restricted</th></tr></thead>
        <tbody>{skills.data?.map((k) => (
          <tr key={k.code}><td dir="ltr">{k.code}</td><td>{k.name_en}<br /><span className="muted" lang="ur">{k.name_ur}</span></td>
            <td><label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={k.restricted}
              onChange={(e) => a.run(() => put('/v1/admin/skills', { code: k.code, name_en: k.name_en, name_ur: k.name_ur, restricted: e.target.checked })).then(skills.reload)} /> {k.restricted ? 'Licence needed' : 'No'}</label></td></tr>
        ))}</tbody>
      </table></div>
      <form className="panel row" onSubmit={(e) => { e.preventDefault(); void a.run(() => put('/v1/admin/skills', s), 'Skill saved').then(skills.reload); }}>
        <Field label="Code"><input dir="ltr" placeholder="solar_ups" value={s.code} onChange={(e) => setS({ ...s, code: e.target.value })} required /></Field>
        <Field label="Name (English)"><input value={s.name_en} onChange={(e) => setS({ ...s, name_en: e.target.value })} required /></Field>
        <Field label="Name (Urdu)"><input lang="ur" dir="rtl" value={s.name_ur} onChange={(e) => setS({ ...s, name_ur: e.target.value })} required /></Field>
        <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={s.restricted} onChange={(e) => setS({ ...s, restricted: e.target.checked })} /> Licence needed</label>
        <button className="primary" disabled={a.busy}>Save skill</button>
      </form>
      <Notice msg={a.msg} />
    </section>
  );
}

// ---------------- Service settings (inside a catalogue row) ----------------

const FIELD_TYPES = [['integer', 'Number'], ['hours', 'Hours'], ['text', 'Text'], ['select', 'Choice'], ['boolean', 'Yes / no']] as const;

export function ServiceSettings({ jobId, onChange }: { jobId: string; onChange: () => void }) {
  const job = useLoad(() => get<any>(`/v1/admin/jobs/${jobId}`), [jobId]);
  const skills = useLoad(() => get<any[]>('/v1/admin/skills'));
  const a = useAction();
  const [form, setForm] = useState<any>(null);
  const [field, setField] = useState({ key: '', field_type: 'integer', label_en: '', label_ur: '', required: false, options: '' });
  if (!job.data) return <Loading error={job.error} loading={job.loading} />;
  const j = job.data;
  const f = form ?? {
    name_en: j.name_en, name_ur: j.name_ur, description_en: j.description_en ?? '', description_ur: j.description_ur ?? '',
    booking_modes: j.booking_modes, required_skill: j.required_skill ?? '', duration_minutes: String(j.duration_minutes ?? 90),
    duration_field_key: j.duration_field_key ?? '', needs_destination: !!j.needs_destination,
    requires_authorization_check: !!j.requires_authorization_check, visit: String((j.visit_charge_paisa ?? 0) / 100),
  };
  const set = (k: string, v: unknown) => setForm({ ...f, [k]: v });
  const hoursFields = j.fields.filter((x: any) => x.field_type === 'hours');

  const save = () => a.run(() => patch(`/v1/admin/jobs/${jobId}/settings`, {
    name_en: f.name_en, name_ur: f.name_ur, description_en: f.description_en, description_ur: f.description_ur,
    booking_modes: f.booking_modes, ...(f.required_skill && { required_skill: f.required_skill }),
    duration_minutes: Number(f.duration_minutes), duration_field_key: f.duration_field_key || null,
    needs_destination: f.needs_destination, requires_authorization_check: f.requires_authorization_check,
    visit_charge_paisa: Math.round(Number(f.visit) * 100),
  }), 'Saved. New bookings use these settings; existing bookings keep the terms the customer accepted.').then(() => { setForm(null); void job.reload(); onChange(); });

  const addField = () => {
    const options = field.field_type === 'select'
      ? field.options.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p[0]).map(([value, en, ur]) => ({ value: value!, label_en: en || value!, label_ur: ur || en || value! }))
      : undefined;
    void a.run(() => put(`/v1/admin/jobs/${jobId}/fields`, { key: field.key, field_type: field.field_type, label_en: field.label_en, label_ur: field.label_ur, required: field.required, ...(options && { options }) }),
      'Field saved. The app shows it on the next screen load.').then((ok) => { if (ok) { setField({ ...field, key: '', label_en: '', label_ur: '', options: '' }); void job.reload(); } });
  };

  return (
    <div className="stack" style={{ marginTop: '1rem' }}>
      <h3>Service settings</h3>
      <div className="row">
        <Field label="Name (English)"><input value={f.name_en} onChange={(e) => set('name_en', e.target.value)} /></Field>
        <Field label="Name (Urdu)"><input lang="ur" dir="rtl" value={f.name_ur} onChange={(e) => set('name_ur', e.target.value)} /></Field>
      </div>
      <div className="row">
        <Field label="What is included (English)"><textarea rows={2} value={f.description_en} onChange={(e) => set('description_en', e.target.value)} /></Field>
        <Field label="What is included (Urdu)"><textarea lang="ur" dir="rtl" rows={2} value={f.description_ur} onChange={(e) => set('description_ur', e.target.value)} /></Field>
      </div>
      <div className="row">
        <fieldset className="row" style={{ border: 0, padding: 0 }}><legend>How it is priced</legend>
          {['fixed', 'inspection', 'quote'].map((m) => (
            <label key={m} className="row"><input type="checkbox" style={{ width: 'auto' }} checked={f.booking_modes.includes(m)}
              onChange={(e) => set('booking_modes', e.target.checked ? [...f.booking_modes, m] : f.booking_modes.filter((x: string) => x !== m))} />{m}</label>
          ))}
        </fieldset>
        <Field label="Skill needed"><select value={f.required_skill} onChange={(e) => set('required_skill', e.target.value)}>
          {skills.data?.map((k) => <option key={k.code} value={k.code}>{k.name_en}{k.restricted ? ' (licence)' : ''}</option>)}
        </select></Field>
        <Field label="Usual duration (minutes)"><input dir="ltr" inputMode="numeric" value={f.duration_minutes} onChange={(e) => set('duration_minutes', e.target.value)} /></Field>
        <Field label="Duration comes from field"><select value={f.duration_field_key} onChange={(e) => set('duration_field_key', e.target.value)}>
          <option value="">Use the usual duration</option>{hoursFields.map((x: any) => <option key={x.key} value={x.key}>{x.label_en}</option>)}
        </select></Field>
      </div>
      <div className="row">
        <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={f.needs_destination} onChange={(e) => set('needs_destination', e.target.checked)} /> Customer gives a destination</label>
        <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={f.requires_authorization_check} onChange={(e) => set('requires_authorization_check', e.target.checked)} /> Provider must verify occupancy before work</label>
        <Field label="Visit charge if work cannot go ahead (PKR, shown to the customer before booking)"><input dir="ltr" inputMode="numeric" value={f.visit} onChange={(e) => set('visit', e.target.value)} /></Field>
      </div>
      <button className="primary" disabled={a.busy || f.booking_modes.length === 0} onClick={save}>Save settings</button>

      <h3>Questions the customer answers</h3>
      <div className="table-wrap"><table>
        <thead><tr><th>Key</th><th>Type</th><th>Label</th><th>Required</th><th>Choices</th><th /></tr></thead>
        <tbody>{j.fields.map((x: any) => (
          <tr key={x.key}><td dir="ltr">{x.key}</td><td>{x.field_type}</td><td>{x.label_en}<br /><span className="muted" lang="ur">{x.label_ur}</span></td>
            <td>{x.required ? 'Yes' : 'No'}</td><td>{(x.options ?? []).map((o: any) => o.label_en).join(', ')}</td>
            <td><button className="small danger" disabled={a.busy} onClick={() => a.run(() => del(`/v1/admin/jobs/${jobId}/fields/${x.key}`), 'Field removed').then(job.reload)}>Remove</button></td></tr>
        ))}</tbody>
      </table></div>
      <div className="row">
        <Field label="Key"><input dir="ltr" placeholder="system_size" value={field.key} onChange={(e) => setField({ ...field, key: e.target.value })} /></Field>
        <Field label="Type"><select value={field.field_type} onChange={(e) => setField({ ...field, field_type: e.target.value })}>{FIELD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Question (English)"><input value={field.label_en} onChange={(e) => setField({ ...field, label_en: e.target.value })} /></Field>
        <Field label="Question (Urdu)"><input lang="ur" dir="rtl" value={field.label_ur} onChange={(e) => setField({ ...field, label_ur: e.target.value })} /></Field>
        <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={field.required} onChange={(e) => setField({ ...field, required: e.target.checked })} /> Required</label>
      </div>
      {field.field_type === 'select' && (
        <Field label="Choices, one per line: value | English | Urdu"><textarea rows={3} dir="ltr" placeholder={'3kw | Up to 3 kW | 3 کلو واٹ تک\n10kw | 3 to 10 kW | 3 سے 10 کلو واٹ'} value={field.options} onChange={(e) => setField({ ...field, options: e.target.value })} /></Field>
      )}
      <button disabled={a.busy || !field.key || field.label_en.length < 2 || field.label_ur.length < 2} onClick={addField}>Save question</button>
      <p className="muted">Visit charge now: {pkr(j.visit_charge_paisa)}</p>
      <Notice msg={a.msg} />
    </div>
  );
}
