# COGNIX integration status (SAGA)

The initial SAGA-to-COGNIX teacher-summary experiment is **disabled** pending privacy review. There is currently no teacher-facing COGNIX feature in SAGA.

## Current behavior

The existing server-side entry point, `POST /api/cognix/teacher-summary`, is retained temporarily for a safe, explicit response to any stale caller. It:

- Requires SAGA's authenticated, non-demo teacher session.
- Returns `403 capability_disabled`.
- Does not query subjects, enrollments, assessments, or grade workflow records.
- Does not make an outbound request to COGNIX.
- Does not send any teacher or academic data outside SAGA.

## Why it is disabled

The original experiment sent teacher-scoped workload aggregates to an external model endpoint. Aggregate counts can still describe an identifiable teacher's activities and are not automatically anonymous. This use case has not been established as necessary and proportionate, and the current free model endpoint is not approved for confidential production information.

## Requirements before reconsidering

A future COGNIX integration must have:

1. A specific, documented purpose that benefits from model processing.
2. A necessity and proportionality assessment, including a local-processing alternative.
3. An approved data contract that excludes unnecessary personal and academic information.
4. Review of provider retention, training/improvement use, data processing terms, and deployment configuration.
5. Appropriate notices, authorization, and approval from the responsible privacy/governance owners.
6. Synthetic-data testing before production data is considered.

Until those requirements are satisfied, keep `COGNIX_API_URL` and `COGNIX_API_KEY` unconfigured in SAGA. Never expose a service credential to a browser.
