"use client";

import { FormEvent, useEffect, useState } from "react";

type ClassInfo = { id: string; code: string; title: string; term: string; academicYear: string; gradeStatus: string; teacher: { fullName: string } };
type CategoryOption = { id: string; label: string };
type Question = { id: string; prompt: string; options: string[]; answer?: number };
type Submission = { text: string | null; driveUrl: string | null; points: number | null; feedback: string | null; submittedAt: string; graded?: boolean; gradedAt?: string | null; answers?: Record<string, number> };
type TeacherSubmission = Submission & { id: string; enrollment: { studentName: string } };
type Activity = {
  id: string; title: string; kind: "QUIZ" | "ASSIGNMENT"; instructions: string; maxScore: number;
  status: "DRAFT" | "OPEN" | "CLOSED"; practice: boolean; dueAt: string | null;
  categoryId?: string | null; itemWeight?: number | null; questions?: Question[];
  submission?: Submission | null; subject?: ClassInfo; _count?: { submissions: number };
};

const teacherPath = "/api/teacher/activities";
const studentPath = "/api/student/activities";
const formatDate = (value: string) => new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila"
}).format(new Date(value));
function dateInput(value?: string | null) {
  return value ? new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 16) : "";
}

async function request(url: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(url, { signal, cache: "no-store", ...(body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  } : {}) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || "Could not load or save the activity. Try again.");
  return data;
}

const baseDraft = {
  kind: "QUIZ" as Activity["kind"], title: "", instructions: "", practice: false,
  categoryId: "", due: "", maxScore: "20", itemWeight: "", questionIds: [] as string[]
};

