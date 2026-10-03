# New-device approval

A browser that has never been approved cannot open the till. On every load the
client registers its device; if the device is unknown, the approval addresses
(see below) are emailed a 6-digit code together with the device details, and the app stays locked behind
`DeviceGate` until someone types that code or an admin approves the device from
**Devices**.

## Turning it on

Settings → Security → **Approve every new device**. Saving that toggle also
approves the browser the admin is using at that moment, so enabling the feature
can never lock an admin out of the switch itself.

It ships **off**. With no SMTP configured and no device yet approved, defaulting
it on would lock a working shop out of its own till.

## Who gets the code

Settings → Security → **Approval code emails** lists the addresses codes are
sent to. Leave it empty and codes go to every active admin's login email, so
clearing the list never leaves nobody to ask. **Send test email** mails a
sample (code `123456`, nothing waiting) to the saved list — use it to check
SMTP after changing `functions/.env` or deploying.

## SMTP

Copy `functions/.env.example` to `functions/.env` and fill it in — the file is
gitignored, and `firebase deploy --only functions` uploads it as the deployed
functions' environment. Port 465 uses TLS directly; 587 uses STARTTLS. Mail goes out as `noreply@5xcodes.com` (`SMTP_FROM`).

Mail is **best effort**. If sending fails, the device request still stands, the
error is recorded on the device doc and shown on the Devices screen, and an
admin can approve the device by hand. Approval never depends on email working.

## Data

| Path | Who can read | Written by |
| --- | --- | --- |
| `deviceApprovals/{deviceId}` | admins, plus users the device has been used by | Cloud Functions only |
| `deviceCodes/{deviceId}` | nobody | Cloud Functions only |

The code lives in a separate, client-unreadable document: if it sat on the
device doc, the browser asking for approval could simply read its own code.

A code is bound to the user it was issued for — it travels through an admin, so
it must not double as a token any signed-in account can spend. Codes last 15
minutes and allow 5 attempts; a new one can only be minted every 10 minutes, so
a reload loop can neither reset the attempt counter at will nor flood the
admins' inboxes.

## Functions

- `requestDeviceApproval({ deviceId, details })` — registers/refreshes the
  device, issues or reuses a code, mails the admins. Returns the status.
- `verifyDeviceCode({ deviceId, code })` — approves the device on a match.
- `setDeviceStatus({ deviceId, status, details? })` — admin approve/block/re-pend.
  `details` lets an admin register-and-approve a device that hasn't called in yet.
- `removeDevice({ deviceId })` — forget a device; it comes back as new.
- `sendTestDeviceEmail()` — admin-only; mails a sample to the current recipients.

## What this does and does not stop

- **Does** stop someone signing in on an unapproved browser, and someone typing
  a URL to skip the login screen — `DeviceGate` sits inside `AuthGate`, so every
  route renders through it.
- **Does not** stop someone driving the Firebase SDK directly. Enforcement is in
  the client; Firestore rules still only require a signed-in user. Rules can't
  see which device a request came from without binding a device id into a custom
  claim, which would break a user who works two tills at once.
- A blocked user who clears site data comes back as a *new* device, not an
  approved one — they still need a code or an admin. The Devices screen flags a
  pending device whose hardware fingerprint matches one that was blocked.

## Offline

The gate reads the device's status from Firestore's offline cache, so a till
that is mid-shift when the wifi drops keeps selling on its last known status. A
block therefore takes effect the next time that device is online. A device that
has *never* been approved cannot be verified offline at all.
