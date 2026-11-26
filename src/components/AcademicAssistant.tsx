"use client";

import { useState, type FormEvent } from "react";

type SubjectContext = {
  code: string;
  title: string;
  classId: string | null;
  courseYear: string | null;
  academicYear: string;
  term: string;
};
type AssistantMessage = { id: number; role: "assistant" | "user"; content: string };
type AssistantResponse = { answer?: string; message?: string; error?: string };

const suggestions = [
  "Give me an overview of this class.",
  "How many students are enrolled?",
  "What assessments are due this week?",
  "What is the current grade-sheet status?",
  "How do I record scores?",
  "How do I submit final grades?",
];

export default function AcademicAssistant({
  subjectId,
  subjectContext,
}: {
  subjectId: string;
  subjectContext: SubjectContext;
}) {
  const [messages, setMessages] = useState<AssistantMessage[]>([{
    id: 1,
    role: "assistant",
    content: `Hello! I’m your SAGA Virtual Assistant. I can explain how to use SAGA and answer supported questions about this class workspace: ${subjectContext.code} · ${subjectContext.title}. What would you like to know?`,
  }]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nextId, setNextId] = useState(2);

  async function sendMessage(value: string) {
    const message = value.trim();
    if (!message || loading || message.length > 800) return;

    setDraft("");
    setError("");
    setMessages(current => [...current, { id: nextId, role: "user", content: message }]);
    setNextId(value => value + 1);
    setLoading(true);

    try {
      const response = await fetch(`/api/teacher/subjects/${encodeURIComponent(subjectId)}/assistant`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const payload = await response.json().catch(() => null) as AssistantResponse | null;
      if (!response.ok || !payload?.answer) {
        setError(payload?.message || "The assistant could not complete this request.");
        return;
      }
      setMessages(current => [...current, { id: nextId + 1, role: "assistant", content: payload.answer || "" }]);
      setNextId(value => value + 1);
    } catch {
      setError("SAGA could not process the message. Your class records were not changed.");
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  return (
    <section className="surface" style={{ borderRadius: 16, padding: "clamp(16px, 3vw, 26px)", boxShadow: "0 12px 30px rgba(20,45,74,.06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <span className="eyebrow">SAGA · WORKSPACE COPILOT</span>
          <h2 style={{ margin: "6px 0", color: "var(--bs-emphasis-color, #173454)", fontSize: 22 }}>SAGA Virtual Assistant</h2>
          <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>Ask about using SAGA or get a read-only overview of this class.</p>
        </div>
        <span style={{ borderRadius: 999, background: "#edf5fd", color: "#285a86", padding: "7px 11px", fontSize: 12, fontWeight: 800 }}>Current workspace only</span>
      </div>

      <div style={{ marginTop: 18, padding: 15, border: "1px solid #d8e5f3", borderRadius: 12, background: "#f4f8fc" }}>
        <div style={{ color: "#54718e", fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase" }}>Active class · Read only</div>
        <h3 style={{ margin: "6px 0 3px", color: "#173454", fontSize: 18 }}>{subjectContext.code} · {subjectContext.title}</h3>
        <p style={{ margin: 0, color: "#5b7188", fontSize: 12, lineHeight: 1.6 }}>
          {subjectContext.classId ? `Class ID ${subjectContext.classId} · ` : ""}
          {subjectContext.courseYear || "Course/year not set"} · {subjectContext.term} · {subjectContext.academicYear}
        </p>
      </div>

      <div aria-live="polite" aria-label="Assistant conversation" style={{ display: "grid", gap: 12, marginTop: 20, maxHeight: 520, overflowY: "auto", padding: 2 }}>
        {messages.map(message => (
          <article key={message.id} style={{
            maxWidth: "min(100%, 780px)",
            justifySelf: message.role === "user" ? "end" : "start",
            border: message.role === "user" ? "1px solid #c5d9ee" : "1px solid #e0e7ef",
            borderRadius: 13,
            padding: "12px 15px",
            background: message.role === "user" ? "#edf5fd" : "#fff",
            color: "#243b53",
            lineHeight: 1.7,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            fontSize: 14,
          }}>
            <div style={{ marginBottom: 5, color: "#698099", fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>
              {message.role === "user" ? "You" : "SAGA Virtual Assistant"}
            </div>
            {message.content}
          </article>
        ))}
        {loading && <p role="status" style={{ margin: 0, color: "#627a94", fontSize: 13 }}>Checking this workspace and preparing a response…</p>}
      </div>

      {messages.length === 1 && (
        <div style={{ marginTop: 18 }}>
          <p style={{ margin: "0 0 9px", color: "#526b85", fontSize: 12, fontWeight: 800 }}>TRY ASKING</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {suggestions.map(suggestion => (
              <button key={suggestion} type="button" className="btn btn-sm btn-outline-primary" disabled={loading} onClick={() => void sendMessage(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={submit} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 9, alignItems: "end", marginTop: 18 }}>
        <label style={{ display: "grid", gap: 6, color: "#38536e", fontSize: 12, fontWeight: 700 }}>
          Your question
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            maxLength={800}
            rows={2}
            placeholder="Ask about this class or how to use a SAGA feature…"
            disabled={loading}
            style={{ width: "100%", minHeight: 54, resize: "vertical", border: "1px solid #cbd5e1", borderRadius: 9, padding: "10px 12px", font: "inherit", fontWeight: 400, color: "#172b45" }}
          />
          <span style={{ color: "#7a8da2", fontSize: 10, fontWeight: 400 }}>{draft.length}/800 characters</span>
        </label>
        <button type="submit" className="btn btn-primary" disabled={loading || draft.trim().length < 2 || draft.length > 800} style={{ minHeight: 46, paddingInline: 18 }}>
          {loading ? "Sending…" : "Send"}
        </button>
      </form>
      {error && <p role="alert" style={{ margin: "10px 0 0", color: "#b42318", fontSize: 13 }}>{error}</p>}

      <aside role="note" style={{ marginTop: 18, padding: 14, border: "1px solid #d6e6d9", borderRadius: 10, background: "#f3f9f4", color: "#385b43", fontSize: 11, lineHeight: 1.7 }}>
        <strong>Privacy and permissions:</strong> SAGA verifies your teacher and school access for this class on every message. Workspace answers are produced inside SAGA from class metadata and aggregate counts; individual student records and marks are not loaded into chat. For general SAGA help, COGNIX receives only a fixed help-topic code—not your typed question, class details, or academic records. This assistant is read-only and does not save changes. Conversation text stays in this page session and is not saved by the assistant.
      </aside>
    </section>
  );
}
