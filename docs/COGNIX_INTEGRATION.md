# COGNIX integration (SAGA)

SAGA exposes a teacher-facing entry point at `POST /api/cognix/teacher-summary`. That server-side route calls the versioned COGNIX endpoint `POST /api/v1/agent`.

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

Configure these on the SAGA Vercel project:

- `COGNIX_API_URL`: `https://cognixph.vercel.app`.
- `COGNIX_API_KEY`: the high-entropy SAGA-to-COGNIX service credential. It must match either `COGNIX_SAGA_API_KEY` or the SAGA-only compatibility fallback `COGNIX_API_KEY` configured on COGNIX.

The endpoint fails closed with 503 when either setting is absent or the URL is not HTTPS. Do not use a `NEXT_PUBLIC_` prefix.

## Versioned request

SAGA sends the following application-scoped contract from its server only:

    {
      "apiVersion": "1",
      "app": "saga",
      "task": "teacher-summary",
      "requestId": "saga-generated-correlation-id",
      "input": {
        "reportingPeriod": {
          "start": "YYYY-MM-DD",
          "endExclusive": "YYYY-MM-DD",
          "timezone": "Asia/Manila"
        },
        "totals": {
          "assignedSubjects": 0,
          "enrollmentRecords": 0,
          "assessmentsDueWithinSevenDays": 0,
          "gradeWorkflow": {
            "draftSubjects": 0,
            "submittedSubjects": 0,
            "verifiedSubjects": 0
          }
        }
      }
    }

COGNIX validates the request against a strict aggregate-only schema. It does not accept caller-supplied teacher IDs, school IDs, student-level rows, grades, or attendance records.

## Response

A successful response uses the common COGNIX envelope with `apiVersion`, `status`, `app`, `task`, `requestId`, `answer`, `sources`, `warnings`, and model usage metadata. COGNIX also returns `summary` as a compatibility alias for the existing SAGA UI. SAGA currently forwards the complete response to its caller.

Errors return a safe error code and message. SAGA does not expose the COGNIX service token to the browser.

## Safety boundaries

- SAGA remains authoritative for teacher authentication, school scope, and record access.
- COGNIX receives aggregate counts only and generates a bounded text summary.
- One model call maximum; no tool calls or write actions for this task.
- No grade calculations, grade changes, attendance changes, or database writes.
- A request ID is for correlation only and is not an idempotency guarantee.
