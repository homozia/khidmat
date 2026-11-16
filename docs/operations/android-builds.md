# Android builds

The customer app has four variants, chosen by `APP_VARIANT` in `apps/mobile/app.config.ts`. They use different package ids, so they can be installed side by side.

| Variant | App name | Package id | Server | Plain HTTP |
|---|---|---|---|---|
| `fieldtest` | Khidmat TEST | `pk.khidmat.customer.fieldtest` | Set in the app (**Test server**). The optional `EXPO_PUBLIC_API_URL` pre-fills it. | Allowed (laptop on office Wi-Fi) |
| `staging` | Khidmat STAGING | `pk.khidmat.customer.staging` | `EXPO_PUBLIC_API_URL`, must be `https://` | Refused |
| `production` | Khidmat | `pk.khidmat.customer` | `EXPO_PUBLIC_API_URL`, must be `https://` | Refused |
| `development` (default) | Khidmat DEV | `pk.khidmat.customer.dev` | Metro or Expo Go | Allowed |

Version: `version` in `app.config.ts` (currently 0.4.0). Android `versionCode` comes from `KHIDMAT_VERSION_CODE` (default 4). **Raise it for every APK you hand out**, otherwise phones refuse to install it as an update. Minimum Android is 7.0 (API 24).

## Signing

`plugins/with-release-signing.js` adds a release signing config that reads these values at build time:

| Variable | Meaning |
|---|---|
| `KHIDMAT_KEYSTORE_PATH` | Path to the keystore (.jks or .p12) |
| `KHIDMAT_KEYSTORE_PASSWORD` | Keystore password |
| `KHIDMAT_KEY_ALIAS` | Key alias |
| `KHIDMAT_KEY_PASSWORD` | Key password |

The keystore and its passwords are never committed (`*.jks` and `*.keystore` are git-ignored) and are not in the source zip. Without them, a release build falls back to the debug key; the CI workflow detects that and fails.

The field-test key is only for test APKs. Use a separate Play Console upload key for production.

## Path 1: GitHub Actions (used for M4)

1. Push the repository to GitHub as a private repository.
2. Add repository secrets (Settings → Secrets and variables → Actions):
   - `KHIDMAT_KEYSTORE_BASE64`: `base64 -w0 upload.jks`
   - `KHIDMAT_KEYSTORE_PASSWORD`, `KHIDMAT_KEY_ALIAS`, `KHIDMAT_KEY_PASSWORD`
   - Optional variable `KHIDMAT_TEST_API_URL` (for example `http://192.168.1.20:3000`).
3. Go to Actions → **Field-test APK** → Run workflow, and enter the version code.
4. Download the `khidmat-m4-field-test` artifact. It contains:
   - `khidmat-m4-field-test.apk`
   - `khidmat-m4-field-test.apk.sha256`
   - `apksigner.txt`: the certificate and the v2 scheme result
   - `badging.txt`: package, version, minSdk and label
   - `bundle.txt`: proof that `assets/index.android.bundle` is inside the APK

## Path 2: Local Gradle (Android Studio machine)

Requirements: JDK 17, Android SDK (platform 37, build-tools), Node 22.18+.

```
npm ci
export KHIDMAT_KEYSTORE_PATH=/secure/place/upload.jks KHIDMAT_KEYSTORE_PASSWORD=… KHIDMAT_KEY_ALIAS=khidmat-fieldtest KHIDMAT_KEY_PASSWORD=…
export KHIDMAT_VERSION_CODE=5
npm run apk:fieldtest
# → apps/mobile/android/app/build/outputs/apk/release/app-release.apk
$ANDROID_HOME/build-tools/<ver>/apksigner verify --verbose --print-certs apps/mobile/android/app/build/outputs/apk/release/app-release.apk
sha256sum apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

To create a field-test key:

```
keytool -genkeypair -v -storetype PKCS12 -keystore upload.jks -alias khidmat-fieldtest -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Khidmat Field Test, O=Khidmat, C=PK"
```

## Path 3: EAS Build

`eas.json` has a `fieldtest` profile that builds an APK with `:app:assembleRelease`, plus `staging` (APK) and `production` (AAB for Play). EAS builds use paid Expo build time and need an Expo project id, so they require owner approval. Run `eas build -p android --profile fieldtest`. EAS can store the keystore itself (`eas credentials`).

An Expo export, a browser preview or an AAB is **not** an installable test APK.
