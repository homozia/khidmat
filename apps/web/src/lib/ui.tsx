import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError } from './api.ts';
import { STATUS_LABEL, useI18n } from './i18n.tsx';

export function pkr(paisa: number | null | undefined): string {
  const p = Number(paisa ?? 0);
  const abs = Math.abs(p);
  const whole = Math.floor(abs / 100).toLocaleString('en-PK');
  const frac = abs % 100;
  return `${p < 0 ? '−' : ''}Rs ${whole}${frac ? '.' + String(frac).padStart(2, '0') : ''}`;
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-PK', { timeZone: 'Asia/Karachi', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    .format(new Date(iso));
}

/** Loads data and re-loads on demand. Errors are shown, not swallowed. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); setError(null); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, deps);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load };
}

/** Wraps an action: disables the button while it runs and reports the result. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); if (ok) setMsg({ kind: 'ok', text: ok }); return true; }
    catch (e) {
      const err = e as ApiError;
      const details = err.details && typeof err.details === 'object' ? ' ' + Object.entries(err.details as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`).join('; ') : '';
      setMsg({ kind: 'err', text: err.message + details }); return false;
    } finally { setBusy(false); }
  };
  return { busy, msg, run, clear: () => setMsg(null) };
}

export function Notice({ msg }: { msg: { kind: 'ok' | 'err'; text: string } | null }) {
  if (!msg) return null;
  return <p className={`notice notice-${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</p>;
}

export function Loading({ error, loading }: { error: string | null; loading: boolean }) {
  if (error) return <p className="notice notice-err" role="alert">{error}</p>;
  if (loading) return <p className="muted">Loading…</p>;
  return null;
}

export function StatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  return <span className={`pill pill-${status}`}>{t(STATUS_LABEL[status] ?? status)}</span>;
}

const RAIL = ['requested', 'assigned', 'en_route', 'on_site', 'in_progress', 'completed', 'closed'];

/** The booking journey. Awaiting approval sits between on site and in progress. */
export function JourneyRail({ status }: { status: string }) {
  const { t } = useI18n();
  const stopped = status === 'cancelled' || status === 'no_provider';
  const pos = status === 'awaiting_approval' ? RAIL.indexOf('on_site') : RAIL.indexOf(status);
  return (
    <div className="rail-wrap">
      <ol className={`rail ${stopped ? 'rail-stopped' : ''}`} aria-label="Booking progress">
        {RAIL.map((s, i) => (
          <li key={s} className={i < pos ? 'done' : i === pos ? 'now' : ''} aria-current={i === pos ? 'step' : undefined}>
            <span className="dot" aria-hidden="true" />
            <span className="lbl">{t(STATUS_LABEL[s]!)}</span>
          </li>
        ))}
      </ol>
      {status === 'awaiting_approval' && <p className="rail-note">{t('Waiting for the customer to approve')}</p>}
      {stopped && <p className="rail-note rail-note-bad">{t(STATUS_LABEL[status]!)}</p>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><p className="empty-title">{title}</p>{children && <p className="muted">{children}</p>}</div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}
