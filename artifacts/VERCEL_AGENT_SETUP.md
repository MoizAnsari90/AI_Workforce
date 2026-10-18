# Vercel agent setup verification

Followed the official [Vercel onboarding playbook](https://vercel.com/get-started.md). The exact Markdown was fetched to ignored `.local/vercel-get-started.md` after the browser fetcher rejected the Markdown content type.

| Item | Verified state |
| --- | --- |
| CLI | Vercel **64.5.0**, Node.js **22.23.3** |
| CLI identity | `moizansari90`, confirmed with `vercel whoami` |
| Installation | D:-based CLI and private global configuration; user PATH includes `D:\Agent\.local\bin` for new terminals |
| Guidance | Official Vercel plugin **0.54.1**, installed and enabled for Codex in user scope |
| Standalone skills | Not installed; avoided duplicating the plugin |
| MCP endpoint | User-wide `vercel` Streamable HTTP registration, exactly `https://mcp.vercel.com` |
| MCP OAuth | CLI reported **Successfully logged in** |
| Runtime tools | **237 Vercel MCP tools** loaded after the client reset |
| Documentation check | `search_vercel_documentation` returned documentation successfully |
| Authenticated account check | `list_teams` succeeded; result contained **0 teams**, with no continuation token |
| MCP confirmation | `default_tools_approval_mode = "writes"` on the native and plugin-provided Vercel server; non-read-only tools require prompts |
| Existing settings | Preserved; original user configuration backed up before the targeted policy merge |
| Application project | No Vercel project created or linked during global agent setup |

Subsequent deployment inspection found the existing `workforce` project in the CLI's effective `moiz-ansaris-projects` Hobby team. The MCP default-scope empty list was not an account-wide inventory. Explicit CLI inspection confirmed the project ID and owner; its initial Git link and runtime environment list were empty, with no production target. The deployment preparation uses that existing project rather than creating a duplicate named `ai-workforce`.

## Runtime verification after client reset

The user reset the client. The refreshed session now exposes 237 tools under the Vercel MCP server, as well as the installed Vercel skill catalog.

Executed read-only verification:

1. The Vercel tool catalog loaded successfully.
2. `search_vercel_documentation` returned documentation.
3. Authenticated `list_teams` returned a successful empty result: no teams were listed and pagination count was zero.

MCP connectivity and the authenticated read are now verified, rather than inferred from OAuth login alone. No additional reset or reinstallation is needed for these checks. A command-menu-specific `/vercel-plugin:status` check was not performed; this runtime exposes the tools and skills directly.

## Commands after reopening a terminal

```powershell
vercel.cmd --version
vercel.cmd whoami
codex.cmd mcp get vercel --json
```

The PATH shim preserves the caller's working directory and uses the existing D:-based authenticated configuration. `scripts/vercel-d-drive.cmd` is also available inside this repository. No API token values were printed or committed. The CLI update notifier and telemetry are disabled in these wrappers.

The guide's scope is agent onboarding. This does not claim that the AI Workforce application, API, database or Firebase site has been deployed. Continue the separate [application deployment guide](../docs/VERCEL_RENDER_FIREBASE_DEPLOYMENT.md) after loading the tools and obtaining the remaining provider/datastore access.

References: [Vercel CLI setup guide](https://vercel.com/get-started.md), [Vercel global options](https://vercel.com/docs/cli/global-options), [OpenAI MCP configuration and write approvals](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
