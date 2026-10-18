# AI Workforce appearance and visual accessibility

The Appearance control is shared by the dashboard header, public landing page, sign-in/register headers and the not-found screen. It exposes three independent preferences:

| Preference | Values | Default |
| --- | --- | --- |
| Theme | Light, Dark, System | System |
| Color palette | Standard, Color-blind friendly | Standard |
| Contrast | Standard, High | Standard |

System follows device color-scheme changes; explicit Light/Dark selections take priority. Preferences are stored under `ai-workforce.appearance.v1` in localStorage and synchronize between same-origin tabs. The preference belongs to this browser/site, rather than a tenant or database account. Blocked storage keeps settings usable for the current page session; invalid saved values revert to safe defaults. Reset appearance restores all three defaults.

## First render and interaction

`lib/appearance.ts` contains the preference validator and a self-contained initialization script. The root layout runs it in the document head before React hydration, so saved preferences affect the initial document. The provider then keeps root data attributes, native `color-scheme`, and the `dark` class in sync. The script reads only validated preference values, never credentials. The root uses a narrow hydration suppression for attributes changed before hydration.

The header button opens a non-modal, labelled settings panel using native selects and a checkbox. Focus moves to Theme, Escape closes the panel and returns focus, and leaving the panel or clicking outside closes it. Its position is clamped to the viewport, including narrow mobile headers. The button becomes interactive after initial preferences have loaded.

The bootstrap is inline JavaScript. If a strict Content Security Policy is introduced later, allow it with a matching script hash or nonce as part of that CSP change; do not broadly enable arbitrary inline scripts.

## Palettes and coverage

`app/appearance.css` defines semantic surface, text, border, primary, information, warning, danger and violet colors. Dashboard `workforce.css` and public `public.css` inherit these instead of defining separate palettes. Shared Tailwind UI components use the same semantic variables. The earlier requested spacing fixes remain in place.

Light uses soft neutral page surfaces, white panels and dark readable text. Dark retains navy surfaces and mint accents. The color-blind-friendly palette substitutes blue/orange emphasis for common red-green distinctions, and can be combined with either theme and High contrast. No global image-inversion or color-vision simulation filter is applied to the product.

Status badges include visible text and distinct icons; notifications include a visible status heading and icon, rather than relying on hue alone. Notification surface colors follow the selected theme. Existing connection/status text and selection markers remain visible. Native controls follow the theme; keyboard focus has an explicit outline. Reduced-motion and operating-system forced-colors preferences are supported. The global error fallback applies saved appearance independently of the regular provider.

The accessibility principles follow [W3C guidance on using color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html). Color-vision differences vary; the alternate palette and simulated screenshots are not a guarantee of accessibility for every individual, or a full WCAG conformance assessment.

## Verification commands

```powershell
.\scripts\with-d-drive.cmd node --test scripts/test-appearance.mjs
.\scripts\with-d-drive.cmd npm.cmd run build --workspace=@ai-employee/web
.\scripts\with-d-drive.cmd node scripts/verify-local-predeployment.mjs --appearance-browser
```

The 11 logic/palette checks verify preference resolution, pre-hydration initialization, invalid/blocked storage, all eight theme/palette/contrast combinations, text-token contrast of at least 4.5:1 for the tested pairs, control/focus contrast of at least 3:1, and palette inheritance. These measurements cover defined token pairs, not every rendered composited pixel or third-party UI.

The browser harness uses installed headless Edge/Chromium with an isolated temporary profile under `.local/theme-browser`; it does not open or modify the user's normal profile. It uses the existing isolated PostgreSQL/Redis rehearsal, synthetic accounts and compiled production frontend. A browser-only onboarding-status response allows rendering the overview without pretending that external integrations are connected. Repeated UI `/api/auth/me` responses reuse the session already validated by the real HTTP rehearsal, avoiding the credential-route rate-limit budget during full-page reloads. API rate-limit settings are not changed. Auth cookies remain in the temporary profile and are not reported. The real authentication/tenant/Socket.IO rehearsal still runs separately before browser checks.

Browser checks cover the initialization script with JavaScript bundles blocked, interactive combinations, refresh and cross-tab persistence, OS scheme changes, manual override, keyboard dismissal/focus, representative routes, a 320px viewport, forced colors, reduced motion, invalid/blocked storage and color-vision simulation screenshots. The local harness copies traced static/public assets to match the Docker runner before starting the standalone server.

Results: `artifacts/appearance-browser.json`, `artifacts/predeployment-local-runtime.json`; screenshots: `artifacts/appearance/`. Browser profile cleanup verifies the resolved path is the exact owned temporary directory before removal. The harness needs a supported browser; set `BROWSER_EXECUTABLE` if it is not in a standard installation path.

No new dependency, API contract, database migration, GCP resource or billing change is required by the appearance feature.
