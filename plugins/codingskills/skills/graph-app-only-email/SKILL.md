---
name: graph-app-only-email
description: Send email with Microsoft Graph using app-only (application) permissions and test it locally. Use when sendMail returns 403/Authorization errors, when an az login token lacks Mail.Send, or when setting up DefaultAzureCredential for local Graph testing.
license: MIT
---

# Microsoft Graph app-only email (Mail.Send)

Send mail with Microsoft Graph using application (app-only) permissions, and get
local testing working reliably.

## Why your token fails locally

A plain `az login` / Azure CLI token does **not** carry `Mail.Send`. Inspect it:

```bash
az account get-access-token --resource https://graph.microsoft.com
```

The Azure CLI app's `scp` typically includes `Directory.AccessAsUser.All`,
`User.ReadWrite.All`, etc., but **not** `Mail.Send`. Sending mail with that
token returns an authorization error.

## The working setup

1. Create a dedicated **app registration** and grant it the **`Mail.Send`
   application permission** (Role), then grant admin consent.
2. Provide credentials via environment variables so
   `DefaultAzureCredential` picks the `EnvironmentCredential`:

   - `AZURE_TENANT_ID`
   - `AZURE_CLIENT_ID`
   - `AZURE_CLIENT_SECRET`

3. Acquire a token for `https://graph.microsoft.com/.default`. The resulting
   token has `roles=Mail.Send`.
4. Call `POST /users/{id|userPrincipalName}/sendMail`. A successful send returns
   **HTTP 202**.

## Verification checklist

- Decode the app-only token and confirm `roles` contains `Mail.Send`.
- Use an application permission (Role), not a delegated scope, for daemon /
  unattended scenarios.
- App-only `sendMail` must specify the sending mailbox in the path
  (`/users/{sender}`); there is no signed-in user.
