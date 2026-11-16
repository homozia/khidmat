import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { useI18n, useName } from '@/lib/i18n';
import { Button, C, Card, Input, Notice, T, usePlace } from '@/lib/ui';

/**
 * Where is the job? GPS when allowed; otherwise the customer picks their area from our own
 * list (English, Urdu or Roman Urdu names). Works without any map service.
 */
export default function ChooseLocation() {
  const { t } = useI18n();
  const name = useName();
  const { setPlace } = usePlace();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'err' | 'wait'; text: string } | null>(null);
  const [nearby, setNearby] = useState<any[] | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const h = setTimeout(() => { api('GET', `/v1/places?q=${encodeURIComponent(q)}`).then(setResults).catch(() => setResults([])); }, 250);
    return () => clearTimeout(h);
  }, [q]);

  const check = async (input: { lat?: number; lng?: number; locality_id?: string }, label: string, source: 'gps' | 'area') => {
    setBusy(true); setMsg(null); setNearby(null);
    try {
      const r = await api('POST', '/v1/coverage/resolve', input);
      if (r.status === 'outside') { setNearby(r.nearby); setMsg({ kind: 'err', text: t('We do not serve this area yet') }); return; }
      setPlace({ ...input, label, source, zone: r.zone });
      router.back();
    } catch (e) { setMsg({ kind: 'err', text: errorText(e, t) }); } finally { setBusy(false); }
  };

  const useGps = async () => {
    setBusy(true); setMsg(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') { setMsg({ kind: 'wait', text: t('Location is off. Choose your area from the list instead.') }); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setBusy(false);
      await check({ lat: pos.coords.latitude, lng: pos.coords.longitude }, t('Use my location'), 'gps');
    } catch {
      setMsg({ kind: 'wait', text: t('Location is off. Choose your area from the list instead.') });
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Button title={t('Use my location')} onPress={useGps} busy={busy} />
      {msg && <Notice kind={msg.kind} text={msg.text} />}
      {nearby && nearby.length > 0 && <T variant="muted">{t('Areas we serve nearby:')} {nearby.map((z) => name(z)).join(', ')}</T>}
      <View style={{ height: 16 }} />
      <Input label={t('Choose my area')} placeholder={t('Search area, e.g. G-10 or Satellite Town')} value={q} onChangeText={setQ} autoCorrect={false} />
      <FlatList data={results} keyExtractor={(r) => r.id} keyboardShouldPersistTaps="handled" renderItem={({ item }) => (
        <Pressable accessibilityRole="button" onPress={() => check({ locality_id: item.id }, `${name(item)}, ${name(item, 'city')}`, 'area')}>
          <Card style={{ paddingVertical: 12 }}>
            <T style={{ fontWeight: '600' }}>{name(item)}</T>
            <T variant="small">{name(item, 'city')}</T>
          </Card>
        </Pressable>
      )} ItemSeparatorComponent={() => <View style={{ height: 0, backgroundColor: C.line }} />} />
    </View>
  );
}
