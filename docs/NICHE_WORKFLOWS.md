# Real estate and clinic workflows

## What works now

- `/dashboard/real-estate`: add/archive property listings; capture and update
  leads in the existing workspace CRM; collect seven qualification details;
  show follow-up questions and up to 20 matching active properties; configure
  viewing agents and book/cancel viewings against actual lead/property records.
- `/dashboard/healthcare`: add/archive doctors and services, choose service
  duration, check doctor availability, book/cancel appointments and retry sync.
- Country, currency and timezone come from Business setup. Property rentals use
  monthly prices. Property matching requires the same country, currency, purpose,
  city, selected area/type and a price within budget. Qualification scores measure
  information completeness, not buyer quality or a model prediction.
- Contacts and scheduling screens are admin-only. Other workspace members cannot
  fetch these endpoints. Appointment contacts are encrypted with AES-256-GCM;
  audit records contain IDs and operations, not contact details. Medical histories,
  diagnoses and free-text clinical notes are not collected by these screens.
- One connected Google account can supply multiple writable calendars. Each
  resource uses business working hours. Shared calendars intentionally block
  overlapping times across resources. Per-doctor hours/split shifts are not yet supported.

## Google setup and first use

Follow [Google OAuth setup](BUSINESS_SETUP_CALENDAR.md). This integration needs a
Google Web OAuth client, not the Gemini key. Existing connections must reconnect
and approve `calendar.events` for booking. Keep the same integration encryption
key across restarts and deployments.

1. Save the workspace country/timezone/working hours in Business setup.
2. Connect Google and approve availability plus event permissions.
3. Open Clinic reception > Doctors & services. Add a doctor with a writable
   calendar, then add a service and its duration. For real estate, add a viewing
   agent, property inventory and a lead instead.
4. In Appointments choose a resource, service when applicable, and a future day.
5. Select an available time, enter the clinic contact or select the property lead,
   and press **Confirm booking**. Confirmed means the event response was verified.
6. Check Google for a private **Reserved appointment** event. Contact names,
   phone numbers, clinical information and guest invitations are not sent there.
7. Cancel from the appointment list and verify the Google event is removed.

Staff-created bookings do not send customer notifications automatically. Guided
WhatsApp/voice bookings and opted-in reminders can now be enabled through
[Automation & inbox](NICHE_AUTOMATION.md). Live provider use
requires completing the OAuth setup and this acceptance check; automated tests
use mocked Google responses.

## Reservation and recovery behavior

Bookings use a database reservation before contacting Google. A workspace lock
serializes booking changes, and local reservations supplement Google free/busy
data. The caller's idempotency key is bound to normalized request data; reuse with
different details returns 409. The provider event ID is stable across retries.

| Status | Meaning and action |
| --- | --- |
| `sync_pending` | Time is reserved locally; Google confirmation is unknown. Retry sync on this row. |
| `confirmed` | Google returned the expected event ID, ownership marker and times. |
| `cancel_pending` | Cancellation was requested; time stays blocked until verified deletion. Retry sync. |
| `cancelled` | Google deletion/cancelled event was verified; the local slot is released. |
| `review_required` | Google event ownership or times differ. Review the event manually; no automatic overwrite/deletion occurs. |

A timed-out insert may still succeed remotely. Retry first reads the deterministic
event ID. When cancelling an uncertain insert, the service establishes that same
event before deleting it, so an uncertain 404 does not silently release a slot.
There is no background retry worker yet: use **Check / retry sync**.

Reconnect can verify an existing event on its original calendar. It cannot create
a missing event under a different connection. Disconnect removes credentials,
not appointment records; reconnect the correct calendar before reconciling.
For an externally moved event, review it in Google, cancel there if appropriate,
then sync here. Reschedule by confirming cancellation and making a new booking;
this is not an atomic reschedule and the new time is not guaranteed.

Application requests are serialized, but Google Calendar has no atomic
free/busy-and-insert operation. Someone editing the calendar directly, or another
system/workspace writing to it, can still create a conflict between those calls.
Use a dedicated booking calendar and check conflicts during the live pilot.

## Database and verification

Migration `20261003010000_niche_booking_workflows` adds resource, service, property
and appointment tables without deleting existing records. Prisma client generation
is required after migration; stop the API first on Windows if its DLL is locked.
The local migration and generation were completed during implementation.

Tests cover auth/tenant isolation, qualification gaps and market matching,
service duration, encrypted contact persistence, concurrency on shared calendars,
idempotency, uncertain insert/cancel responses, provider event ownership, reconnect
and externally changed events. UI screenshots use isolated fixture data.

Validation on 3 October 2026:

- Full API suite: **38 files / 286 tests passed**.
- API TypeScript build and web production build passed (20 web routes).
- Eight browser flow checks passed: doctors/services; booking errors/retry;
  pending cancellation; property/lead qualification; viewing booking; mobile and
  tablet layouts; archiving; admin/viewer access. No browser runtime errors.
- No lint script is configured in either workspace. `git diff --check` passed.
- API was restarted on port 3001 after Prisma generation. Google OAuth consent
  and live event creation remain unverified until real OAuth credentials are set.

Google implementation references: [create events](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert),
[read events](https://developers.google.com/workspace/calendar/api/v3/reference/events/get),
[delete events](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete).

## Boundaries before public rollout

Automatic WhatsApp/voice receptionist conversations, staff handoff and opted-in
reminders are implemented in [Reception automation](NICHE_AUTOMATION.md), with
provider setup and live acceptance still required. External CRM sync, medical
record storage, dedicated clinic staff roles, multi-branch routing and jurisdiction
review remain separate work. Template deployment alone does not activate these
capabilities or make a healthcare deployment compliant.
