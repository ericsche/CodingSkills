---
name: teams-sso-spa
description: Build a Microsoft Teams app with a personal tab as a Blazor WebAssembly SPA authenticated via Teams SSO (silent Entra token, no redirect), hosted on Azure Static Web Apps and calling an Azure Functions API. Use when creating or debugging a Teams tab, Teams SSO, "refused to connect" in the new Teams, getAuthToken "App resource ... do not match", missing roles/403, iframe/CSP framing, or linking a private Functions backend to a SWA. See reference.md for the full guide.
license: MIT
---

# Teams tab (Blazor WASM SPA) with Teams SSO

Field-tested guide for shipping a Microsoft Teams **personal tab** as a **Blazor
WebAssembly SPA** on a **separate Static Web App (SWA)**, authenticating the user
with **Teams SSO** (a silent Entra token passed as a Bearer token to an Azure
Functions API). For exhaustive detail, error tables, and code, read
[reference.md](reference.md).

## When to use this skill

Use it when you are building or troubleshooting any of:
- A Teams personal tab rendered as a SPA (Blazor WASM) inside the Teams iframe.
- Teams SSO / `getAuthToken`, app registration for SSO, token validation in the API.
- Framing errors ("refused to connect"), CSP `frame-ancestors`, iframe login issues.
- Linking a (private) Azure Functions backend to a Static Web App.

## Core architecture decisions

- **Blazor WASM (SPA) on a dedicated SWA.** Static content is SWA-hostable.
  TeamsFx Blazor **Server** samples do not transpose to a SWA.
- **Auth = MSAL + Teams SSO → Bearer token**, validated in the API. **Do NOT use
  SWA Easy Auth for a Teams tab** — Easy Auth relies on session cookies and a
  redirect login, which is incompatible with the Teams iframe (login pages
  refuse to be framed). Teams SSO returns an Entra token directly: no cookie, no
  redirect.
- **Authorization = Entra app role in the JWT** (`roles` claim), checked in API code.
- **Networking**: if the backend is private, use a dedicated Functions app
  integrated into the same VNet and linked to the admin SWA (call `/api/*`
  same-origin through the SWA).

## Highest-value pitfalls (the ones that cost the most time)

1. **CSP `frame-ancestors` must include `*.cloud.microsoft`.** The new Teams,
   Outlook, and M365 web migrate to `*.cloud.microsoft`; without it the tab shows
   **"refused to connect"** even though the URL returns 200 directly. Also do not
   send a blocking `X-Frame-Options`.
2. **No redirect-based auth in the iframe.** Remove any gating that redirects to
   the IdP (`AuthorizeRouteView` + `RedirectToLogin`). Attempt **silent SSO**;
   show a sign-in button **only outside Teams**.
3. **teams-js `@@` trap.** `index.html` is a static file, not a `.razor`, so `@@`
   stays literal and breaks the unpkg URL — the script never loads,
   `window.microsoftTeams` is `undefined`, the app thinks it is outside Teams and
   **never attempts SSO**. Use a single `@`, and prefer the official CDN
   (`res.cdn.office.net/teams-js/...`); `dist/MicrosoftTeams.min.js` on unpkg 404s.
4. **App ID URI must include the host domain**: `api://{full-domain}/{appId}`.
   `api://{appId}` alone makes `getAuthToken` fail with *"App resource defined in
   manifest and iframe origin do not match"*. Keep it in the manifest `resource`
   and in `validDomains`.
5. **Token audience is the appId GUID** (v2 token), **not** the App ID URI. The
   API must expect the **GUID** as the audience.
6. **`roles` claim requires a security or M365 group** — a distribution list does
   NOT emit the claim, so the token has no `roles` → **403**. Assign the app role
   to a **security group** (or use `groupMembershipClaims=ApplicationGroup`, or an
   email/oid allowlist).
7. **The manifest does not auto-update.** SWA code redeploys itself, but any
   manifest change (e.g. `resource`) requires **re-uploading the package**: bump
   `version`, remove and re-add the app (clear the Teams cache).

## End-to-end workflow

1. **Infra**: dedicated Standard SWA (+ deploy token as a GitHub secret). If the
   backend is private, create a dedicated VNet-integrated Functions app, replicate
   app settings and managed-identity roles, and link it as the SWA backend.
2. **Entra app registration**: App ID URI `api://{swa-domain}/{appId}`; expose
   scope `access_as_user`; `requestedAccessTokenVersion = 2`; pre-authorize the
   Teams/Office clients; grant Graph admin consent; add SPA redirect
   `/authentication/login-callback`.
3. **SPA**: load teams-js from the official CDN (single `@`); set CSP
   `frame-ancestors` incl. `*.cloud.microsoft`, no `X-Frame-Options`; call
   `app.initialize()` before `getAuthToken()`; attach the token via a
   `DelegatingHandler` (Teams SSO first, MSAL fallback only outside Teams).
4. **API**: validate audience = appId **GUID**; authorize on multiple signals
   (`roles`, `groups`, allowlist).
5. **Manifest**: `resource` = domain-form App ID URI; `validDomains` = SWA domain;
   no `packageName`; `developer.name` ≤ 32. Bump `version` and re-upload on any
   manifest change.

## Reference

- [reference.md](reference.md) — full guide: architecture, framing/CSP, teams-js
  loading, Entra registration, API token validation, Teams manifest lifecycle,
  networking to a private API, Fluent UI theming, an end-to-end checklist, and a
  symptom → cause → fix table.
