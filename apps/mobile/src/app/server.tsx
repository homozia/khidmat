import * as Application from 'expo-application';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView } from 'react-native';
import { apiUrl, CAN_CHANGE_SERVER, normaliseServerUrl, VARIANT } from '@/lib/config';
import { checkServer, HEALTH_HELP, type HealthResult } from '@/lib/health';
import { useI18n } from '@/lib/i18n';
import { switchServer } from '@/lib/server';
import { useSession } from '@/lib/session';
import { Button, C, Card, Input, Notice, Row, T } from '@/lib/ui';

/**
 * Test server: shows the address the app uses, checks the connection, and explains in plain words what to fix.
 * Changing the address signs the tester out of the old server first; unsent bookings stay with that server.
 */
export default function Server() {
  const { t } = useI18n();
  const { signedIn, setSignedIn } = useSession();
  const [current, setCurrent] = useState(apiUrl());
  const [check, setCheck] = useState<HealthResult | 'checking' | null>(null);
  const [value, setValue] = useState('');
  const [candidate, setCandidate] = useState<{ url: string; result: HealthResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recheck = useCallback(async () => { setCheck('checking'); setCheck(await checkServer(apiUrl())); }, []);
  useEffect(() => { void recheck(); }, [recheck]);

  const test = async () => {
    const url = normaliseServerUrl(value);
    if (!url) { setError(t('That address is not valid. Type it like 192.168.1.20')); setCandidate(null); return; }
    setError(null); setBusy(true);
    setCandidate({ url, result: await checkServer(url) });
    setBusy(false);
  };
  const use = async () => {
    if (!candidate) return;
    setBusy(true);
    await switchServer(candidate.url); // finishes any request on its way, ends the old session, then switches
    setBusy(false); setConfirm(false); setCurrent(candidate.url); setCandidate(null); setValue('');
    setSignedIn(false);
    void recheck();
    router.replace('/sign-in');
  };

  const Result = ({ r }: { r: HealthResult }) => r.ok
    ? <Notice kind="ok" text={`${t('Connected to the test server.')} (${r.ms} ms${r.info.sandbox_sms ? `, ${t('test sign-in codes')}` : ''})`} />
    : (
      <Card style={{ borderColor: C.bad }}>
        {HEALTH_HELP[r.reason].map((line, i) => <T key={i} style={i === 0 ? { fontWeight: '600', color: C.bad } : undefined}>{i === 0 ? '' : '• '}{t(line)}</T>)}
      </Card>
    );

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <T variant="small">{t('Server address in use')}</T>
      <T variant="h2" style={{ marginBottom: 6 }}>{current.replace(/^https?:\/\//, '')}</T>
      {check === 'checking' ? <Row><ActivityIndicator color={C.primary} /><T>{t('Checking the connection…')}</T></Row> : check && <Result r={check} />}
      <Button kind="secondary" title={t('Check again')} onPress={recheck} />

      {CAN_CHANGE_SERVER && (
        <Card style={{ marginTop: 16 }}>
          <T variant="h2">{t('Use a different server')}</T>
          <Input label={t('Server address')} hint={t('The laptop address shown when the test server starts, for example 192.168.1.20')} autoCapitalize="none" autoCorrect={false}
            keyboardType="url" value={value} onChangeText={(v) => { setValue(v); setCandidate(null); setConfirm(false); }} />
          {error && <Notice kind="err" text={error} />}
          <Button kind="secondary" title={t('Test this address')} busy={busy && !candidate} disabled={!value.trim()} onPress={test} />
          {candidate && <Result r={candidate.result} />}
          {candidate?.result.ok && (confirm || !signedIn
            ? <>
                {signedIn && <T>{t('You will be signed out of the current server. Bookings not yet sent stay with that server and come back when you switch back to it.')}</T>}
                <Button title={t('Use this server')} busy={busy} onPress={use} />
              </>
            : <Button title={t('Use this server')} onPress={() => setConfirm(true)} />)}
        </Card>
      )}

      <Card style={{ marginTop: 16 }}>
        <T variant="small">{t('App version')}</T>
        <T>{Application.applicationName} {Application.nativeApplicationVersion} ({Application.nativeBuildVersion})</T>
        <T variant="small">{Application.applicationId} · {VARIANT}</T>
      </Card>
      <Button kind="link" title={t('Diagnostics')} onPress={() => router.push('/diagnostics')} />
    </ScrollView>
  );
}
