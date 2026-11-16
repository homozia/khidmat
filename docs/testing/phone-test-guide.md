# Khidmat M4: Phone Test Guide

This guide is for the people testing Khidmat on real Android phones. You install a test version of the customer app, point it at a laptop running the test server, and work through eight scenarios. When something goes wrong, you report it with the defect template at the end.

Everything here is test data. Sign-in codes are not sent by SMS: every test number uses the code **123456**. Do not use real customer names, phone numbers or addresses.

## What you need

| Item | Detail |
|---|---|
| Test app | `khidmat-m4-field-test.apk`. It appears as **Khidmat TEST** with an amber icon and can be installed next to any other Khidmat app. |
| Package ID | `pk.khidmat.customer.fieldtest` |
| Version | 0.4.0 (build 4) |
| Phone | Android 7.0 or newer (API 24+). Test at least one small-screen phone. |
| Laptop | Runs the test server and the provider/staff website (see "Start the test server"). |
| Network | Phone and laptop on the **same Wi-Fi**. Guest Wi-Fi networks often block phones from reaching each other; use a normal office network or the laptop's hotspot. |

Before installing, compare the APK's SHA-256 checksum with the one in the release notes:
- Windows: `certutil -hashfile khidmat-m4-field-test.apk SHA256`
- macOS or Linux: `shasum -a 256 khidmat-m4-field-test.apk`

If the two values differ, do not install the file.

## Start the test server (on the laptop)

Do this once per laptop. You need Node 22.18 or newer and Docker Desktop.

```
npm run setup          # creates .env, starts the database, installs, migrates and loads test data
npm run dev            # starts the API on port 3000 (leave this window open)
npm run serve:web      # in a second window: provider and staff website on port 5173
npm run lan:ip         # prints the address the phones should use
```

`npm run lan:ip` prints something like this:

```
wlan0: 192.168.1.20
  Customer app (Khidmat TEST) → Test server: 192.168.1.20
  Provider and staff website  → http://192.168.1.20:5173
  API health check            → http://192.168.1.20:3000/health
```

You can also find the address yourself. On Windows, run `ipconfig` and read the "IPv4 Address" under Wi-Fi. On macOS, go to System Settings → Wi-Fi → Details → IP address.

Open the health check address in the **phone's** browser. If it shows `{"status":"ok"…}`, the phone can reach the laptop. If it doesn't load, allow Node.js through the laptop firewall, which Windows asks about the first time, and check that both devices are on the same Wi-Fi.

To start again with clean test data: `npm run db:reset`. Resets only work on databases whose names end in `_dev`, `_test` or `_sandbox`.

## Install the app

1. Copy the APK to the phone, for example over WhatsApp to yourself, by USB, or through Google Drive.
2. Tap the file. If Android blocks it, allow "Install unknown apps" for the app you opened it from (Files, Chrome or Drive), then tap the file again.
3. Open **Khidmat TEST**. On the sign-in screen, tap **Test server**, enter the laptop address (for example `192.168.1.20`), and tap **Save and test**. You should see "Connected to the test server."

The app works without Expo Go, a USB cable or a bundler. Only the test server needs to be running.

## Test roles

All use the code **123456**.

| Role | Number to type | Where |
|---|---|---|
| Customer, Islamabad (Usman) | 0300 1110001 | Khidmat TEST app |
| Customer, Rawalpindi (Hina) | 0300 1110002 | Khidmat TEST app |
| Plumber, Islamabad (Asif) | 0300 2220001 | Website → provider portal |
| Plumber, Rawalpindi (Imran) | 0300 2220005 | Website → provider portal |
| Driver (Tariq) | 0300 2220003 | Website → provider portal |
| Locksmith, skill pending (Zahid) | 0300 2220004 | Website → provider portal |
| Electrician, skill pending (Naveed) | 0300 2220002 | Website → provider portal |
| Dispatcher (Bilal) | 0300 0000002 | Website → staff |
| Finance (Fatima) | 0300 0000003 | Website → staff |
| Services and places setup (Kamran) | 0300 0000004 | Website → staff |
| Verification (Sana) | 0300 0000005 | Website → staff |
| Super admin, all staff roles (Ayesha) | 0300 0000001 | Website → staff |

