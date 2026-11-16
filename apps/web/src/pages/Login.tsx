import { useState } from 'react';
import { post, setToken } from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Field, Notice, useAction } from '../lib/ui.tsx';

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const { t, lang, setLang } = useI18n();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const a = useAction();

  return (
    <div className="login">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <h1>{t('Sign in')}</h1>
        <select aria-label={t('Language')} style={{ width: 'auto' }} value={lang} onChange={(e) => setLang(e.target.value as 'en' | 'ur')}>
          <option value="en">English</option><option value="ur">اردو</option>
        </select>
      </div>
      <form className="panel" onSubmit={async (e) => {
        e.preventDefault();
        if (!sent) {
          if (await a.run(() => post('/v1/auth/otp/request', { phone }))) setSent(true);
        } else {
          await a.run(async () => {
            const r = await post<{ token: string }>('/v1/auth/otp/verify', { phone, code });
            setToken(r.token);
            onSignedIn();
          });
        }
      }}>
        <Field label={t('Mobile number')} hint="03XX XXXXXXX">
          <input inputMode="tel" autoComplete="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={sent} required />
        </Field>
        {sent && (
          <Field label={t('Enter the 6-digit code')}>
            <input inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={6} pattern="\d{6}" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
          </Field>
        )}
        <Notice msg={a.msg} />
        <div className="row">
          <button className="primary" type="submit" disabled={a.busy}>{sent ? t('Verify and sign in') : t('Send code')}</button>
          {sent && <button type="button" className="link" onClick={() => { setSent(false); setCode(''); a.clear(); }}>{t('Use a different number')}</button>}
        </div>
      </form>
    </div>
  );
}
