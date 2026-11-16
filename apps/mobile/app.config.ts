import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * One codebase, four builds. APP_VARIANT picks the name, package id, server and network rules.
 *   fieldtest  → "Khidmat TEST", pk.khidmat.customer.fieldtest, plain HTTP allowed (laptop on office Wi-Fi), server set in the app
 *   staging    → "Khidmat STAGING", pk.khidmat.customer.staging, HTTPS only, EXPO_PUBLIC_API_URL required
 *   production → "Khidmat", pk.khidmat.customer, HTTPS only, EXPO_PUBLIC_API_URL required
 *   development (default) → Metro / Expo Go
 * Test, staging and production can be installed side by side because their package ids differ.
 */
const VERSION = '0.4.1';
const VERSION_CODE = Number(process.env.KHIDMAT_VERSION_CODE ?? 5);

type Variant = 'development' | 'fieldtest' | 'staging' | 'production';
const variant = (process.env.APP_VARIANT ?? 'development') as Variant;
// Also inlined into the JavaScript bundle (web previews do not embed `extra`).
process.env.EXPO_PUBLIC_APP_VARIANT = variant;
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
if ((variant === 'staging' || variant === 'production') && !apiUrl.startsWith('https://')) {
  throw new Error(`${variant} builds need EXPO_PUBLIC_API_URL set to an https:// address`);
}

const NAMES: Record<Variant, string> = { development: 'Khidmat DEV', fieldtest: 'Khidmat TEST', staging: 'Khidmat STAGING', production: 'Khidmat' };
const SUFFIX: Record<Variant, string> = { development: '.dev', fieldtest: '.fieldtest', staging: '.staging', production: '' };
const cleartext = variant === 'fieldtest' || variant === 'development';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: NAMES[variant],
  slug: 'khidmat',
  version: VERSION,
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  scheme: variant === 'production' ? 'khidmat' : `khidmat-${variant}`,
  ios: { supportsTablet: true, bundleIdentifier: `pk.khidmat.customer${SUFFIX[variant]}` },
  android: {
    package: `pk.khidmat.customer${SUFFIX[variant]}`,
    versionCode: VERSION_CODE,
    adaptiveIcon: {
      backgroundColor: variant === 'production' ? '#E6F4FE' : '#FBF1E1',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'RECORD_AUDIO', 'CAMERA'],
    blockedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
  },
  web: { favicon: './assets/favicon.png', output: 'single' },
  plugins: [
    'expo-router',
    ['expo-location', { locationWhenInUsePermission: 'Khidmat uses your location to find services near you and send the provider to the right place.' }],
    ['expo-image-picker', { photosPermission: 'Choose photos of the problem to show the provider.', cameraPermission: 'Take photos of the problem to show the provider.' }],
    ['expo-audio', { microphonePermission: 'Record a short voice note describing the problem.' }],
    'expo-secure-store',
    'expo-localization',
    // Plain HTTP is permitted only in the field-test and development builds; staging and production refuse it.
    ['expo-build-properties', { android: { minSdkVersion: 24, usesCleartextTraffic: cleartext } }],
    './plugins/with-release-signing',
  ],
  experiments: { typedRoutes: false },
  extra: { supportsRTL: true, variant, apiUrl },
});
