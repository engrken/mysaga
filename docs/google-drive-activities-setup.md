# SAGA Portal: Unified Google Sign-In, Drive, and Chat setup

SAGA uses one Google identity across portal login, Activities Drive features, and teacher Google Chat integration. This is an alternative to the existing SAGA email/password login; it does not replace SAGA roles, school membership, or class authorization.

## User flow

1. The person selects their school on the SAGA login page and chooses **Continue with Google**.
2. Google authenticates the account. SAGA verifies the OpenID Connect ID token, including Google's signature, issuer, audience, expiry, nonce, and verified email.
3. SAGA matches the Google email to an existing account in the selected school. It does not automatically create a user or grant access to another tenant. A student or teacher must use the email already registered by their school.
4. Students complete sign-in with Google identity only. Their verified SAGA email is used for class access and Google Chat membership invitations. Students are not asked to grant teacher-only Chat administration permissions.
5. Teachers are automatically redirected to a second Google consent step when Drive and Chat scopes are missing. This incremental authorization stores the encrypted refresh token in the existing teacher Google service connection, allowing the same account to power Drive Picker and Chat API actions. If a teacher declines the additional permissions, SAGA login still succeeds but the connected Drive and Chat actions remain unavailable until authorized.

Google authorization is server-side using the existing OAuth Web application client and callback. SAGA never receives the user's Google password.

## Google services and permissions

SAGA requests only the permissions needed for the enabled SAGA integrations:

- OpenID Connect `openid email profile` for SAGA login and verified account identity.
- `https://www.googleapis.com/auth/drive.file` for teacher-selected files through Google Picker. This is narrower than full Drive access.
- `https://www.googleapis.com/auth/chat.spaces.readonly` to list available Chat spaces.
- `https://www.googleapis.com/auth/chat.spaces.create` to create class spaces.
- `https://www.googleapis.com/auth/chat.memberships` to add, list, and remove class-space members.
- `https://www.googleapis.com/auth/chat.messages.create` to send class announcements.

SAGA does not request Gmail mailbox access or broad read/write access to every Drive file. Teacher service tokens are encrypted at rest. Access tokens are refreshed server-side and are not exposed as long-lived browser credentials. Students do not receive the teacher Chat scopes.

The Google Chat API permissions are user-delegated teacher permissions. Creating a class Chat space, sending messages, or managing memberships still requires a teacher role, ownership of the subject in the selected school, and an authorized Google Chat space. Students are invited using their verified SAGA email and must also be allowed by the relevant Google Chat organization policies.

## Google Cloud setup

Use the **same Google Cloud project and OAuth Web application client** already configured for SAGA's Google Chat integration. Do not create a new OAuth client or replace its client secret.

1. In that project, enable:
   - Google Drive API
   - Google Picker API
   - Google Chat API
2. In Google Auth Platform → Clients, open the existing Web application OAuth client.
3. Confirm its Authorized redirect URI includes the exact value used by `GOOGLE_REDIRECT_URI`, currently the SAGA callback:
   `/api/integrations/google/callback`.
   Do not remove the existing redirect URI; the legacy Chat reconnect path continues using it.
4. Add these Authorized JavaScript origins for Google Picker and Google Identity Services:
   - `https://my.sagaportal.online`
   - `https://faculty-grade-portal-git-feat-activities-45ffe4-kentbsece-7567.vercel.app` (SAGA Preview branch alias)
   - `http://localhost:3000` (local development only)
   Add any other actual SAGA hostnames only when they are used for testing.
5. Create a Google API key for Picker. Restrict it to the authorized SAGA website referrers using HTTP-referrer restrictions. Also allow the Google Picker iframe origin:
   `https://docs.google.com/*`.
6. Restrict the API key to the Google Picker API and Google Drive API. Do not leave the key unrestricted.
7. Record the Google Cloud **project number** (numeric value). Google Picker uses this as its App ID, not the project ID.
8. In Google Auth Platform → Data Access, confirm the configured consent screen lists the scopes above. Add test users or complete the required Google verification for the app's publishing status and requested Chat permissions before inviting external users.

Google recommends incremental authorization so applications request additional API permissions when those features are needed. SAGA therefore uses a minimal OpenID login first, then requests teacher Drive/Chat scopes only for teacher accounts.

## Vercel environment variables

Use the existing SAGA OAuth values in **Production and Preview**:

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Existing OAuth Web application client ID |
| `GOOGLE_CLIENT_SECRET` | Existing server-only OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Exact existing callback URI ending in `/api/integrations/google/callback` |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Existing 32-byte key encoded as 64-character hex or base64; encrypts teacher service tokens |
| `GOOGLE_DRIVE_API_KEY` | Restricted Google API key for Picker |
| `GOOGLE_DRIVE_APP_ID` | Numeric Google Cloud project number |

Keep the OAuth client secret and token encryption key server-only. Never use a `NEXT_PUBLIC_` prefix for them.

The following flags control only the optional Activities Drive controls. They do not control the availability of Google Sign-In on the SAGA login page:

| Variable | Value / purpose |
| --- | --- |
| `SAGA_ACTIVITIES_GOOGLE_DRIVE_EXPLORATION` | `true` to enable server-side Activities Drive routes |
| `NEXT_PUBLIC_SAGA_ACTIVITIES_GOOGLE_DRIVE_EXPLORATION` | `true` to show the optional Activities Drive controls |

For Production exploration, keep these existing Activities guards unchanged:

- `SAGA_ACTIVITIES_EXPLORATION_ONLY=true`
- `NEXT_PUBLIC_SAGA_ACTIVITIES_EXPLORATION_ONLY=true`
- `SAGA_ACTIVITIES_PUBLISH_ENABLED=false`
- `NEXT_PUBLIC_SAGA_ACTIVITIES_PUBLISH_ENABLED=false`
- `SAGA_ACTIVITIES_TEACHER_WRITE=false`
- `SAGA_ACTIVITIES_STUDENT_WRITE=false`

Do not switch on publishing, grading, student submissions, or general Activity writes as part of Google integration.

## Suggested verification sequence

1. Open the SAGA Preview branch alias and confirm the school list loads.
2. On the login page, select a school and click **Continue with Google**.
3. Test a Google email that already belongs to a teacher account at that school. Confirm the first screen signs in and the second consent step requests the Drive and Chat permissions.
4. Complete authorization and verify the teacher connection status reports the same email as the SAGA profile, with Drive and Chat enabled.
5. Open a class workspace. Confirm Google Chat controls show the connected account and the Activities draft shows **Select from Google Drive** without another Google Sign-In button.
6. Select a Drive file, save the Activity as a draft, and verify that only the Drive link is saved. Do not publish it during exploration. Share the file with enrolled students as viewers in Google Drive.
7. Sign in as a student using the Google email registered at the selected school. Confirm SAGA login succeeds and Drive resources open for that account when the teacher has shared them.
8. Test a Google account whose email does not match an existing account at the selected school. SAGA must reject access and must not create a user or expose another school's account.
9. Test a teacher who declines the second consent step. The SAGA login should still work, while Drive Picker and Chat actions remain disabled until permissions are granted.

Google identity does not override Drive file-sharing rules, Chat organization policies, SAGA tenant boundaries, class enrollment, or teacher/student roles.
