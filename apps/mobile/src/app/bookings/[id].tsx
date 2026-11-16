import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView } from 'react-native';
import { OutboxCard } from '@/components/OutboxCard';
import { api } from '@/lib/api';
import { setCurrentBookingRef } from '@/lib/diagnostics';
import { errorText } from '@/lib/errors';
import { useI18n, useName } from '@/lib/i18n';
import { Button, C, Card, Input, Journey, ltr, Notice, pkr, Row, StatusPill, T, when } from '@/lib/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** One plain sentence per status: what happens next, and what (if anything) the customer should do. */
const NEXT_STEP: Record<string, string> = {
  requested: 'We are finding a provider. Their name will appear here, usually within 30 minutes.',
  assigned: 'A provider has accepted. They will mark "On the way" when they leave.',
  en_route: 'Your provider is on the way.',
  on_site: 'Your provider has arrived.',
  awaiting_approval: 'Your provider sent a new price. Approve or decline it below.',
  in_progress: 'Work is in progress. Pay the provider in cash when it is finished.',
  completed: 'Check the receipt, then tap "I paid in cash".',
  closed: 'This booking is finished. You can rate the work or make a complaint.',
  cancelled: 'This booking is cancelled. You can book again from the home screen.',
  no_provider: 'We could not find a provider for this time. Call us or choose another time.',
};

const COMPLAINT_TYPES: [string, string][] = [['quality', 'Quality'], ['price', 'Price'], ['conduct', 'Behaviour'], ['damage', 'Damage'], ['no_show', 'Did not come'], ['other', 'Other']];

