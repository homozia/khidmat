# Start here: from ZIP to the first booking

This page takes you from the ZIP file to a plumbing booking placed from an Android phone. Everything uses **test data**: no real SMS is sent, and the sign-in code is always **123456**.

You need a **Windows laptop** and an **Android phone (Android 7 or newer)** on the **same Wi-Fi**.

## 1. Install two programs on the laptop (once)

1. **Node.js 22 LTS** from <https://nodejs.org>. Click the "LTS" button and install with the default options.
2. **Docker Desktop** from <https://www.docker.com/products/docker-desktop/>. Install it, restart the laptop, then open Docker Desktop and wait until it shows **Engine running**.

## 2. Start the test environment

1. Unzip `khidmat-m4.1-source.zip` into a simple folder, for example `C:\Khidmat`. Avoid OneDrive folders.
2. Open the unzipped folder `khidmat-m4.1` in File Explorer. Click the address bar, type `powershell` and press Enter.
3. Paste this command and press Enter:

   ```
   powershell -ExecutionPolicy Bypass -File .\start-test-env.ps1
   ```

   The first run takes a few minutes. It shows steps 1 to 7 and then a box like this:

   ```
    USE THIS ONE - adapter "Wi-Fi" (Wi-Fi)
      Phone app (Khidmat TEST > Test server):  192.168.1.20
      Provider and staff website on a phone:   http://192.168.1.20:5173
      Health check (open in the phone browser): http://192.168.1.20:3000/health
   ```

   Write down the address (here `192.168.1.20`). If Windows asks whether Node.js may use the network, tick **Private networks** and click **Allow**.

Running the command again is always safe: it keeps your test bookings. To **stop** everything at the end of the day:

```
powershell -ExecutionPolicy Bypass -File .\stop-test-env.ps1
```

## 3. Install the app on the phone

1. Get `khidmat-m4.1-field-test.apk`. It is built on GitHub; see [docs/operations/android-builds.md](docs/operations/android-builds.md), section "Get the APK".
2. Send it to the phone (WhatsApp to yourself, USB cable or Google Drive) and tap it. If Android says installing is blocked, tap **Settings**, allow **Install unknown apps** for that app, go back and tap **Install**.
3. Open **Khidmat TEST** (amber icon).

## 4. Connect the phone and sign in

1. On the phone, open the browser and go to the **health check** address, for example `http://192.168.1.20:3000/health`. You should see `"ok":true`. If not, see "If something goes wrong" below.
2. In Khidmat TEST, tap **Open Test server**, or the "Test server" link at the bottom of the sign-in screen.
3. Type the address (for example `192.168.1.20`), tap **Test this address**, then **Use this server**. You should see "Connected to the test server".
4. On the sign-in screen, tap the test account **0300 1110001 · Usman**, then **Send code**, type **123456** and tap **Sign in**.

## 5. Place the first plumbing booking

1. Tap **Choose my area**. If the phone asks for location, you can tap **Don't allow**: type `g10` and tap **G-10**.
2. Tap **Plumbing**, then **Tap and pipe leak repair** (from Rs 800).
3. Enter `1` for the number of taps, and a made-up address such as `House 1, Street 1, G-10/2`.
4. Tap **Review**. Check the price, then tap **Confirm booking** once.
5. You see **Booking received: KH-…** and "What happens next". Your booking also appears under **My bookings** on the home screen.

That's it. To continue with the provider and staff side (dispatch, accepting the job, cash, commission), follow the smoke test in [PHONE_TEST_CHECKLIST.md](PHONE_TEST_CHECKLIST.md). It also has the role card with every test account.

## Report a problem

In the TEST app, tap **Report** (top right on every screen), describe what happened and tap **Copy or share the report**. Then attach a screenshot yourself. The report contains the app version, screen, time, booking reference and request id. It never contains phone numbers, addresses or photos. On the website, use **Report a problem** at the bottom of the page.

## If something goes wrong

| What you see | What to do |
|---|---|
| "Docker is not installed" or "not running" | Install or open Docker Desktop and wait for **Engine running**, then run the start command again. |
| "Port 5432 / 3000 / 5173 is used by another program" | Close the other program or old PowerShell windows, or restart the laptop, then start again. |
| Phone browser cannot open the health check | Phone and laptop must be on the same Wi-Fi. Guest Wi-Fi often blocks this: use the laptop's hotspot instead. On Windows, set the Wi-Fi network to **Private** and allow Node.js in the firewall (the start command prints the exact firewall command). |
| The app worked yesterday but not today | The laptop's address may have changed. Run the start command again and use the new address in **Test server**. |
| The app says the result is unknown | Tap **Check again**. You will never be booked twice. |

Build details (GitHub Actions, signing, Gradle) are in [docs/operations/android-builds.md](docs/operations/android-builds.md). Everything else is in [README.md](README.md).