export function TeacherActivities({ subjectId, categories, locked, readOnly, initialActivityId, onRecordChange }: {
  subjectId: string; categories: CategoryOption[]; locked: boolean; readOnly?: boolean;
  initialActivityId?: string; onRecordChange: () => Promise<void>;
}) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [bank, setBank] = useState<Question[]>([]);
  const [draft, setDraft] = useState(baseDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [active, setActive] = useState(initialActivityId || "");
  const [rows, setRows] = useState<TeacherSubmission[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submissionLoading, setSubmissionLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [questionKind, setQuestionKind] = useState("choice");
  const query = `${teacherPath}?subjectId=${encodeURIComponent(subjectId)}`;
  const selected = activities.find(activity => activity.id === active);
  const disabled = busy || locked || readOnly;

  useEffect(() => {
    const controller = new AbortController();
    request(query, undefined, controller.signal).then(data => {
      setActivities(data.activities);
      setBank(data.bank);
    }).catch(error => { if (!controller.signal.aborted) setFailure(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, revision]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setRows([]);
    setNextCursor(null);
    setSubmissionLoading(true);
    request(`${query}&activityId=${encodeURIComponent(active)}`, undefined, controller.signal).then(data => {
      setRows(data.submissions);
      setNextCursor(data.nextCursor);
    }).catch(error => { if (!controller.signal.aborted) setFailure(error.message); })
      .finally(() => { if (!controller.signal.aborted) setSubmissionLoading(false); });
    return () => controller.abort();
  }, [query, active, revision]);

  async function save(body: object, done: string, refreshRecord = false) {
    setBusy(true); setFailure(""); setMessage("");
    try {
      await request(teacherPath, body);
      setMessage(done);
      setRevision(current => current + 1);
      if (refreshRecord) {
        try { await onRecordChange(); }
        catch { setFailure("Saved. Reload Record Scores to see the update."); }
      }
      return true;
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not save the activity.");
      return false;
    } finally { setBusy(false); }
  }

  function edit(activity?: Activity) {
    setFailure("");
    setEditing(activity?.id ?? null);
    setDraft(activity ? {
      kind: activity.kind, title: activity.title, instructions: activity.instructions, practice: activity.practice,
      categoryId: activity.categoryId || "", due: dateInput(activity.dueAt), maxScore: String(activity.maxScore || 20),
      itemWeight: activity.itemWeight?.toString() ?? "", questionIds: activity.questions?.map(item => item.id) ?? []
    } : baseDraft);
    setFormOpen(true);
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await save({
      action: "draft", subjectId, activityId: editing ?? undefined, kind: draft.kind, title: draft.title,
      instructions: draft.instructions, practice: draft.practice, categoryId: draft.practice ? null : draft.categoryId || null,
      dueAt: draft.due ? new Date(`${draft.due}:00+08:00`).toISOString() : null,
      maxScore: draft.kind === "QUIZ" ? 1 : Number(draft.maxScore),
      itemWeight: draft.practice || !draft.itemWeight ? null : Number(draft.itemWeight),
      questionIds: draft.questionIds
    }, "Draft saved.")) setFormOpen(false);
  }

  async function addQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const options = questionKind === "boolean" ? ["True", "False"] : String(data.get("options")).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (await save({ action: "bank", question: { prompt: data.get("prompt"), options, answer: Number(data.get("answer")) - 1 } },
      "Question saved to your bank.")) form.reset();
  }

  async function loadMore() {
    setBusy(true);
    setFailure("");
    try {
      const data = await request(`${query}&activityId=${encodeURIComponent(active)}&cursor=${encodeURIComponent(nextCursor!)}`);
      setRows(current => [...current, ...data.submissions]);
      setNextCursor(data.nextCursor);
    } catch (error) { setFailure(error instanceof Error ? error.message : "Could not load submissions."); }
    finally { setBusy(false); }
  }

  return <section className="surface mb-3" aria-labelledby="class-activities-heading">
    <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
      <h2 id="class-activities-heading" className="mb-0">Class activities</h2>
      <button className="btn btn-primary btn-sm" disabled={disabled} type="button" onClick={() => edit()}>New activity</button>
    </div>
    {failure && <p className="alert alert-danger" role="alert">{failure}</p>}
    {message && <p className="alert alert-success" role="status">{message}</p>}
    {locked && <p className="small text-secondary">Recall the class record to draft before opening activities or recording grades.</p>}
    <details className="border rounded p-3 mb-3">
      <summary>Question bank · {bank.length} recent questions</summary>
      <p className="small text-secondary mt-2 mb-2">Multiple choice and true/false. Each correct answer earns one point.</p>
      <form onSubmit={addQuestion} className="d-grid gap-2">
        <label>Question type<select className="form-select" value={questionKind} onChange={event => setQuestionKind(event.target.value)}>
          <option value="choice">Multiple choice</option><option value="boolean">True / False</option>
        </select></label>
        <label>Question<textarea name="prompt" className="form-control" required maxLength={1000} rows={2}/></label>
        {questionKind === "choice"
          ? <><label>Answer options, one per line<textarea name="options" className="form-control" required rows={4} maxLength={1806}/></label>
            <label>Correct option number<input className="form-control" name="answer" type="number" min="1" max="6" required/></label></>
          : <label>Correct answer<select name="answer" className="form-select"><option value="1">True</option><option value="2">False</option></select></label>}
        <button className="btn btn-outline-primary justify-self-start" disabled={busy || readOnly}>Save question</button>
      </form>
    </details>
    {formOpen && <form className="border rounded p-3 mb-3 d-grid gap-3" onSubmit={saveDraft}>
      <h3 className="h6 mb-0">{editing ? "Edit draft" : "New activity draft"}</h3>
      <label>Type<select value={draft.kind} className="form-select" onChange={event => setDraft({ ...draft, kind: event.target.value as Activity["kind"] })}>
        <option value="QUIZ">Quiz</option><option value="ASSIGNMENT">Assignment</option>
      </select></label>
      <label>Title<input className="form-control" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} maxLength={120} required/></label>
      <label>Instructions<textarea className="form-control" rows={3} maxLength={8000} value={draft.instructions} onChange={event => setDraft({ ...draft, instructions: event.target.value })}/></label>
      <label>Deadline (Manila time)<input type="datetime-local" className="form-control" value={draft.due} onChange={event => setDraft({ ...draft, due: event.target.value })}/></label>
      <label><input type="checkbox" className="form-check-input me-2" checked={draft.practice} onChange={event => setDraft({ ...draft, practice: event.target.checked })}/>Practice only</label>
      {!draft.practice && <>
        <label>Record scores in<select className="form-select" value={draft.categoryId} onChange={event => setDraft({ ...draft, categoryId: event.target.value })}>
          <option value="">Choose before opening</option>
          {categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}
        </select></label>
        {!categories.length && <p className="small text-secondary mb-0">Create an assessment category in Grading setup before opening a graded activity.</p>}
        <label>Item weight (%)<input className="form-control" type="number" min="0.01" max="100" step="0.01" value={draft.itemWeight} onChange={event => setDraft({ ...draft, itemWeight: event.target.value })}/>
          <small>Leave blank if the category uses points without item weights.</small></label>
      </>}
      {draft.kind === "QUIZ" ? <fieldset>
        <legend className="h6">Select questions · {draft.questionIds.length} points</legend>
        {!bank.length && <p className="small text-secondary">Add questions to your bank above.</p>}
        <div className="overflow-auto border rounded p-2 d-grid gap-2" style={{ maxHeight: 260 }}>
          {bank.map(item => <label className="text-break" key={item.id}>
            <input className="form-check-input me-2" type="checkbox" checked={draft.questionIds.includes(item.id)}
              disabled={draft.questionIds.length >= 50 && !draft.questionIds.includes(item.id)}
              onChange={event => setDraft({ ...draft, questionIds: event.target.checked
                ? [...draft.questionIds, item.id] : draft.questionIds.filter(value => value !== item.id) })}/>
            {item.prompt}
          </label>)}
        </div>
      </fieldset> : <label>Maximum points<input className="form-control" type="number" min="0.01" step="0.01" max="100000" required value={draft.maxScore} onChange={event => setDraft({ ...draft, maxScore: event.target.value })}/></label>}
      <div className="d-flex flex-wrap gap-2"><button className="btn btn-primary" disabled={disabled}>Save draft</button><button type="button" className="btn btn-outline-secondary" onClick={() => setFormOpen(false)}>Cancel</button></div>
    </form>}
    {loading ? <p role="status">Loading activities…</p> : !activities.length && <p className="text-secondary">No activities in this class yet.</p>}
    <ul className="list-group mb-3">
      {activities.map(activity => <li key={activity.id} className="list-group-item d-flex flex-wrap gap-2 justify-content-between align-items-center">
        <div className="text-break"><b>{activity.title}</b><div className="small text-secondary">
          {activity.kind === "QUIZ" ? "Quiz" : "Assignment"} · {activity.status === "OPEN" && activity.dueAt && Date.parse(activity.dueAt) <= Date.now() ? "Deadline passed" : activity.status.toLowerCase()} · {activity.practice ? "Practice" : `${activity.maxScore} points`}{activity.dueAt ? ` · Due ${formatDate(activity.dueAt)}` : ""}
        </div></div>
        <div className="d-flex flex-wrap gap-2">
          {activity.status === "DRAFT" ? <>
            <button className="btn btn-sm btn-outline-secondary" type="button" disabled={disabled} onClick={() => edit(activity)}>Edit draft</button>
            <button className="btn btn-sm btn-primary" type="button" disabled={disabled} onClick={() =>
              void save({ action: "open", subjectId, activityId: activity.id }, "Activity opened.", true)}>Open activity</button>
          </> : <>
            <button className="btn btn-sm btn-outline-primary" type="button" disabled={busy} onClick={() => setActive(activity.id)}>Submissions ({activity._count?.submissions ?? 0})</button>
            {activity.status === "OPEN" && <button type="button" className="btn btn-sm btn-outline-secondary" disabled={busy || readOnly} onClick={() =>
              void save({ action: "close", subjectId, activityId: activity.id }, "Submissions closed.")}>Close submissions</button>}
          </>}
        </div>
      </li>)}
    </ul>
    {active && <section className="border rounded p-3">
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
        <h3 className="h6 mb-0">Submissions{selected ? ` · ${selected.title}` : ""}</h3>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setActive("")}>Hide submissions</button>
      </div>
      {submissionLoading ? <p role="status">Loading submissions…</p> : !rows.length && <p className="mb-0">No submissions yet.</p>}
      {rows.map(row => <article className="border-top py-3 text-break" key={row.id}>
        <b>{row.enrollment.studentName}</b><p className="small text-secondary mb-1">{formatDate(row.submittedAt)} · {row.gradedAt ? "Graded" : "Submitted"}</p>
        {row.text && <p style={{ whiteSpace: "pre-wrap" }}>{row.text}</p>}
        {row.driveUrl && <p><a href={row.driveUrl} target="_blank" rel="noreferrer">Open submitted file in Google Drive</a></p>}
        {selected?.kind === "ASSIGNMENT" ? <form className="d-grid gap-2" key={`${row.id}-${row.gradedAt}`} onSubmit={event => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          void save({ action: "grade", activityId: active, subjectId, submissionId: row.id,
            points: Number(fields.get("points")), feedback: String(fields.get("feedback") ?? "") }, "Grade recorded.", true);
        }}>
          <label>Score out of {selected.maxScore}<input name="points" className="form-control" type="number" step="0.01" min="0" max={selected.maxScore} required defaultValue={row.points ?? ""}/></label>
          <label>Feedback<textarea name="feedback" className="form-control" maxLength={4000} defaultValue={row.feedback ?? ""}/></label>
          <button className="btn btn-outline-primary btn-sm" disabled={disabled}>Save grade</button>
        </form> : row.points !== null && <span>{row.points} / {selected?.maxScore ?? "—"}</span>}
      </article>)}
      {nextCursor && <button type="button" className="btn btn-outline-primary btn-sm" disabled={busy} onClick={() => void loadMore()}>Load more submissions</button>}
    </section>}
  </section>;
}

