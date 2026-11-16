import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView } from 'react-native';
import { api } from '@/lib/api';
import { useI18n, useName } from '@/lib/i18n';
import { Card, Notice, T, usePlace } from '@/lib/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function Category() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { t } = useI18n();
  const name = useName();
  const { place } = usePlace();
  const [cat, setCat] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!place) return;
    const q = place.locality_id ? `locality_id=${place.locality_id}` : `lat=${place.lat}&lng=${place.lng}`;
    api('GET', `/v1/catalogue?${q}`).then((r) => setCat(r.categories.find((c: any) => c.code === code))).catch((e) => setError(e.message));
  }, [code, place]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Stack.Screen options={{ title: cat ? name(cat) : '' }} />
      {error && <Notice kind="err" text={error} />}
      {cat?.jobs.map((j: any) => (
        <Pressable key={j.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/book/[jobId]', params: { jobId: j.id, code } })}>
          <Card>
            <T style={{ fontWeight: '600' }}>{name(j)}</T>
            <T variant="small">{j.booking_modes.includes('fixed') ? t('Fixed price') : j.booking_modes.includes('inspection') ? t('Inspection fee') : t('Price after inspection')}</T>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}
