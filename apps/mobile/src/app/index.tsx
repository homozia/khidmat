import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { api, clearPending, getPending, submitPending, type PendingBooking } from '@/lib/api';
import { useI18n, useName } from '@/lib/i18n';
import { Button, C, Card, Notice, Row, T, usePlace } from '@/lib/ui';
import { useSession } from '@/lib/session';

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function Home() {
  const { t, lang, setLang } = useI18n();
  const name = useName();
  const { place } = usePlace();
  const { signOut } = useSession();
  const [cats, setCats] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingBooking | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setPending(await getPending());
    if (!place) return;
    const q = place.locality_id ? `locality_id=${place.locality_id}` : `lat=${place.lat}&lng=${place.lng}`;
    try { setCats((await api('GET', `/v1/catalogue?${q}`)).categories); setError(null); } catch (e) { setError((e as Error).message); }
  }, [place]);
  useEffect(() => { void load(); }, [load]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      {pending && (
        <Card style={{ borderColor: C.wait }}>
          <T style={{ fontWeight: '600' }}>{t('You have a booking that was not sent')}</T>
          <Row>
            <Button title={t('Send again')} busy={sending} onPress={async () => {
              setSending(true);
              try { const r = await submitPending(pending); setPending(null); router.push(`/bookings/${r.booking.id}`); }
              catch (e) { setError((e as Error).message); } finally { setSending(false); }
            }} />
            <Button kind="secondary" title={t('Discard')} onPress={async () => { await clearPending(); setPending(null); }} />
          </Row>
        </Card>
      )}
      <Pressable accessibilityRole="button" onPress={() => router.push('/location')}>
        <Card>
          <T variant="small">{t('Your location')}</T>
          <Row style={{ justifyContent: 'space-between' }}>
            <T style={{ fontWeight: '600' }}>{place ? `${place.label}${place.zone ? ` · ${name(place.zone)}` : ''}` : t('Choose my area')}</T>
            <T style={{ color: C.primary }}>{t('Change')}</T>
          </Row>
        </Card>
      </Pressable>
      {error && <Notice kind="err" text={error} />}
      {place && <T variant="title" style={{ marginVertical: 8 }}>{t('What do you need?')}</T>}
      <Row gap={10}>
        {cats?.map((c) => (
          <Pressable key={c.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/category/[code]', params: { code: c.code } })}
            style={({ pressed }) => [{ width: '48%', minHeight: 84, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 14, justifyContent: 'center' }, pressed && { borderColor: C.primary }]}>
            <T style={{ fontWeight: '600' }}>{name(c)}</T>
            <T variant="small">{c.jobs.length} {t('services')}</T>
          </Pressable>
        ))}
      </Row>
      <View style={{ height: 24 }} />
      <Button kind="secondary" title={t('My bookings')} onPress={() => router.push('/bookings')} />
      <Row style={{ justifyContent: 'space-between', marginTop: 8 }}>
        <Button kind="link" title={lang === 'ur' ? 'English' : 'اردو'} onPress={() => setLang(lang === 'ur' ? 'en' : 'ur')} />
        <Button kind="link" title={t('Sign out')} onPress={signOut} />
      </Row>
    </ScrollView>
  );
}
