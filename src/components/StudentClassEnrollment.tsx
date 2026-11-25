"use client";

import { FormEvent, useEffect, useState } from "react";

type StudentClass = { id: string; code: string; title: string; term: string; academicYear: string; isPublished: boolean };

export default function StudentClassEnrollment({ onJoined, academicYear, term }: { onJoined: () => void; academicYear?: string; term?: string }) {
  const [code, setCode] = useState("");
  const [classes, setClasses] = useState<StudentClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const classesUrl = `/api/student/classes${academicYear && term ? `?academicYear=${encodeURIComponent(academicYear)}&term=${encodeURIComponent(term)}` : ""}`;

  async function loadClasses() {
    const response = await fetch(classesUrl, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not load enrolled classes.");
    setClasses(data.classes || []);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(classesUrl, { cache: "no-store" })
      .then(async response => { const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Could not load enrolled classes."); return data; })
      .then(data => { if (!cancelled) setClasses(data.classes || []); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load classes."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [classesUrl]);

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/student/classes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }), cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not join the class.");
      setCode("");
      setMessage(data.linked ? "Your existing class record has been linked to your account. No scores were changed." : data.created ? "Joined " + data.class.code + " successfully." : "You are already enrolled in this class.");
      await loadClasses();
      onJoined();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not join this class."); }
    finally { setSaving(false); }
  }

  return <section className="surface student-enrollment-panel mb-4" aria-labelledby="student-join-title">
    <div className="student-enrollment-header">
      <div><span className="eyebrow">CLASS ACCESS</span><h2 id="student-join-title">Join a class</h2><p>Use the invitation code provided by your teacher to connect your class record.</p></div>
      <span className="student-enrollment-symbol" aria-hidden="true">＋</span>
    </div>
    <div className="student-enrollment-layout">
      <div className="student-enrollment-join">
        <form onSubmit={join} className="student-enrollment-form">
          <label htmlFor="student-class-invitation-code">Class invitation code</label>
          <div className="student-enrollment-form-row">
            <input id="student-class-invitation-code" className="form-control" aria-label="Class invitation code" value={code} onChange={event => setCode(event.target.value.toUpperCase().slice(0, 32))} placeholder="XXXX-XXXX-XXXX" autoComplete="off" required minLength={12} maxLength={32}/>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Joining…" : "Join class"}</button>
          </div>
          <small>Make sure you are registered and verified at the same school as your instructor.</small>
        </form>
        {error && <div className="alert alert-danger py-2 mt-3 mb-0" role="alert">{error}</div>}
        {message && <div className="alert alert-success py-2 mt-3 mb-0" role="status">{message}</div>}
      </div>
      <div className="student-enrolled-classes">
        <div className="student-enrolled-classes-heading"><div><h3>My enrolled classes</h3><small>Your connected class records for this academic period.</small></div><span>{classes.length} linked</span></div>
        {loading ? <p className="muted small mb-0" role="status">Loading your classes…</p> :
          classes.length ? <div className="student-enrolled-classes-list">{classes.slice(0, 15).map(item => <article key={item.id} className="student-enrolled-class-card">
            <span className="student-enrolled-class-mark">{item.code.slice(0, 2)}</span>
            <div><strong>{item.code} — {item.title}</strong><small>{item.term} · {item.academicYear}</small><span className={item.isPublished ? "student-enrolled-status shared" : "student-enrolled-status pending"}>{item.isPublished ? "Grades shared" : "Waiting for grade visibility"}</span></div>
          </article>)}{classes.length > 15 && <small className="muted">Showing 15 of {classes.length} enrolled classes.</small>}</div> :
            <div className="student-enrolled-empty">No linked classes for this period yet. Join with a teacher-provided code or ask your teacher to add you directly.</div>}
      </div>
    </div>
  </section>;
}
