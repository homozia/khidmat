import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { ApiError } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { useI18n } from '@/lib/i18n';
import { discardOutbox, loadOutbox, onOutboxChange, removeFile, replaceFile, retryFile, sendOutbox, type Outbox, type OutboxMedia } from '@/lib/outbox';
import { Button, C, Card, ltr, Notice, pkr, Row, T, when } from '@/lib/ui';

/** Plain words for each file state and the most common upload errors. */
const STATE: Record<OutboxMedia['state'], string> = { pending: 'Waiting to send', uploading: 'Sending…', uploaded: 'Sent', failed: 'Not sent' };
const FILE_ERROR: Record<string, string> = {
  FILE_TYPE_NOT_ALLOWED: 'This file type cannot be sent. Replace it with a photo.',
  UNSUPPORTED_MEDIA: 'This file type cannot be sent. Replace it with a photo.',
  FILE_TOO_LARGE: 'This file is too large. Replace it with a smaller photo.',
  EMPTY_FILE: 'This file is empty. Replace it or remove it.',
  TOO_MANY_FILES: 'This booking already has the most files allowed. Remove this one.',
  BOOKING_FINISHED: 'The booking is finished, so files can no longer be added. Remove this one.',
  FILE_MISSING: 'The file is no longer on this phone. Replace it or remove it.',
  NETWORK: 'No connection. It will be sent when you tap "Send files".',
  TIMEOUT: 'The server took too long. Tap "Send files" to try again.',
};

/**
 * The unfinished booking for this account on this server, with a clear state:
 * saved but not sent, being sent, result unknown, or received with files still to send.
 * "Check again" re-sends the same saved request, so it can only ever produce the one booking.
 */
export function OutboxCard({ onChange, bookingId }: { onChange?: () => void; bookingId?: string }) {
  const { t, lang } = useI18n();
  const [o, setO] = useState<Outbox | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const load = useCallback(async () => setO(await loadOutbox()), []);
  useEffect(() => { void load(); return onOutboxChange(() => { void load(); }); }, [load]);

  if (!o || (bookingId && o.booking?.id !== bookingId)) return null;
  const created = !!o.booking;
  const sending = busy || o.status === 'sending';

  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await sendOutbox();
      onChange?.();
      if (!created) router.push({ pathname: '/bookings/[id]', params: { id: r.booking.id } });
    } catch (e) {
      setErr(errorText(e, t));
      onChange?.();
      if ((e as ApiError).code?.startsWith('PRICE_')) router.push('/');
    } finally { setBusy(false); }
  };
  const replace = async (m: OutboxMedia) => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    const a = r.canceled ? null : r.assets[0];
    if (a) await replaceFile(m.ref, { uri: a.uri, type: a.mimeType ?? 'image/jpeg', kind: 'photo' });
  };
  const discard = async () => { await discardOutbox(); setConfirmDiscard(false); onChange?.(); };

  const headline = created ? `${t('Booking received')}: ${ltr(o.booking!.ref)}`
    : sending ? t('Sending your booking…')
    : o.status === 'uncertain' ? t('We could not confirm whether your booking was received.')
    : t('Your booking is saved on this phone and has not been sent yet.');

  return (
    <Card style={{ borderColor: created ? C.line : C.wait, borderWidth: 2 }}>
      <Row>{sending && <ActivityIndicator color={C.primary} />}<T style={{ fontWeight: '600', flex: 1 }}>{headline}</T></Row>
      <T variant="muted">{lang === 'ur' ? o.summary.job_name_ur : o.summary.job_name_en}{o.summary.scheduled_start ? ` · ${when(o.summary.scheduled_start)}` : ''}{o.summary.total_paisa != null ? ` · ${pkr(o.summary.total_paisa)}` : ''}</T>
      {!created && o.status === 'uncertain' && <T variant="small">{t('Check again to find out. You will not be booked twice.')}</T>}

      {o.media.length > 0 && (
        <View style={{ marginTop: 8 }} accessibilityLabel={t('Photos and voice note')}>
          {o.media.map((m, i) => (
            <View key={m.ref} style={{ paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T>{m.kind === 'voice' ? t('Voice note') : `${t('Photo')} ${o.media.filter((x, j) => x.kind === 'photo' && j <= i).length}`}</T>
                <T style={{ color: m.state === 'failed' ? C.bad : m.state === 'uploaded' ? C.good : C.muted }}>{t(STATE[m.state])}</T>
              </Row>
              {m.error && m.state !== 'uploaded' && <T variant="small">{t(FILE_ERROR[m.error.code] ?? (m.error.permanent ? 'The server refused this file. Replace it or remove it.' : 'It will be sent when you tap "Send files".'))}</T>}
              {m.state === 'failed' && created && (
                <Row>
                  {m.kind === 'photo' && <Button kind="secondary" title={t('Replace')} onPress={() => replace(m)} />}
                  {!m.error?.permanent && <Button kind="secondary" title={t('Try again')} onPress={() => retryFile(m.ref)} />}
                  <Button kind="secondary" title={t('Remove')} onPress={() => removeFile(m.ref)} />
                </Row>
              )}
            </View>
          ))}
        </View>
      )}

      {err && <Notice kind="err" text={err} />}
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
          {(!created || o.media.some((m) => m.state === 'pending')) && (
            <Button title={created ? t('Send files') : o.status === 'uncertain' ? t('Check again') : t('Send now')} busy={sending} onPress={send} />
          )}
          {created
            ? <Button kind="secondary" title={t('View booking')} disabled={sending} onPress={() => router.push({ pathname: '/bookings/[id]', params: { id: o.booking!.id } })} />
            : <Button kind="secondary" title={t('Discard it')} disabled={sending} onPress={() => (o.status === 'ready' ? discard() : setConfirmDiscard(true))} />}
        </Row>
      )}
    </Card>
  );
}
