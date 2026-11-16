import * as Application from 'expo-application';
import { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, Share } from 'react-native';
import { apiUrl, VARIANT } from '@/lib/config';
import { currentBookingRef, currentScreen, loadDiagnostics, type DiagEntry } from '@/lib/diagnostics';
import { useI18n } from '@/lib/i18n';
import { Button, Card, Input, Notice, T } from '@/lib/ui';

/** Removes anything that looks like a phone number or a long id number from what the tester typed. */
export function scrub(text: string) {
  return text
    .replace(/(\+?92|0)3\d{2}[\s-]?\d{7}/g, '[phone number removed]')
    .replace(/\d{5}-\d{7}-\d/g, '[ID number removed]')
    .replace(/\d{10,}/g, '[number removed]');
}

/**
 * TEST app only. Builds a draft defect report from a fixed list of safe facts (app version, phone model, screen,
 * time, last request id, booking reference) plus what the tester types. Nothing is sent automatically: the tester
 * copies or shares the draft and attaches a screenshot themselves. Never included: sign-in tokens, phone numbers,
 * addresses, identity documents or booking photos.
 */
export default function Report() {
  const { t, lang } = useI18n();
  const [what, setWhat] = useState('');
  const [expected, setExpected] = useState('');
  const [steps, setSteps] = useState('');
  const [last, setLast] = useState<DiagEntry | null>(null);
  const [shared, setShared] = useState(false);
  const screen = currentScreen();
  const ref = currentBookingRef();
  useEffect(() => { void loadDiagnostics().then((l) => setLast(l[0] ?? null)); }, []);

  const report = useMemo(() => {
    const c = (Platform.constants ?? {}) as { Model?: string; Manufacturer?: string; Release?: string };
    const now = new Date();
    return [
      `Title: ${scrub(what).split('\n')[0]!.slice(0, 80) || '(one line: what went wrong)'}`,
      `App version: ${Application.applicationName} ${Application.nativeApplicationVersion} (${Application.nativeBuildVersion}), ${VARIANT}`,
      `Phone model: ${[c.Manufacturer, c.Model].filter(Boolean).join(' ') || '(fill in)'}`,
      `Android version: ${c.Release ?? '?'} (API ${String(Platform.Version)})`,
      'Role: customer (Khidmat TEST app)',
      `Language: ${lang === 'ur' ? 'Urdu' : 'English'}`,
      `Screen: ${screen || '(fill in)'}`,
      `Booking ref: ${ref ?? '(none)'}`,
      `Last request id: ${last?.request_id ?? '(none)'}${last ? ` (${last.code}, ${last.method} ${last.path.replace(/[0-9a-f-]{36}/g, '…')})` : ''}`,
      `Server: ${apiUrl().replace(/^https?:\/\//, '')}`,
      'Network: (office Wi-Fi / mobile data / weak signal / airplane mode toggled)',
      `Time: ${now.toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })} PKT (${now.toISOString()})`,
      `Steps: ${scrub(steps) || '(1. … 2. … 3. …)'}`,
      `Expected result: ${scrub(expected) || '(fill in)'}`,
      `Actual result: ${scrub(what) || '(fill in)'}`,
      'Screenshot: (attach; cover any phone numbers or addresses)',
    ].join('\n');
  }, [what, expected, steps, last, screen, ref, lang]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <T variant="muted">{t('Describe the problem. The app adds the version, phone, screen, time and booking reference. It never adds phone numbers, addresses or photos.')}</T>
      <Input label={t('What went wrong?')} multiline value={what} onChangeText={setWhat} />
      <Input label={t('What did you expect?')} multiline value={expected} onChangeText={setExpected} />
      <Input label={t('Steps (optional)')} multiline value={steps} onChangeText={setSteps} />
      <T variant="h2" style={{ marginTop: 8 }}>{t('Draft report')}</T>
      <Card><T selectable style={{ fontFamily: Platform.OS === 'android' ? 'monospace' : undefined, fontSize: 13 }}>{report}</T></Card>
      <Button title={t('Copy or share the report')} onPress={async () => { await Share.share({ message: report }); setShared(true); }} />
      {shared && <Notice kind="ok" text={t('Now attach a screenshot in the app you shared to. Nothing was sent by Khidmat.')} />}
    </ScrollView>
  );
}
