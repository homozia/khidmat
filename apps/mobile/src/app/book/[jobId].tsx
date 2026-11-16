import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { api, ApiError, newKey, savePending, submitPending, type PendingBooking } from '@/lib/api';
import { useI18n, useName } from '@/lib/i18n';
import { Button, C, Card, Input, Notice, pkr, Row, T, usePlace } from '@/lib/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

const HOURS = [9, 10, 11, 12, 14, 15, 16, 17, 18];

function karachiDate(offsetDays: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date(Date.now() + offsetDays * 864e5));
}

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
  const [preview, setPreview] = useState<any>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: 'err' | 'wait' | 'ok'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder);

  useEffect(() => {
    if (!place) return;
    const q = place.locality_id ? `locality_id=${place.locality_id}` : `lat=${place.lat}&lng=${place.lng}`;
    api('GET', `/v1/catalogue?${q}`).then((r) => {
      const j = r.categories.find((c: any) => c.code === code)?.jobs.find((x: any) => x.id === jobId);
      setJob(j);
      if (j && !j.scheduled) setTiming('same_day');
    }).catch((e) => setMsg({ kind: 'err', text: e.message }));
  }, [jobId, code, place]);

  useEffect(() => {
    if (dest.q.trim().length < 2 || dest.picked) { setDestResults([]); return; }
    const h = setTimeout(() => api('GET', `/v1/places?q=${encodeURIComponent(dest.q)}`).then(setDestResults).catch(() => undefined), 250);
    return () => clearTimeout(h);
  }, [dest.q, dest.picked]);

  const needsDestination = code === 'driver';
  const body = useMemo(() => {
    if (!place || !job) return null;
    return {
      job_id: job.id, timing,
      ...(timing === 'scheduled' && { scheduled_start: `${karachiDate(day)}T${String(hour).padStart(2, '0')}:00:00+05:00` }),
      ...(place.locality_id ? { locality_id: place.locality_id } : { location: { lat: place.lat, lng: place.lng, source: place.source === 'gps' ? 'gps' : 'manual_pin' } }),
      address_line: address.trim(), ...(landmark.trim() && { landmark: landmark.trim() }),
      ...(needsDestination && dest.picked && { destination: { lat: dest.picked.lat, lng: dest.picked.lng, text: dest.text || name(dest.picked) } }),
      intake: Object.fromEntries(Object.entries(intake).filter(([, v]) => v !== '' && v !== undefined)),
    };
  }, [place, job, timing, day, hour, address, landmark, dest, intake, needsDestination, name]);

  const showError = (e: unknown) => {
    const err = e as ApiError;
    if (err.code === 'INVALID_INTAKE' && err.details) setErrors(err.details as Record<string, string>);
    setMsg({ kind: 'err', text: err.message });
  };

  const review = async () => {
    if (!body) return;
    setBusy(true); setMsg(null); setErrors({});
    try { setPreview(await api('POST', '/v1/bookings/preview', body)); } catch (e) { showError(e); } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!body) return;
    const pending: PendingBooking = {
      key: newKey(), body, saved_at: new Date().toISOString(),
      media: [...photos.map((p) => ({ ...p, kind: 'photo' as const })), ...(voice ? [{ ...voice, kind: 'voice' as const }] : [])],
    };
    await savePending(pending); // saved before sending: a dropped connection loses nothing
    setBusy(true); setMsg(null);
    try {
      const r = await submitPending(pending);
      router.replace({ pathname: '/bookings/[id]', params: { id: r.booking.id, ...(r.mediaFailed && { media: 'failed' }) } });
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'NETWORK') setMsg({ kind: 'wait', text: t('No connection. Your booking is saved on this phone.') });
      else showError(e);
    } finally { setBusy(false); }
  };

  const addPhoto = async (camera: boolean) => {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, allowsEditing: false };
    if (camera) {
      const p = await ImagePicker.requestCameraPermissionsAsync();
      if (!p.granted) return;
    }
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    const a = r.canceled ? null : r.assets[0];
    if (a) setPhotos([...photos, { uri: a.uri, type: a.mimeType ?? 'image/jpeg' }].slice(0, 3));
  };

  const toggleRecording = async () => {
    if (recState.isRecording) {
      await recorder.stop();
      if (recorder.uri) setVoice({ uri: recorder.uri, type: 'audio/mp4' });
      return;
    }
    const p = await requestRecordingPermissionsAsync();
    if (!p.granted) return;
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setTimeout(() => { if (recorder.isRecording) void toggleRecording(); }, 60_000); // voice notes are capped at 60 s
  };

  if (!place) return <View style={{ padding: 16 }}><Button title={t('Choose my area')} onPress={() => router.push('/location')} /></View>;
  if (!job) return <View style={{ padding: 16 }}>{msg && <Notice kind="err" text={msg.text} />}</View>;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: name(job) }} />
      <T variant="title">{name(job)}</T>
      <T variant="muted">{place.label}</T>

      {job.fields.length > 0 && <T variant="h2" style={{ marginTop: 16 }}>{t('Details')}</T>}
      {job.fields.map((f: any) => f.type === 'boolean' ? (
        <Row key={f.key} style={{ justifyContent: 'space-between', marginVertical: 8 }}>
          <T style={{ flex: 1 }}>{name(f, 'label')}</T>
          <Switch value={!!intake[f.key]} onValueChange={(v) => { setIntake({ ...intake, [f.key]: v }); setPreview(null); }} accessibilityLabel={name(f, 'label')} />
        </Row>
      ) : (
        <Input key={f.key} label={name(f, 'label')} error={errors[f.key]}
          keyboardType={f.type === 'text' ? 'default' : 'numeric'} multiline={f.type === 'text'}
          value={intake[f.key] === undefined ? '' : String(intake[f.key])}
          onChangeText={(v) => { setIntake({ ...intake, [f.key]: f.type === 'text' ? v : v === '' ? '' : Number(v) }); setPreview(null); }} />
      ))}

      <Input label={t('House, street and block')} value={address} onChangeText={(v) => { setAddress(v); setPreview(null); }} />
      <Input label={t('Nearby landmark (optional)')} value={landmark} onChangeText={setLandmark} />

      {needsDestination && (
        <Card>
          <T variant="h2">{t('Where to? (pickup is your location above)')}</T>
          <Input label={t('Destination area')} value={dest.picked ? name(dest.picked) : dest.q} onChangeText={(v) => setDest({ ...dest, q: v, picked: null })} />
          {destResults.map((p) => (
            <Pressable key={p.id} accessibilityRole="button" onPress={() => { setDest({ ...dest, picked: p }); setPreview(null); }}><T style={{ paddingVertical: 8, color: C.primary }}>{name(p)}, {name(p, 'city')}</T></Pressable>
          ))}
          <Input label={t('Destination address')} value={dest.text} onChangeText={(v) => setDest({ ...dest, text: v })} />
        </Card>
      )}

      <T variant="h2" style={{ marginTop: 8 }}>{t('When?')}</T>
      {job.same_day && <Button kind={timing === 'same_day' ? 'primary' : 'secondary'} title={t('Today, as soon as possible')} onPress={() => { setTiming('same_day'); setPreview(null); }} />}
      {job.scheduled && <Button kind={timing === 'scheduled' ? 'primary' : 'secondary'} title={t('Choose a time')} onPress={() => { setTiming('scheduled'); setPreview(null); }} />}
      {timing === 'scheduled' && (
        <>
          <Row>{[1, 2].map((d) => <Button key={d} kind={day === d ? 'primary' : 'secondary'} title={d === 1 ? t('Tomorrow') : t('Day after')} onPress={() => { setDay(d); setPreview(null); }} />)}</Row>
          <Row>{HOURS.map((h) => <Button key={h} kind={hour === h ? 'primary' : 'secondary'} title={`${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}`} onPress={() => { setHour(h); setPreview(null); }} />)}</Row>
        </>
      )}

      <T variant="h2" style={{ marginTop: 16 }}>{t('Photos and voice note (optional)')}</T>
      <Row>
        <Button kind="secondary" title={`${t('Add photo')} (${photos.length}/3)`} disabled={photos.length >= 3} onPress={() => addPhoto(true)} />
        <Button kind="secondary" title="🖼" disabled={photos.length >= 3} onPress={() => addPhoto(false)} />
        <Button kind={recState.isRecording ? 'danger' : 'secondary'} title={recState.isRecording ? `${t('Stop recording')} ${Math.round(recState.durationMillis / 1000)}s` : t('Record voice note')} onPress={toggleRecording} />
      </Row>
      {voice && <T variant="small">{t('Voice note added')}</T>}

      {msg && <Notice kind={msg.kind} text={msg.text} />}
      {!preview
        ? <Button title={t('Review')} busy={busy} disabled={address.trim().length < 3 || (needsDestination && !dest.picked)} onPress={review} />
        : (
          <Card style={{ marginTop: 12 }}>
            <T variant="h2">{t('Review')}</T>
            {preview.lines.length === 0 && <T variant="muted">{t('Price after inspection')}</T>}
            {preview.lines.map((l: any, i: number) => (
              <Row key={i} style={{ justifyContent: 'space-between' }}><T style={{ flex: 1 }}>{l.description}</T><T>{pkr(l.amount_paisa)}</T></Row>
            ))}
            <Row style={{ justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: C.line, marginTop: 6, paddingTop: 6 }}>
              <T style={{ fontWeight: '600' }}>{t('Total now')}</T><T style={{ fontWeight: '600' }}>{pkr(preview.totals.customer_total_paisa)}</T>
            </Row>
            <T variant="small" style={{ marginTop: 8 }}>{t('Pay the provider in cash after the work. Any extra cost needs your approval first.')}</T>
            <Button title={msg?.kind === 'wait' ? t('Send again') : t('Confirm booking')} busy={busy} onPress={confirm} />
          </Card>
        )}
    </ScrollView>
  );
}
