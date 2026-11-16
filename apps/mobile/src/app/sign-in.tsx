import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView } from 'react-native';
import { api, saveSession } from '@/lib/api';
import { apiUrl, CAN_CHANGE_SERVER } from '@/lib/config';
import { errorText } from '@/lib/errors';
import { checkServer, type HealthResult } from '@/lib/health';
import { TEST_CODE_HINT, TEST_CUSTOMERS } from '@/lib/testAccounts';
import { useI18n } from '@/lib/i18n';
import { Button, C, Card, Input, ltr, Notice, Row, T } from '@/lib/ui';
import { useSession } from '@/lib/session';

export default function SignIn() {
  const { t, lang, setLang } = useI18n();
  const { setSignedIn } = useSession();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string } | null>(null);
  const [server, setServer] = useState<HealthResult | null>(null);
  useEffect(() => { void checkServer(apiUrl(), 6000).then(setServer); }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError({ text: errorText(e, t) }); } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 40 }} keyboardShouldPersistTaps="handled">
        <Row style={{ justifyContent: 'space-between', marginBottom: 24 }}>
          <T variant="title">{t('Sign in with your mobile number')}</T>
        </Row>
        {CAN_CHANGE_SERVER && server && !server.ok && (
          <Card style={{ borderColor: C.bad }}>
            <T style={{ fontWeight: '600' }}>{t('The app cannot reach the test server.')}</T>
            <Button title={t('Open Test server')} onPress={() => router.push('/server')} />
          </Card>
        )}
        <Input label={t('Mobile number')} hint="0300 1234567" keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber"
          value={phone} onChangeText={setPhone} editable={!sent} />
        {sent && (
          <>
            <T variant="muted">{t('We sent a 6-digit code to')} {ltr(phone)}</T>
            <Input label={t('Code')} keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" maxLength={6} value={code} onChangeText={setCode} autoFocus />
          </>
        )}
        {error && <Notice kind="err" text={error.text} />}
        {!sent
          ? <Button title={t('Send code')} busy={busy} disabled={phone.length < 10} onPress={() => run(async () => { await api('POST', '/v1/auth/otp/request', { phone }); setSent(true); })} />
          : <>
              <Button title={t('Sign in')} busy={busy} disabled={code.length !== 6} onPress={() => run(async () => {
                const r = await api<{ token: string; userId: string }>('POST', '/v1/auth/otp/verify', { phone, code });
                await saveSession(r.token, r.userId);
                setSignedIn(true);
              })} />
              <Button kind="link" title={t('Change number')} onPress={() => { setSent(false); setCode(''); }} />
            </>}
        {CAN_CHANGE_SERVER && server?.ok && server.info.sandbox_sms && !sent && (
          <Card>
            <T variant="h2">{t('Test accounts')}</T>
            <T variant="small">{t('Test server only. No SMS is sent; the code is')} {TEST_CODE_HINT}.</T>
            {TEST_CUSTOMERS.map((a) => (
              <Button key={a.phone} kind="secondary" title={`${ltr(a.phone)} · ${lang === 'ur' ? a.name_ur : a.name_en}`} onPress={() => setPhone(a.phone)} />
            ))}
            <T variant="small">{t('Provider and staff accounts sign in on the website. See the role card in PHONE_TEST_CHECKLIST.md.')}</T>
          </Card>
        )}
        <Button kind="link" title={lang === 'ur' ? 'English' : 'اردو'} onPress={() => setLang(lang === 'ur' ? 'en' : 'ur')} />
        {CAN_CHANGE_SERVER && (
          <>
            <Button kind="link" title={`${t('Test server')}: ${ltr(apiUrl().replace(/^https?:\/\//, ''))}`} onPress={() => router.push('/server')} />
            <T variant="small">{t('TEST BUILD')}</T>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
