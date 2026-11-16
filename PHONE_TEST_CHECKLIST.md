# Phone test checklist (Khidmat M4.1)

Set up first with [START_HERE.md](START_HERE.md). In each row, mark **Pass**, **Fail** (then report it: tap **Report** in the app) or **Blocked** (and write why).

**Where you tested:** ☐ physical phone (model / Android version: ______________) ☐ emulator ☐ desktop browser.
Only a physical phone proves install, permissions, camera, microphone, airplane mode and font size.

## Role card

Every number signs in with the code **123456** (test server only). Customers use the **Khidmat TEST app**. Everyone else uses the website at `http://<laptop address>:5173` in the phone's browser. On the website sign-in page you can also tap **Use** next to an account.

| Account | Number | Where | Can do |
|---|---|---|---|
| Usman, customer (Islamabad, G-10) | 0300 1110001 | App | Book, approve prices, confirm cash, rate, complain, cancel |
| Hina, customer (Rawalpindi, Satellite Town) | 0300 1110002 | App | Same; use her for driver bookings |
| Asif, plumber (G and F sectors) | 0300 2220001 | Website | Accept offers, update status, send prices, record cash, earnings |
| Imran, plumber (Rawalpindi) | 0300 2220005 | Website | Same as Asif, Rawalpindi zones |
| Tariq, driver | 0300 2220003 | Website | Driver jobs; overlapping bookings are refused |
| Rashid, licensed locksmith | 0300 2220006 | Website | Lockouts: must record the occupancy check before work |
| Zahid, locksmith (skill pending) | 0300 2220004 | Website | No lockout offers until verification approves him |
| Naveed, electrician (skill pending) | 0300 2220002 | Website | No offers until verification approves him |
| Bilal, dispatcher | 0300 0000002 | Website | Dispatch, bookings, reassign, cancel, visit charge, complaints |
| Fatima, finance | 0300 0000003 | Website | Refunds (and mark paid), settlements, statements, reports |
| Sana, verification | 0300 0000005 | Website | Documents, skills, approve or suspend providers |
| Kamran, setup | 0300 0000004 | Website | Services, prices, places, skills, service areas |
| Ayesha, super admin | 0300 0000001 | Website | Everything staff can do |

**Switching roles on the website:** **Sign out** (top right), then sign in as someone else. To keep two roles open, use a normal tab and an Incognito tab; each keeps its own sign-in. **In the app:** **Sign out** on the home screen.

Rashid (licensed locksmith) is new in M4.1. A database that was set up with M4 does not have him: run the reset command (`reset-test-data.ps1`) once to get the full M4.1 test data.

---

## A. Five-minute smoke test

| # | Role | Do this | Expected | Result |
|---|---|---|---|---|
| A1 | — | Open Khidmat TEST. Tap **Test server**, enter the laptop address, tap **Test this address**, then **Use this server**. | "Connected to the test server". The screen shows the app version **0.4.1 (5)**. | |
| A2 | Usman | Tap the **Usman** test account, then **Send code**, `123456`, **Sign in**. | Home screen with "Where do you need the service?". | |
| A3 | Usman | **Choose my area**, then `g10`, then **G-10**. Then **Plumbing** → **Tap and pipe leak repair**, 1 tap, a made-up address, **Review**, **Confirm booking**. | **Booking received: KH-…**, "We are finding a provider…". It appears under **My bookings**. | |
| A4 | Bilal (website) | **Dispatch** → tap the new booking → **Send offer** next to Asif. | Status "offer out". | |
| A5 | Asif (website) | **Offers** → **Accept**. Then **On my way** → **I have arrived** → **Start work** → enter the customer total under **Complete and record cash** → **Complete and record cash**. | The job shows **Completed**. The fee is 8% of the labour. | |
| A6 | Usman | Open the booking, check the receipt, tap **I paid in cash**. | The receipt says "Cash payment confirmed". | |

## B. Installation, server connection and sign-in

| # | Role | Do this | Expected | Result |
|---|---|---|---|---|
| B1 | — | Install the APK. If you already have the M4 test build, install over it. | It installs as an update (no "conflicts with an existing package"). The icon and name read **Khidmat TEST**. | |
| B2 | — | Stop the test server on the laptop, then open **Test server** → **Check again**. | A plain explanation: the phone could not reach the laptop, plus what to check (same Wi-Fi, server window, firewall, changed address). | |
| B3 | — | Enter `192.168.1.999`, then **Test this address**. | "That address is not valid…" | |
| B4 | Usman | Sign in with a wrong code (`000000`). | "That code is not right…" (no technical details on screen). | |
| B5 | Usman | Close the app completely and reopen it. | Still signed in. | |

