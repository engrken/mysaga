# SAGA Virtual Assistant and COGNIX integration

SAGA integrates with COGNIX through server-side routes only. Browser code never receives a COGNIX service token.

## SAGA Virtual Assistant

The former lesson-outline, study-guide, and practice-question generator has been retired. Teachers launch **Virtual Assistant** from the currently open class workspace. The assistant page does not display a list of other classes or provide a class switcher. To ask about another class, the teacher returns to **My classes** and opens that workspace first.

The assistant is a conversational, read-only copilot for two purposes:

1. Explain how to use SAGA features such as class roster, grading setup, assessment items, score entry, attendance, activities, final-grade submission, grade visibility, profile/security, and class chats.
2. Answer supported factual questions about the currently open class workspace, such as class overview, enrollment count, assessment item count and due dates, grade-sheet workflow state, attendance-session count, activity metadata, and student grade visibility.

## SAGA-local academic data boundary

For every message, SAGA authenticates an active, non-demo teacher and queries exactly one `Subject` with all of these predicates: the route's class subject ID, the authenticated `teacherId`, and the authenticated `schoolId`.

The adapter answers supported workspace questions inside SAGA. It can read the selected class's non-personal subject metadata, class-level relation counts, assessment titles and due dates, grade workflow status, attendance-session count, and activity titles/types/status/due dates. It does not load individual student names or IDs, student-level grades, scores, grade-change history, attendance marks, rosters, or activity submissions into the assistant conversation. It cannot change academic records or execute actions.

Questions requesting individual student details or marks are not answered in chat; the teacher is directed to the appropriate private SAGA workspace screen. Unsupported questions fail closed to a safe clarification. Requests are throttled to 20 messages per teacher per hour. Conversation text remains in the browser page state and is not saved as assistant history.

## Fixed-topic COGNIX system guidance

COGNIX is used only for generic SAGA product instructions. The SAGA adapter classifies the teacher's question locally into one allowlisted help-topic code, then sends only that fixed code to COGNIX using task `system-help`.

The COGNIX request contains only one enum value such as `score-entry` or `attendance`. It does **not** include the teacher's typed message, teacher or student identifiers, subject ID, class metadata, roster, assessment contents, grades, scores, attendance marks, or any other academic record. COGNIX cannot query the SAGA database.

The COGNIX virtual model is `vmc/saga-system-help`, targeting `openai/gpt-4.1-mini`, with AI Gateway provider filtering that excludes providers marked as training on prompts. This does **not** guarantee zero data retention. If COGNIX is unavailable, SAGA falls back to its built-in help instructions.

The COGNIX capability `learning-resource` is disabled. The old SAGA route `POST /api/cognix/academic-assistant` is retired and returns `410 feature_retired`. The separate COGNIX `teacher-summary` capability remains disabled; the SAGA compatibility endpoint remains disabled and does not query academic records or make an outbound request.

## Server environment

The SAGA production server uses:

- `COGNIX_API_URL`: `https://cognixph.vercel.app`.
- `COGNIX_API_KEY`: the SAGA-to-COGNIX server credential matching the SAGA application key (or the SAGA-only legacy fallback) configured in COGNIX.

Both values must stay server-side. Do not use a `NEXT_PUBLIC_` prefix or put either value in browser code.

## Safety boundaries

- SAGA remains authoritative for teacher authentication, class ownership, school scope, and all academic data.
- Workspace facts are queried and answered locally by SAGA; no academic records are sent to a model.
- COGNIX receives a fixed help-topic code only, never teacher free text or academic data.
- The assistant is read-only. It performs no grade calculations, student evaluation, attendance decisions, data mutation, or autonomous actions.
- Neither endpoint persists the conversation or logs message contents or generated text.
- AI-generated system guidance is instructional only; teachers remain responsible for using SAGA's authoritative on-screen workflow and validation messages.


## Technical incident event adapter

SAGA's database readiness endpoint reports a narrowly classified database-unavailable event to Cognix after returning its existing 503 health response. The server-side adapter sends only a generated event UUID, timestamp, fixed application/category/severity/component/operation/dependency codes, HTTP status, and environment. It never sends database errors, query text, request data, identities, tenant scope, or application records.

Delivery uses the existing server-only COGNIX_API_URL and COGNIX_API_KEY settings. It is best-effort, bounded by a two-second timeout, and does not change the health response. If Cognix is unavailable, SAGA retains its own degraded health result. This adapter does not enable any additional Cognix capability or application data access.
