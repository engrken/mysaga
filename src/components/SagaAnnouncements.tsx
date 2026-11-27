"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type AnnouncementStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
type AnnouncementItem = {
  id: string; title: string; body: string; status: AnnouncementStatus; isPinned: boolean;
  publishAt: string | null; expiresAt: string | null; createdAt: string; updatedAt: string;
  readCount?: number; recipientCount?: number; readAt?: string | null;
  subject?: { id: string; classId: string | null; code: string; title: string; term: string; academicYear: string };
  author?: { fullName: string };
};
type AnnouncementForm = { title: string; body: string; status: AnnouncementStatus; isPinned: boolean; publishAt: string; expiresAt: string };

function formatDate(value: string | null | undefined) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Invalid date";
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(date);
}
function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
}
function asIso(value: string) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Enter a valid date and time.");
  return date.toISOString();
}
function emptyForm(): AnnouncementForm {
  return { title: "", body: "", status: "PUBLISHED", isPinned: false, publishAt: "", expiresAt: "" };
}

export function TeacherClassAnnouncements({ subjectId, readOnly = false }: { subjectId: string; readOnly?: boolean }) {
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [form, setForm] = useState<AnnouncementForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showComposer, setShowComposer] = useState(false);
  const [loading, setLoading] = useState(!readOnly);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const response = await fetch("/api/teacher/subjects/" + encodeURIComponent(subjectId) + "/announcements", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load class announcements.");
    setItems(Array.isArray(data.announcements) ? data.announcements : []);
  }
  useEffect(() => {
    if (readOnly) return;
    let active = true;
    setLoading(true);
    fetch("/api/teacher/subjects/" + encodeURIComponent(subjectId) + "/announcements", { cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load class announcements.");
        if (active) setItems(Array.isArray(data.announcements) ? data.announcements : []);
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Could not load class announcements."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [subjectId, readOnly]);

  function startNew() {
    setForm(emptyForm()); setEditingId(null); setShowComposer(true); setError(""); setNotice("");
  }
  function startEdit(item: AnnouncementItem) {
    setForm({
      title: item.title, body: item.body, status: item.status,
      isPinned: item.isPinned, publishAt: item.status === "PUBLISHED" ? toLocalDateTime(item.publishAt) : "",
      expiresAt: toLocalDateTime(item.expiresAt)
    });
    setEditingId(item.id); setShowComposer(true); setError(""); setNotice("");
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    try {
      const payload = {
        title: form.title, body: form.body, status: form.status, isPinned: form.isPinned,
        publishAt: form.status === "DRAFT" ? null : asIso(form.publishAt), expiresAt: asIso(form.expiresAt)
      };
      const response = await fetch(
        editingId ? "/api/teacher/announcements/" + encodeURIComponent(editingId) : "/api/teacher/subjects/" + encodeURIComponent(subjectId) + "/announcements",
        { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the announcement.");
      await load(); setShowComposer(false); setEditingId(null); setForm(emptyForm());
      setNotice(form.status === "DRAFT" ? "Announcement saved as a draft." : "Announcement saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the announcement.");
    } finally { setSaving(false); }
  }
  async function updateItem(item: AnnouncementItem, status: AnnouncementStatus) {
    setSaving(true); setError(""); setNotice("");
    try {
      const payload = {
        title: item.title, body: item.body, status, isPinned: item.isPinned,
        publishAt: status === "DRAFT" ? null : status === "PUBLISHED" ? new Date().toISOString() : item.publishAt,
        expiresAt: item.expiresAt
      };
      const response = await fetch("/api/teacher/announcements/" + encodeURIComponent(item.id), {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update the announcement.");
      await load();
      setNotice(status === "ARCHIVED" ? "Announcement archived." : status === "PUBLISHED" ? "Announcement published." : "Announcement updated.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the announcement.");
    } finally { setSaving(false); }
  }
  async function removeItem(item: AnnouncementItem) {
    if (!window.confirm("Delete this announcement permanently?")) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/teacher/announcements/" + encodeURIComponent(item.id), { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete the announcement.");
      await load(); setNotice("Announcement deleted.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete the announcement.");
    } finally { setSaving(false); }
  }

  if (readOnly) return <section className="section-block surface"><div className="section-heading"><div><span className="eyebrow">CLASS BULLETIN BOARD</span><h2>Announcements</h2></div></div><p className="alert alert-info mb-0">The public SAGA demo is read-only. Sign in to a registered teacher account to manage class announcements.</p></section>;

  return <section className="section-block class-announcements">
    <div className="section-heading">
      <div><span className="eyebrow">CLASS BULLETIN BOARD</span><h2>Announcements</h2><p className="muted">Post formal notices and reminders for students enrolled in this class. Published notices appear in each student's compiled Announcements feed.</p></div>
      <button className="btn btn-primary" type="button" onClick={startNew}>＋ New announcement</button>
    </div>
    {notice && <div className="alert alert-success" role="status">{notice}</div>}
    {error && <div className="alert alert-danger" role="alert">{error}</div>}
    {showComposer && <form className="surface p-3 mb-3" onSubmit={save}>
      <div className="d-flex justify-content-between align-items-center gap-2 mb-3"><h3 className="h5 mb-0">{editingId ? "Edit announcement" : "New announcement"}</h3><button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { setShowComposer(false); setEditingId(null); setForm(emptyForm()); }}>Close</button></div>
      <label className="form-label" htmlFor="class-announcement-title">Title</label>
      <input id="class-announcement-title" className="form-control mb-3" value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} maxLength={160} required placeholder="e.g. Change in examination schedule"/>
      <label className="form-label" htmlFor="class-announcement-body">Announcement</label>
      <textarea id="class-announcement-body" className="form-control mb-3" rows={6} value={form.body} onChange={event => setForm(current => ({ ...current, body: event.target.value }))} maxLength={12000} required placeholder="Write the official notice, instructions, or reminder…"/>
      <div className="row g-3">
        <div className="col-12 col-md-4"><label className="form-label" htmlFor="class-announcement-status">Publishing</label><select id="class-announcement-status" className="form-select" value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value as AnnouncementStatus }))}><option value="PUBLISHED">Publish / schedule</option><option value="DRAFT">Save as draft</option>{editingId && <option value="ARCHIVED">Keep archived</option>}</select></div>
        <div className="col-12 col-md-4"><label className="form-label" htmlFor="class-announcement-publish">Publish date and time (optional)</label><input id="class-announcement-publish" className="form-control" type="datetime-local" value={form.publishAt} disabled={form.status !== "PUBLISHED"} onChange={event => setForm(current => ({ ...current, publishAt: event.target.value }))}/><small className="text-body-secondary">Leave blank to publish immediately. Scheduled notices appear when the date arrives.</small></div>
        <div className="col-12 col-md-4"><label className="form-label" htmlFor="class-announcement-expiry">Expiration (optional)</label><input id="class-announcement-expiry" className="form-control" type="datetime-local" value={form.expiresAt} onChange={event => setForm(current => ({ ...current, expiresAt: event.target.value }))}/></div>
      </div>
      <div className="form-check my-3"><input id="class-announcement-pin" className="form-check-input" type="checkbox" checked={form.isPinned} onChange={event => setForm(current => ({ ...current, isPinned: event.target.checked }))}/><label className="form-check-label" htmlFor="class-announcement-pin">Pin this announcement at the top of the class feed</label></div>
      <div className="d-flex flex-wrap gap-2"><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Save changes" : form.status === "DRAFT" ? "Save draft" : "Publish announcement"}</button><button className="btn btn-outline-secondary" type="button" disabled={saving} onClick={() => { setShowComposer(false); setEditingId(null); setForm(emptyForm()); }}>Cancel</button></div>
    </form>}
    {loading ? <div className="inline-empty" role="status">Loading class announcements…</div>
      : items.length === 0 ? <div className="empty-state"><div className="empty-icon">▤</div><h3>No announcements yet</h3><p>Publish the first formal notice for students in this class.</p></div>
      : <div className="d-flex flex-column gap-3">{items.map(item => <article className="surface p-3" key={item.id}>
        <div className="d-flex flex-wrap justify-content-between align-items-start gap-2"><div className="d-flex flex-wrap align-items-center gap-2"><span className={"badge " + (item.status === "PUBLISHED" ? "text-bg-success" : item.status === "DRAFT" ? "text-bg-secondary" : "text-bg-dark")}>{item.status === "PUBLISHED" ? item.publishAt && new Date(item.publishAt) > new Date() ? "Scheduled" : "Published" : item.status === "DRAFT" ? "Draft" : "Archived"}</span>{item.isPinned && <span className="badge text-bg-warning">Pinned</span>}</div><small className="text-body-secondary">{item.publishAt ? formatDate(item.publishAt) : "Not published"}</small></div>
        <h3 className="h5 mt-2 mb-2">{item.title}</h3><p className="mb-2" style={{ whiteSpace: "pre-wrap" }}>{item.body}</p>
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2"><small className="text-body-secondary">Read by {item.readCount || 0} of {item.recipientCount || 0} rostered student(s){item.expiresAt ? " · Expires " + formatDate(item.expiresAt) : ""}</small><div className="d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-outline-primary btn-sm" disabled={saving} onClick={() => startEdit(item)}>Edit</button>
          {item.status === "DRAFT" && <button type="button" className="btn btn-outline-success btn-sm" disabled={saving} onClick={() => void updateItem(item, "PUBLISHED")}>Publish now</button>}
          {item.status === "PUBLISHED" && <button type="button" className="btn btn-outline-secondary btn-sm" disabled={saving} onClick={() => void updateItem(item, "ARCHIVED")}>Archive</button>}
          {item.status === "ARCHIVED" && <button type="button" className="btn btn-outline-success btn-sm" disabled={saving} onClick={() => void updateItem(item, "PUBLISHED")}>Republish</button>}
          <button type="button" className="btn btn-outline-danger btn-sm" disabled={saving} onClick={() => void removeItem(item)}>Delete</button>
        </div></div>
      </article>)}</div>}
  </section>;
}

