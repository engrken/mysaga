# COGNIX integration status (SAGA)

SAGA integrates with COGNIX through server-side routes only. Browser code never receives a COGNIX service token.

## Enabled capability: Academic resource drafting

Teachers can open **Academic Assistant** from the SAGA top navigation. It generates general lesson outlines, study guides, and practice questions from:

- A fixed resource type.
- A fixed subject selection.
- A fixed learning-level selection.
- A short generic academic topic.

It does not query SAGA academic records, classes, rosters, students, assessments, grades, or attendance. The request contains no teacher or student identifier. Only an authenticated, non-demo teacher can use the SAGA proxy endpoint, which also applies a 10-request-per-hour per-teacher limit.

### External model processing disclosure

The generic topic and selected settings are processed by the COGNIX Academic Agent using the AI Gateway virtual model `vmc/academic-assistant`. This model's configuration enforces the Gateway no-prompt-training provider filter. This does **not** guarantee zero data retention. The UI tells teachers not to enter personal, confidential, or record-level information.

Generated materials are drafts and require teacher review for factual accuracy and curriculum fit. Do not treat the generated content as official school policy or an official curriculum determination.

## Disabled experiment: Teacher summary

The previous `POST /api/cognix/teacher-summary` experiment remains disabled. It returns `403 capability_disabled` before querying subjects, enrollments, assessments, or grade workflows. It makes no outbound request to COGNIX.

## Server environment

The SAGA production server uses:

- `COGNIX_API_URL`: `https://cognixph.vercel.app`.
- `COGNIX_API_KEY`: the SAGA-to-COGNIX server credential matching the SAGA application key (or the SAGA-only legacy fallback) configured in COGNIX.

Both values must stay server-side. Do not use a `NEXT_PUBLIC_` prefix or put either value in browser code.

## Safety boundaries

- SAGA remains authoritative for teacher authentication and school scope.
- COGNIX receives generic topic input only; no SAGA data access or direct database connection exists.
- Requests and responses are not persisted by the integration endpoints.
- Logs contain only request IDs, task labels, duration, and token counts—not prompts or generated text.
- No grade calculations, student evaluation, attendance decisions, academic record changes, or autonomous actions are enabled.
