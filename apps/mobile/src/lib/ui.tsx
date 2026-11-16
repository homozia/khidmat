import { createContext, useContext, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { STATUS_LABEL, useI18n } from './i18n';

export const C = {
  bg: '#F6F8FA', surface: '#FFFFFF', ink: '#172033', muted: '#5B6577', line: '#DDE2EA',
  primary: '#1F5C99', primarySoft: '#E6EEF7', wait: '#A86A12', waitSoft: '#FBF1E1', good: '#2F7D4F', goodSoft: '#E5F2EA', bad: '#B23A3A', badSoft: '#F8E6E6',
};

export function pkr(paisa: number | null | undefined) {
  const p = Number(paisa ?? 0);
  const abs = Math.abs(p);
  const frac = abs % 100;
  return `${p < 0 ? '-' : ''}Rs ${Math.floor(abs / 100).toLocaleString('en-US')}${frac ? '.' + String(frac).padStart(2, '0') : ''}`;
}
export function when(iso?: string | null) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-PK', { timeZone: 'Asia/Karachi', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** Direction-aware text and rows: Urdu reads right to left without restarting the app. */
export function T({ children, style, variant = 'body', numberOfLines }: { children: ReactNode; style?: object; variant?: 'title' | 'h2' | 'body' | 'muted' | 'small'; numberOfLines?: number }) {
  const { rtl } = useI18n();
  return <Text numberOfLines={numberOfLines} style={[s.text, s[variant], { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' }, style]}>{children}</Text>;
}
export function Row({ children, style, gap = 8 }: { children: ReactNode; style?: ViewStyle; gap?: number }) {
  const { rtl } = useI18n();
  return <View style={[{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap, flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function Button({ title, onPress, kind = 'primary', disabled, busy }: { title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'link'; disabled?: boolean; busy?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled || !!busy }} disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [s.btn, s[`btn_${kind}`], (disabled || busy) && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}>
      {busy ? <ActivityIndicator color={kind === 'primary' ? '#fff' : C.primary} /> : <Text style={[s.btnText, s[`btnText_${kind}`]]}>{title}</Text>}
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label: string; hint?: string; error?: string }) {
  const { rtl } = useI18n();
  const { label, hint, error, style, ...rest } = props;
  return (
    <View style={{ marginBottom: 14 }}>
      <T style={{ fontWeight: '500', marginBottom: 4 }}>{label}</T>
      <TextInput placeholderTextColor={C.muted} accessibilityLabel={label} {...rest}
        style={[s.input, { textAlign: rtl && !props.keyboardType ? 'right' : 'left' }, error ? { borderColor: C.bad } : null, style]} />
      {hint && !error && <T variant="small">{hint}</T>}
      {error && <T variant="small" style={{ color: C.bad }}>{error}</T>}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Notice({ kind, text }: { kind: 'ok' | 'err' | 'wait'; text: string }) {
  const bg = kind === 'ok' ? C.goodSoft : kind === 'err' ? C.badSoft : C.waitSoft;
  const fg = kind === 'ok' ? C.good : kind === 'err' ? C.bad : C.wait;
  return <View accessibilityLiveRegion="polite" style={{ backgroundColor: bg, padding: 10, borderRadius: 6, marginVertical: 8 }}><T style={{ color: fg }}>{text}</T></View>;
}

export function StatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  const tone = ['completed', 'closed'].includes(status) ? [C.goodSoft, C.good] : ['cancelled', 'no_provider'].includes(status) ? [C.badSoft, C.bad]
    : ['requested', 'awaiting_approval'].includes(status) ? [C.waitSoft, C.wait] : [C.primarySoft, C.primary];
  return <View style={{ backgroundColor: tone[0], borderRadius: 99, paddingHorizontal: 10, paddingVertical: 2, alignSelf: 'flex-start' }}><Text style={{ color: tone[1], fontWeight: '500', fontSize: 13 }}>{t(STATUS_LABEL[status] ?? status)}</Text></View>;
}

const RAIL = ['requested', 'assigned', 'en_route', 'on_site', 'in_progress', 'completed'];

/** Vertical journey: where the booking is now, what happened, what comes next. */
export function Journey({ status }: { status: string }) {
  const { t } = useI18n();
  const pos = status === 'awaiting_approval' ? 3 : status === 'closed' ? 6 : RAIL.indexOf(status);
  if (status === 'cancelled' || status === 'no_provider') return <Notice kind="err" text={t(STATUS_LABEL[status]!)} />;
  return (
    <View accessibilityLabel="Booking progress" style={{ marginVertical: 8 }}>
      {RAIL.map((st, i) => {
        const done = i < pos, now = i === pos;
        return (
          <Row key={st} gap={12} style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <View style={{ alignItems: 'center', width: 22 }}>
              <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: done || now ? C.primary : C.line, backgroundColor: done ? C.primary : C.surface }} />
              {i < RAIL.length - 1 && <View style={{ width: 3, height: 22, backgroundColor: done ? C.primary : C.line }} />}
            </View>
            <T style={{ color: now ? C.ink : C.muted, fontWeight: now ? '600' : '400', paddingTop: 0 }}>
              {t(STATUS_LABEL[st]!)}{now && status === 'awaiting_approval' ? ` · ${t('Awaiting approval')}` : ''}
            </T>
          </Row>
        );
      })}
    </View>
  );
}

/** Shared state: the customer's chosen location. */
export interface Place { lat?: number; lng?: number; locality_id?: string; label: string; source: 'gps' | 'manual_pin' | 'area'; zone?: { code: string; name_en: string; name_ur: string } }
const PlaceCtx = createContext<{ place: Place | null; setPlace: (p: Place | null) => void }>({ place: null, setPlace: () => undefined });
export function PlaceProvider({ children }: { children: ReactNode }) {
  const [place, setPlace] = useState<Place | null>(null);
  return <PlaceCtx.Provider value={{ place, setPlace }}>{children}</PlaceCtx.Provider>;
}
export const usePlace = () => useContext(PlaceCtx);

const s = StyleSheet.create({
  text: { color: C.ink, fontSize: 16, lineHeight: 24 },
  title: { fontSize: 24, lineHeight: 32, fontWeight: '600' },
  h2: { fontSize: 18, lineHeight: 26, fontWeight: '600' },
  body: {},
  muted: { color: C.muted },
  small: { fontSize: 13, lineHeight: 19, color: C.muted },
  btn: { minHeight: 50, borderRadius: 8, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', marginVertical: 4 },
  btn_primary: { backgroundColor: C.primary },
  btn_secondary: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  btn_danger: { backgroundColor: C.surface, borderWidth: 1, borderColor: '#E7C3C3' },
  btn_link: { minHeight: 36, paddingHorizontal: 0 },
  btnText: { fontSize: 16, fontWeight: '600' },
  btnText_primary: { color: '#fff' },
  btnText_secondary: { color: C.ink },
  btnText_danger: { color: C.bad },
  btnText_link: { color: C.primary, textDecorationLine: 'underline', fontWeight: '500' },
  input: { minHeight: 50, borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 12, fontSize: 16, backgroundColor: C.surface, color: C.ink },
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 16, marginBottom: 12 },
});
