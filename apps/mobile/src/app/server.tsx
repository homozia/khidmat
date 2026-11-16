import * as Application from 'expo-application';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { apiUrl, CAN_CHANGE_SERVER, normaliseServerUrl, setServerUrl, VARIANT } from '@/lib/config';
import { useI18n } from '@/lib/i18n';
import { Button, Input, Notice, T } from '@/lib/ui';

/** Test builds only: point the app at the laptop running the API on the office Wi-Fi. */
export default function Server() {
  const { t } = useI18n();
  const [value, setValue] = useState(apiUrl());
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const url = normaliseServerUrl(value);
    if (!url) { setMsg({ kind: 'err', text: t('That address is not valid.') }); return; }
    setBusy(true); setMsg(null);
    try {
      const ctrl = new AbortController();
      const h = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(`${url}/health`, { signal: ctrl.signal }).finally(() => clearTimeout(h));
      if (!r.ok) throw new Error(String(r.status));
      await setServerUrl(url);
      setValue(url);
      setMsg({ kind: 'ok', text: t('Connected to the test server.') });
    } catch {
      setMsg({ kind: 'err', text: t('Could not reach the server. Check that the phone and laptop are on the same Wi-Fi and the server is running.') });
    } finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
      <T variant="small">{Application.applicationName} {Application.nativeApplicationVersion} ({Application.nativeBuildVersion}) · {Application.applicationId} · {VARIANT}</T>
      {CAN_CHANGE_SERVER ? (
        <>
          <Input label={t('Server address')} hint={t('The laptop address on the office Wi-Fi, for example 192.168.1.20')} autoCapitalize="none" autoCorrect={false}
            keyboardType="url" value={value} onChangeText={setValue} />
          {msg && <Notice kind={msg.kind} text={msg.text} />}
          <Button title={t('Save and test')} busy={busy} onPress={save} />
        </>
      ) : <T>{apiUrl()}</T>}
    </ScrollView>
  );
}
