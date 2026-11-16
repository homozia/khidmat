import { useEffect, useMemo, useRef, useState } from 'react';
import { clearDiagnostics, lastBookingRef, maskIds, recentFailures } from '../lib/diagnostics.ts';
import { ROLE_CARD } from '../lib/testAccounts.ts';

/** What the server allows: sandbox sign-in codes mean a private test environment. */
export interface ServerInfo { env: string; sandbox_sms: boolean }
export function useServerInfo() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  useEffect(() => { fetch('/health').then((r) => r.json()).then(setInfo).catch(() => setInfo(null)); }, []);
  return info;
}
export const isTestServer = (i: ServerInfo | null) => !!i?.sandbox_sms && i.env !== 'production';

/** Test server only: who to sign in as, and what each role can do. */
export function RoleCard({ onPick }: { onPick: (phone: string) => void }) {
  return (
    <div className="panel" style={{ marginTop: '1rem' }}>
      <h2>Test accounts</h2>
      <p className="muted">Test server only. No SMS is sent; the code is 123456. Customers use the Khidmat TEST app; everyone else signs in here.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Who</th><th>Can do</th><th /></tr></thead>
        <tbody>{ROLE_CARD.map((r) => (
          <tr key={r.phone}>
            <td>{r.who}<br /><span className="muted" dir="ltr">{r.phone}</span></td>
            <td>{r.can}</td>
            <td>{r.where === 'web' ? <button type="button" className="small" onClick={() => onPick(r.phone)}>Use</button> : <span className="muted">app</span>}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

export function Diagnostics() {
  const [list, setList] = useState(recentFailures());
  return (
    <section className="stack content" style={{ padding: '1rem' }}>
      <button className="link" onClick={() => history.back()}>Back</button>
      <h1>Diagnostics</h1>
      <p className="muted">Recent requests that failed in this browser tab. Quote the request id in a defect report.</p>
      {list.length === 0 && <p className="muted">No failed requests recorded.</p>}
      {list.length > 0 && (
        <div className="panel table-wrap"><table>
          <thead><tr><th>Time</th><th>Error</th><th>Request id</th><th>Page</th></tr></thead>
          <tbody>{list.map((e, i) => (
            <tr key={i}>
              <td>{new Date(e.at).toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi' })}</td>
              <td>{e.code} ({e.status || 'no reply'})<br /><span className="muted">{e.method} {maskIds(e.path)}</span></td>
              <td dir="ltr">{e.request_id ?? '—'}</td>
              <td>{maskIds(e.page)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {list.length > 0 && <button onClick={() => { clearDiagnostics(); setList([]); }}>Clear</button>}
    </section>
  );
}

/** Removes anything that looks like a phone number or an ID number from what the tester typed. */
const scrub = (s: string) => s.replace(/(\+?92|0)3\d{2}[\s-]?\d{7}/g, '[phone number removed]').replace(/\d{5}-\d{7}-\d/g, '[ID number removed]').replace(/\d{10,}/g, '[number removed]');

/**
 * Test server only. A draft defect report from safe facts (browser, page, role, time, last request id, booking
 * reference) plus the tester's words. Nothing is sent: the tester copies it and attaches a screenshot.
 */
export function Report({ roles, page }: { roles: string[]; page: string }) {
  const [what, setWhat] = useState('');
  const [expected, setExpected] = useState('');
  const [steps, setSteps] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const last = recentFailures()[0];
  const text = useMemo(() => {
    const now = new Date();
    return [
      `Title: ${scrub(what).split('\n')[0]!.slice(0, 80) || '(one line: what went wrong)'}`,
      'App: Khidmat provider and staff website (test server)',
      `Browser: ${navigator.userAgent.replace(/\s*\([^)]*\)\s*/, ' ').slice(0, 120)}`,
      `Phone model / Android version: (fill in)`,
      `Role: ${roles.join(', ') || '(signed out)'}`,
      `Page: ${maskIds(page)}`,
      `Booking ref: ${lastBookingRef() ?? '(none)'}`,
      `Last request id: ${last?.request_id ?? '(none)'}${last ? ` (${last.code}, ${last.method} ${maskIds(last.path)})` : ''}`,
      'Network: (office Wi-Fi / mobile data / weak signal)',
      `Time: ${now.toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })} PKT (${now.toISOString()})`,
      `Steps: ${scrub(steps) || '(1. … 2. … 3. …)'}`,
      `Expected result: ${scrub(expected) || '(fill in)'}`,
      `Actual result: ${scrub(what) || '(fill in)'}`,
      'Screenshot: (attach; cover any phone numbers or addresses)',
    ].join('\n');
  }, [what, expected, steps, roles, page, last]);

  // Clipboard and share APIs need HTTPS; phones on the office Wi-Fi use plain HTTP, so fall back to selecting the text.
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied('Copied. Paste it into WhatsApp, email or the defect sheet, then attach a screenshot.'); return; } catch { /* not available */ }
    box.current?.select();
    const ok = document.execCommand?.('copy');
    setCopied(ok ? 'Copied. Paste it, then attach a screenshot.' : 'The text is selected: use your phone\'s Copy, then paste it and attach a screenshot.');
  };

  return (
    <section className="stack content" style={{ padding: '1rem', maxWidth: 720 }}>
      <button className="link" onClick={() => history.back()}>Back</button>
      <h1>Report a problem</h1>
      <p className="muted">The draft adds the page, role, time, booking reference and last request id. It never adds phone numbers, addresses, documents or photos. Nothing is sent automatically.</p>
      <label className="field"><span className="field-label">What went wrong?</span><textarea rows={2} value={what} onChange={(e) => setWhat(e.target.value)} /></label>
      <label className="field"><span className="field-label">What did you expect?</span><textarea rows={2} value={expected} onChange={(e) => setExpected(e.target.value)} /></label>
      <label className="field"><span className="field-label">Steps (optional)</span><textarea rows={3} value={steps} onChange={(e) => setSteps(e.target.value)} /></label>
      <label className="field"><span className="field-label">Draft report</span><textarea ref={box} rows={14} dir="ltr" readOnly value={text} style={{ fontFamily: 'monospace', fontSize: '.85rem' }} /></label>
      <button className="primary" onClick={copy}>Copy the report</button>
      {copied && <p className="notice notice-ok" role="status">{copied}</p>}
    </section>
  );
}
