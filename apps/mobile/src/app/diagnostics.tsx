import * as Application from 'expo-application';
import { useEffect, useState } from 'react';
import { ScrollView, Switch } from 'react-native';
import { apiUrl, CAN_CHANGE_SERVER, VARIANT } from '@/lib/config';
import { armedFault, armFault, clearDiagnostics, loadDiagnostics, type DiagEntry } from '@/lib/diagnostics';
import { useI18n } from '@/lib/i18n';
import { Button, C, Card, Notice, Row, T } from '@/lib/ui';
import { useServerInfo } from '@/lib/useServerInfo';

/**
 * Developer details, kept off the normal screens: recent failed requests with the server's request id
 * (quote it in a defect report), plus, in the TEST app only, controls to reproduce a lost reply.
 */
export default function Diagnostics() {
  const { t } = useI18n();
  const info = useServerInfo();
  const [list, setList] = useState<DiagEntry[]>([]);
  const [fault, setFault] = useState(armedFault());
  useEffect(() => { void loadDiagnostics().then((l) => setList([...l])); }, []);
  const toggle = (f: 'booking' | 'upload') => (on: boolean) => { armFault(on ? f : null); setFault(armedFault()); };
  const testControls = CAN_CHANGE_SERVER && info?.test_faults;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Card>
        <T>{Application.applicationName} {Application.nativeApplicationVersion} ({Application.nativeBuildVersion}) · {VARIANT}</T>
        <T variant="small">{apiUrl().replace(/^https?:\/\//, '')}</T>
      </Card>

      {testControls && (
        <Card style={{ borderColor: C.wait }}>
          <T variant="h2">{t('Test controls')}</T>
          <T variant="small">{t('For testing only. The server saves the next booking (or file) normally, then drops its reply, as if the connection broke at the worst moment. The app should show "result unknown" and "Check again" should find the same booking.')}</T>
          <Row style={{ justifyContent: 'space-between' }}>
            <T style={{ flex: 1 }}>{t('Drop the reply to my next booking')}</T>
            <Switch value={fault === 'booking'} onValueChange={toggle('booking')} accessibilityLabel={t('Drop the reply to my next booking')} />
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <T style={{ flex: 1 }}>{t('Drop the reply to my next photo upload')}</T>
            <Switch value={fault === 'upload'} onValueChange={toggle('upload')} accessibilityLabel={t('Drop the reply to my next photo upload')} />
          </Row>
          {fault && <Notice kind="wait" text={t('Armed: it applies once, to the next one only.')} />}
        </Card>
      )}

      <T variant="h2" style={{ marginTop: 12 }}>{t('Recent problems')}</T>
      {list.length === 0 && <T variant="muted">{t('No failed requests recorded.')}</T>}
      {list.map((e, i) => (
        <Card key={i}>
          <T style={{ fontWeight: '600' }}>{e.code} · {e.status || t('no reply')}</T>
          <T variant="small">{new Date(e.at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })} · {e.method} {e.path.replace(/[0-9a-f-]{36}/g, '…')}</T>
          {e.request_id && <T variant="small" style={{ color: C.ink }}>{t('Request id')}: {e.request_id}</T>}
          {e.screen && <T variant="small">{t('Screen')}: {e.screen}</T>}
        </Card>
      ))}
      {list.length > 0 && <Button kind="secondary" title={t('Clear')} onPress={async () => { await clearDiagnostics(); setList([]); }} />}
    </ScrollView>
  );
}
