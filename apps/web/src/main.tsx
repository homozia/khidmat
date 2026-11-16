import { StrictMode, useEffect, useState } from 'react';
import type { Me } from './lib/route.ts';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/noto-naskh-arabic/400.css';
import '@fontsource/noto-naskh-arabic/600.css';
import './styles.css';
import { get, hasToken, post, setToken } from './lib/api.ts';
import { I18nProvider, useI18n } from './lib/i18n.tsx';
import { Login } from './pages/Login.tsx';
import { ProviderApp } from './pages/provider.tsx';
import { AdminApp } from './pages/admin.tsx';
import { Diagnostics, isTestServer, Report, useServerInfo } from './pages/tools.tsx';

/** Small links on every page: diagnostics always, "Report a problem" on the test server only. */
function Footer({ test }: { test: boolean }) {
  return (
    <footer className="row" style={{ justifyContent: 'center', gap: '1.2rem', padding: '1.5rem 1rem 2rem' }}>
      {test && <a href="#/report">Report a problem</a>}
      <a href="#/diagnostics">Diagnostics</a>
    </footer>
  );
}

function useHash() {
  const [h, setH] = useState(location.hash);
  const [prev, setPrev] = useState('#/');
  useEffect(() => {
    const on = () => setH((cur) => { if (!['#/report', '#/diagnostics'].includes(cur)) setPrev(cur || '#/'); return location.hash; });
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return { hash: h, prev };
}

const STAFF = ['super_admin', 'dispatcher', 'finance', 'config_admin', 'verification'];

function Topbar({ me, onSignOut, mode, setMode }: { me: Me; onSignOut: () => void; mode: string; setMode: (m: string) => void }) {
  const { t, lang, setLang } = useI18n();
  const isStaff = me.roles.some((r) => STAFF.includes(r));
  const isProvider = me.roles.includes('provider');
  return (
    <header className="topbar">
      <a className="brand" href="#/">{import.meta.env.VITE_APP_NAME ?? 'Khidmat'}</a>
      {isStaff && isProvider && (
        <select aria-label="Workspace" value={mode} onChange={(e) => { setMode(e.target.value); window.location.hash = '#/'; }}>
          <option value="admin">Operations</option><option value="provider">Provider</option>
        </select>
      )}
      <span className="spacer" />
      <select aria-label={t('Language')} value={lang} onChange={(e) => setLang(e.target.value as 'en' | 'ur')}>
        <option value="en">English</option><option value="ur">اردو</option>
      </select>
      <button className="small" onClick={onSignOut}>{t('Sign out')}</button>
    </header>
  );
}

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(hasToken());
  const [mode, setMode] = useState('admin');
  const server = useServerInfo();
  const test = isTestServer(server);
  const { hash, prev } = useHash();

  const refresh = async () => {
    if (!hasToken()) { setMe(null); setChecking(false); return; }
    try {
      const m = await get<Me>('/v1/me');
      setMe(m);
      setMode(m.roles.some((r) => STAFF.includes(r)) ? 'admin' : 'provider');
    } catch { setMe(null); } finally { setChecking(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const signOut = async () => { await post('/v1/auth/logout').catch(() => undefined); setToken(null); setMe(null); window.location.hash = '#/'; };

  if (checking) return <p className="login muted">Loading…</p>;
  if (hash === '#/diagnostics') return <Diagnostics />;
  if (hash === '#/report' && test) return <Report roles={me?.roles ?? []} page={prev} />;
  if (!me) return <><Login onSignedIn={refresh} showRoles={test} /><Footer test={test} /></>;
  const isStaff = me.roles.some((r) => STAFF.includes(r));
  const isProvider = me.roles.includes('provider');
  if (!isStaff && !isProvider) {
    return (
      <div className="login panel">
        <h1>This site is for providers and staff</h1>
        <p>Customers book through the Khidmat Android app.</p>
        <button onClick={signOut}>Sign out</button>
      </div>
    );
  }
  return (
    <>
      <Topbar me={me} onSignOut={signOut} mode={mode} setMode={setMode} />
      {isStaff && mode === 'admin' ? <AdminApp me={me} /> : <ProviderApp />}
      <Footer test={test} />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><I18nProvider><App /></I18nProvider></StrictMode>,
);
