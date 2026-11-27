# SAGA Activities: Google Drive and Google identity setup

This integration is an optional **Activities exploration** capability. It does not turn on publishing, grading, student submissions, or other Activity writes.

## What the integration does

- Teachers can sign in with Google from a class Activity draft and use Google Picker to select a Drive file as the Activity material link.
- Students can verify a Google account before opening a Google Drive resource or Drive-based submission attachment.
- Google ID tokens are verified by SAGA on the server. The Google account's verified email must match the email on the currently signed-in SAGA account (trimmed and case-insensitive).
- A mismatch blocks the action. Students are told to select the correct Google account or contact their subject teacher to correct/confirm their registered SAGA email.
- SAGA stores the selected Drive URL in the Activity record. It does not copy the Drive file contents, change Drive sharing permissions, or persist the temporary Google access token.
- The teacher must share the resource with enrolled students as viewers in Google Drive. The Google sign-in check does not grant file permission.

Google Drive actions remain separate from the existing Google Chat integration and its OAuth callback/scopes.

## Google Cloud setup

Use the existing Google OAuth **Web application client ID** already configured for SAGA's Google Chat integration. Do not place the client secret in browser code.

1. In the same Google Cloud project, enable **Google Drive API** and **Google Picker API**.
2. Open the existing OAuth Web application client and add these Authorized JavaScript origins:
   - `https://my.sagaportal.online`
   - `https://mysaga.vercel.app` (if this hostname is used)
   - `http://localhost:3000` (local development only)
3. Create a Google API key for Picker. Restrict it to the SAGA web origins using HTTP referrer restrictions. Also allow the Google Picker iframe origin required by the Picker integration (Google documents the `docs.google.com` origin for this purpose).
4. Restrict the API key to only the Google Picker API and Google Drive API. Do not leave the key unrestricted.
5. Record the Google Cloud project **number**. Picker uses this as its App ID.

The teacher Picker requests the narrow `https://www.googleapis.com/auth/drive.file` scope, which is intended for files the user chooses with the app, rather than broad access to the whole Drive.

## Vercel environment variables

Add the following values to the SAGA Vercel project. The server-side and public feature switches must both be enabled for the UI and API to operate.

| Variable | Value / purpose |
| --- | --- |
| `GOOGLE_DRIVE_API_KEY` | Restricted Google API key for Picker |
| `GOOGLE_DRIVE_APP_ID` | Google Cloud project number (not project ID) |
| `SAGA_ACTIVITIES_GOOGLE_DRIVE_EXPLORATION` | `true` to enable server-side Drive identity/Picker routes |
| `NEXT_PUBLIC_SAGA_ACTIVITIES_GOOGLE_DRIVE_EXPLORATION` | `true` to show the optional controls in Activities |

The existing `GOOGLE_CLIENT_ID` is reused for Google Identity Services and the Picker OAuth token client. Keep `GOOGLE_CLIENT_SECRET` and `GOOGLE_TOKEN_ENCRYPTION_KEY` server-only; this feature does not need to expose either one.

For production exploration, keep these existing guards unchanged:

- `SAGA_ACTIVITIES_EXPLORATION_ONLY=true`
- `SAGA_ACTIVITIES_PUBLISH_ENABLED=false`
- `SAGA_ACTIVITIES_TEACHER_WRITE=false`
- `SAGA_ACTIVITIES_STUDENT_WRITE=false`
- `NEXT_PUBLIC_SAGA_ACTIVITIES_PUBLISH_ENABLED=false`
- `NEXT_PUBLIC_SAGA_ACTIVITIES_STUDENT_WRITE=false`

Do not switch on publishing, grading, student submissions, or general Activity writes as part of this Google integration.

## Suggested verification sequence

1. Enable Google Drive exploration only after the OAuth JavaScript origins, APIs, Picker API key, and project number have been configured.
2. Sign in as a teacher whose SAGA email matches the Google account email. Open a class, add or edit an Activity draft, and select a Drive file from the Picker.
3. Confirm that only the Drive link is placed in the draft, save the draft, and verify it can be previewed. Do not publish it during exploration.
4. Sign in to a student SAGA account whose email matches a Google account. Open an already available Drive resource or legacy Drive attachment and complete the Google identity check.
5. Repeat with a different Google email. The action should be blocked with the message to choose the registered account or contact the subject teacher.
6. Confirm that students cannot use the feature to bypass Activity publishing or submission restrictions.

Google sign-in verifies the identity used for the SAGA action. It does not guarantee the file has been shared with that person. Google Drive still enforces the file's actual sharing permissions.