export function StudentAnnouncements({ readOnly = false }: { readOnly?: boolean }) {
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [loading, setLoading] = useState(!readOnly);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [marking, setMarking] = useState<string[]>([]);
  useEffect(() => {
    if (readOnly) return;
    let active = true;
    setLoading(true);
    fetch("/api/student/announcements", { cache: "no-store" })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load announcements."); if (active) setItems(Array.isArray(data.announcements) ? data.announcements : []); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Could not load announcements."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [readOnly]);
  const courses = useMemo(() => {
    const unique = new Map<string, NonNullable<AnnouncementItem["subject"]>>();
    for (const item of items) if (item.subject) unique.set(item.subject.id, item.subject);
    return [...unique.values()].sort((a,b)=>a.code.localeCompare(b.code));
  }, [items]);
  const visibleItems = useMemo(() => filter === "ALL" ? items : items.filter(item => item.subject?.id === filter), [items, filter]);
  const unreadCount = items.filter(item => !item.readAt).length;
  async function openAnnouncement(item: AnnouncementItem) {
    const isOpen = expanded.includes(item.id);
    setExpanded(current => isOpen ? current.filter(id => id !== item.id) : [...current, item.id]);
    if (isOpen || item.readAt || marking.includes(item.id) || readOnly) return;
    setMarking(current => [...current, item.id]);
    try {
      const response = await fetch("/api/student/announcements/" + encodeURIComponent(item.id) + "/read", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not record that this announcement was read.");
      setItems(current => current.map(entry => entry.id === item.id ? { ...entry, readAt: data.readAt } : entry));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not record the announcement as read.");
    } finally { setMarking(current => current.filter(id => id !== item.id)); }
  }
  async function refresh() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/student/announcements", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not refresh announcements.");
      setItems(Array.isArray(data.announcements) ? data.announcements : []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not refresh announcements."); }
    finally { setLoading(false); }
  }
  if (readOnly) return <section className="section-block surface"><div className="section-heading"><div><span className="eyebrow">CLASS BULLETIN BOARD</span><h2>Announcements</h2></div></div><p className="alert alert-info mb-0">The public demo is read-only. Sign in to a registered student account to see enrolled-class announcements.</p></section>;
  return <section className="section-block student-announcements">
    <div className="section-heading"><div><span className="eyebrow">YOUR CLASS BULLETIN BOARD</span><h2>Announcements</h2><p className="muted">Formal notices from teachers of your enrolled classes and subjects, gathered in one place.</p></div>
      <div className="d-flex flex-wrap gap-2 align-items-center"><span className="badge text-bg-primary">{unreadCount} unread</span><button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => void refresh()} disabled={loading}>Refresh</button></div>
    </div>
    {error && <div className="alert alert-danger" role="alert">{error}</div>}
    <div className="surface p-3 mb-3"><label className="form-label" htmlFor="student-announcement-filter">Filter by class or subject</label><select id="student-announcement-filter" className="form-select" value={filter} onChange={event => setFilter(event.target.value)}><option value="ALL">All enrolled classes</option>{courses.map(course => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}</select></div>
    {loading ? <div className="inline-empty" role="status">Loading your announcements…</div>
      : visibleItems.length === 0 ? <div className="empty-state"><div className="empty-icon">▤</div><h3>No announcements to show</h3><p>When your teachers publish notices for your enrolled classes, they will appear here.</p></div>
      : <div className="d-flex flex-column gap-3">{visibleItems.map(item => {
        const isExpanded = expanded.includes(item.id);
        return <article className="surface p-3" key={item.id}>
          <div className="d-flex flex-wrap justify-content-between align-items-start gap-2"><div className="d-flex flex-wrap align-items-center gap-2">{!item.readAt ? <span className="badge text-bg-primary">New</span> : <span className="badge text-bg-light">Read</span>}{item.isPinned && <span className="badge text-bg-warning">Important · Pinned</span>}<span className="badge text-bg-light">{item.subject?.code}</span></div><small className="text-body-secondary">{formatDate(item.publishAt)}</small></div>
          <h3 className="h5 mt-2 mb-1">{item.title}</h3><p className="text-body-secondary small mb-2">{item.subject?.title} · {item.subject?.term} · {item.subject?.academicYear} · {item.author?.fullName}</p>
          {isExpanded && <p className="mb-2" style={{ whiteSpace: "pre-wrap" }}>{item.body}</p>}
          <button type="button" className="btn btn-outline-primary btn-sm" disabled={marking.includes(item.id)} onClick={() => void openAnnouncement(item)}>{marking.includes(item.id) ? "Recording…" : isExpanded ? "Show less" : "Read announcement"}</button>
        </article>;
      })}</div>}
  </section>;
}
