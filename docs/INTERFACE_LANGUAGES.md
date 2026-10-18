# Interface languages

AI Workforce has a header language selector for English (`en`), Urdu (`ur`) and Arabic (`ar`). It is available on the dashboard, landing page, sign-in, registration and not-found page, next to Appearance. The native select supports keyboard navigation and exposes a localized accessible label.

## Preference and rendering

`apps/web/lib/language.ts` validates the three language codes and resolves a saved preference before the browser's weighted `Accept-Language` preferences. Unknown values fall back to English. The root server layout reads the preference and renders the matching HTML `lang`, `dir` and initial provider state. Reading request cookies makes pages dynamically rendered; the standalone Cloud Run setup supports this.

`LanguageProvider` updates the interface without reloading or clearing forms. It saves only the non-sensitive language code in the `ai-workforce-language` cookie for one year, with `Path=/`, `SameSite=Lax`, and `Secure` on HTTPS. Authentication cookies are untouched. Other tabs synchronize on window focus. If cookie storage is blocked, selection still works for the current mounted application but cannot persist across reloads.

Existing URLs, auth proxy rules, API requests, integration callbacks and database contracts remain unchanged. No dependency or external translation service is required.

## Translation boundaries

The catalogs in `apps/web/locales/en.json`, `ur.json` and `ar.json` share the same English source-message keys. The UI calls `useTranslation().t(message, values)` for application labels, headings, explanatory copy, known statuses, form validation and known notifications. Unknown messages fall back to the original text. Named parameters such as `{name}` preserve supplied values; translations are rendered as React text, never HTML.

Changing the interface language does **not** change:

- Business/customer conversation language or AI response language.
- Saved country, currency, timezone, working hours or form values.
- Customer messages, AI answers, call transcripts, record names, product titles or custom template content.
- Provider protocol values, IDs, URLs, SKUs or credentials.

Provider-generated errors, custom API descriptions, new server messages and user-created content can remain in their original language unless explicitly added to the catalog and connected at a display boundary. This is not automatic translation of arbitrary data. Urdu/Arabic editorial wording should receive native-speaker review before public release.

## Layout and formatting

Urdu and Arabic set `dir="rtl"`. Shared dashboard and public styles use logical spacing, borders and interactive positioning; sidebar placement follows document direction. Directional navigation arrows are mirrored selectively. Decorative illustrations and brand marks are preserved. Arabic-script fonts use available system fonts without requiring an external font download.

Date/time and currency formatters use the selected locale while retaining the business timezone and currency supplied by the workflow. Email, URL, telephone, password and machine-readable inputs remain left-to-right. Light/Dark/System, accessible palette and high contrast remain independent of language.

## Verification

Run from the repository root in PowerShell:

```powershell
node --test scripts/test-language.mjs scripts/test-appearance.mjs
.\scripts\with-d-drive.cmd npm.cmd run build --workspace=@ai-employee/web
.\scripts\with-d-drive.cmd node scripts/verify-local-predeployment.mjs --language-browser
```

The last command requires the existing local PostgreSQL/Redis rehearsal setup and an installed Chromium browser. It uses the isolated rehearsal database and a temporary browser profile; it does not deploy to GCP or send customer messages. Browser checks reuse a previously verified session response to avoid exhausting the login/session rate limit. Only the overview onboarding response is bypassed for rendering tests; actual integration readiness is unchanged.

Language browser results are saved in `artifacts/language-browser.json`, with screenshots under `artifacts/appearance/language-*.png`. The browser suite checks selection, server rendering, refresh persistence, unchanged business form values, dashboard/public routes, RTL sidebar placement, mobile width, keyboard focus and localized form validation. The existing appearance suite runs in the same session and records hydration warnings separately.

When adding UI copy, add its English key and both translations together. `scripts/test-language.mjs` checks catalog parity, named parameters, invalid locale handling and literal translation calls.
