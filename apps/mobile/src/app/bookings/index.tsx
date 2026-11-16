import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { useI18n, useName } from '@/lib/i18n';
import { Card, Notice, Row, StatusPill, T, when } from '@/lib/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function MyBookings() {
  const { t } = useI18n();
  const name = useName();
  const [list, setList] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api('GET', '/v1/bookings').then((r) => { setList(r); setError(null); }).catch((e) => setError(errorText(e, t))); }, [t]);
  useFocusEffect(load);
  return (
    <View style={{ flex: 1, padding: 16 }}>
      {error && <Notice kind="err" text={error} />}
      <FlatList data={list ?? []} keyExtractor={(b) => b.id} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
        ListEmptyComponent={list ? <View style={{ padding: 24 }}><T style={{ fontWeight: '600', textAlign: 'center' }}>{t('No bookings yet')}</T><T variant="muted" style={{ textAlign: 'center' }}>{t('Book a service from the home screen.')}</T></View> : undefined}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/bookings/[id]', params: { id: item.id } })}>
            <Card>
              <Row style={{ justifyContent: 'space-between' }}><T style={{ fontWeight: '600', flex: 1 }}>{name(item, 'job_name')}</T><StatusPill status={item.status} /></Row>
              <T variant="small">{item.ref} · {when(item.scheduled_start)}</T>
            </Card>
          </Pressable>
        )} />
    </View>
  );
}