## C. Manual area selection and Urdu layout

| # | Role | Do this | Expected | Result |
|---|---|---|---|---|
| C1 | Usman | On the home screen tap **اردو**. | Every screen switches to Urdu and reads right to left. | |
| C2 | Usman | **اپنا علاقہ منتخب کریں** → **میرا مقام استعمال کریں** → **Don't allow**. | Message that location is off; the search box stays usable. | |
| C3 | Usman | Search `جی ٹین`, then `g10`, then `zzzz`. | G-10 appears for the first two. For `zzzz` a "no area matches" message appears (not a blank screen). | |
| C4 | Usman | Open Plumbing. | Prices read as **از Rs 800** (Rs and the number not reversed). | |
| C5 | Usman | Phone **Settings → Display → Font size: largest** and **Display size: large**, then repeat C3–C4 and the booking form. | No text cut off or overlapping; buttons easy to tap. | |
| C6 | Usman | On the booking form, leave the address empty and tap **جائزہ** (Review). | Review stays disabled until the address is filled. Any error message is in Urdu. | |

## D. Plumbing booking, change order, cash receipt and provider commission

| # | Role | Do this | Expected | Result |
|---|---|---|---|---|
| D1 | Usman | Book **Tap and pipe leak repair** with **2** taps. | Review shows Rs 800 + Rs 400 = **Rs 1,200**. | |
| D2 | Bilal → Asif | Offer it to Asif, who accepts → **On my way** → **I have arrived**. | | |
| D3 | Asif | **Send price for approval**: change order, materials, "Washers", **450**. | The customer's booking shows "New price to approve". | |
| D4 | Usman | **Approve**. | The total becomes **Rs 1,650**. | |
| D5 | Asif | **Start work**, then **Complete and record cash** with **1650**. | The job page shows customer total Rs 1,650, fee charged on **Rs 1,200**, no fee on **Rs 450**, platform fee **Rs 96**, your earnings **Rs 1,554**. **Earnings** shows one Rs 96 fee. | |
| D6 | Usman | Receipt → **I paid in cash**. | "Cash payment confirmed". | |

## E. Lost reply after the server saved the booking (controlled)

This reproduces the worst case: the server saves the booking, but the reply never reaches the phone. It works only on the test server (the API refuses this setting on staging and production) and only in the TEST app.

| # | Role | Do this | Expected | Result |
|---|---|---|---|---|
| E1 | Usman | Home → **Diagnostics** → switch on **Drop the reply to my next booking**. | "Armed: it applies once…" | |
| E2 | Usman | Go back, book any service, **Review** → **Confirm booking**. | "We could not confirm whether your booking was received… You will not be booked twice." with **Check again**. | |
| E3 | Bilal (website) | **Bookings** list. | The booking **is already there** (the server saved it). | |
| E4 | Usman | Close the app completely, reopen it. | The home screen still shows the booking whose result is unknown, with **Check again**. | |
| E5 | Usman | **Check again**. | **Booking received: KH-…** with the **same** reference Bilal sees. **My bookings** shows it **once**. | |
| E6 | Usman | Separate test: turn on **Airplane mode**, book and **Confirm booking**, turn Airplane mode off, then **Check again**. | One booking. | |
| E7 | Usman | Tap **Confirm booking** several times quickly on a new booking. | One booking. | |

## F. Failed attachment upload, then recovery

| # | Role | Do this | Expected | Result |
|---|---|---|---|---|
| F1 | Usman | **Diagnostics** → switch on **Drop the reply to my next photo upload**. Book with **one photo**, **Confirm booking**. | The booking screen shows **Booking received: KH-…** and Photo 1 **Waiting to send** ("No connection. It will be sent when you tap Send files"). | |
| F2 | Usman | Close the app completely, reopen it. | Home shows the same booking reference with Photo 1 waiting. The booking is not sent again. | |
| F3 | Usman | **Send files**. | Photo 1 **Sent**; the card disappears. Bilal sees exactly **one** photo on the booking. | |
| F4 | Usman | Book with 2 photos, turn on Airplane mode right after **Confirm booking** appears to finish, then reopen the app with Airplane mode off. | Files show their state and **Send files** finishes them. Same booking reference. | |
| F5 | Usman | If a photo shows **Not sent** with a reason (for example an unsupported file), tap **Replace** or **Remove**. | It is replaced or removed; the booking is unchanged. | |

