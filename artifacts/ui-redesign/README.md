# UI review

The dashboard, integrations, approvals, templates, voice logs, WhatsApp setup,
home page, login and registration now share the navy and mint visual system.

Screenshots in this folder use isolated sample API responses. They do not show
production customers or prove that external integrations are live.

## Verification

- Next.js production build passed.
- Desktop (1440px), mobile (390px) and tablet (768px) browser checks passed for
  the seven additional screens, with no horizontal overflow or runtime errors.
- Approval success, failed submission, retry, rejection reason and history checked.
- Template search, empty search and deployment request checked.
- Voice provider filtering, transcripts, missing transcripts, empty state and service failure checked.
- WhatsApp signup callback and disconnect checked using a simulated Meta SDK.
- Registration validation, password visibility and success checked; login error handling checked.
- Non-admin approval controls and WhatsApp requests checked.
- A 6.5-second approval response completed without being cancelled by the
  5-second refresh interval; pending review controls also fit on mobile.

Live Meta authorization, real messages and external store actions were not
executed during these UI checks.

## Business setup and Calendar

The `business-setup-*` screenshots also use isolated sample responses. They show
the new business profile, working hours and Google Calendar availability screen
at desktop, mobile and tablet widths. Profile save/reload, validation, calendar
selection, availability errors/retry, unsaved-change handling, disconnect and
viewer restrictions passed browser checks. Google authorization and real calendar
requests were not executed in these UI checks.

## Real estate and clinic reception

`clinic-*`, `healthcare-mobile`, and `real-estate-*` capture the new workflow
screens with fixture data. Eight browser checks passed for doctor/service setup,
qualification and property matching, clinic and viewing bookings, uncertain
provider responses, cancellation retry, archive behavior, mobile/tablet layouts
and viewer restrictions. These screenshots do not demonstrate a live Google event.
