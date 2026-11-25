"use client";

import { useState, type FormEvent } from "react";

type ResourceType = "lesson-outline" | "study-guide" | "practice-questions";
type SubjectContext = {
  code: string;
  title: string;
  courseYear: string | null;
  term: string;
};
type ResourceResponse = {
  answer?: string;
  warnings?: string[];
  message?: string;
  error?: string;
};

const resourceLabels: Record<ResourceType, string> = {
  "lesson-outline": "Lesson outline",
  "study-guide": "Study guide",
  "practice-questions": "Practice questions",
};

export default function AcademicAssistant({
  subjectId,
  subjectContext,
}: {
  subjectId: string;
  subjectContext: SubjectContext;
}) {
  const [resourceType, setResourceType] = useState<ResourceType>("lesson-outline");
  const [level, setLevel] = useState("");
  const [topic, setTopic] = useState("");
  const [answer, setAnswer] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    setAnswer("");
    setWarnings([]);
    setCopyStatus("");

    try {
      const response = await fetch("/api/cognix/academic-assistant", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        // Only send the selected Subject ID. The server re-checks ownership
        // and reads its instructional metadata; browser-supplied class text
        // is never trusted or forwarded.
        body: JSON.stringify({ subjectId, resourceType, level, topic }),
      });
      const payload = await response.json().catch(() => null) as ResourceResponse | null;
      if (!response.ok || !payload?.answer) {
        setError(payload?.message || "The Academic Assistant could not complete this request.");
        return;
      }
      setAnswer(payload.answer);
      setWarnings(Array.isArray(payload.warnings) ? payload.warnings : []);
    } catch {
      setError("COGNIX could not be reached. Your SAGA academic records were not accessed or changed.");
    } finally {
      setLoading(false);
    }
  }

  async function copyAnswer() {
    if (!answer) return;
    try {
      await navigator.clipboard.writeText(answer);
      setCopyStatus("Draft copied.");
    } catch {
      setCopyStatus("Copy was not available. Select the draft text and copy it manually.");
    }
  }

  const fieldStyle = {
    width: "100%",
    minHeight: 44,
    border: "1px solid #cbd5e1",
    borderRadius: 9,
    background: "#fff",
    color: "#172b45",
    padding: "10px 12px",
    font: "inherit",
  } as const;

  return (
    <section style={{ border: "1px solid #d7e0eb", borderRadius: 16, background: "#fff", boxShadow: "0 12px 30px rgba(20,45,74,.07)", padding: "clamp(18px, 3vw, 28px)" }}>
      <div style={{ padding: 16, borderRadius: 10, background: "#f1f6fc", border: "1px solid #d8e5f3", marginBottom: 18 }}>
        <p style={{ margin: 0, color: "#52708f", fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase" }}>Current class subject · Read only</p>
        <h2 style={{ margin: "6px 0 4px", color: "#173454", fontSize: 19 }}>{subjectContext.title}</h2>
        <p style={{ margin: 0, color: "#526d88", fontSize: 13, lineHeight: 1.6 }}>
          {subjectContext.code} · {subjectContext.courseYear || "Course/year not set"} · {subjectContext.term}
        </p>
      </div>

      <form onSubmit={generate}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 16 }}>
          <label style={{ display: "grid", gap: 7, color: "#314b67", fontSize: 13, fontWeight: 700 }}>
            Resource type
            <select style={fieldStyle} value={resourceType} onChange={event => setResourceType(event.target.value as ResourceType)}>
              <option value="lesson-outline">Lesson outline</option>
              <option value="study-guide">Study guide</option>
              <option value="practice-questions">Practice questions</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 7, color: "#314b67", fontSize: 13, fontWeight: 700 }}>
            Learning level
            <select style={fieldStyle} value={level} onChange={event => setLevel(event.target.value)} required>
              <option value="">Select level</option>
              <option>Elementary</option>
              <option>Junior High School</option>
              <option>Senior High School</option>
              <option>Higher Education</option>
              <option>Adult Learning</option>
            </select>
          </label>
        </div>

        <label style={{ display: "grid", gap: 7, marginTop: 18, color: "#314b67", fontSize: 13, fontWeight: 700 }}>
          Topic or learning competency
          <textarea
            style={{ ...fieldStyle, minHeight: 104, resize: "vertical" }}
            value={topic}
            onChange={event => setTopic(event.target.value)}
            minLength={3}
            maxLength={120}
            placeholder="Example: Linear equations in one variable"
            required
          />
          <span style={{ color: "#74869b", fontSize: 11, fontWeight: 400 }}>{topic.length}/120 characters · Use a general topic or competency only; never include learner or teacher details.</span>
        </label>

        <div role="note" style={{ marginTop: 18, padding: 15, borderRadius: 10, background: "#fff7e7", border: "1px solid #f1d8a7", color: "#79551a", fontSize: 12, lineHeight: 1.65 }}>
          <strong>Privacy notice:</strong> Only this class's subject title and code, course/year label, term, selected learning level, resource type, and generic topic are sent through COGNIX to an external model provider. SAGA does not send class lists, enrollments, assessment items, grades, scores, attendance, or student records. AI Gateway filters out providers that train on prompts, but this does <strong>not</strong> guarantee zero data retention. Never enter names, student IDs/LRNs, grades, scores, attendance, contact details, personal circumstances, or confidential school material.
        </div>
        <p style={{ margin: "10px 0 0", color: "#74869b", fontSize: 11, lineHeight: 1.6 }}>
          SAGA does not currently supply official curriculum guides or learning-competency documents to COGNIX. The topic or competency is teacher-provided; generated materials are not certified curriculum-aligned.
        </p>

        {error ? <p role="alert" style={{ margin: "16px 0 0", color: "#b42318", fontSize: 13 }}>{error}</p> : null}

        <button type="submit" disabled={loading || topic.trim().length < 3 || !level} style={{ marginTop: 18, minHeight: 46, padding: "0 20px", border: 0, borderRadius: 9, background: loading ? "#7891ad" : "#225f9e", color: "#fff", fontWeight: 800, cursor: loading ? "wait" : "pointer" }}>
          {loading ? "Generating draft…" : `Generate ${resourceLabels[resourceType].toLowerCase()}`}
        </button>
      </form>

      {answer ? (
        <section style={{ marginTop: 24, borderTop: "1px solid #e1e8f0", paddingTop: 22 }} aria-labelledby="academic-draft-title">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <p style={{ margin: 0, color: "#52708f", fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase" }}>COGNIX generated draft</p>
              <h2 id="academic-draft-title" style={{ margin: "5px 0 0", color: "#173454", fontSize: 21 }}>{resourceLabels[resourceType]}</h2>
            </div>
            <button type="button" onClick={copyAnswer} style={{ border: "1px solid #9fb2c8", borderRadius: 8, padding: "9px 14px", background: "#f7faff", color: "#244768", fontWeight: 700 }}>Copy draft</button>
          </div>
          <p role="status" aria-live="polite" style={{ margin: "8px 0", color: "#52708f", fontSize: 12 }}>{copyStatus}</p>
          <pre style={{ margin: "12px 0 0", padding: 18, borderRadius: 10, background: "#f5f8fc", color: "#253b55", whiteSpace: "pre-wrap", overflowWrap: "anywhere", font: "inherit", fontSize: 14, lineHeight: 1.75 }}>{answer}</pre>
          {warnings.length ? <ul style={{ margin: "14px 0 0", paddingLeft: 20, color: "#667d97", fontSize: 12, lineHeight: 1.6 }}>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
        </section>
      ) : null}
    </section>
  );
}