export default function BookingScreen() {
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const { t } = useI18n();
  const name = useName();
  const [b, setB] = useState<any>(null);
  const [receipt, setReceipt] = useState<any>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'wait'; text: string; ref?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(0);
  const [complaint, setComplaint] = useState<{ open: boolean; category: string; text: string }>({ open: false, category: 'quality', text: '' });
  const [cancelReason, setCancelReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api('GET', `/v1/bookings/${id}`);
      setB(d);
      setCurrentBookingRef(d.ref);
      if (['completed', 'closed'].includes(d.status)) setReceipt(await api('GET', `/v1/bookings/${id}/receipt`));
    } catch (e) { setMsg({ kind: 'err', text: errorText(e, t) }); }
  }, [id, t]);
  useEffect(() => { void load(); const h = setInterval(load, 20000); return () => clearInterval(h); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); if (ok) setMsg({ kind: 'ok', text: ok }); await load(); } catch (e) { setMsg({ kind: 'err', text: errorText(e, t) }); } finally { setBusy(false); }
  };

  if (!b) return <ScrollView contentContainerStyle={{ padding: 16 }}>{msg && <Notice kind={msg.kind} text={msg.text} />}</ScrollView>;
  const open = b.quotes.find((q: any) => q.status === 'sent');
  const canCancel = ['requested', 'assigned', 'en_route', 'no_provider'].includes(b.status);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      <Stack.Screen options={{ title: b.ref }} />
      <Row style={{ justifyContent: 'space-between' }}><T variant="title" style={{ flex: 1 }}>{name(b.job)}</T><StatusPill status={b.status} /></Row>
      <T variant="muted">{when(b.scheduled_start)}</T>
      {msg && <Notice kind={msg.kind} text={msg.text} />}
      {created === '1' && <Notice kind="ok" text={`${t('Booking received')}: ${ltr(b.ref)}`} />}
      <Card style={{ backgroundColor: C.primarySoft, borderColor: C.primarySoft }}>
        <T variant="small">{t('What happens next')}</T>
        <T>{t(NEXT_STEP[b.status] ?? '')}</T>
      </Card>
      <OutboxCard bookingId={b.id} />
      <Journey status={b.status} />

      {b.provider && <Card><T variant="small">{t('Your provider')}</T><T style={{ fontWeight: '600' }}>{b.provider.name}{b.provider.rating ? `  ★ ${b.provider.rating}` : ''}</T></Card>}

      {open && (
        <Card style={{ borderColor: C.wait, borderWidth: 2 }}>
          <T variant="h2">{t('New price to approve')}</T>
          {open.note && <T variant="muted">{open.note}</T>}
          {open.lines.map((l: any, i: number) => <Row key={i} style={{ justifyContent: 'space-between' }}><T style={{ flex: 1 }}>{l.description}</T><T>{pkr(l.amount_paisa)}</T></Row>)}
          <Row style={{ justifyContent: 'space-between', marginTop: 6 }}><T style={{ fontWeight: '600' }}>{t('Total')}</T><T style={{ fontWeight: '600' }}>{pkr(open.lines.reduce((s: number, l: any) => s + l.amount_paisa, 0))}</T></Row>
          <Row>
            <Button title={t('Approve')} busy={busy} onPress={() => act(() => api('POST', `/v1/quotes/${open.id}/approve`))} />
            <Button kind="danger" title={t('Decline')} disabled={busy} onPress={() => act(() => api('POST', `/v1/quotes/${open.id}/decline`))} />
          </Row>
        </Card>
      )}

      {receipt && (
        <Card>
          <T variant="h2">{t('Receipt')}</T>
          {([['Labour', receipt.labour_paisa], ['Materials and parts', receipt.materials_paisa], ['Visit and travel', receipt.visit_travel_paisa], ['Tolls and parking', receipt.reimbursements_paisa]] as [string, number][])
            .filter(([, v]) => v > 0).map(([k, v]) => <Row key={k} style={{ justifyContent: 'space-between' }}><T>{t(k)}</T><T>{pkr(v)}</T></Row>)}
          <Row style={{ justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6, marginTop: 6 }}><T style={{ fontWeight: '600' }}>{t('Total')}</T><T style={{ fontWeight: '600' }}>{pkr(receipt.total_paisa)}</T></Row>
          {receipt.refunded_paisa > 0 && <Row style={{ justifyContent: 'space-between' }}><T>{t('Refunded')}</T><T>-{pkr(receipt.refunded_paisa)}</T></Row>}
          {receipt.refund_owed_paisa > 0 && <Row style={{ justifyContent: 'space-between' }}><T>{t('Refund owed to you')}</T><T>{pkr(receipt.refund_owed_paisa)}</T></Row>}
          <T variant="small" style={{ marginTop: 6 }}>{receipt.payment_status === 'provider_reported' ? t('Cash payment: waiting for your confirmation') : t('Cash payment confirmed')}</T>
          <T variant="small">{b.ref} · {when(receipt.completed_at)}</T>
        </Card>
      )}
      {receipt?.payment_status === 'provider_reported' && <Button title={t('I paid in cash')} busy={busy} onPress={() => act(() => api('POST', `/v1/bookings/${id}/confirm-payment`))} />}

      {['completed', 'closed'].includes(b.status) && !b.review && (
        <Card>
          <T variant="h2">{t('Rate the work')}</T>
          <Row>{[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n}`} onPress={() => setRating(n)} style={{ padding: 6 }}>
              <T style={{ fontSize: 30, lineHeight: 36, color: n <= rating ? C.wait : C.line }}>★</T>
            </Pressable>
          ))}</Row>
          <Button title={t('Send rating')} disabled={!rating} busy={busy} onPress={() => act(() => api('POST', `/v1/bookings/${id}/review`, { rating }))} />
        </Card>
      )}

      {(b.complaints ?? []).map((c: any) => (
        <Card key={c.id}><T style={{ fontWeight: '600' }}>{t('Your complaint')}: {c.status.replace('_', ' ')}</T><T variant="muted">{c.description}</T>{c.resolution_note && <T>{c.resolution_note}</T>}</Card>
      ))}
      {!['requested'].includes(b.status) && !(b.complaints ?? []).some((c: any) => ['open', 'under_review'].includes(c.status)) && (
        complaint.open ? (
          <Card>
            <T variant="h2">{t('What went wrong?')}</T>
            <Row>{COMPLAINT_TYPES.map(([k, l]) => <Button key={k} kind={complaint.category === k ? 'primary' : 'secondary'} title={t(l)} onPress={() => setComplaint({ ...complaint, category: k })} />)}</Row>
            <Input label={t('Details')} multiline value={complaint.text} onChangeText={(v) => setComplaint({ ...complaint, text: v })} />
            <Button title={t('Send complaint')} disabled={complaint.text.trim().length < 5} busy={busy} onPress={() => act(() => api('POST', `/v1/bookings/${id}/complaints`, { category: complaint.category, description: complaint.text.trim() }))} />
          </Card>
        ) : <Button kind="link" title={t('Make a complaint')} onPress={() => setComplaint({ ...complaint, open: true })} />
      )}

      {canCancel && (cancelOpen ? (
        <Card>
          <T variant="small">{t('Free cancellation before the provider arrives.')}</T>
          <Input label={t('Reason for cancelling')} value={cancelReason} onChangeText={setCancelReason} />
          <Row>
            <Button kind="danger" title={t('Cancel booking')} disabled={cancelReason.trim().length < 2} busy={busy} onPress={() => act(() => api('POST', `/v1/bookings/${id}/cancel`, { reason: cancelReason.trim() }))} />
            <Button kind="secondary" title={t('Keep booking')} onPress={() => setCancelOpen(false)} />
          </Row>
        </Card>
      ) : <Button kind="link" title={t('Cancel this booking')} onPress={() => setCancelOpen(true)} />)}
    </ScrollView>
  );
}