## G. Switching accounts and test servers

| # | Role | Do this | Expected | Result |
|---|---|---|---|---|
| G1 | Usman | Airplane mode on, book and confirm (it stays "saved on this phone"). Airplane mode off. **Sign out**. | | |
| G2 | Hina | Sign in as Hina. | No unsent booking, and nothing of Usman's is visible. | |
| G3 | Usman | Sign in as Usman again. | His unsent booking is back; **Send now** creates it once. | |
| G4 | Usman | With a second laptop running the test server (or the same laptop's other address), **Test server** → enter the other address → **Use this server**. | Warning that you will be signed out and unsent bookings stay with the old server. You are signed out and must sign in again. | |
| G5 | Usman | On the second server, sign in. | No drafts from the first server. Switching back and signing in shows them again. | |

## H. Driver overlap, locksmith authorisation, cancellation and partial refund

| # | Role | Do this | Expected | Result |
|---|---|---|---|---|
| H1 | Hina | Area **Satellite Town** → Driver → **Hourly driver**, **8** hours, tomorrow 9 am, destination G-10. Bilal offers it to Tariq, who accepts. | Booked and accepted. | |
| H2 | Hina | Book a 2-hour driver for tomorrow 1 pm. Bilal opens it in Dispatch. | Tariq is not in the list. If offered anyway: "The provider already has a job at this time." | |
| H3 | Usman | Area **F-10** → Locksmith → **Authorised lockout assistance**. | Before booking, the app explains the occupancy check and shows the visit charge **Rs 500**. | |
| H4 | Bilal → Rashid | Offer to Rashid, who accepts → **On my way** → **I have arrived**. | A "Check occupancy before opening" form appears. **Start work** is disabled and completing is blocked. | |
| H5 | Rashid | Record **Could not verify** with a note. | "Occupancy could not be verified. Do not open the lock…" | |
| H6 | Bilal | Open the booking → reason **Occupancy could not be verified** → **Bill the agreed visit charge (Rs 500)**. Then Rashid completes with **500**. | The customer total is Rs 500. Completion works. | |
| H7 | Usman | Book another service and, before the provider arrives, **Cancel this booking** → reason → **Cancel booking**. | Cancelled; no charge. | |
| H8 | Fatima | Open the completed booking from D → refund **labour 200** (reason) → **Record refund**; then **materials 100**. | The labour refund lowers the fee by Rs 16; materials leaves the fee unchanged. Refunds list shows "Paid to customer" fields. | |
| H9 | Fatima | **Mark paid** without a reference, then with method JazzCash and reference `JC-TEST-1`. | Without a reference it is refused; with one it shows as paid. The customer's receipt shows the refund owed reduced. | |
| H10 | Usman | On a completed booking: **Make a complaint** → describe → **Send complaint**. Bilal opens **Complaints**. | The complaint is listed and can be reviewed and resolved on the phone without zooming. | |

## I. Test data survives running setup again

| # | Role | Do this | Expected | Result |
|---|---|---|---|---|
| I1 | — | Note the number of bookings in **My bookings** and on Bilal's **Bookings** page, and Asif's **Earnings** balance. | | |
| I2 | — | On the laptop, run `start-test-env.ps1` again (and also `stop-test-env.ps1` then `start-test-env.ps1`). | The output says "Existing data kept". | |
| I3 | — | Check again. | Same bookings, photos, refunds and balance. | |
| I4 | — | Run `reset-test-data.ps1` and press Enter without typing. | "Cancelled. Nothing was changed." | |

---

## Reporting a defect

Tap **Report** in the app (or **Report a problem** at the bottom of the website). Fill in what went wrong and what you expected, then **Copy or share the report** and attach a screenshot. The draft already has:

```
Title, App version (0.4.1 (5)), Phone model, Android version, Role, Language, Screen,
Booking ref, Last request id, Server, Network (fill in), Time (PKT), Steps, Expected result, Actual result, Screenshot
```

It never includes sign-in tokens, phone numbers, addresses, identity documents or photos. Anything typed that looks like a phone or ID number is replaced. Before sharing a screenshot, cover any phone number or address.

**Request ids:** normal screens show short messages only. Home → **Diagnostics** lists recent failed requests with their request id (`req-…`). The laptop's API log (`.khidmat\logs\api.log`) has the matching line; the log never contains sign-in codes or tokens.
