"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { StudentR2Uploader } from "@/components/StudentR2Uploader";
import { TeacherSubmissionViewer } from "@/components/TeacherSubmissionViewer";
import { ActivityRichEditor } from "@/components/ActivityRichEditor";
import { activitiesExplorationOnly, activitiesPublishEnabled, activitiesReadOnly, activitiesStudentReadOnly } from "@/lib/activity-feature-flags.client";

type ClassInfo = { id: string; code: string; title: string; term: string; academicYear: string; gradeStatus: string; teacher: { fullName: string } };
type CategoryOption = { id: string; label: string };
type QuestionType = "MULTIPLE_CHOICE" | "TRUE_FALSE" | "ESSAY" | "SHORT_ANSWER";
type LessonPage = { id: string; title: string; content: string; nextPageId: string | null; branches: { label: string; targetPageId: string }[] };
type Attachment = { pathname: string; filename: string; contentType: string; size: number };
type InlineQuestion = { type: QuestionType; prompt: string; choices: string; answer: string; answerText: string; points: string };
type Question = { id: string; type: QuestionType; prompt: string; options: string[]; answer?: number; answerText?: string; points: number };
type BankQuestionItem = Pick<Question, "id" | "prompt" | "type" | "points"> & { topic: string | null };
type StorageProvider = "GOOGLE_DRIVE" | "CLOUDFLARE_R2";
type SubmissionAttachment = { id: string; storageProvider: StorageProvider;
  fileUrl: string | null; fileName: string; fileSize: number; mimeType: string; createdAt: string };
type Submission = { id: string; text: string | null; driveUrl: string | null; files?: Attachment[];
  attachments?: SubmissionAttachment[];
  storageProvider?: StorageProvider | null; fileKey?: string | null; fileUrl?: string | null;
  fileName?: string | null; fileSize?: number | null; mimeType?: string | null; offline?: boolean;
  points: number | null; feedback: string | null; submittedAt: string; graded?: boolean; gradedAt?: string | null;
  answers?: Record<string, string | number> };
type TeacherSubmission = Submission & { id: string; enrollment: { id: string; studentName: string; studentNumber: string | null } };
type RosterStudent = { id: string; studentName: string; studentNumber: string | null };
type QuizAttempt = { id: string; enrollmentId: string; attemptNumber: number; answers: Record<string, string | number>;
  points: number | null; feedback: string | null; manualGrades?: Record<string, number>; startedAt: string; submittedAt: string | null;
  gradedAt: string | null; enrollment: { studentName: string; studentNumber: string | null } };
type QuizStats = { title: string; attempts: number; gradedAttempts: number; students: number; classAverage: number | null;
  maxScore: number; distribution: { range: string; count: number }[];
  questions: { id: string; prompt: string; type: QuestionType; attempts: number; facilityIndex: number | null;
    standardDeviation: number; discriminationIndex: number | null }[] };
type Activity = {
  id: string; title: string; kind: "QUIZ" | "ASSIGNMENT" | "RESOURCE" | "LESSON"; topic?: string | null;
  instructions: string; maxScore: number; status: "DRAFT" | "OPEN" | "CLOSED"; practice: boolean;
  dueAt: string | null; availableAt?: string | null; materialUrl?: string | null; categoryId?: string | null;
  itemWeight?: number | null; questions?: Question[]; lessonPages?: LessonPage[];
  timeLimitMinutes?: number | null; attemptsAllowed?: number; gradingMethod?: string; releaseGrade?: boolean;
  releaseAnswers?: boolean; attempts?: { id: string; attemptNumber: number; startedAt: string;
    submittedAt: string | null; points: number | null; graded: boolean; feedback?: string | null }[];
  attemptsRemaining?: number; submission?: Submission | null; subject?: ClassInfo; _count?: { submissions: number };
};
const activityLabels = { ASSIGNMENT: "Assignment", QUIZ: "Quiz", RESOURCE: "Resource", LESSON: "Lesson" };
const activityDescriptions = {
  ASSIGNMENT: "Collect written work and direct-to-cloud file uploads; grade online and offline work.",
  QUIZ: "Build quizzes from reusable multiple-choice, true/false, short-answer, and essay questions.",
  RESOURCE: "Share instructions, readings, or a Google Drive file.",
  LESSON: "Create rich-content pages with sequential navigation and branching choices."
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
  kind: "ASSIGNMENT" as Activity["kind"], title: "", topic: "", instructions: "", practice: false,
  categoryId: "", due: "", opens: "", materialUrl: "", maxScore: "20", itemWeight: "", questionIds: [] as string[],
  inline: [] as InlineQuestion[], timeLimitMinutes: "", attemptsAllowed: "1", gradingMethod: "HIGHEST",
  releaseGrade: true, releaseAnswers: false,
  lessonPages: [{ id: "page-1", title: "Introduction", content: "<p></p>", nextPageId: null, branches: [] }] as LessonPage[]
};