**Switching roles.** In the app, use **Sign out** at the bottom of the home screen, then sign in with another number. On the website (`http://<laptop-address>:5173`), use **Sign out** at the top right. To keep two roles open at once, use a normal tab and an Incognito tab: each tab keeps its own sign-in, and closing the tab signs out.

## Scenarios

Mark each one **Pass**, **Fail** (file a defect) or **Blocked** (say why).

### 1. Install, connect, sign in
1. Install and open Khidmat TEST. Set the test server as described above.
2. Sign in as Usman (0300 1110001, code 123456).

**Expected:** the home screen appears and asks you to choose your area. Closing and reopening the app keeps you signed in. A wrong code shows "That code is not right…" with a support reference.

### 2. Urdu, no GPS, manual area, plumbing or solar/UPS
1. On the home screen, tap **اردو**. All screens should switch to Urdu, reading right to left.
2. Tap your location, then **Use my location**, and choose **Don't allow** when Android asks.
3. Search for an area by typing `g10`, `جی ٹین` or `G-10` and pick **G-10**.
4. Choose plumbing (for example a leaking tap) or solar/UPS maintenance. Fill in the details and the address, then tap **Review**.

**Expected:** with GPS refused, the app offers the area list instead, with no crash and no endless spinner. All three spellings find G-10. The review shows the price lines in PKR, the total, and a note saying the location is approximate (the area centre) and the provider will call to confirm the exact address. Leaving a required field empty highlights it with an Urdu message.

### 3. Confirm once, even when the reply is lost
1. On the Review card, tap **Confirm booking**, then turn on **Airplane mode** straight away, before the next screen appears.
2. The app says it could not confirm whether the booking was received. Turn Airplane mode off, then tap **Check again**.
3. Also try tapping **Confirm booking** several times quickly on a new booking.

**Expected:** each attempt ends on one booking with one reference (for example KH-1001). **My bookings** shows it once. The dispatcher's **Bookings** page on the website also shows it once.

### 4. Photo and voice note, interrupted and recovered
1. Start a new booking and add a photo (camera or gallery) and a voice note of a few seconds.
2. Tap **Confirm booking**. As soon as the booking screen appears, turn on Airplane mode. If the upload already finished, try again with a larger photo.
3. Swipe the app away from recent apps, turn Airplane mode off, and reopen Khidmat TEST.

**Expected:** the home screen shows "Booking received. Some files have not been sent yet." with the same reference. **Send files** uploads them to that booking. No second booking appears and no file appears twice. As the dispatcher, the booking page shows the photo and voice note.

### 5. Provider on the phone: accept, change order, approve, complete, receipt
1. Book a plumbing job in G-10 as Usman.
2. On the website as Bilal (dispatcher): go to **Dispatch**, open the booking, and offer it to Asif.
3. In a second tab, sign in as Asif (0300 2220001). Under **Offers**, tap **Accept**. Then work through **On my way** and **I have arrived**.
4. As Asif, tap **Send price for approval** and add a materials line, for example PKR 450 for washers.
5. In the app as Usman, open the booking and **Approve** the new price.
6. As Asif: **Start work**, then **Complete and record cash** with the full customer total.
7. In the app, check the receipt and tap **I paid in cash**.

**Expected:** for PKR 1,200 of labour plus PKR 450 of materials, Asif's job page shows the customer total as PKR 1,650. The fee is charged on PKR 1,200 only, so it is PKR 96, and his earnings are PKR 1,554. His **Earnings** page shows one PKR 96 fee for this booking. Usman's receipt first says the cash payment is waiting for his confirmation, then that it is confirmed.

### 6. Driver, conflicts, cancellation, no provider, complaint, partial refund
- **Driver:** as Hina (0300 1110002), set the area to Satellite Town and book a driver for 8 hours to G-10 Markaz. As dispatcher, offer it to Tariq. Then book a second 2-hour drive starting 4 hours later. *Expected:* Tariq is not offered the second drive, and the reason given is that he already has a job at that time.
- **Conflicting offers:** offer Asif two overlapping jobs and accept both quickly in two tabs. *Expected:* only one is assigned. The other says the offer is no longer available, with the reason.
- **Cancellation:** cancel a booking from the app before the provider arrives. *Expected:* it shows as cancelled, with no charge.
- **No provider:** book a job and don't offer it to anyone for 30 minutes, or ask the operator to run the no-provider check. *Expected:* the app explains that no provider was found and what to do next.
- **Complaint:** on a completed booking, use **Report a problem**. *Expected:* the complaint appears on the staff **Complaints** page. A second open complaint on the same booking is refused with a clear message.
- **Partial refund:** as Fatima (finance), open the completed booking and record a PKR 200 labour refund, then a PKR 100 materials refund. *Expected:* the labour refund lowers the fee by PKR 16, the materials refund does not change the fee, and the receipt shows the refund owed. **Mark paid** needs a method and a reference.

