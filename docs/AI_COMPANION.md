# Animated workforce companion

The dashboard's right column starts with an original robotic companion above **Needs your attention** and **Bring your tools together**. It uses a transparent, precompressed 640 × 640 WebP (81,218 bytes), CSS animation and existing semantic theme variables. It adds no inference calls, microphone access, external animation libraries or backend routes.

The dashboard-scoped `CompanionProvider` is keyed by tenant, so state resets when switching workspaces. The assistant reports current question/voice activity through the provider. The visual carries no transcript, audio or business data.

| State | Actual trigger | Presentation |
| --- | --- | --- |
| Ready | Waiting for a question or previewing a recording | Gentle floating portrait and breathing halo |
| Listening | MediaRecorder has started recording | Faster halo and animated recording indicator |
| Thinking | Audio preparation/transcription or an answer request | Moving scan accent and orbit |
| Answered | The latest answer arrived | Brief acknowledgement motion and answer-ready status |
| Error | Recording or the latest question failed | Calm static portrait and text pointing to the chat message |

Microphone permission requests never show Listening. Existing typing, cancellation, request identity and permissions are unchanged. This is a visual chat companion, not a claim that an autonomous agent is actively executing business actions.

The companion is the first card in the right column, above attention items and integrations. Chat, team and activity cards share an independent primary column with a 20px gap, so a taller right column cannot create empty space below chat. Narrow tablet layouts stack the team and activity cards. Mobile uses a compact avatar/status arrangement below the primary content. Tablet uses a shorter portrait. The portrait is decorative; text/icons communicate status. Urdu/Arabic strings and logical layout inherit the selected interface locale.

The user can pause animation. Reduced-motion preferences make the character static automatically. Pausing affects only decoration; status text still updates. High-contrast/accessible palettes continue to use the existing semantic tokens. The **Go to chat** link focuses the actual question field.

## Artwork provenance

Created using the built-in **imagegen** tool, not the CLI/API fallback. The user-provided robotic portrait was a style reference; this is an original generated character.

- Served asset: `apps/web/public/images/workforce-companion.webp`.
- Full-resolution source copy: `artifacts/companion-source.png`.
- Default generated original was retained outside the repository; production uses only the workspace WebP.

Final generation prompt:

> Create an original premium 3D-rendered AI robotic companion portrait asset for an AI Workforce business dashboard. Stylized-concept, meticulously crafted futuristic android head and upper shoulders, three-quarter view facing slightly toward viewer's left, calm approachable intelligent expression. Beautiful graphite and brushed titanium facial armor with intricate layered mechanical temple and neck details, restrained luminous mint and ice-blue circuit seams and subtle luminous eyes, tiny warm amber pin lights allowed but primarily mint blue. Elegant professional science-fiction product aesthetic, expressive sculptural face, no human skin, no sinister expression, no weapons. Centered complete head and upper shoulders in a square composition with generous transparent margins, face occupies most of upper center, clean silhouette tapering at lower shoulders. Genuine transparent background, isolated cutout with alpha, no rectangular backdrop, no smoke, no floating objects, no words, no letters, no logos, no watermark. Crisp polished detailed artwork with cinematic soft edge lighting readable on both white and deep navy backgrounds. This is a new original asset, not a copy of an existing character. Save as project-bound illustration; animation will be added in CSS.

Only resizing/compression was performed after generation; transparency was preserved.

## Verification

```powershell
node --test scripts/test-companion.mjs scripts/test-language.mjs scripts/test-appearance.mjs
.\scripts\with-d-drive.cmd npm.cmd run build --workspace=@ai-employee/web
.\scripts\with-d-drive.cmd node scripts/verify-local-predeployment.mjs --companion-browser
```

The browser command uses the existing isolated application and synthetic microphone. It verifies actual recording/processing/answer/error state propagation, image loading, placement, pause/resume, reduced motion, chat focus, light/dark appearance and widths 320, 390, 768, 1024, 1366, 1440 and 1920 in English, Urdu and Arabic. Browser results are recorded in `artifacts/companion-browser.json`; voice interactions are recorded separately in `artifacts/voice-browser.json`. Screenshots use `artifacts/appearance/companion-*.png`.