export function TeacherActivities({ subjectId, categories, locked, readOnly, initialActivityId, onRecordChange }: {
  subjectId: string; categories: CategoryOption[]; locked: boolean; readOnly?: boolean;
  initialActivityId?: string; onRecordChange: () => Promise<void>;
}) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [bank, setBank] = useState<BankQuestionItem[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [bankTopic, setBankTopic] = useState("all");
  const [choosing, setChoosing] = useState(false);
  const [draft, setDraft] = useState(baseDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [useBank, setUseBank] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [active, setActive] = useState(initialActivityId || "");
  const [rows, setRows] = useState<TeacherSubmission[]>([]);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [quizAttempts, setQuizAttempts] = useState<QuizAttempt[]>([]);
  const [stats, setStats] = useState<QuizStats | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submissionLoading, setSubmissionLoading] = useState(!!initialActivityId);
  const [clockNow, setClockNow] = useState(0);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [questionKind, setQuestionKind] = useState<QuestionType>("MULTIPLE_CHOICE");
  const query = `${teacherPath}?subjectId=${encodeURIComponent(subjectId)}`;
  const bankQuery = bankTopic === "all" ? query : `${query}&topic=${encodeURIComponent(bankTopic === "untagged" ? "" : bankTopic.slice(6))}`;
  const selected = activities.find(activity => activity.id === active);
  const featureReadOnly = !!readOnly || activitiesReadOnly;
  const explorationOnly = activitiesExplorationOnly;
  const disabled = busy || locked || featureReadOnly;
  const actionDisabled = disabled || explorationOnly;

  useEffect(() => {
    const firstTick = setTimeout(() => setClockNow(Date.now()), 0);
    const interval = setInterval(() => setClockNow(Date.now()), 30_000);
    return () => { clearTimeout(firstTick); clearInterval(interval); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    request(bankQuery, undefined, controller.signal).then(data => {
      setActivities(data.activities);
      setBank(data.bank);
      setTopics(data.topics);
    }).catch(error => { if (!controller.signal.aborted) setFailure(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [bankQuery, revision]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    request(`${query}&activityId=${encodeURIComponent(active)}`, undefined, controller.signal).then(data => {
      setRows(data.submissions);
      setRoster(data.roster ?? []);
      setQuizAttempts(data.quizAttempts ?? []);
      setStats(null);
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

  function edit(activity?: Activity, kind = baseDraft.kind) {
    setChoosing(false);
    setFailure("");
    setEditing(activity?.id ?? null);
    const questions = activity?.questions ?? [];
    const bankIds = questions.filter(item => !item.id.startsWith("inline-")).map(item => item.id);
    setUseBank(bankIds.length > 0);
    setDraft(activity ? {
      kind: activity.kind, title: activity.title, topic: activity.topic ?? "", instructions: activity.instructions, practice: activity.practice,
      categoryId: activity.categoryId || "", due: dateInput(activity.dueAt), maxScore: String(activity.maxScore || 20),
      itemWeight: activity.itemWeight?.toString() ?? "", questionIds: bankIds,
      materialUrl: activity.materialUrl ?? "", opens: dateInput(activity.availableAt),
      inline: questions.filter(item => item.id.startsWith("inline-")).map(item => ({
        type: item.type ?? (item.options.join("|") === "True|False" ? "TRUE_FALSE" : "MULTIPLE_CHOICE"),
        prompt: item.prompt, choices: item.options.join("\n"),
        answer: String((item.answer ?? 0) + 1), answerText: item.answerText ?? "", points: String(item.points ?? 1)
      })),
      timeLimitMinutes: activity.timeLimitMinutes?.toString() ?? "",
      attemptsAllowed: String(activity.attemptsAllowed ?? 1), gradingMethod: activity.gradingMethod ?? "HIGHEST",
      releaseGrade: activity.releaseGrade ?? true, releaseAnswers: activity.releaseAnswers ?? false,
      lessonPages: activity.lessonPages?.length ? activity.lessonPages : baseDraft.lessonPages
    } : { ...baseDraft, kind });
    setFormOpen(true);
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const inlineQuestions = draft.kind === "QUIZ" ? draft.inline.map(question => ({
      type: question.type, prompt: question.prompt,
      options: question.type === "TRUE_FALSE" ? ["True", "False"]
        : question.type === "MULTIPLE_CHOICE" ? question.choices.split(/\r?\n/).map(choice => choice.trim()).filter(Boolean) : [],
      answer: ["MULTIPLE_CHOICE", "TRUE_FALSE"].includes(question.type) ? Number(question.answer) - 1 : 0,
      answerText: question.type === "SHORT_ANSWER" ? question.answerText.trim() : undefined,
      points: Number(question.points || 1)
    })) : [];
    if (await save({
      action: "draft", subjectId, activityId: editing ?? undefined, kind: draft.kind,
      title: draft.title, instructions: draft.instructions, topic: draft.topic, practice: draft.practice,
      categoryId: draft.practice ? null : draft.categoryId || null,
      dueAt: draft.due && ["ASSIGNMENT", "QUIZ"].includes(draft.kind)
        ? new Date(`${draft.due}:00+08:00`).toISOString() : null,
      maxScore: draft.kind === "QUIZ" ? 1 : Number(draft.maxScore),
      itemWeight: draft.practice || !draft.itemWeight ? null : Number(draft.itemWeight),
      materialUrl: draft.kind !== "QUIZ" ? draft.materialUrl.trim() || null : null,
      availableAt: draft.opens ? new Date(`${draft.opens}:00+08:00`).toISOString() : null,
      questionIds: draft.kind === "QUIZ" && useBank ? draft.questionIds : [],
      inlineQuestions, timeLimitMinutes: draft.kind === "QUIZ" && draft.timeLimitMinutes ? Number(draft.timeLimitMinutes) : null,
      attemptsAllowed: Number(draft.attemptsAllowed), gradingMethod: draft.gradingMethod,
      releaseGrade: draft.releaseGrade, releaseAnswers: draft.releaseAnswers,
      lessonPages: draft.kind === "LESSON" ? draft.lessonPages : undefined
    }, "Draft saved.")) setFormOpen(false);
  }

  async function addQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const options = questionKind === "TRUE_FALSE" ? ["True", "False"]
      : questionKind === "MULTIPLE_CHOICE" ? String(data.get("options")).split(/\r?\n/).map(line => line.trim()).filter(Boolean) : [];
    const question = {
      type: questionKind, prompt: data.get("prompt"), options,
      answer: ["MULTIPLE_CHOICE", "TRUE_FALSE"].includes(questionKind) ? Number(data.get("answer")) - 1 : 0,
      answerText: questionKind === "SHORT_ANSWER" ? String(data.get("answerText") ?? "") : undefined,
      points: Number(data.get("points") || 1)
    };
    if (await save({ action: "bank", topic: data.get("topic"), question }, "Question saved to your bank.")) form.reset();
  }

  async function loadStatistics() {
    if (!active) return;
    setBusy(true); setFailure("");
    try {
      const data = await request(query + "&activityId=" + encodeURIComponent(active) + "&view=stats");
      setStats(data as QuizStats);
    } catch (error) { setFailure(error instanceof Error ? error.message : "Could not load quiz statistics."); }
    finally { setBusy(false); }
  }

  function selectSubmissionActivity(activityId: string) {
    setRows([]);
    setNextCursor(null);
    setSubmissionLoading(true);
    setStats(null);
    setActive(activityId);
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
      <button className="btn btn-primary btn-sm" disabled={disabled} type="button" onClick={() => { setFormOpen(false); setChoosing(current => !current); }}>Add activity</button>
    </div>
    {featureReadOnly && <p className="alert alert-info" role="status">Beta preview · read-only in production. Teachers can review published activities and student submissions; changes are disabled until the feature is enabled.</p>}
    {explorationOnly && !featureReadOnly && <p className="alert alert-info" role="status">Exploration mode · you can create, edit, and preview drafts and manage the question bank. Publishing, submissions, grading, and changes to opened activities are disabled.</p>}
    {failure && <p className="alert alert-danger" role="alert">{failure}</p>}
    {message && <p className="alert alert-success" role="status">{message}</p>}
    {locked && <p className="small text-secondary">Recall the class record to draft before opening activities or recording grades.</p>}
    {choosing && !featureReadOnly && <section aria-label="Choose an activity type" className="border rounded p-3 mb-3">
      <h3 className="h6">Choose an activity type</h3>
      <div className="row g-2">{(["ASSIGNMENT", "QUIZ", "RESOURCE", "LESSON"] as const).map(kind =>
        <div className="col-12 col-md-4" key={kind}><button type="button" className="btn btn-outline-primary text-start w-100 h-100" disabled={disabled} onClick={() => edit(undefined, kind)}>
          <strong>{activityLabels[kind]}</strong><small className="d-block">{activityDescriptions[kind]}</small>
        </button></div>)}</div>
    </section>}
    {formOpen && !featureReadOnly && <form className="border rounded p-3 mb-3 d-grid gap-3" onSubmit={saveDraft}>
      <h3 className="h6 mb-0">{editing ? "Edit" : "New"} {activityLabels[draft.kind].toLowerCase()}</h3>
      <fieldset className="d-grid gap-2"><legend className="h6">General</legend>
      <label>Title<input className="form-control" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} maxLength={120} required/></label>
      <label>Topic or lesson<input className="form-control" maxLength={100} value={draft.topic} onChange={event => setDraft({ ...draft, topic: event.target.value })}/></label>
      <label>Instructions<textarea className="form-control" rows={3} maxLength={8000} value={draft.instructions} onChange={event => setDraft({ ...draft, instructions: event.target.value })}/></label>
      {draft.kind !== "QUIZ" && <label>Activity material (optional Google Drive link)
        <input type="url" className="form-control" maxLength={2048} value={draft.materialUrl} onChange={event => setDraft({ ...draft, materialUrl: event.target.value })}/>
        <small>Give enrolled students permission to view the file in Drive.</small>
      </label>}
      </fieldset>
      <fieldset className="d-grid gap-2"><legend className="h6">Availability</legend>
      <label>Opens (Manila time)<input type="datetime-local" className="form-control" value={draft.opens} onChange={event => setDraft({ ...draft, opens: event.target.value })}/>
        <small>Leave blank for immediate access when published.</small></label>
      {["ASSIGNMENT", "QUIZ"].includes(draft.kind) && <label>Deadline (Manila time)<input type="datetime-local" className="form-control" value={draft.due} onChange={event => setDraft({ ...draft, due: event.target.value })}/></label>}
      </fieldset>
      {["ASSIGNMENT", "QUIZ"].includes(draft.kind) && <fieldset className="d-grid gap-2"><legend className="h6">Grading</legend>
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
      {draft.kind === "ASSIGNMENT" && <label>Maximum points<input className="form-control" type="number" min="0.01" step="0.01" max="100000" required value={draft.maxScore} onChange={event => setDraft({ ...draft, maxScore: event.target.value })}/></label>}
      </fieldset>}
      {draft.kind === "QUIZ" && <>
        <fieldset className="d-grid gap-2 border rounded p-3 mb-3"><legend className="h6">Quiz settings</legend>
          <label>Time limit in minutes<input type="number" className="form-control" min="1" max="360" value={draft.timeLimitMinutes} onChange={e => setDraft({ ...draft, timeLimitMinutes: e.target.value })}/><small>Leave blank for no time limit.</small></label>
          <label>Allowed attempts<select className="form-select" value={draft.attemptsAllowed} onChange={e => setDraft({ ...draft, attemptsAllowed: e.target.value })}>{[1,2,3,4,5,10].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
          <label>Grade calculation<select className="form-select" value={draft.gradingMethod} onChange={e => setDraft({ ...draft, gradingMethod: e.target.value })}><option value="HIGHEST">Highest attempt</option><option value="AVERAGE">Average attempts</option><option value="FIRST">First attempt</option><option value="LAST">Last attempt</option></select></label>
          <label><input type="checkbox" className="form-check-input me-2" checked={draft.releaseGrade} onChange={e => setDraft({ ...draft, releaseGrade: e.target.checked })}/>Release grades when available</label>
          <label><input type="checkbox" className="form-check-input me-2" checked={draft.releaseAnswers} onChange={e => setDraft({ ...draft, releaseAnswers: e.target.checked })}/>Release correct answers after grading</label>
        </fieldset>
        {draft.inline.map((question, index) => {
          const update = (values: Partial<InlineQuestion>) => setDraft({
            ...draft, inline: draft.inline.map((item, position) => position === index ? { ...item, ...values } : item)
          });
          return <fieldset className="border rounded p-3 d-grid gap-2" key={index}>
            <legend className="h6 float-none">Question {index + 1}</legend>
            <label>Question type<select className="form-select" value={question.type}
              onChange={event => update({ type: event.target.value as QuestionType, answer: "1" })}>
              <option value="MULTIPLE_CHOICE">Multiple choice</option><option value="TRUE_FALSE">True / False</option><option value="SHORT_ANSWER">Short answer</option><option value="ESSAY">Essay</option>
            </select></label>
            <label>Question<textarea className="form-control" required maxLength={1000} rows={2} value={question.prompt}
              onChange={event => update({ prompt: event.target.value })}/></label>
            {question.type === "MULTIPLE_CHOICE" ? <>
              <label>Answer options, one per line<textarea className="form-control" required rows={3} maxLength={1806}
                value={question.choices} onChange={event => update({ choices: event.target.value })}/></label>
              <label>Correct option number<input className="form-control" type="number" min="1" max="6" required
                value={question.answer} onChange={event => update({ answer: event.target.value })}/></label>
            </> : question.type === "TRUE_FALSE" ? <label>Correct answer<select className="form-select" value={question.answer} onChange={event => update({ answer: event.target.value })}>
              <option value="1">True</option><option value="2">False</option></select></label>
              : question.type === "SHORT_ANSWER" ? <label>Expected answer<input className="form-control" maxLength={500} value={question.answerText} onChange={event => update({ answerText: event.target.value })}/></label>
              : <p className="small text-secondary">Essay responses are graded manually.</p>}
            <button type="button" className="btn btn-sm btn-outline-secondary justify-self-start"
              onClick={() => setDraft({ ...draft, inline: draft.inline.filter((_, position) => position !== index) })}>Remove question</button>
          </fieldset>;
        })}
        <button type="button" className="btn btn-outline-primary justify-self-start"
          disabled={draft.inline.length + (useBank ? draft.questionIds.length : 0) >= 50}
          onClick={() => setDraft({ ...draft, inline: [...draft.inline, { type: "MULTIPLE_CHOICE", prompt: "", choices: "", answer: "1", answerText: "", points: "1" }] })}>Add a quiz-only question</button>
        <label><input type="checkbox" className="form-check-input me-2" checked={useBank} onChange={event => setUseBank(event.target.checked)}/>Use questions from my question bank</label>
        {useBank && <fieldset>

        <legend className="h6">Question bank · {draft.questionIds.length} selected</legend>
        <label>Filter by topic or lesson<select className="form-select mb-2" value={bankTopic} onChange={event => setBankTopic(event.target.value)}>
          <option value="all">All topics</option><option value="untagged">Uncategorized</option>
          {topics.map(topic => <option key={topic} value={`topic:${topic}`}>{topic}</option>)}
        </select></label>
        {!bank.length && <p className="small text-secondary">Add reusable questions in the question bank below.</p>}
        <div className="overflow-auto border rounded p-2 d-grid gap-2" style={{ maxHeight: 260 }}>
          {bank.map(item => <label className="text-break" key={item.id}>
            <input className="form-check-input me-2" type="checkbox" checked={draft.questionIds.includes(item.id)}
              disabled={draft.questionIds.length + draft.inline.length >= 50 && !draft.questionIds.includes(item.id)}
              onChange={event => setDraft({ ...draft, questionIds: event.target.checked
                ? [...draft.questionIds, item.id] : draft.questionIds.filter(value => value !== item.id) })}/>
            {item.prompt} <small className="text-secondary">· {item.type.replace("_", " ").toLowerCase()} · {item.points} pt · {item.topic || "Uncategorized"}</small>
          </label>)}
        </div>
      </fieldset>}
      </>}
      {draft.kind === "LESSON" && <fieldset className="d-grid gap-3"><legend className="h6">Lesson pages</legend>
        <p className="small text-secondary">Add rich-content pages, sequential links, and optional branch choices.</p>
        {draft.lessonPages.map((page, index) => {
          const updatePage = (patch: Partial<LessonPage>) => setDraft({ ...draft,
            lessonPages: draft.lessonPages.map((item, position) => position === index ? { ...item, ...patch } : item) });
          return <section className="border rounded p-3 d-grid gap-2" key={page.id}>
            <label>Page {index + 1} title<input className="form-control" maxLength={120} required value={page.title} onChange={e => updatePage({ title: e.target.value })}/></label>
            <ActivityRichEditor value={page.content} onChange={content => updatePage({ content })} disabled={disabled}/>
            <label>Next page<select className="form-select" value={page.nextPageId ?? ""} onChange={e => updatePage({ nextPageId: e.target.value || null })}><option value="">End lesson</option>{draft.lessonPages.filter(other => other.id !== page.id).map(other => <option key={other.id} value={other.id}>{other.title}</option>)}</select></label>
            {page.branches.map((branch, branchIndex) => <div className="row g-2" key={branchIndex}>
              <div className="col"><input className="form-control" aria-label="Branch answer" value={branch.label} onChange={e => updatePage({ branches: page.branches.map((item, i) => i === branchIndex ? { ...item, label: e.target.value } : item) })}/></div>
              <div className="col"><select className="form-select" aria-label="Branch destination" value={branch.targetPageId} onChange={e => updatePage({ branches: page.branches.map((item, i) => i === branchIndex ? { ...item, targetPageId: e.target.value } : item) })}>{draft.lessonPages.filter(other => other.id !== page.id).map(other => <option key={other.id} value={other.id}>{other.title}</option>)}</select></div>
              <div className="col-auto"><button type="button" className="btn btn-outline-secondary" onClick={() => updatePage({ branches: page.branches.filter((_, i) => i !== branchIndex) })}>Remove</button></div>
            </div>)}
            <button type="button" className="btn btn-sm btn-outline-primary" disabled={draft.lessonPages.length < 2 || page.branches.length >= 8}
              onClick={() => updatePage({ branches: [...page.branches, { label: "Continue", targetPageId: draft.lessonPages.find(other => other.id !== page.id)!.id }] })}>Add branch choice</button>
            {draft.lessonPages.length > 1 && <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setDraft({ ...draft, lessonPages: draft.lessonPages.filter((_, i) => i !== index) })}>Remove page</button>}
          </section>;
        })}
        <button type="button" className="btn btn-outline-primary" disabled={draft.lessonPages.length >= 50} onClick={() => setDraft({ ...draft, lessonPages: [...draft.lessonPages, { id: crypto.randomUUID(), title: "New page", content: "<p></p>", nextPageId: null, branches: [] }] })}>Add lesson page</button>
      </fieldset>}
      <div className="d-flex flex-wrap gap-2"><button className="btn btn-primary" disabled={disabled}>Save draft</button><button type="button" className="btn btn-outline-secondary" onClick={() => setFormOpen(false)}>Cancel</button></div>
    </form>}
    {formOpen && draft.kind === "QUIZ" && useBank && <details className="border rounded p-3 mb-3">
      <summary>Question bank · {bank.length} recent questions</summary>
      <p className="small text-secondary mt-2 mb-2">Multiple choice and true/false. Each correct answer earns one point.</p>
      <datalist id="bank-topics">{topics.map(topic => <option key={topic} value={topic}/>)}</datalist>
      <form onSubmit={addQuestion} className="d-grid gap-2">
        <label>Topic or lesson<input name="topic" className="form-control" maxLength={100} list="bank-topics"/></label>
        <label>Question type<select className="form-select" value={questionKind} onChange={event => setQuestionKind(event.target.value as QuestionType)}>
          <option value="MULTIPLE_CHOICE">Multiple choice</option><option value="TRUE_FALSE">True / False</option><option value="SHORT_ANSWER">Short answer</option><option value="ESSAY">Essay</option>
        </select></label>
        <label>Question<textarea name="prompt" className="form-control" required maxLength={1000} rows={2}/></label>
        <label>Points<input name="points" className="form-control" type="number" min="0.01" max="1000" step="0.01" defaultValue="1" required/></label>
        {questionKind === "MULTIPLE_CHOICE"
          ? <><label>Answer options, one per line<textarea name="options" className="form-control" required rows={4} maxLength={1806}/></label>
            <label>Correct option number<input className="form-control" name="answer" type="number" min="1" max="6" required/></label></>
          : questionKind === "TRUE_FALSE"
            ? <label>Correct answer<select name="answer" className="form-select"><option value="1">True</option><option value="2">False</option></select></label>
            : questionKind === "SHORT_ANSWER" ? <label>Expected answer<input name="answerText" className="form-control" maxLength={500} required/></label>
            : <p className="small text-secondary">Essay questions are manually graded.</p>}
        <button className="btn btn-outline-primary justify-self-start" disabled={disabled}>Save question</button>
      </form>
      {bank.length > 0 && <details className="mt-3">
        <summary>Manage question topics</summary>
        <div className="overflow-auto" style={{ maxHeight: 300 }}>
          {bank.map(question => <form key={question.id + question.topic} className="border-bottom py-2" onSubmit={event => {
            event.preventDefault();
            void save({ action: "tag-question", questionId: question.id, topic: new FormData(event.currentTarget).get("topic") }, "Question topic saved.");
          }}>
            <label className="w-100 text-break">{question.prompt}<input aria-label={`Topic for ${question.prompt}`} name="topic" className="form-control my-1" maxLength={100} list="bank-topics" defaultValue={question.topic ?? ""}/></label>
            <button className="btn btn-sm btn-outline-secondary" disabled={disabled}>Save topic</button>
          </form>)}
        </div>
      </details>}
    </details>}
    {loading ? <p role="status">Loading activities…</p> : !activities.length && <p className="text-secondary">No activities in this class yet.</p>}
    <ul className="list-group mb-3">
      {activities.map(activity => <li key={activity.id} className="list-group-item d-flex flex-wrap gap-2 justify-content-between align-items-center">
        <div className="text-break"><b>{activity.title}</b><div className="small text-secondary">
          {activityLabels[activity.kind]} · {activity.topic ? `${activity.topic} · ` : ""}{activity.status === "OPEN" && activity.dueAt && Date.parse(activity.dueAt) <= clockNow ? "Deadline passed" : activity.status.toLowerCase()} · {activity.kind === "RESOURCE" ? "Read only" : activity.practice ? "Practice" : `${activity.maxScore} points`}{activity.availableAt && Date.parse(activity.availableAt) > clockNow ? ` · Opens ${formatDate(activity.availableAt)}` : ""}{activity.dueAt ? ` · Due ${formatDate(activity.dueAt)}` : ""}
        </div></div>
        <div className="d-flex flex-wrap gap-2">
          {activity.status === "DRAFT" ? <>
            <button className="btn btn-sm btn-outline-secondary" type="button" disabled={disabled} onClick={() => edit(activity)}>Edit draft</button>
            {activity.kind === "LESSON" && <button className="btn btn-sm btn-outline-primary" type="button" disabled={busy} onClick={() => selectSubmissionActivity(activity.id)}>Preview lesson</button>}
            <button className="btn btn-sm btn-primary" type="button" disabled={disabled || explorationOnly || !activitiesPublishEnabled} title={explorationOnly ? "Publishing is disabled in exploration mode." : undefined} onClick={() =>
              void save({ action: "open", subjectId, activityId: activity.id }, "Activity published.", true)}>{explorationOnly || !activitiesPublishEnabled ? "Publishing disabled" : "Publish activity"}</button>
          </> : <>
            {activity.kind !== "RESOURCE" && <button className="btn btn-sm btn-outline-primary" type="button" disabled={busy} onClick={() => selectSubmissionActivity(activity.id)}>{activity.kind === "LESSON" ? "Preview lesson" : activity.kind === "QUIZ" ? "Results & attempts" : "Submissions (" + (activity._count?.submissions ?? 0) + ")"}</button>}
            {activity.status === "OPEN" && <button type="button" className="btn btn-sm btn-outline-secondary" disabled={actionDisabled} onClick={() =>
              void save({ action: "close", subjectId, activityId: activity.id }, activity.kind === "RESOURCE" ? "Resource unpublished." : "Submissions closed.")}>{activity.kind === "RESOURCE" ? "Unpublish" : "Close submissions"}</button>}
          </>}
        </div>
      </li>)}
    </ul>
    {active && <section className="border rounded p-3">
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
        <h3 className="h6 mb-0">Submissions{selected ? ` · ${selected.title}` : ""}</h3>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setActive("")}>Hide submissions</button>
      </div>
      {selected?.kind === "LESSON" && selected.lessonPages?.map((page, index) => <article className="border rounded p-3 mb-2" key={page.id}>
        <div className="small text-secondary">Page {index + 1}</div><h4 className="h6">{page.title}</h4>
        <div className="lesson-content" dangerouslySetInnerHTML={{ __html: page.content }}/>
        {page.branches.length > 0 && <ul className="small mb-0">{page.branches.map((branch, branchIndex) => <li key={branchIndex}>{branch.label} → {selected.lessonPages?.find(item => item.id === branch.targetPageId)?.title ?? "Unknown page"}</li>)}</ul>}
        {page.nextPageId && <p className="small text-secondary mb-0">Next: {selected.lessonPages?.find(item => item.id === page.nextPageId)?.title ?? "Unknown page"}</p>}
      </article>)}
      {submissionLoading ? <p role="status">Loading submissions…</p> : !rows.length && selected?.kind !== "LESSON" && <p className="mb-0">No submissions yet.</p>}
      {rows.length > 0 && <TeacherSubmissionViewer activityId={active} submissions={rows}/>}
      {rows.map(row => <article className="border-top py-3 text-break" key={row.id}>
        <b>{row.enrollment.studentName}</b><p className="small text-secondary mb-1">{formatDate(row.submittedAt)} · {row.gradedAt ? "Graded" : "Submitted"}</p>
        {row.text && <p style={{ whiteSpace: "pre-wrap" }}>{row.text}</p>}
        {row.offline && <p className="small text-secondary">Offline work recorded by the teacher</p>}
        {selected?.kind === "ASSIGNMENT" ? <form className="d-grid gap-2" key={`${row.id}-${row.gradedAt}`} onSubmit={event => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          void save({ action: "grade", activityId: active, subjectId, submissionId: row.id,
            points: Number(fields.get("points")), feedback: String(fields.get("feedback") ?? "") }, "Grade recorded.", true);
        }}>
          <label>Score out of {selected.maxScore}<input name="points" className="form-control" type="number" step="0.01" min="0" max={selected.maxScore} required defaultValue={row.points ?? ""}/></label>
          <label>Feedback<textarea name="feedback" className="form-control" maxLength={4000} defaultValue={row.feedback ?? ""}/></label>
          <button className="btn btn-outline-primary btn-sm" disabled={actionDisabled}>Save grade</button>
        </form> : row.points !== null && <span>{row.points} / {selected?.maxScore ?? "—"}</span>}
      </article>)}
      {selected?.kind === "ASSIGNMENT" && !featureReadOnly && !explorationOnly && roster.some(student => !rows.some(row => row.enrollment.id === student.id)) && <details className="border rounded p-3 mt-3">
        <summary>Record offline work for students without submissions</summary>
        <div className="d-grid gap-2 mt-3">{roster.filter(student => !rows.some(row => row.enrollment.id === student.id)).map(student => <form key={student.id} className="border-top pt-2 d-grid gap-2" onSubmit={event => {
          event.preventDefault(); const fields = new FormData(event.currentTarget);
          void save({ action: "offline-grade", subjectId, activityId: active, enrollmentId: student.id,
            points: Number(fields.get("points")), feedback: String(fields.get("feedback") ?? "") }, "Offline grade recorded.", true);
        }}>
          <strong>{student.studentName}{student.studentNumber ? " · " + student.studentNumber : ""}</strong>
          <label>Score out of {selected.maxScore}<input name="points" className="form-control" type="number" step=".01" min="0" max={selected.maxScore} required/></label>
          <label>Feedback<textarea name="feedback" className="form-control" maxLength={4000}/></label>
          <button className="btn btn-sm btn-outline-primary" disabled={actionDisabled}>Record offline grade</button>
        </form>)}</div>
      </details>}
      {selected?.kind === "QUIZ" && <>
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-3">
          <h4 className="h6 mb-0">Quiz results</h4>
          <button type="button" className="btn btn-outline-primary btn-sm" disabled={busy} onClick={() => void loadStatistics()}>Results · Statistics</button>
        </div>
        {stats && <section className="border rounded p-3 mt-2">
          <h5 className="h6">{stats.title} · Statistics</h5>
          <div className="row g-2 mb-3">
            <div className="col-6 col-md-3"><strong>{stats.attempts}</strong><div className="small text-secondary">Attempts</div></div>
            <div className="col-6 col-md-3"><strong>{stats.gradedAttempts}</strong><div className="small text-secondary">Graded attempts</div></div>
            <div className="col-6 col-md-3"><strong>{stats.students}</strong><div className="small text-secondary">Students graded</div></div>
            <div className="col-6 col-md-3"><strong>{stats.classAverage === null ? "—" : stats.classAverage.toFixed(2) + " / " + stats.maxScore}</strong><div className="small text-secondary">Class average</div></div>
          </div>
          <h6 className="small">Score distribution</h6>
          {stats.distribution.map(row => <div className="d-flex align-items-center gap-2 mb-1" key={row.range}>
            <span className="small" style={{ width: 70 }}>{row.range}</span>
            <div className="progress flex-grow-1" style={{ height: 12 }}><div className="progress-bar" role="img" aria-label={row.count + " students"} style={{ width: (stats.students ? row.count / stats.students * 100 : 0) + "%" }}/></div>
            <span className="small" style={{ width: 24 }}>{row.count}</span>
          </div>)}
          <h6 className="small mt-3">Question analysis</h6>
          {stats.questions.map((question, index) => <div className="border-top py-2" key={question.id}>
            <strong>{index + 1}. {question.prompt}</strong>
            <div className="small text-secondary">Average % correct: {question.facilityIndex === null ? "—" : question.facilityIndex.toFixed(1) + "%"} · SD: {question.standardDeviation.toFixed(2)} · Discrimination: {question.discriminationIndex === null ? "—" : question.discriminationIndex.toFixed(2)} · Responses: {question.attempts}</div>
          </div>)}
        </section>}
      </>}
      {selected?.kind === "QUIZ" && quizAttempts.filter(attempt => attempt.submittedAt).map(attempt => {
        const essays = selected.questions?.filter(question => question.type === "ESSAY") ?? [];
        return <article className="border-top py-3" key={attempt.id}>
          <strong>{attempt.enrollment.studentName} · Attempt {attempt.attemptNumber}</strong>
          <p className="small text-secondary mb-2">{attempt.submittedAt ? formatDate(attempt.submittedAt) : "In progress"} · {attempt.gradedAt ? "Graded" : "Awaiting grading"}</p>
          {selected.questions?.map(question => {
            const answer = attempt.answers?.[question.id];
            return <div className="small mb-2" key={question.id}><b>{question.prompt}</b><div>{typeof answer === "number" ? question.options[answer] ?? "No answer" : answer || "No answer"}</div></div>;
          })}
          {essays.length > 0 && !featureReadOnly && !explorationOnly && <form className="d-grid gap-2" onSubmit={event => {
            event.preventDefault(); const fields = new FormData(event.currentTarget);
            const questionPoints = Object.fromEntries(essays.map(question => [question.id, Number(fields.get(question.id))]));
            void save({ action: "grade-quiz", subjectId, activityId: active, attemptId: attempt.id,
              questionPoints, feedback: String(fields.get("feedback") ?? "") }, "Essay answers graded.", true);
          }}>
            {essays.map(question => <label key={question.id}>Score for: {question.prompt} (max {question.points})<input name={question.id} className="form-control" type="number" min="0" max={question.points} step=".01" required defaultValue={attempt.manualGrades?.[question.id] ?? ""}/></label>)}
            <label>Feedback<textarea name="feedback" className="form-control" maxLength={4000} defaultValue={attempt.feedback ?? ""}/></label>
            <button className="btn btn-sm btn-outline-primary" disabled={actionDisabled}>Save essay grades</button>
          </form>}
          {attempt.points !== null && <p className="mb-0">Score: {attempt.points} / {selected.maxScore}</p>}
        </article>;
      })}
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

export function StudentActivities({ readOnly, subjectId, academicYear, term }: { readOnly?: boolean; subjectId?: string; academicYear?: string; term?: string }) {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const classId = subjectId ?? "";
  const [activities, setActivities] = useState<Activity[]>([]);
  const [active, setActive] = useState<Activity | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [clockNow, setClockNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [revision, setRevision] = useState(0);
  const [quizAttemptId, setQuizAttemptId] = useState<string | null>(null);
  const [quizStartedAt, setQuizStartedAt] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [lessonPageId, setLessonPageId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const activityParams = new URLSearchParams();
  if (classId) activityParams.set("subjectId", classId);
  if (academicYear) activityParams.set("academicYear", academicYear);
  if (term) activityParams.set("term", term);
  const query = activityParams.size ? `?${activityParams.toString()}` : "";
  const requestKey = query + "|" + revision;
  const loading = loadedKey !== requestKey;
  const selected = classes.find(item => item.id === classId);
  useEffect(() => {
    const firstTick = setTimeout(() => setClockNow(Date.now()), 0);
    const interval = setInterval(() => setClockNow(Date.now()), 30_000);
    return () => { clearTimeout(firstTick); clearInterval(interval); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    request(studentPath + query, undefined, controller.signal).then(data => {
      setClasses(data.classes);
      setActivities(data.activities);
      setLoadedKey(requestKey);
    }).catch(error => {
      if (!controller.signal.aborted) {
        setFailure(error.message);
        setLoadedKey(requestKey);
      }
    });
    return () => controller.abort();
  }, [requestKey, query]);

  const featureReadOnly = !!readOnly || activitiesStudentReadOnly;

  async function open(id: string) {
    setFailure(""); setBusy(true); setQuizAttemptId(null); setQuizStartedAt(null); setTimeLeft(null); setLessonPageId(null);
    try {
      const data = await request(`${studentPath}?activityId=${encodeURIComponent(id)}${academicYear && term ? `&academicYear=${encodeURIComponent(academicYear)}&term=${encodeURIComponent(term)}` : ""}`);
      const activity = data.activities[0] as Activity;
      setActive(activity);
      setLessonPageId(activity.lessonPages?.[0]?.id ?? null);
      if (activity.kind === "QUIZ" && !featureReadOnly && activity.status === "OPEN") {
        try {
          const started = await request(studentPath, { action: "start-quiz", activityId: id });
          setQuizAttemptId(started.attemptId);
          setQuizStartedAt(started.startedAt);
          if (activity.timeLimitMinutes) setTimeLeft(activity.timeLimitMinutes * 60);
        } catch (error) {
          setFailure(error instanceof Error ? error.message : "No quiz attempt is available.");
        }
      }
    } catch (error) { setFailure(error instanceof Error ? error.message : "Could not open activity."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!active || active.kind !== "QUIZ" || !quizAttemptId || !active.timeLimitMinutes || featureReadOnly) return;
    if (!quizStartedAt) return;
    const expiresAt = Date.parse(quizStartedAt) + active.timeLimitMinutes * 60_000;
    const tick = () => setTimeLeft(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [active, quizAttemptId, quizStartedAt, featureReadOnly]);

  useEffect(() => {
    if (timeLeft === 0 && quizAttemptId && !featureReadOnly) formRef.current?.requestSubmit();
  }, [timeLeft, quizAttemptId, featureReadOnly]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || featureReadOnly || active.kind !== "QUIZ") return;
    const fields = new FormData(event.currentTarget);
    setFailure(""); setBusy(true);
    try {
      if (!quizAttemptId) throw new Error("Start a quiz attempt before submitting.");
      const answers = Object.fromEntries((active.questions ?? []).map(question => {
        const value = fields.get(question.id);
        return [question.id, question.type === "MULTIPLE_CHOICE" || question.type === "TRUE_FALSE"
          ? (value === null ? -1 : Number(value)) : String(value ?? "")];
      }));
      await request(studentPath, { action: "submit-quiz", activityId: active.id, attemptId: quizAttemptId, answers });
      setActive(null);
      setQuizAttemptId(null);
      setQuizStartedAt(null);
      setTimeLeft(null);
      setRevision(current => current + 1);
    } catch (error) { setFailure(error instanceof Error ? error.message : "Could not submit the quiz."); }
    finally { setBusy(false); }
  }
  const groups = new Map<string, Activity[]>();
  for (const item of activities) {
    const topic = subjectId ? item.topic || "General" : "";
    groups.set(topic, [...(groups.get(topic) ?? []), item]);
  }
  const deadlinePassed = active?.dueAt ? Date.parse(active.dueAt) <= clockNow : false;
  const canSubmit = active && active.status === "OPEN" && !deadlinePassed && !featureReadOnly &&
    (active.practice || active.subject?.gradeStatus === "DRAFT") &&
    (active.kind !== "QUIZ" || !!quizAttemptId);

  return <section className="surface mb-3 student-activities-panel" aria-labelledby="student-activities-heading">
    <div className="d-flex flex-wrap justify-content-between gap-2 align-items-center mb-2">
      <h2 id="student-activities-heading" className="mb-0">{subjectId ? "Class activities" : "Activities and submissions"}</h2>
    </div>
    {!subjectId && classes.length > 0 && <nav aria-label="Activities by class" className="d-flex flex-wrap gap-2 mb-3">
      {classes.map(item => <a className="btn btn-sm btn-outline-primary text-start" key={item.id} href={`/student/classes/${encodeURIComponent(item.id)}/activities`}>{item.code} · {item.title}</a>)}
    </nav>}
    {selected && <p className="small text-secondary">{selected.code} · {selected.teacher.fullName} · {selected.term} {selected.academicYear}</p>}
    {failure && <p className="alert alert-danger" role="alert">{failure}</p>}
    {loading ? <p role="status">Loading activities…</p> : !activities.length && <p className="text-secondary mb-0">No activities have opened for these classes.</p>}
    {!loading && Array.from(groups, ([topic, items]) => <section key={topic} className="mb-3">
      {subjectId && <h3 className="h6 text-break">{topic}</h3>}
      <ul className="list-group list-group-flush">
        {items.map(item => {
          const upcoming = !!item.availableAt && Date.parse(item.availableAt) > clockNow;
          const closed = item.status === "CLOSED" || (!!item.dueAt && Date.parse(item.dueAt) <= clockNow);
          const status = item.submission ? item.submission.graded ? "Graded" : "Submitted"
            : closed ? "Closed" : upcoming ? "Upcoming" : item.kind === "RESOURCE" ? "Available" : "Open";
          return <li key={item.id} className="list-group-item px-0 text-break">
            {upcoming ? <strong>{item.title}</strong> : <button className="btn btn-link text-start p-0" type="button" disabled={busy} onClick={() => void open(item.id)}>{item.title}</button>}
            <div className="small text-secondary">
              {!subjectId && `${item.subject?.code} · `}{activityLabels[item.kind]} · {status}
              {upcoming && item.availableAt ? ` · Opens ${formatDate(item.availableAt)} Manila time` : ""}
              {item.dueAt ? ` · Due ${formatDate(item.dueAt)} Manila time` : ""}
            </div>
          </li>;
        })}
      </ul>
    </section>)}
    {active && <article className="border rounded p-3 mt-3 text-break">
      <div className="d-flex flex-wrap justify-content-between gap-2 mb-2">
        <h3 className="h6 mb-0">{active.title}</h3>
        <button className="btn btn-sm btn-outline-secondary" type="button" disabled={busy} onClick={() => { setActive(null); setQuizAttemptId(null); setQuizStartedAt(null); setTimeLeft(null); }}>Close details</button>
      </div>
      <p className="small text-secondary">{active.subject?.code} · {activityLabels[active.kind]}{active.kind !== "RESOURCE" && active.kind !== "LESSON" ? " · " + active.maxScore + " points" + (active.practice ? " · Practice" : "") : ""}</p>
      {active.dueAt && <p className="small text-secondary">Deadline: {formatDate(active.dueAt)} Manila time</p>}
      {active.instructions && <p style={{ whiteSpace: "pre-wrap" }}>{active.instructions}</p>}
      {active.materialUrl && <p><a href={active.materialUrl} target="_blank" rel="noreferrer">Open activity material in Google Drive</a></p>}
      {featureReadOnly && <p className="alert alert-info" role="status">Beta preview · this activity is read-only. Submitting work and changing answers are disabled.</p>}
      {active.kind === "LESSON" && active.lessonPages?.length ? (() => {
        const page = active.lessonPages.find(item => item.id === lessonPageId) ?? active.lessonPages[0];
        const pageIndex = active.lessonPages.findIndex(item => item.id === page.id);
        return <section className="border rounded p-3">
          <div className="small text-secondary mb-2">Lesson page {pageIndex + 1} of {active.lessonPages.length}</div>
          <h4 className="h5">{page.title}</h4>
          <div className="lesson-content" dangerouslySetInnerHTML={{ __html: page.content }}/>
          {page.branches.length > 0 && <div className="d-grid gap-2 mt-3"><strong>Choose how to continue</strong>{page.branches.map((branch, index) => <button key={index} type="button" className="btn btn-outline-primary text-start" onClick={() => setLessonPageId(branch.targetPageId)}>{branch.label}</button>)}</div>}
          <div className="d-flex flex-wrap justify-content-between gap-2 mt-3">
            <button type="button" className="btn btn-outline-secondary" disabled={pageIndex <= 0} onClick={() => setLessonPageId(active.lessonPages?.[Math.max(0, pageIndex - 1)].id ?? null)}>Previous page</button>
            {page.nextPageId && <button type="button" className="btn btn-primary" onClick={() => setLessonPageId(page.nextPageId)}>Next page</button>}
          </div>
        </section>;
      })() : null}
      {active.kind === "QUIZ" && <>
        {active.attempts?.filter(item => item.submittedAt).length ? <section className="mb-3">
          <h4 className="h6">Previous attempts</h4>
          <ul className="list-group">{active.attempts.filter(item => item.submittedAt).map(attempt => <li key={attempt.id} className="list-group-item d-flex justify-content-between">
            <span>Attempt {attempt.attemptNumber} · {formatDate(attempt.submittedAt!)}</span>
            <span>{attempt.points === null ? attempt.graded ? "Grade pending release" : "Awaiting grading" : attempt.points + " / " + active.maxScore}</span>
          </li>)}</ul>
        </section> : null}
        {canSubmit && <form ref={formRef} key={quizAttemptId ?? active.id} onSubmit={submit} className="d-grid gap-3">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
            <strong>Attempt in progress · {active.attempts?.find(item => item.id === quizAttemptId)?.attemptNumber ?? 1}</strong>
            {timeLeft !== null && <span className={timeLeft < 60 ? "text-danger fw-bold" : "text-secondary"} aria-live="polite">Time remaining: {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")}</span>}
          </div>
          {active.questions?.map((question, index) => <fieldset className="border rounded p-3" key={question.id}>
            <legend className="float-none fs-6 mb-1">{index + 1}. {question.prompt} <small className="text-secondary">({question.points} pt)</small></legend>
            {question.type === "MULTIPLE_CHOICE" || question.type === "TRUE_FALSE"
              ? question.options.map((option, optionIndex) => <label className="d-block py-1" key={optionIndex}><input name={question.id} className="form-check-input me-2" type="radio" value={optionIndex}/>{option}</label>)
              : question.type === "SHORT_ANSWER"
                ? <input name={question.id} className="form-control" maxLength={500} placeholder="Type your answer"/>
                : <textarea name={question.id} className="form-control" rows={5} maxLength={12000} placeholder="Write your essay response"/>}
          </fieldset>)}
          <button className="btn btn-primary" disabled={busy || featureReadOnly || timeLeft === 0}>{busy ? "Submitting…" : "Submit quiz"}</button>
        </form>}
        {!canSubmit && active.status === "OPEN" && active.attemptsRemaining === 0 && <p className="text-secondary">All allowed quiz attempts have been used.</p>}
        {!active.questions?.length && <p className="text-secondary">This quiz has no questions available.</p>}
      </>}
      {active.kind === "ASSIGNMENT" && (active.submission ? <section>
        <p><b>My submission</b> · {formatDate(active.submission.submittedAt)} Manila time {active.submission.offline ? "· Recorded as offline work" : ""}</p>
        {active.submission.text && <p style={{ whiteSpace: "pre-wrap" }}>{active.submission.text}</p>}
        {active.submission.attachments?.map(file => <p key={file.id} className="text-break">
          <a href={file.storageProvider === "CLOUDFLARE_R2"
            ? "/api/submissions/download?attachmentId=" + encodeURIComponent(file.id)
            : file.fileUrl || "#"} target="_blank" rel="noreferrer">
            {file.storageProvider === "GOOGLE_DRIVE" ? "Open Google Drive" : "Download securely"} · {file.fileName}
          </a> <small className="text-secondary">({(file.fileSize / (1024 * 1024)).toFixed(2)} MB)</small>
        </p>)}
        {active.submission.fileName && (active.submission.fileUrl || active.submission.storageProvider === "CLOUDFLARE_R2") &&
          <p><a href={active.submission.storageProvider === "CLOUDFLARE_R2"
            ? "/api/submissions/download?submissionId=" + encodeURIComponent(active.submission.id)
            : active.submission.fileUrl!} target="_blank" rel="noreferrer">
            Download securely {active.submission.fileName || "submitted file"}
          </a>{active.submission.fileSize ? <small className="text-secondary"> · {Math.ceil(active.submission.fileSize / 1024)} KB</small> : null}</p>}
        {active.submission.driveUrl && <p><a href={active.submission.driveUrl} target="_blank" rel="noreferrer">Open legacy Google Drive submission</a></p>}
        {active.submission.files?.map(file => <p key={file.pathname}><a href={"/api/activities/files?activityId=" + encodeURIComponent(active.id) + "&pathname=" + encodeURIComponent(file.pathname)}>{file.filename}</a> <small className="text-secondary">({Math.ceil(file.size / 1024)} KB)</small></p>)}
        {active.submission.points !== null ? <p>Score · <strong>{active.submission.points} / {active.maxScore}</strong></p> : <p>{active.submission.graded ? "Your grade has not been released." : "Waiting for grading."}</p>}
        {active.submission.feedback && <div className="border-start border-3 ps-3"><strong>Teacher feedback</strong><p className="mb-0" style={{ whiteSpace: "pre-wrap" }}>{active.submission.feedback}</p></div>}
        {canSubmit && <div className="border-top pt-3 mt-3"><p className="mb-2"><strong>Replace or resubmit your work</strong></p><StudentR2Uploader assignmentId={active.id} disabled={busy || featureReadOnly}
          onSubmitted={() => { setActive(null); setRevision(current => current + 1); }}/></div>}
      </section> : canSubmit ? <StudentR2Uploader assignmentId={active.id} disabled={busy || featureReadOnly}
          onSubmitted={() => { setActive(null); setRevision(current => current + 1); }}/> : <p className="mb-0">Submissions are closed.</p>)}
    </article>}

  </section>;
}
