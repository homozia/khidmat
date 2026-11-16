# Android builds (field-test APK)

The customer app has four variants, chosen by `APP_VARIANT` in `apps/mobile/app.config.ts`. They have different package IDs, so they can be installed side by side.

| Variant | App name | Package ID | Server | Plain HTTP | Test tools |
|---|---|---|---|---|---|
| `fieldtest` | Khidmat TEST | `pk.khidmat.customer.fieldtest` | Set in the app (**Test server**). `EXPO_PUBLIC_API_URL` pre-fills it | Allowed (laptop on the office Wi-Fi) | Report, test accounts, lost-reply controls (only when the server allows them) |
| `staging` | Khidmat STAGING | `pk.khidmat.customer.staging` | `EXPO_PUBLIC_API_URL`, must be `https://` | Refused | None |
| `production` | Khidmat | `pk.khidmat.customer` | `EXPO_PUBLIC_API_URL`, must be `https://` | Refused | None |
| `development` | Khidmat DEV | `pk.khidmat.customer.dev` | Metro / Expo Go | Allowed | As fieldtest |

**M4.1 release:**
- Version **0.4.1**, Android versionCode **5** (M4 was 4).
- Minimum Android 7.0 (API 24).
- Same package ID as M4, so an installed TEST build updates in place, provided the APK is signed with the same key.

The workflow checks this when the `KHIDMAT_CERT_SHA256` variable is set. The field-test key in use has this certificate SHA-256:
`59:4F:9B:8E:ED:7E:18:49:56:01:FF:24:DF:44:8E:13:AD:BF:6B:AA:CE:16:3C:A0:B5:ED:7A:49:19:C4:45:B6`.

**Raise the versionCode for every APK you hand out.** Phones refuse an "update" with the same or a lower number.

## Signing

`apps/mobile/plugins/with-release-signing.js` reads these at build time:
- `KHIDMAT_KEYSTORE_PATH`
- `KHIDMAT_KEYSTORE_PASSWORD`
- `KHIDMAT_KEY_ALIAS`
- `KHIDMAT_KEY_PASSWORD`

The keystore and its passwords are never in the repository or the source ZIP (`*.jks` and `*.keystore` are git-ignored). Without them, a release build would use the debug key; the GitHub workflow detects that and fails. Use a **separate** Play Console upload key for production; never reuse the field-test key.

## GitHub Actions: step by step in the browser

### 1. Create the private repository (once)

1. Sign in at <https://github.com>. Click **+** (top right) → **New repository**.
2. Name: `khidmat`. Choose **Private**. Leave "Add a README", ".gitignore" and "license" **unticked**. Click **Create repository**.

### 2. Put the code in it (once per release)

- **Easiest:** tell Claude "repo created". Claude pushes the code and sets the four signing secrets and the certificate check, so the key never passes through your hands. Then continue at step 4.
- **Yourself, with GitHub Desktop:**
  1. Unzip `khidmat-m4.1-source.zip`.
  2. In GitHub Desktop: **File → Add local repository** → choose the `khidmat-m4.1` folder → **create a repository** → **Publish repository**, with **Keep this code private** ticked, under the name `khidmat`.
  3. On later releases, copy the new files over the old ones, **Commit**, then **Push**.

### 3. Add the four signing secrets (skip if Claude set them)

1. In the repository: **Settings** → (left menu) **Secrets and variables** → **Actions** → **New repository secret**.
2. Add these four, one at a time (Name, then Secret, then **Add secret**):

   | Name | Value |
   |---|---|
   | `KHIDMAT_KEYSTORE_BASE64` | The keystore file as base64 text (see below) |
   | `KHIDMAT_KEYSTORE_PASSWORD` | The keystore password |
   | `KHIDMAT_KEY_ALIAS` | The key alias (for the current field-test key: `khidmat-fieldtest`) |
   | `KHIDMAT_KEY_PASSWORD` | The key password |

