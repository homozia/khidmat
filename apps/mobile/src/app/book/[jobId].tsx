import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { OutboxCard } from '@/components/OutboxCard';
import { api, ApiError } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { useI18n, useName } from '@/lib/i18n';
import { createOutbox, loadOutbox, sendOutbox } from '@/lib/outbox';
import { Button, C, Card, Input, Notice, pkr, Row, T, usePlace } from '@/lib/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

const HOURS = [9, 10, 11, 12, 14, 15, 16, 17, 18];
const LINE_LABEL: Record<string, string> = { inspection_fee: 'Inspection fee', travel_charge: 'Travel charge', materials: 'Materials and parts' };

function karachiDate(offsetDays: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date(Date.now() + offsetDays * 864e5));
}

type Msg = { kind: 'err' | 'wait' | 'ok'; text: string; ref?: string | null };

/**
 * Booking form. Everything the form asks for comes from the catalogue API (fields, choices, whether a destination
 * is needed, visit-charge terms), so staff can change a service without an app release.
 * The price the customer confirms is the server's quote, bound to a signed token; if anything changes before
 * the booking is created the server refuses it and returns the new terms to approve.
 */
export default function Book() {
  const { jobId, code } = useLocalSearchParams<{ jobId: string; code: string }>();
  const { t } = useI18n();
  const name = useName();
  const { place } = usePlace();
  const [job, setJob] = useState<any>(null);
  const [intake, setIntake] = useState<Record<string, any>>({});
  const [address, setAddress] = useState('');
  const [landmark, setLandmark] = useState('');
  const [timing, setTiming] = useState<'same_day' | 'scheduled'>('scheduled');
  const [day, setDay] = useState(1);
  const [hour, setHour] = useState(10);
  const [dest, setDest] = useState<{ q: string; picked: any | null; text: string }>({ q: '', picked: null, text: '' });
  const [destResults, setDestResults] = useState<any[]>([]);
  const [photos, setPhotos] = useState<{ uri: string; type: string }[]>([]);
  const [voice, setVoice] = useState<{ uri: string; type: string } | null>(null);
  const [quote, setQuote] = useState<{ terms: any; price_token: string; location_precision: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<boolean | null>(null); // an earlier booking on this account is unfinished
  const [uncertain, setUncertain] = useState(false);
  const sending = useRef(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder);

  useEffect(() => { void loadOutbox().then((o) => setBlocked(!!o)); }, []);

  useEffect(() => {
    if (!place) return;
    const q = place.locality_id ? `locality_id=${place.locality_id}` : `lat=${place.lat}&lng=${place.lng}`;
    api('GET', `/v1/catalogue?${q}`).then((r) => {
      const j = r.categories.find((c: any) => c.code === code)?.jobs.find((x: any) => x.id === jobId);
      setJob(j ?? null);
      if (j && !j.scheduled) setTiming('same_day');
    }).catch((e) => setMsg({ kind: 'err', text: errorText(e, t) }));
  }, [jobId, code, place, t]);

  const needsDestination = !!job?.needs_destination;
  useEffect(() => {
    if (!needsDestination || dest.q.trim().length < 2 || dest.picked) { setDestResults([]); return; }
    const h = setTimeout(() => api('GET', `/v1/places?q=${encodeURIComponent(dest.q)}`).then(setDestResults).catch(() => undefined), 250);
    return () => clearTimeout(h);
  }, [dest.q, dest.picked, needsDestination]);

  const body = useMemo(() => {
    if (!place || !job) return null;
    return {
      job_id: job.id, timing,
      ...(timing === 'scheduled' && { scheduled_start: `${karachiDate(day)}T${String(hour).padStart(2, '0')}:00:00+05:00` }),
      ...(place.locality_id ? { locality_id: place.locality_id } : { location: { lat: place.lat, lng: place.lng, source: place.source === 'gps' ? 'gps' : 'manual_pin' } }),
      address_line: address.trim(), ...(landmark.trim() && { landmark: landmark.trim() }),
      ...(needsDestination && dest.picked && { destination: { lat: dest.picked.lat, lng: dest.picked.lng, text: dest.text.trim() || name(dest.picked) } }),
      intake: Object.fromEntries(Object.entries(intake).filter(([, v]) => v !== '' && v !== undefined)),
    };
  }, [place, job, timing, day, hour, address, landmark, dest, intake, needsDestination, name]);

  // Any edit invalidates the quote the customer saw.
  const edit = <A,>(fn: (a: A) => void) => (a: A) => { if (uncertain) return; fn(a); setQuote(null); };

  const showError = (e: unknown) => {
    const err = e as ApiError;
    if (err.code === 'INVALID_INTAKE' && err.details) setErrors(err.details as Record<string, string>);
    setMsg({ kind: 'err', text: errorText(e, t) });
  };

  const review = async () => {
    if (!body) return;
    setBusy(true); setMsg(null); setErrors({});
    try { setQuote(await api('POST', '/v1/bookings/preview', body)); } catch (e) { showError(e); } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!body || !quote || sending.current) return; // a second tap while sending does nothing
    sending.current = true;
    setBusy(true); setMsg({ kind: 'wait', text: t('Sending your booking…') });
    try {
      if (!uncertain) {
        await createOutbox({ ...body, price_token: quote.price_token },
          { job_name_en: job.name_en, job_name_ur: job.name_ur, total_paisa: quote.terms.total_paisa, scheduled_start: body.scheduled_start ?? null },
          [...photos.map((p) => ({ ...p, kind: 'photo' as const })), ...(voice ? [{ ...voice, kind: 'voice' as const }] : [])]);
      }
      const r = await sendOutbox();
      router.replace({ pathname: '/bookings/[id]', params: { id: r.booking.id, created: '1' } });
    } catch (e) {
      const err = e as ApiError;
      if (err.uncertain || err.code === 'REQUEST_IN_PROGRESS') {
        setUncertain(true);
        setMsg({ kind: 'wait', text: `${t('We could not confirm whether your booking was received.')} ${t('Check again to find out. You will not be booked twice.')}` });
      } else if (err.code === 'PRICE_CHANGED' || err.code === 'PRICE_CONFIRMATION_REQUIRED') {
        // Nothing was created. Show the server's new terms; the customer must approve them again.
        setUncertain(false);
        const d = err.details as any;
        setQuote(d?.terms && d?.price_token ? { terms: d.terms, price_token: d.price_token, location_precision: quote.location_precision } : null);
        setMsg({ kind: 'err', text: errorText(e, t) });
      } else {
        setUncertain(false);
        showError(e);
      }
    } finally { sending.current = false; setBusy(false); }
  };

  const addPhoto = async (camera: boolean) => {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, allowsEditing: false };
    if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) return;
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    const a = r.canceled ? null : r.assets[0];
    if (a) setPhotos((p) => [...p, { uri: a.uri, type: a.mimeType ?? 'image/jpeg' }].slice(0, 3));
  };

  const toggleRecording = async () => {
    if (recState.isRecording) {
      await recorder.stop();
      if (recorder.uri) setVoice({ uri: recorder.uri, type: 'audio/mp4' });
      return;
    }
    if (!(await requestRecordingPermissionsAsync()).granted) return;
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setTimeout(() => { if (recorder.isRecording) void toggleRecording(); }, 60_000); // voice notes are capped at 60 s
  };

  if (!place) return <View style={{ padding: 16 }}><Button title={t('Choose my area')} onPress={() => router.push('/location')} /></View>;
  if (blocked) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Notice kind="wait" text={t('Finish your previous booking first.')} />
        <OutboxCard onChange={() => void loadOutbox().then((o) => setBlocked(!!o))} />
      </ScrollView>
    );
  }
  if (!job) return <View style={{ padding: 16 }}>{msg && <Notice kind="err" text={msg.text} />}</View>;

  const terms = quote?.terms;
  const fieldInput = (f: any) => {
    const label = `${name(f, 'label')}${f.required ? '' : ` (${t('optional')})`}`;
    if (f.type === 'boolean') {
      return (
        <Row key={f.key} style={{ justifyContent: 'space-between', marginVertical: 8 }}>
          <T style={{ flex: 1 }}>{label}</T>
          <Switch value={!!intake[f.key]} onValueChange={edit((v: boolean) => setIntake({ ...intake, [f.key]: v }))} accessibilityLabel={name(f, 'label')} />
        </Row>
      );
    }
    if (f.type === 'select') {
      return (
        <View key={f.key} style={{ marginVertical: 8 }}>
          <T>{label}</T>
          <Row>{(f.options ?? []).map((o: any) => (
            <Button key={o.value} kind={intake[f.key] === o.value ? 'primary' : 'secondary'} title={name(o, 'label')}
              onPress={() => edit(() => setIntake({ ...intake, [f.key]: o.value }))(undefined)} />
          ))}</Row>
          {errors[f.key] && <T variant="small" style={{ color: C.bad }}>{errors[f.key]}</T>}
        </View>
      );
    }
    return (
      <Input key={f.key} label={label} error={errors[f.key]}
        keyboardType={f.type === 'text' ? 'default' : 'numeric'} multiline={f.type === 'text'}
        value={intake[f.key] === undefined ? '' : String(intake[f.key])}
        onChangeText={edit((v: string) => setIntake({ ...intake, [f.key]: f.type === 'text' ? v : v === '' ? '' : Number(v) }))} />
    );
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: name(job) }} />
      <T variant="title">{name(job)}</T>
      <T variant="muted">{place.label}</T>
      {name(job, 'description') ? <T variant="muted">{name(job, 'description')}</T> : null}

      {job.requires_authorization_check && (
        <Notice kind="wait" text={t('Before opening a lock, the locksmith must check that you live there: photo ID with this address, a bill or tenancy agreement for this address, or the guard or a neighbour confirming it. If this cannot be checked, the work does not go ahead and the visit charge applies.')} />
      )}

      {job.fields.length > 0 && <T variant="h2" style={{ marginTop: 16 }}>{t('Details')}</T>}
      {job.fields.map(fieldInput)}

      <Input label={t('House, street and block')} value={address} onChangeText={edit(setAddress)} />
      <Input label={t('Nearby landmark (optional)')} value={landmark} onChangeText={edit(setLandmark)} />

      {needsDestination && (
        <Card>
          <T variant="h2">{t('Where to? (pickup is your location above)')}</T>
          <Input label={t('Destination area')} value={dest.picked ? name(dest.picked) : dest.q} onChangeText={edit((v: string) => setDest({ ...dest, q: v, picked: null }))} />
          {destResults.map((p) => (
            <Pressable key={p.id} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}
              onPress={() => edit(() => setDest({ ...dest, picked: p }))(undefined)}>
              <T style={{ color: C.primary }}>{name(p)}, {name(p, 'city')}</T>
            </Pressable>
          ))}
          <Input label={t('Destination address')} value={dest.text} onChangeText={edit((v: string) => setDest({ ...dest, text: v }))} />
        </Card>
      )}

      <T variant="h2" style={{ marginTop: 8 }}>{t('When?')}</T>
      {job.same_day && <Button kind={timing === 'same_day' ? 'primary' : 'secondary'} title={t('Today, as soon as possible')} onPress={() => edit(() => setTiming('same_day'))(undefined)} />}
      {job.scheduled && <Button kind={timing === 'scheduled' ? 'primary' : 'secondary'} title={t('Choose a time')} onPress={() => edit(() => setTiming('scheduled'))(undefined)} />}
      {timing === 'scheduled' && (
        <>
          <Row>{[1, 2].map((d) => <Button key={d} kind={day === d ? 'primary' : 'secondary'} title={d === 1 ? t('Tomorrow') : t('Day after')} onPress={() => edit(() => setDay(d))(undefined)} />)}</Row>
          <Row>{HOURS.map((h) => <Button key={h} kind={hour === h ? 'primary' : 'secondary'} title={`${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}`} onPress={() => edit(() => setHour(h))(undefined)} />)}</Row>
        </>
      )}

      <T variant="h2" style={{ marginTop: 16 }}>{t('Photos and voice note (optional)')}</T>
      <Row>
        <Button kind="secondary" title={`${t('Add photo')} (${photos.length}/3)`} disabled={photos.length >= 3 || uncertain} onPress={() => addPhoto(true)} />
        <Button kind="secondary" title="🖼" disabled={photos.length >= 3 || uncertain} onPress={() => addPhoto(false)} />
        <Button kind={recState.isRecording ? 'danger' : 'secondary'} disabled={uncertain} title={recState.isRecording ? `${t('Stop recording')} ${Math.round(recState.durationMillis / 1000)}s` : t('Record voice note')} onPress={toggleRecording} />
      </Row>
      {voice && <T variant="small">{t('Voice note added')}</T>}

      {msg && <Notice kind={msg.kind} text={msg.text} />}
      {!terms
        ? <Button title={t('Review')} busy={busy} disabled={address.trim().length < 3 || (needsDestination && !dest.picked)} onPress={review} />
        : (
          <Card style={{ marginTop: 12 }}>
            <T variant="h2">{t('Review')}</T>
            {terms.price_lines.length === 0 && <T variant="muted">{t('Price after inspection')}</T>}
            {terms.price_lines.map((l: any, i: number) => (
              <Row key={i} style={{ justifyContent: 'space-between' }}>
                <T style={{ flex: 1 }}>{LINE_LABEL[l.charge_type] ? t(LINE_LABEL[l.charge_type]) : i === 0 ? name(job) : l.description}{l.quantity > 1 ? ` × ${l.quantity}` : ''}</T>
                <T>{pkr(l.amount_paisa)}</T>
              </Row>
            ))}
            <Row style={{ justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: C.line, marginTop: 6, paddingTop: 6 }}>
              <T style={{ fontWeight: '600' }}>{t('Total now')}</T><T style={{ fontWeight: '600' }}>{pkr(terms.total_paisa)}</T>
            </Row>
            {terms.visit_charge_paisa > 0 && (
              <Row style={{ justifyContent: 'space-between' }}><T style={{ flex: 1 }}>{t('Visit charge if the work cannot go ahead')}</T><T>{pkr(terms.visit_charge_paisa)}</T></Row>
            )}
            <T variant="small" style={{ marginTop: 8 }}>
              {quote!.location_precision === 'area_centre'
                ? t('Approximate location: the centre of your area. The provider will call you to confirm the exact address.')
                : t('Location from your phone. The provider will use the address you typed.')}
            </T>
            <T variant="small">{t('Cancellation')}: {t('Free cancellation before the provider arrives.')}</T>
            <T variant="small" style={{ marginTop: 4 }}>{t('Pay the provider in cash after the work. Any extra cost needs your approval first.')}</T>
            <Button title={uncertain ? t('Check again') : t('Confirm booking')} busy={busy} onPress={confirm} />
          </Card>
        )}
    </ScrollView>
  );
}
