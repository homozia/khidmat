import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadToken, saveToken } from '@/lib/api';
import { I18nProvider, useI18n } from '@/lib/i18n';
import { C, PlaceProvider } from '@/lib/ui';
import { SessionCtx, useSession } from '@/lib/session';


function Screens() {
  const { t } = useI18n();
  const { signedIn } = useSession();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: C.surface }, headerTintColor: C.ink, contentStyle: { backgroundColor: C.bg } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" options={{ title: t('Khidmat') }} />
        <Stack.Screen name="location" options={{ title: t('Your location') }} />
        <Stack.Screen name="category/[code]" options={{ title: '' }} />
        <Stack.Screen name="book/[jobId]" options={{ title: t('Book') }} />
        <Stack.Screen name="bookings/index" options={{ title: t('My bookings') }} />
        <Stack.Screen name="bookings/[id]" options={{ title: '' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ title: t('Khidmat') }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => { void loadToken().then((tk) => { setSignedIn(!!tk); setReady(true); }); }, []);
  const signOut = async () => { await saveToken(null); setSignedIn(false); };
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
