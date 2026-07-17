---
name: azure-easy-auth
description: Configure Microsoft Entra ID (Azure AD) authentication for Azure App Service Easy Auth and Azure Static Web Apps. Use when setting up sign-in, protecting APIs, adding Google/Microsoft personal accounts, or debugging 403 "allowed applications" and client-principal issues.
license: MIT
---

# Azure Entra ID / Easy Auth setup

Guidance for wiring up authentication on Azure App Service (Easy Auth) and Azure
Static Web Apps (SWA), based on real deployments.

## Azure Static Web Apps (SWA)

- Configure providers in `staticwebapp.config.json`.
- **Microsoft personal / Live accounts**: use the `aad` provider with issuer
  `https://login.microsoftonline.com/common/v2.0`.
- **Google**: add via `customOpenIdConnectProviders` (requires the SWA
  **Standard** plan).
- The API reads the authenticated user from the `x-ms-client-principal` header
  (base64-encoded JSON). Decode it server-side to get user id, roles, claims.
- **Protect API routes, not SPA routes** for a Blazor WASM / SPA front end.
  Example route rule:

  ```json
  { "route": "/api/inscriptions", "methods": ["POST"], "allowedRoles": ["authenticated"] }
  ```

- Local emulator note: the SWA CLI emulator needs `AAD_CLIENT_ID` in the
  environment for the `aad` provider, otherwise it errors with
  `AAD_CLIENT_ID not found in env for 'aad' provider`.

## Azure App Service Easy Auth

- **An EMPTY `defaultAuthorizationPolicy.allowedApplications` does NOT mean
  allow-all.** The caller's token `appid`/`azp` must be explicitly listed, or
  the request returns **403**. Add the client's `azp` to `allowedApplications`.
- Diagnose 403s with `AppServiceAuthenticationLogs` — look for
  `does not match any of the allowed applications`.
- Validate the token you actually receive: check `aud` (should equal the Easy
  Auth clientId), `azp` (the calling app), `scp`/`roles`, and `ver` (`2.0`).

## Debugging checklist

1. Decode the incoming token (jwt.ms) and confirm `aud`, `azp`, `scp`/`roles`.
2. For App Service 403s, confirm the caller `azp` is in `allowedApplications`.
3. For SWA, confirm the provider issuer and that the protected route targets the
   API, not the SPA shell.
4. Check the platform auth logs before changing app code.