type Recent = { id: string; updatedAt: string; gradedAt: string | null; enrollment: { studentName: string };
  activity: { id: string; title: string; subject: { id: string; code: string; title: string } } };

export function RecentActivitySubmissions({ onOpen }: { onOpen: (subjectId: string, activityId: string) => void }) {
  const [rows, setRows] = useState<Recent[] | null>(null);
  const [failure, setFailure] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    request(`${teacherPath}?view=recent`, undefined, controller.signal).then(data => setRows(data.submissions))
      .catch(() => { if (!controller.signal.aborted) setFailure(true); });
    return () => controller.abort();
  }, []);
  return <section className="surface mb-3" aria-labelledby="recent-submissions-heading">
    <h2 id="recent-submissions-heading">Recent submissions</h2>
    {failure ? <p className="text-secondary mb-0">Could not load recent submissions.</p>
      : rows === null ? <p className="text-secondary mb-0" role="status">Loading submissions…</p>
      : !rows.length ? <p className="text-secondary mb-0">No submissions yet.</p>
      : <ul className="list-group list-group-flush">
        {rows.map(row => <li className="list-group-item px-0 text-break" key={row.id}>
          <button className="btn btn-link text-start p-0" type="button" onClick={() => onOpen(row.activity.subject.id, row.activity.id)}>{row.activity.title}</button>
          <div className="small text-secondary">{row.enrollment.studentName} · {row.activity.subject.code} · {row.gradedAt ? "Graded" : "Submitted"} · {formatDate(row.updatedAt)}</div>
        </li>)}
      </ul>}
  </section>;
}

