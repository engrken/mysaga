# COGNIX pilot integration (SAGA)

The first SAGA pilot endpoint is `POST /api/cognix/teacher-summary`.

## Security model

- Requires SAGA's existing authenticated teacher session.
- Rejects demo sessions.
- Derives teacher and school scope from the verified session; callers cannot supply IDs or scopes.
- Queries only subjects assigned to that teacher in that school.
- Sends aggregate counts only: assigned subjects, enrollment records, assessments due within seven days, and grade-workflow subject counts.
- Does not send student names, student numbers, grades, assessment scores, attendance marks, or raw database records.
- No SAGA data is written or modified.
- COGNIX is called only from SAGA server-side code. The browser never receives the COGNIX service token.

## Server environment

Configure these on the SAGA Vercel project only after the COGNIX deployment is ready:

- `COGNIX_API_URL`: COGNIX deployment origin, for example `https://cognix-kentbsece-7567.vercel.app`.
- `COGNIX_API_KEY`: a long, unique server-to-server secret. It must match `COGNIX_API_KEY` configured on COGNIX.

The endpoint fails closed with 503 when either setting is absent or the URL is not HTTPS. Do not use a `NEXT_PUBLIC_` prefix.

## Current limitation

COGNIX's agent endpoint currently returns `503 not_configured` until its model runtime, authorization policy, and budget controls are enabled. Therefore this SAGA endpoint is scaffolded but will not produce AI answers until COGNIX is explicitly configured and deployed. Do not enable a paid model without reviewing pricing and spend controls first.