### 7. Sign out and switch accounts: drafts stay private
1. As Usman, put the phone in Airplane mode and confirm a booking. The app keeps it as "saved on this phone".
2. Turn Airplane mode off, tap **Sign out**, and sign in as Hina.

**Expected:** Hina's home screen shows no unsent booking, and none of Usman's details appear anywhere. After signing back in as Usman, his saved booking is still there and **Send again** works. The website also requires a new sign-in after sign-out.

### 8. Weak network, restart, large text
Repeat scenarios 2, 3 and 5 under these conditions:
- **Mobile data or weak Wi-Fi.** Stand far from the router, or use a phone hotspot with a slow connection.
- **Closing the app halfway through a booking.**
- **Larger text.** Go to Settings → Display → Font size, set it to the largest, and Display size to large.

**Expected:** slow answers show "The server took too long to answer…" rather than a frozen screen, and retrying never creates a second booking. With large text, nothing is cut off or overlapping, PKR amounts stay readable, and every button is still easy to tap.

## Device checklist (for each phone)

| Check | Result |
|---|---|
| Phone model / Android version | |
| APK checksum matches | |
| Installs; icon and name read "Khidmat TEST" | |
| Health check URL opens in the phone browser | |
| App connects to the test server | |
| Scenarios 1–8 (Pass / Fail / Blocked) | |
| Urdu right-to-left layout correct on the small screen | |
| Largest font size: no cut-off text | |
| Camera, gallery and microphone permission prompts appear and can be refused safely | |
| Location refused → manual area search works | |
| Provider portal usable in the phone browser (Chrome) | |

## Reporting a defect

Copy this template. Leave out phone numbers, sign-in codes, tokens, CNIC or other ID numbers, and exact house addresses. Use the booking reference and the support reference instead.

```
Title:            (one line: what went wrong)
App version:      Khidmat TEST 0.4.0 (4)     ← sign-in screen → Test server shows it
Phone model:      e.g. Samsung Galaxy A14
Android version:  e.g. Android 13
Role:             e.g. customer (Usman) / provider (Asif) / dispatcher
Booking ref:      e.g. KH-100123          ← never the customer's phone number
Support ref:      e.g. req-1a2b3c4d          ← shown under the error message
Network:          office Wi-Fi / mobile data / weak signal / airplane mode toggled
Steps:            1. …  2. …  3. …
Expected result:
Actual result:
Time it happened: e.g. 16 Nov 2026, 15:42 (PKT)
Screenshot:       attached (crop or cover any phone numbers or addresses)
```

### Finding the support reference and server log lines

- **In the app:** most error messages have a line under them saying "Support reference: req-…". Copy it into the report.
- **On the website:** errors end with "(support reference req-…)".
- **On the laptop:** the API window prints one JSON line per request, each with a `reqId`. To pull out the lines for one reference:
  - macOS or Linux: `npm run dev 2>&1 | tee api.log`, then `grep req-1a2b3c4d api.log`
  - Windows PowerShell: `npm run dev 2>&1 | Tee-Object api.log`, then `Select-String req-1a2b3c4d api.log`

  The API never writes sign-in codes, tokens or file contents to the log. Before sharing log lines, still check them for phone numbers or addresses.
- **Android system log (only if asked):** with USB debugging on, run `adb logcat -d -s ReactNativeJS:V > khidmat-logcat.txt` and check it for personal data before sharing.

## Physical phone, emulator, or browser?

Record which one you used for each result. Only a **physical phone** counts as proof for the APK scenarios (install, permissions, camera, microphone, airplane mode, font size). An emulator is useful for quick repeats. A desktop browser only checks the provider and staff website, not the app.