export function StudentActivities({ readOnly }: { readOnly?: boolean }) {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [classId, setClassId] = useState("");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [active, setActive] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [revision, setRevision] = useState(0);
  const query = classId ? `?subjectId=${encodeURIComponent(classId)}` : "";
  const selected = classes.find(item => item.id === classId);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailure("");
    request(studentPath + query, undefined, controller.signal).then(data => { setClasses(data.classes); setActivities(data.activities); })
      .catch(error => { if (!controller.signal.aborted) setFailure(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, revision]);

  async function open(id: string) {
    setFailure(""); setBusy(true);
    try {
      const data = await request(`${studentPath}?activityId=${encodeURIComponent(id)}`);
      setActive(data.activities[0]);
    } catch (error) { setFailure(error instanceof Error ? error.message : "Could not open activity."); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    const fields = new FormData(event.currentTarget);
    setFailure(""); setBusy(true);
    try {
      const payload = active.kind === "QUIZ" ? {
        answers: Object.fromEntries((active.questions ?? []).map(q => [q.id, Number(fields.get(q.id))]))
      } : { text: fields.get("text"), driveUrl: fields.get("driveUrl") };
      await request(studentPath, { activityId: active.id, ...payload });
      setActive(null);
      setRevision(current => current + 1);
    } catch (error) { setFailure(error instanceof Error ? error.message : "Could not submit the activity."); }
    finally { setBusy(false); }
  }

  const deadlinePassed = active?.dueAt ? Date.parse(active.dueAt) <= Date.now() : false;
  const canSubmit = active && active.status === "OPEN" && !deadlinePassed &&
    (active.practice || active.subject?.gradeStatus === "DRAFT");

  return <section className="surface mb-3" aria-labelledby="student-activities-heading">
    <div className="d-flex flex-wrap justify-content-between gap-2 align-items-center mb-2">
      <h2 id="student-activities-heading" className="mb-0">Activities and submissions</h2>
      <label>Class<select className="form-select form-select-sm" disabled={busy} value={classId} onChange={event => {
        setActive(null); setClassId(event.target.value);
      }}>
        <option value="">All classes</option>
        {classes.map(item => <option value={item.id} key={item.id}>{item.code} · {item.title} ({item.term}, {item.academicYear})</option>)}
      </select></label>
    </div>
    {selected && <p className="small text-secondary">{selected.code} · {selected.teacher.fullName} · {selected.term} {selected.academicYear}</p>}
    {failure && <p className="alert alert-danger" role="alert">{failure}</p>}
    {loading ? <p role="status">Loading activities…</p> : !activities.length && <p className="text-secondary mb-0">No activities have opened for these classes.</p>}
    <ul className="list-group list-group-flush">
      {activities.map(item => <li key={item.id} className="list-group-item px-0 text-break">
        <button className="btn btn-link text-start p-0" type="button" disabled={busy} onClick={() => void open(item.id)}>{item.title}</button>
        <div className="small text-secondary">
          {item.subject?.code} · {item.kind === "QUIZ" ? "Quiz" : "Assignment"} · {item.submission
            ? item.submission.graded ? "Graded" : "Submitted"
            : item.status === "CLOSED" || (item.dueAt && Date.parse(item.dueAt) <= Date.now()) ? "Closed" : "Not submitted"}
          {item.dueAt ? ` · Due ${formatDate(item.dueAt)} Manila time` : ""}
        </div>
      </li>)}
    </ul>
    {active && <article className="border rounded p-3 mt-3 text-break">
      <div className="d-flex flex-wrap justify-content-between gap-2 mb-2">
        <h3 className="h6 mb-0">{active.title}</h3>
        <button className="btn btn-sm btn-outline-secondary" type="button" disabled={busy} onClick={() => setActive(null)}>Close details</button>
      </div>
      <p className="small text-secondary">{active.subject?.code} · {active.maxScore} points{active.practice ? " · Practice" : ""}</p>
      {active.instructions && <p style={{ whiteSpace: "pre-wrap" }}>{active.instructions}</p>}
      {active.submission ? <div>
        <p><b>My submission</b> · {formatDate(active.submission.submittedAt)} Manila time</p>
        {active.submission.text && <p style={{ whiteSpace: "pre-wrap" }}>{active.submission.text}</p>}
        {active.submission.driveUrl && <p><a href={active.submission.driveUrl} target="_blank" rel="noreferrer">Open my submitted file</a></p>}
        {active.questions?.map(q => <p key={q.id}><strong>{q.prompt}</strong><br/>{q.options[active.submission?.answers?.[q.id] ?? -1]}</p>)}
        {active.submission.points !== null ? <p>Score · <strong>{active.submission.points} / {active.maxScore}</strong></p>
          : <p>{active.submission.graded ? "Your grade has not been released." : "Waiting for grading."}</p>}
        {active.submission.feedback && <p style={{ whiteSpace: "pre-wrap" }}>{active.submission.feedback}</p>}
      </div> : canSubmit ? <form key={active.id} onSubmit={submit} className="d-grid gap-3">
        {active.kind === "QUIZ" ? active.questions?.map((question, index) => <fieldset className="border rounded p-2" key={question.id}>
          <legend className="float-none fs-6 mb-1">{index + 1}. {question.prompt}</legend>
          {question.options.map((option, optionIndex) => <label className="d-block py-1" key={optionIndex}>
            <input name={question.id} className="form-check-input me-2" type="radio" value={optionIndex} required/>{option}
          </label>)}
        </fieldset>) : <>
          <label>Text response<textarea name="text" className="form-control" maxLength={12000} rows={4}/></label>
          <label>Google Drive link<input type="url" name="driveUrl" className="form-control" maxLength={2048}/>
            <small>Share the file with your teacher in Drive before submitting. Add a text response, a link, or both.</small></label>
        </>}
        <button className="btn btn-primary" disabled={busy || readOnly}>{busy ? "Submitting…" : "Submit work"}</button>
      </form> : <p className="mb-0">Submissions are closed.</p>}
    </article>}
  </section>;
}
