import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView } from 'react-native';
import { api, saveToken } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, Input, Notice, Row, T } from '@/lib/ui';
import { useSession } from '@/lib/session';

export default function SignIn() {
  const { t, lang, setLang } = useI18n();
  const { setSignedIn } = useSession();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 40 }} keyboardShouldPersistTaps="handled">
        <Row style={{ justifyContent: 'space-between', marginBottom: 24 }}>
          <T variant="title">{t('Sign in with your mobile number')}</T>
        </Row>
        <Input label={t('Mobile number')} hint="0300 1234567" keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber"
          value={phone} onChangeText={setPhone} editable={!sent} />
        {sent && (
          <>
            <T variant="muted">{t('We sent a 6-digit code to')} {phone}</T>
            <Input label={t('Code')} keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" maxLength={6} value={code} onChangeText={setCode} autoFocus />
          </>
        )}
        {error && <Notice kind="err" text={error} />}
        {!sent
          ? <Button title={t('Send code')} busy={busy} disabled={phone.length < 10} onPress={() => run(async () => { await api('POST', '/v1/auth/otp/request', { phone }); setSent(true); })} />
          : <>
              <Button title={t('Sign in')} busy={busy} disabled={code.length !== 6} onPress={() => run(async () => {
                const r = await api<{ token: string }>('POST', '/v1/auth/otp/verify', { phone, code });
                await saveToken(r.token);
                setSignedIn(true);
              })} />
              <Button kind="link" title={t('Change number')} onPress={() => { setSent(false); setCode(''); }} />
            </>}
        <Button kind="link" title={lang === 'ur' ? 'English' : 'اردو'} onPress={() => setLang(lang === 'ur' ? 'en' : 'ur')} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
