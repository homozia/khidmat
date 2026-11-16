import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import type { ApiError } from '@/lib/api';
import { errorText, supportRef } from '@/lib/errors';
import { useI18n } from '@/lib/i18n';
import { discardOutbox, loadOutbox, sendOutbox, type Outbox } from '@/lib/outbox';
import { Button, C, Card, Notice, pkr, Row, T, when } from '@/lib/ui';

/**
 * Shows an unfinished booking for the signed-in account and lets the customer finish it.
 * "Check again" re-sends the same saved request, so it can only ever produce the one booking.
 */
export function OutboxCard({ onChange }: { onChange?: () => void }) {
  const { t, lang } = useI18n();
  const [o, setO] = useState<Outbox | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; ref: string | null } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const load = useCallback(async () => setO(await loadOutbox()), []);
  useEffect(() => { void load(); }, [load]);

  if (!o) return null;
  const created = !!o.booking;
  const pendingFiles = o.media.filter((m) => !m.uploaded).length;

  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await sendOutbox();
      await load(); onChange?.();
      router.push({ pathname: '/bookings/[id]', params: { id: r.booking.id } });
    } catch (e) {
      setErr({ text: errorText(e, t), ref: supportRef(e) });
      await load(); onChange?.();
      if ((e as ApiError).code?.startsWith('PRICE_')) router.push('/');
    } finally { setBusy(false); }
  };
  const discard = async () => { await discardOutbox(); setConfirmDiscard(false); await load(); onChange?.(); };

  return (
    <Card style={{ borderColor: C.wait, borderWidth: 2 }}>
      <T style={{ fontWeight: '600' }}>
        {created ? t('Booking received. Some files have not been sent yet.')
          : o.status === 'uncertain' ? t('We could not confirm whether your booking was received.')
          : t('Your booking is saved on this phone and has not been sent yet.')}
      </T>
      <T variant="muted">{lang === 'ur' ? o.summary.job_name_ur : o.summary.job_name_en}{o.summary.scheduled_start ? ` · ${when(o.summary.scheduled_start)}` : ''}{o.summary.total_paisa != null ? ` · ${pkr(o.summary.total_paisa)}` : ''}</T>
      {o.status === 'uncertain' && <T variant="small">{t('Check again to find out. You will not be booked twice.')}</T>}
      {created && <T variant="small">{o.booking!.ref} · {pendingFiles}</T>}
      {err && <Notice kind="err" text={err.text} />}
      {(err?.ref ?? o.last_error?.request_id) && <T variant="small">{t('Support reference')}: {err?.ref ?? o.last_error?.request_id}</T>}
      {confirmDiscard ? (
        <>
          <T>{t('If the server already received it, the booking will still go ahead. Discard anyway?')}</T>
          <Row>
            <Button kind="danger" title={t('Yes, discard')} onPress={discard} />
            <Button kind="secondary" title={t('Keep it')} onPress={() => setConfirmDiscard(false)} />
          </Row>
        </>
      ) : (
        <Row>
          <Button title={created ? t('Send files') : o.status === 'uncertain' ? t('Check again') : t('Send again')} busy={busy} onPress={send} />
          <Button kind="secondary" title={created ? t('Skip the files') : t('Discard it')} disabled={busy}
            onPress={() => (created || o.status === 'ready' ? discard() : setConfirmDiscard(true))} />
        </Row>
      )}
    </Card>
  );
}