3. On the **Variables** tab, add `KHIDMAT_CERT_SHA256` with the certificate value above. The build then refuses to produce an APK signed with any other key. Optionally also add `KHIDMAT_TEST_API_URL` (for example `http://192.168.1.20:3000`) to pre-fill the server address.

To turn a keystore into base64 on Windows (PowerShell, in the keystore's folder):
`[Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\upload.jks")) | Set-Clipboard`. Then paste it as the secret value.

**Only if you are creating a new key:** this is fine as long as no TEST build signed with the old key is installed on testers' phones; otherwise they must uninstall it first. Run:
`keytool -genkeypair -v -storetype PKCS12 -keystore upload.jks -alias khidmat-fieldtest -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Khidmat Field Test, O=Khidmat, C=PK"`.
`keytool` comes with Java or Android Studio. Keep the file and the passwords in a password manager, not in the project folder.

### 4. Start the build

1. Open the **Actions** tab. The first time, click **I understand my workflows, go ahead and enable them**.
2. In the left list, click **Field-test APK** → **Run workflow** (right side) → leave branch `main` and **versionCode `5`** → **Run workflow**.
3. Wait about 15–25 minutes. The run turns green ✓ when done. If it turns red ✗, click it: the failed step names the problem (for example "Add these repository secrets first: …").

**Expected output:** the run's **Summary** page shows:

```
package: name='pk.khidmat.customer.fieldtest' versionCode='5' versionName='0.4.1' …
sdkVersion:'24'
application-label:'Khidmat TEST'
certificate SHA-256: 594f9b8e…c445b6
<sha256>  khidmat-m4.1-field-test.apk
```

Under **Artifacts** there is **khidmat-m4.1-field-test**.

### 5. Get the APK

1. On the run's Summary page, click **khidmat-m4.1-field-test** under Artifacts. GitHub downloads `khidmat-m4.1-field-test.zip`.
2. Right-click the ZIP → **Extract All**. Inside:
   - `khidmat-m4.1-field-test.apk`: the app
   - `khidmat-m4.1-field-test.apk.sha256`: the checksum
   - `apksigner.txt`: signature verification (v2 scheme true, certificate)
   - `badging.txt`: package, version, minimum Android, label
   - `bundle.txt`: proof that the JavaScript bundle is inside the APK
3. Check the checksum in PowerShell: `Get-FileHash .\khidmat-m4.1-field-test.apk -Algorithm SHA256`. It must match the `.sha256` file and the Summary page.

Artifacts are kept for 30 days; run the workflow again to rebuild.

### 6. Install on the phone

1. Send the APK to the phone (WhatsApp to yourself, USB or Google Drive) and tap it.
2. If Android blocks it, allow **Install unknown apps** for the app you opened it from, go back and tap **Install**.
3. If you had the M4 TEST app, it updates in place and keeps its settings.

## Local Gradle build (a machine with Android Studio)

Requirements: JDK 17, Android SDK (platform 37 and build-tools), Node 22.18 or newer.

```
npm ci
set KHIDMAT_KEYSTORE_PATH=C:\secure\upload.jks
set KHIDMAT_KEYSTORE_PASSWORD=…
set KHIDMAT_KEY_ALIAS=khidmat-fieldtest
set KHIDMAT_KEY_PASSWORD=…
set KHIDMAT_VERSION_CODE=5
npm run apk:fieldtest
REM → apps\mobile\android\app\build\outputs\apk\release\app-release.apk
%ANDROID_HOME%\build-tools\<version>\apksigner verify --verbose --print-certs apps\mobile\android\app\build\outputs\apk\release\app-release.apk
```

(macOS/Linux: use `export` instead of `set`.)

## EAS Build

`apps/mobile/eas.json` has a `fieldtest` profile that builds an APK with `:app:assembleRelease` and versionCode 5, plus `staging` (APK) and `production` (AAB for Play). EAS uses paid Expo build time and needs an Expo project, so it requires the owner's approval. Command: `eas build -p android --profile fieldtest`.

An Expo export, a browser preview or an AAB is **not** an installable test APK.
