# Business setup and Google Calendar

## Implemented in this step

- `Dashboard > Business setup`: workspace profile, Pakistan/UAE/US country selection,
  currency, conversation language preferences, IANA timezone, weekly opening hours,
  appointment duration and buffer time. Admins edit; other members can view.
- Profile persistence and an audit entry in a single database transaction.
- Date-filtered workforce metrics use the saved timezone. Workspaces without a
  profile retain the previous Asia/Karachi behavior.
- Google Calendar OAuth: session-bound, expiring one-use state, PKCE, encrypted
  refresh/access tokens, refresh rotation handling, calendar selection, disconnect.
- Availability checks combine the selected Google calendar with saved hours and
  buffers, omit past times and handle daylight-saving changes. Provider errors
  never become an empty busy calendar or invented free slots.

The Business setup screen checks availability only. Appointment creation and
cancellation are now available in **Real estate** and **Clinic reception**; see
[Niche workflows](NICHE_WORKFLOWS.md). Each doctor/viewing agent selects a writable
calendar from the workspace's connected Google account. Sharing a calendar means
sharing availability. Guided conversations, opted-in reminders and voice callbacks
are configured in [Automation & inbox](NICHE_AUTOMATION.md). Country selection is
not a compliance certification.

## Local startup

The additive migration and Prisma generation were applied locally during
implementation. On another checkout, run in `D:\Agent\apps\api`:

```powershell
npx prisma migrate deploy
npm run prisma:generate
npm run dev
```

On Windows, stop this project's API first if Prisma generation reports a locked
`query_engine-windows.dll.node`. Do not delete the database or reset migrations.

## Enable Google authorization

A Gemini API key does not authorize access to a user's Google Calendar.

1. In Google Cloud, enable the Google Calendar API, configure the OAuth consent
   screen, and create an OAuth client of type **Web application**.
2. Register this exact development redirect URI:
   `http://localhost:3000/api/calendar/google/callback`
3. Configure these backend variables in `apps/api/.env` and restart the API:

```dotenv
GOOGLE_CALENDAR_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CALENDAR_CLIENT_SECRET=your-google-oauth-client-secret
GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:3000/api/calendar/google/callback
```

Keep the existing `INTEGRATION_ENCRYPTION_KEY` private and unchanged. It must
contain at least 32 characters. Replacing it prevents existing credentials from
being decrypted. Do not paste secrets into the frontend or commit `.env`.

The consent request uses:

- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
- `https://www.googleapis.com/auth/calendar.events.freebusy`
- `https://www.googleapis.com/auth/calendar.events`

During Google testing, add the test user's Google account to the consent screen.
Google's testing-mode refresh-token limitations and any required app verification
must be addressed before public rollout. Reconnect existing read-only connections
to grant event creation permissions. Declining write access leaves availability
checks usable, but prevents resource setup and appointment creation.

In production, register an HTTPS callback on the dashboard origin. Set
`API_INTERNAL_URL` in the **web server environment** to the private API origin,
without `/api/v1`; the proxy and callback use the same origin. Supply persistent
database storage and the same encryption key to every API instance.

Official references:
[Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server),
[calendar list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list),
[availability](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query).

## Live acceptance check

1. Sign in as a workspace admin. Open `/dashboard/settings/business`.
2. Choose a country and your actual timezone, enter working hours, and save.
   Reload to confirm persistence.
3. Connect Google, approve the requested permissions, then select the intended calendar.
4. Check a future open day. Compare displayed times against a busy event in Google.
   A closed day or entirely occupied day must offer no slots.
5. Change timezone or opening hours, save, then check again. Unsaved settings cannot
   be used to test availability.
6. Disconnect. Calendar checks must stop. Also remove the grant in Google Account
   connections if full provider-side revocation is desired; local disconnect does
   not revoke the Google grant.

Automated integration tests use isolated database tenants and mocked Google
responses. A passing test is not proof of live Google consent or public rollout.

## Verification performed

- API suite: 36 files, 263 tests passed, including tenant isolation, admin-only
  updates, OAuth state/session checks, replay rejection, token encryption,
  refresh/disconnect races and daylight-saving availability calculations.
- API TypeScript build and Next.js production build passed. Neither workspace
  currently defines a lint script.
- Browser checks with isolated fixtures covered country defaults, saving and
  reloading a profile, invalid opening hours/languages, calendar selection,
  availability, provider failure/retry, unsaved settings, disconnect and viewer
  restrictions. Mobile (390px), tablet (768px) and desktop (1440px) were checked.
- Local migration and Prisma client generation completed. Live Google OAuth and
  calendar responses still need the platform's Google OAuth credentials and the
  acceptance check above.

## Next workflows

1. Reception automation is implemented; complete the provider setup and live
   acceptance in [the automation guide](NICHE_AUTOMATION.md).
2. Future extensions include bulk property import, external CRM connectors,
   automated calendar reconciliation, atomic rescheduling and dedicated staff roles.
3. Country pilots: validate languages and provider availability plus applicable
   privacy, healthcare and calling requirements for each market before activation.
