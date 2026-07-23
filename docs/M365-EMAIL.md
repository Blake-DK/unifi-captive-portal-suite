# Sending portal mail through Microsoft 365

The portal can send its guest-verification, expiry-warning and alert emails
through Exchange Online using Microsoft Graph, with a free shared mailbox as the
sender. Added license cost: zero. No SMTP AUTH is involved, since Microsoft has
retired basic authentication for SMTP, and the app registration is scoped so it
can only ever touch the one mailbox.

Setup takes about 20 minutes, most of which is waiting for the access policy to
propagate.

## Why this route

- Shared mailboxes need no license, up to 50 GB. You don't burn a user seat on
  `portal@yourdomain`.
- App registrations and Graph calls are free.
- Graph's `sendMail` with an *application* permission works headlessly with a
  client secret. There is no interactive login, no user password to store, and
  no SMTP AUTH toggle to argue about with tenant policy.
- Mail leaves from Exchange Online, so your existing SPF, DKIM and DMARC records
  already cover it. Nothing in DNS has to change.

## Before you start

You need these roles in the tenant. One person may hold all of them.

| Task | Role required |
|---|---|
| Create the shared mailbox | Exchange Administrator |
| Register the app, create its secret | Application Administrator or Cloud Application Administrator |
| Grant admin consent for `Mail.Send` | Privileged Role Administrator or Global Administrator |
| Scope the app to one mailbox | Exchange Administrator (via Exchange Online PowerShell) |

The portal's container must reach two hosts on port 443, directly or through
your egress proxy:

- `login.microsoftonline.com` (token)
- `graph.microsoft.com` (send)

Decide the sender address now, for example `portal@yourdomain.com`. Guests see
it in the From header, and their replies land in that shared mailbox, so it
should be an address somebody actually reads.

## 1. Create the shared mailbox

In the Exchange admin center, go to Recipients, Mailboxes, Add a shared mailbox.
Name it and give it the address you chose. Assign no license and no sign-in
account.

You can reuse an existing shared mailbox. The portal never reads from it, and
only ever sends.

## 2. Register the app

In the Entra admin center, go to App registrations, New registration. Pick a
name such as "Guest portal mail", leave it single tenant, and skip the redirect
URI. The portal never performs an interactive sign-in.

From the Overview page, record:

- Directory (tenant) ID
- Application (client) ID

Then open Certificates & secrets, New client secret. Record the **value**, not
the secret ID, and record it immediately, because it is shown once. The maximum
lifetime is 24 months. Put the expiry date in a calendar, because when it lapses
the portal stops sending and reports "client secret is invalid or expired".

## 3. Grant the permission

Under API permissions, choose Add a permission, Microsoft Graph, Application
permissions, and select `Mail.Send`. Application permissions, not delegated:
delegated permissions require a signed-in user, and the portal has none.

Then choose Grant admin consent. Until you do, every send fails with
"access denied".

At this point the app can send as **any** mailbox in the tenant. Step 4 fixes
that, and you should not stop before it.

## 4. Scope the app to the one mailbox

Two mechanisms exist. Application access policies are the older one and are
still widely used. RBAC for Applications is the newer one, and Microsoft is
steering people towards it. Either is fine. Do one.

Both run in Exchange Online PowerShell, from any desktop or server. Nothing
is installed on the portal host.

### Getting into Exchange Online PowerShell

Windows has PowerShell built in. On macOS or Linux, install PowerShell 7
first:

```bash
# Ubuntu/Debian
sudo snap install powershell --classic

# macOS
brew install --cask powershell
```

Start it with `pwsh` (`powershell` on Windows), then install the Exchange
module once per machine and connect:

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser
Connect-ExchangeOnline -UserPrincipalName admin@yourdomain.com
```

Answer Y if it warns that the PSGallery repository is untrusted. Connecting
opens a browser sign-in, MFA included; on a headless machine use
`Connect-ExchangeOnline -Device` and follow the device-code instructions it
prints. The account needs the Exchange Administrator role.

### Option A: application access policy

The policy is anchored to a mail-enabled security group whose members define
which mailboxes the app may touch. The group must be created here in
Exchange: a plain security group made in the Entra portal has no email
address and is rejected.

```powershell
# A mail-enabled security group containing only the portal mailbox:
New-DistributionGroup -Name "PortalMailApp" -Type Security `
  -Members portal@yourdomain.com -PrimarySmtpAddress portal-mail-app@yourdomain.com

New-ApplicationAccessPolicy -AppId <client-id> `
  -PolicyScopeGroupId portal-mail-app@yourdomain.com `
  -AccessRight RestrictAccess `
  -Description "Portal may only use the portal mailbox"
