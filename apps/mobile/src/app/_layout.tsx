import { router, Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadSession, setSignedOutHandler, signOutEverywhere } from '@/lib/api';
import { settleCurrentWork } from '@/lib/outbox';
import { CAN_CHANGE_SERVER, loadServerUrl } from '@/lib/config';
import { loadDiagnostics, setCurrentScreen } from '@/lib/diagnostics';
import { I18nProvider, useI18n } from '@/lib/i18n';
import { C, PlaceProvider } from '@/lib/ui';
import { SessionCtx, useSession } from '@/lib/session';

/** TEST app only: a "Report" button on every screen opens a draft defect report. */
function ReportButton() {
  const { t } = useI18n();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('Report a problem')} onPress={() => router.push('/report')}
      style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 8, justifyContent: 'center' }}>
      <Text style={{ color: C.primary, fontWeight: '600' }}>{t('Report')}</Text>
    </Pressable>
  );
}

function Screens() {
  const { t } = useI18n();
  const { signedIn } = useSession();
  const path = usePathname();
  useEffect(() => { if (!['/report', '/diagnostics'].includes(path)) setCurrentScreen(path); }, [path]);
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: C.surface }, headerTintColor: C.ink, contentStyle: { backgroundColor: C.bg },
      ...(CAN_CHANGE_SERVER && { headerRight: () => <ReportButton /> }) }}>
      <Stack.Protected guard={signedIn} redirectTo="/sign-in">
        <Stack.Screen name="index" options={{ title: t('Khidmat') }} />
        <Stack.Screen name="location" options={{ title: t('Your location') }} />
        <Stack.Screen name="category/[code]" options={{ title: '' }} />
        <Stack.Screen name="book/[jobId]" options={{ title: t('Book') }} />
        <Stack.Screen name="bookings/index" options={{ title: t('My bookings') }} />
        <Stack.Screen name="bookings/[id]" options={{ title: '' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn} redirectTo="/">
        <Stack.Screen name="sign-in" options={{ title: t('Khidmat') }} />
      </Stack.Protected>
      <Stack.Screen name="server" options={{ title: t('Test server') }} />
      <Stack.Screen name="diagnostics" options={{ title: t('Diagnostics') }} />
      <Stack.Screen name="report" options={{ title: t('Report a problem'), headerRight: () => null }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    setSignedOutHandler(() => setSignedIn(false));
    void (async () => { await loadServerUrl(); await loadDiagnostics(); setSignedIn(!!(await loadSession())); setReady(true); })();
  }, []);
  // Ends the server session when online and always removes this phone's credentials.
  const signOut = async () => { await settleCurrentWork(); await signOutEverywhere(); setSignedIn(false); };
  if (!ready) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={C.primary} /></View>;
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <PlaceProvider>
          <SessionCtx.Provider value={{ signedIn, setSignedIn, signOut }}>
            <StatusBar style="dark" />
            <Screens />
          </SessionCtx.Provider>
        </PlaceProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
