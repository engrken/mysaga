# COGNIX integration status (SAGA)

SAGA integrates with COGNIX through server-side routes only. Browser code never receives a COGNIX service token.

## Enabled capability: Class-contextual academic resource drafting

Teachers open **Academic Assistant** from the SAGA top navigation. When launched from a class workspace, the active subject is preselected. Otherwise, the teacher chooses from a list of subjects owned by their authenticated teacher account in the current school.

For each generation request, SAGA authenticates an active, non-demo teacher and performs one ownership-scoped lookup of the selected `Subject` row. It selects only these scalar instructional fields:

- Subject title.
- Subject/course code.
- Course/year label.
- Term.

The teacher also selects a learning level and resource type and supplies a short generic topic or learning competency. SAGA does not load or query enrollments, student names or identifiers, rosters, assessments, activities, scores, grades, grade-change history, or attendance for this feature. The internal subject ID is used only by SAGA to verify ownership and is not sent to COGNIX.

The Academic Assistant is launched from the current class workspace when a class is active. From the global assistant link, a teacher selects one of their own class subjects before generating a draft. School ID and teacher ID are not sent to COGNIX either. The request endpoint applies a 10-request-per-hour per-teacher limit.

## External model processing disclosure

The selected subject metadata, learning level, resource type, and generic topic are sent through COGNIX to the AI Gateway virtual model `vmc/academic-assistant`. This model's configuration enforces the Gateway no-prompt-training provider filter. This does **not** guarantee zero data retention. The interface discloses these fields and prohibits personal, confidential, or record-level information.

SAGA does not currently provide official curriculum guides or learning-competency documents to COGNIX. A teacher may enter a competency or topic as generic text, but the model must not claim official DepEd, CHED, or institutional curriculum alignment unless verified standards are supplied in a future approved integration. Generated materials are drafts and require teacher review for factual accuracy, age-appropriateness, and classroom suitability.

## Disabled experiment: Teacher summary

The previous `POST /api/cognix/teacher-summary` experiment remains disabled. It returns `403 capability_disabled` before querying subjects, enrollments, assessments, or grade workflows. It makes no outbound request to COGNIX.

## Server environment

The SAGA production server uses:

- `COGNIX_API_URL`: `https://cognixph.vercel.app`.
- `COGNIX_API_KEY`: the SAGA-to-COGNIX server credential matching the SAGA application key (or the SAGA-only legacy fallback) configured in COGNIX.

Both values must stay server-side. Do not use a `NEXT_PUBLIC_` prefix or put either value in browser code.

## Safety boundaries

- SAGA remains authoritative for teacher authentication and school scope.
- COGNIX receives only the selected subject's instructional metadata and generic resource request; it has no direct SAGA database connection.
- Requests and responses are not persisted by the integration endpoints.
- Logs contain only request IDs, task labels, duration, and token counts—not prompts or generated text.
- No grade calculations, student evaluation, attendance decisions, academic record changes, or autonomous actions are enabled.
