# Guide — Build a Teams app (SPA tab) with SSO

Complete field report from setting up the **AMVCC back-office**: a Teams app
(personal tab) built as a **Blazor WebAssembly (SPA)**, hosted on a **separate
Static Web App**, calling the AMVCC API (Azure Functions) and authenticating the
user via **Teams SSO**.

This document lists **what works**, **the traps encountered**, and **the exact
steps to follow**, so you can reproduce (or troubleshoot) a Teams SPA + SSO app
without going through every trial and error again.

> Concrete reference context: admin app `src/TeamsAdmin`, SWA `amvcc-admin`
> (`happy-ocean-00374d003.7.azurestaticapps.net`), dedicated Function App
> `amvcc-func-admin`, app registration `AMVCC Back-office (Teams)` (clientId
> `7a1fb0f6-…`).

---

## 1. Architecture decisions

| Topic | Chosen option | Why |
| --- | --- | --- |
| Rendering | **Blazor WASM (SPA)** on a **separate SWA** | Consistent with the existing `Client`; static content is SWA-hostable. The *blazor-test-app* reference model is Blazor **Server** (TeamsFx) → not directly transposable to a SWA. |
| Authentication | **MSAL + Teams SSO → Bearer token**, validated on the API side (`BearerUserAuthenticator`) | No SWA Easy Auth (see §2). Teams SSO avoids any redirect (forbidden in an iframe). |
| Authorization | **Entra app role in the JWT** (`roles` claim), checked in API code | No SWA roles (no Easy Auth). |
| Networking | **Dedicated Function App integrated into the VNet**, linked to the admin SWA | The existing backend is private and already linked to another SWA (see §7). |

### Do NOT use Easy Auth for a Teams tab
- Easy Auth relies on **session cookies** and a **redirect-based login** →
  **incompatible with the Teams iframe** (login pages refuse to be framed,
  anti-clickjacking).
- Teams SSO directly returns an **Entra token** presentable to the API: no
  cookie, no redirect. This is the right mechanism.

---

## 2. Framing & Content-Security-Policy (tab inside an iframe)

A Teams tab is loaded **inside an iframe**. Two mandatory conditions:

1. **Do not send a blocking `X-Frame-Options`.** On SWA, neutralize it:
   ```json
   "globalHeaders": {
     "X-Frame-Options": "",
     "Content-Security-Policy": "frame-ancestors 'self' teams.microsoft.com *.teams.microsoft.com *.skype.com *.teams.microsoft.us *.cloud.microsoft *.microsoft365.com *.office.com outlook.office.com outlook.office365.com outlook-sdf.office.com outlook-sdf.office365.com"
   }
   ```
2. **`frame-ancestors` must include `*.cloud.microsoft`** (⚠️ major trap). The
   **new Teams**, Outlook, and M365 web migrate to `*.cloud.microsoft`: without
   this domain, the tab shows **"refused to connect"** even though the classic
   "Teams" CSP looked correct.

> Observed symptom: *refused to connect* in the new Teams, but the URL responded
> fine (200) directly. → Cause = incomplete `frame-ancestors`.

**No redirect-based authentication.** Login pages will not render in an iframe.
So on the Blazor side **remove any gating that redirects to the IdP** (no
`AuthorizeRouteView` + `RedirectToLogin` that triggers `NavigateToLogin`).
Attempt **silent SSO** and show a sign-in button **only outside Teams**.

---

## 3. Load the TeamsJS library (URL traps)

The `index.html` of a Blazor WASM project is a **static file**, **not** a Razor
component.

- ⚠️ **`@@` trap**: in a `.razor` file, `@@` is the escape for `@`. In
  `index.html` (static), `@@` **stays literal** → the URL
  `https://unpkg.com/@@microsoft/teams-js@@2/…` is **broken**, the script never
  loads, `window.microsoftTeams` is `undefined`, the app thinks it is **outside
  Teams** and **SSO is never attempted**. → Use a **single** `@`.