```

The group's own address never sends or receives anything; it only anchors
the policy. `Set-DistributionGroup portal-mail-app@yourdomain.com
-HiddenFromAddressListsEnabled $true` keeps it out of the address book.

Verify both directions. The first command must come back Granted, proving
the portal mailbox still works; the second, run against any regular
mailbox, must come back Denied, proving the rest of the tenant is now off
limits:

```powershell
Test-ApplicationAccessPolicy -Identity portal@yourdomain.com   -AppId <client-id>
Test-ApplicationAccessPolicy -Identity someuser@yourdomain.com -AppId <client-id>
```

`Test-ApplicationAccessPolicy` evaluates the stored configuration
immediately; live enforcement lags behind it, see the propagation note
below. To let the app send from a second mailbox later, add that mailbox to
the group rather than creating another policy. `Get-ApplicationAccessPolicy`
lists what exists and `Remove-ApplicationAccessPolicy` undoes it.

### Option B: RBAC for applications

Create a service principal for the app, a management scope limited to the
mailbox, and assign the "Application Mail.Send" role over that scope:

```powershell
New-ServicePrincipal -AppId <client-id> -ObjectId <enterprise-app-object-id> `
  -DisplayName "Guest portal mail"

New-ManagementScope -Name "PortalMailboxOnly" `
  -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'portal@yourdomain.com'"

New-ManagementRoleAssignment -App <client-id> `
  -Role "Application Mail.Send" -CustomResourceScope "PortalMailboxOnly"
```

Either way, propagation can take up to about 30 minutes. A connection check that
passes while sends still fail is the normal state during that window. When
you are done, close the session with `Disconnect-ExchangeOnline
-Confirm:$false`.

## 5. Configure the portal

Go to Settings, Email. Set the provider to Microsoft 365 (Graph), then fill in
the four fields and save.

| Portal field | Where it comes from |
|---|---|
| Directory (tenant) ID | App registration, Overview |
| Application (client) ID | App registration, Overview |
| Client secret | Certificates & secrets, the secret **value** |
| Sender mailbox | The shared mailbox address from step 1 |

The secret is encrypted at rest with the host's `ADMIN_SECRET`. It is never
returned to the browser, and the field shows "set, blank keeps it" once saved.

Then verify in this order:

1. **Check M365 connection.** This only acquires a token, so it proves the
   tenant ID, client ID and secret. It cannot prove the mailbox or the access
   policy, because no mail is sent.
2. **Send test email.** This proves the mailbox, the `Mail.Send` consent and the
   access policy. A pass here means the setup is done.
3. **Send activity.** The card at the bottom of the page shows the attempt, and
   the shared mailbox's Sent Items holds a copy.

To watch step 4 itself work, once: temporarily set the Sender mailbox to some
other real mailbox in the tenant, save, and send a test. It must fail with
access denied. Set the sender back and save. That failure is the scope
holding.

Nothing else changes. Email verification, expiry notifications and alert digests
keep their own toggles and templates, and simply route through Graph now.

## Rotating the client secret without downtime

1. Create a second secret in Certificates & secrets. Both are valid at once.
2. Paste the new value into the portal and save. The portal caches its access
   token for under an hour, so the switch takes effect within that window.
3. Send a test email.
4. Delete the old secret.

## Rolling back to SMTP

Set the provider back to SMTP on Settings, Email. The SMTP fields are still
stored, so the previous configuration returns unchanged. Nothing in Microsoft
365 needs undoing, though you may want to remove the app registration if the
change is permanent.

## Limits worth knowing

Exchange Online applies per-mailbox sending limits, commonly 10,000 recipients
per day. Graph also throttles bursts and answers with HTTP 429 and a
`Retry-After` header, which the portal surfaces verbatim. A captive portal sends
one message per guest registration plus hourly digests, so neither limit is
close. If you see throttling, look for a loop rather than raising a support
case.

## Auditing what the mailbox sends

The portal records every attempt under Settings, Email, Send activity, with the
kind, recipient and result. Rows age out with the audit-log retention setting.

On the Microsoft side, sends use `saveToSentItems`, so the shared mailbox's Sent
Items folder holds a complete copy. Purview and message trace answer
delivery-level questions such as whether the recipient's server accepted it.

## Troubleshooting

| Portal error message | Cause | Fix |
|---|---|---|
| Client secret is invalid or expired | Secret lapsed, or the secret ID was pasted instead of the value | New secret in the app registration, paste the value, save |
| Client ID not found in this tenant | Wrong GUID, or the app lives in another tenant | Copy it from the app registration Overview page |
| Tenant ID not found | Wrong GUID | Copy it from the same page |
| Access denied, grant Mail.Send | Permission missing, delegated instead of application, or admin consent not granted | Step 3 |
| Not allowed to send as this mailbox | The access policy scopes the app to a different mailbox, or the sender address is wrong | Step 4, and check the address |
| Sender mailbox not found | Typo, or the mailbox was never created | Step 1 |
| Graph throttled the request | Burst throttling | Wait for the `Retry-After` window and look for a loop |
| Connection check passes but sends fail | Policy still propagating, or step 4 scoped wrongly | Wait 30 minutes, then run `Test-ApplicationAccessPolicy` |
| No errors, but no mail either | The feature's own toggle is off | Check Email verification and Expiry notifications on the same page |

One failure mode has no error message. If the host's `ADMIN_SECRET` changes, the
stored client secret no longer decrypts. The provider then reads as
unconfigured, and the email features deactivate silently rather than throwing.
Re-paste the secret to recover.