- ⚠️ **unpkg path**: `dist/MicrosoftTeams.min.js` returns **404**. The UMD bundle
  is under `dist/umd/…`. The most reliable option is the **official CDN**:
  ```html
  <script src="https://res.cdn.office.net/teams-js/2.54.0/js/MicrosoftTeams.min.js" crossorigin="anonymous"></script>
  ```

**Interop** (JS module + C# wrapper) — key points:
- Always call **`microsoftTeams.app.initialize()` before
  `authentication.getAuthToken()`**.
- Make the calls *best-effort* and **log the real errors** (`console.warn`) —
  otherwise an SSO failure is hidden and hard to diagnose.

```javascript
// wwwroot/js/teams-interop.js (excerpt)
export async function initialize() {
    const t = window.microsoftTeams;
    if (!t || !t.app) { console.warn('[teams-interop] microsoftTeams unavailable'); return false; }
    try { await t.app.initialize(); return true; }
    catch (e) { console.warn('[teams-interop] initialize failed', e); return false; }
}
export async function getAuthToken() {
    try { return await window.microsoftTeams.authentication.getAuthToken(); }
    catch (e) { console.warn('[teams-interop] getAuthToken failed (consent/SSO config?)', e); return ''; }
}
```

The HTTP `DelegatingHandler` attaches the token: **Teams SSO first**, MSAL
fallback **only** if unavailable (outside Teams).

---

## 4. Entra registration (app registration) for SSO

### 4.1 Application ID URI — SSO trap #1
The App ID URI **must include the hosting domain**:

```
api://{full-domain}/{appId}
e.g. api://happy-ocean-00374d003.7.azurestaticapps.net/7a1fb0f6-2e9b-4694-864a-507667e051f5
```

- ❌ `api://{appId}` **alone** (without the domain) → `getAuthToken` fails with
  **`Error: App resource defined in manifest and iframe origin do not match`**.
- The **domain must match** the tab's domain **and** appear in the manifest's
  `validDomains`.
- After changing `identifierUris`, verify that the SP's
  **`servicePrincipalNames`** include the new URI (otherwise
  `AADSTS500011: resource principal … was not found`).

### 4.2 Scope, token version, pre-authorized clients
- Expose an **`access_as_user`** scope (admin + user consent).
- **`requestedAccessTokenVersion = 2`**.
- **Pre-authorize the Teams/Office clients** (no consent dialog inside Teams):

  | Client | AppId |
  | --- | --- |
  | Teams desktop/mobile | `1fec8e78-bce4-4aaf-ab1b-5451cc387264` |
  | Teams web | `5e3ce6c0-2b1f-4285-8d4b-75ee78787346` |
  | Microsoft 365 web | `4765445b-32c6-49b0-83e6-1d93765276ca` |
  | Microsoft 365 desktop | `0ec893e0-5785-4de6-99da-4ed124e5296c` |
  | M365 / Outlook mobile (shared) | `d3590ed6-52b3-4102-aeff-aad2292ab01c` |
  | Outlook web | `bc59ab01-8403-45c6-8796-ac3ef710b3e3` |
  | Outlook mobile | `27922004-5251-4030-b22d-91ecd9a37ea4` |

> Graph requires that the pre-authorized scope **already exists**: create the
> scope **then** add the `preAuthorizedApplications` in a **second PATCH**
> (otherwise `InvalidValue … Permission Id … not found`).

### 4.3 Graph consent (avoid the dialog)
Grant **admin consent** for the base delegated scopes
(`openid profile offline_access email User.Read`) so no dialog appears:
```powershell
# grant AllPrincipals via Graph (oauth2PermissionGrants): clientId = objectId of the app's SP,
# resourceId = objectId of the Microsoft Graph SP in the tenant.
```

### 4.4 SPA redirects (MSAL fallback outside Teams)
Add, as type **SPA**: `https://{domain}/authentication/login-callback`
(+ `localhost` in dev).

---

## 5. Token validation on the API side (traps)

- ⚠️ **A v2 token's `aud` = the `appId` (GUID)**, **not** the App ID URI. So the
  **audience expected by the API must be the GUID** (`api://…/{guid}` will **not**
  be the SSO token's audience).
- `azp` = Teams client (e.g. Teams web `5e3ce6c0-…`): normal.
- `iss` = `https://login.microsoftonline.com/{tenantId}/v2.0`.

### The `roles` claim: the **group type** trap
- The `roles` claim (app roles via a group) **is only emitted for a SECURITY
  group or a Microsoft 365 group**.
- ❌ A **distribution list** (`securityEnabled=false, mailEnabled=true,
  groupTypes=[]`) **does not emit** the claim, even if you assign the app role to
  it → token **without `roles`** → **403**.
- Solutions:
  1. **Security group** (recommended) assigned to the `admin` app role;
  2. **`groupMembershipClaims = ApplicationGroup`** + check the `groups` claim
     (emits only the groups assigned to the app, no overage);
  3. **Email / oid allowlist** in configuration (quick unblock / dev).

> Best practice: on the API side, accept **multiple signals** (`roles` roles,
> `groups` groups, allowlist) to stay robust. See `IAdminAuthorizer` in `src/Api`.

---

## 6. Teams manifest & update cycle

- ❌ **`packageName`** is **rejected** by the recent schema validator → **remove**
  it.
- `developer.name` ≤ **32 characters**; `name.short` ≤ 30; `description.short` ≤ 80.
- `webApplicationInfo.resource` = **App ID URI in domain form** (§4.1);
  `webApplicationInfo.id` = appId.
- `validDomains` includes the **SWA domain**.
- ⚠️ **The code updates itself** from the SWA (static redeploy), **but the
  manifest does NOT**: any manifest change (e.g. `resource`) requires
  **re-uploading the package** in Teams. **Increment `version`** to force it to be
  picked up, and **remove then re-add** the app (or quit/restart Teams, or test in
  private browsing to purge the cache).

Packaging: zip **at the root** `manifest.json` + `color.png` (192×192) +
`outline.png` (32×32 transparent). The zip must not contain a subfolder.

---

## 7. Networking: reach a private API from the SPA

AMVCC context: **private** backend (storage/Key Vault behind *private endpoints*)
and an existing Function App **already linked** (1:1) to the volunteer SWA.

- ⚠️ A **linked** Function App (linked backend) is **locked by Easy Auth**:
  calling it **cross-origin directly** from the browser returns **401**
  (`WWW-Authenticate: Bearer` + `x-ms-middleware-request-id`). → The admin app
  **cannot** hit the volunteer Function App directly.
- A Function App can be **linked to only one** SWA.
- The **private storage** prevents an admin app with *managed functions* from
  reaching the data.

**Chosen solution (Option C)**: a **dedicated Function App** `amvcc-func-admin`
(Flex Consumption), **integrated into the same VNet** (delegated subnet
`Microsoft.App/environments`), **same private storage/Key Vault**, **linked to the
admin SWA**. The app then calls `/api/*` **same-origin** (proxied by the SWA to its
linked backend).

Deployment traps encountered:
- Since the storage is private, deploying the code (blob container + upload)
  requires temporary access: **IP pinhole** (public enabled + default `Deny` + IP
  rule), deploy, then **re-lock** (`public-network-access Disabled`). The outbound
  IP may **rotate** (a /29 pool): allow the pool's IPs for the duration of the
  operation.
- Replicate on the admin func **all the application app settings** of the original
  func (storage, Key Vault, HelloAsso, Approvals, Email, `Auth__Providers`) + add
  the tenant's **Auth provider** and admin authorization.
- Grant the admin func's **managed identity** the same roles: *Storage Blob Data
  Owner*, *Storage Queue Data Contributor*, *Key Vault Secrets User*.
- After `az staticwebapp backends link`, the admin func **inherits Easy Auth**
  (only accepts SWA traffic anymore) — free hardening: a direct call returns 401,
  a call **via the SWA** works.

---

## 8. Fluent UI + Teams theme

- Use the **real components** from `Microsoft.FluentUI.AspNetCore.Components`
  (`FluentDataGrid`, `FluentCard`, `FluentAccordion`, `FluentBadge`,
  `FluentLayout/Header/BodyContent`, `FluentStack`…).
- **Theme**: `<FluentDesignTheme Mode="..." />` driven by the **Teams host theme**
  (`app.getContext().app.theme` → light/dark/contrast) → the app automatically
  follows Teams.
- Let the Fluent **design tokens** manage colors/typography; reduce custom CSS to
  layout only.
- ⚠️ **Build trap `BLAZOR106`**: a local **publish** folder (`publish/`) placed
  **inside** the project is scanned and fails the build (`… .razor.js … no
  associated razor component`). → **Exclude** it in the `.csproj`:
  ```xml
  <ItemGroup>
    <Content Remove="publish\**" />
    <None Remove="publish\**" />
  </ItemGroup>
  ```
- The Fluent **icons** are in a **separate package** (`…Components.Icons`);
  without it, the `Icons` namespace is not found (`CS0246`). Add it only if you use
  them.

---

## 9. End-to-end checklist

**Infra**
- [ ] Dedicated SWA (Standard) created; deploy token stored as a GitHub secret.
- [ ] (If private backend) Dedicated VNet Function App + MI roles + replicated app
      settings + linked backend.
- [ ] Storage re-locked after deployment.

**Entra (app registration)**
- [ ] App ID URI = `api://{SWA-domain}/{appId}`; SP `servicePrincipalNames`
      synchronized.
- [ ] Scope `access_as_user`; `requestedAccessTokenVersion = 2`.
- [ ] 7 Teams/Office clients pre-authorized; Graph admin consent granted.
- [ ] App role `admin` **assigned to a SECURITY group** (not a DL).
- [ ] SPA redirects (`/authentication/login-callback`).

**App (SPA)**
- [ ] `index.html`: teams-js script via the official CDN (single `@`, valid path).
- [ ] CSP `frame-ancestors` including `*.cloud.microsoft`; no `X-Frame-Options`.
- [ ] Redirect-free auth; silent SSO + TeamsJS init before `getAuthToken`.
- [ ] Fluent theme driven by Teams; `publish/` excluded from the csproj.

**API**
- [ ] Audience = **appId GUID** (v2 token).
- [ ] Multi-signal authorization (`roles`, `groups`, allowlist).

**Manifest**
- [ ] `resource` = domain-form App ID URI; `validDomains` = SWA domain; no
      `packageName`; `developer.name` ≤ 32.
- [ ] After any manifest change: **bump `version`** + **re-upload**
      (remove/re-add).

---

## 10. Errors encountered → cause → fix (memo)

| Symptom | Cause | Fix |
| --- | --- | --- |
| Tab "refused to connect" | `frame-ancestors` without `*.cloud.microsoft` (new Teams) | Complete the CSP (§2) |
| SSO never attempted (MSAL fallback) | teams-js not loaded: literal `@@` / unpkg path 404 | Single `@` + official CDN (§3) |
| MSAL login blocked in iframe | **Redirect**-based auth (forbidden in an iframe) | Teams SSO, remove the redirect gating (§2) |
| `getAuthToken`: *App resource … do not match* | App ID URI without the domain | `api://{domain}/{appId}` + manifest `resource` (§4.1) |
| `AADSTS500011 resource principal … not found` | Old scope cached / SP not synchronized | Reload the manifest; check `servicePrincipalNames` |
| Token issued but API returns **401** | `aud` = GUID but API expects the URI | API audience = appId **GUID** (§5) |
| Token **without `roles`** → 403 | Role assigned to a **distribution list** | **Security** group / `groups`=ApplicationGroup / allowlist (§5) |
| `packageName … not defined` (manifest) | Field rejected by the schema | Remove `packageName` (§6) |
| `developer.name exceeds 32` | Name too long | ≤ 32 characters (§6) |
| Admin API **401** on a direct call to the func | Easy Auth of the linked backend | Call **via the SWA** (§7) |
| Build `BLAZOR106 … .razor.js` | `publish/` folder scanned | Exclude `publish/**` from the csproj (§8) |
| `CS0246 Icons` | Fluent icons package missing | Add `…Components.Icons` or do not use icons (§8) |
