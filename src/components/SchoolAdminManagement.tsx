"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AccountMenu, { type AccountTheme } from "./AccountMenu";
import { saveSagaTheme } from "./ThemeSync";

type Settings = {
  id: string; name: string; shortName: string; slug: string; portalTitle: string; logoText: string;
  primaryColor: string; privacyController: string | null; privacyContactEmail: string | null;
  privacyPolicyUrl: string | null; billingEmail: string | null;
};
type Invitation = { id: string; invitedEmail: string; role: "TEACHER" | "SCHOOL_ADMIN"; expiresAt: string };
type FormSettings = Omit<Settings, "id" | "slug">;

const dateLabel = (value: string) => new Date(value).toLocaleDateString("en-PH", {
  year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Manila"
});

export default function SchoolAdminManagement({ managerName, managerEmail, managerSchoolSlug, managerProfileImagePath, schoolId }: {
  managerName: string; managerEmail: string; managerSchoolSlug: string;
  managerProfileImagePath: string | null; schoolId: string;
}) {
  const router = useRouter();
  const endpoint = `/api/tenant-management/schools/${encodeURIComponent(schoolId)}`;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<FormSettings | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [invitationUrl, setInvitationUrl] = useState("");
  const [theme, setTheme] = useState<AccountTheme>("light");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [settingsResponse, invitationsResponse] = await Promise.all([
        fetch(`${endpoint}/settings`, { cache: "no-store" }),
        fetch(`${endpoint}/invitations`, { cache: "no-store" })
      ]);
      const [settingsData, invitationsData] = await Promise.all([settingsResponse.json(), invitationsResponse.json()]);
      if (!settingsResponse.ok) throw new Error(settingsData.error || "Could not load school settings.");
      if (!invitationsResponse.ok) throw new Error(invitationsData.error || "Could not load invitations.");
      setSettings(settingsData.school);
      setForm({
        name: settingsData.school.name, shortName: settingsData.school.shortName,
        portalTitle: settingsData.school.portalTitle, logoText: settingsData.school.logoText,
        primaryColor: settingsData.school.primaryColor, privacyController: settingsData.school.privacyController || "",
        privacyContactEmail: settingsData.school.privacyContactEmail || "",
        privacyPolicyUrl: settingsData.school.privacyPolicyUrl || "", billingEmail: settingsData.school.billingEmail || ""
      });
      setInvitations(invitationsData.invitations);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load school administration.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, [endpoint]);
  useEffect(() => {
    const saved = window.localStorage.getItem("saga-portal-theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  function setAppearance(next: AccountTheme) {
    saveSagaTheme(next);
    setTheme(next);
  }
  async function logout() {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error("Could not sign out.");
    router.replace("/login");
    router.refresh();
  }
  function setField<K extends keyof FormSettings>(key: K, value: FormSettings[K]) {
    setForm(current => current ? { ...current, [key]: value } : current);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${endpoint}/settings`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save school settings.");
      setSettings(current => current ? { ...current, ...data.school } : current);
      setNotice("School profile saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save school settings.");
    } finally {
      setSaving(false);
    }
  }
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !email.trim()) return;
    setSaving(true);
    setError("");
    setNotice("");
    setInvitationUrl("");
    try {
      const response = await fetch(`${endpoint}/invitations`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: "TEACHER" })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not send invitation.");
      setEmail("");
      setInvitationUrl(data.invitationUrl || "");
      setNotice(data.emailSent ? `Invitation sent to ${data.invitation.invitedEmail}.` : "Invitation created. Copy the secure link below and send it to the teacher.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send invitation.");
    } finally {
      setSaving(false);
    }
  }
  async function revoke(invitationId: string) {
    if (saving || !window.confirm("Revoke this pending invitation? Its link will stop working.")) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${endpoint}/invitations`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitationId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not revoke invitation.");
      setInvitations(current => current.filter(invitation => invitation.id !== invitationId));
      setNotice("Invitation revoked.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke invitation.");
    } finally {
      setSaving(false);
    }
  }
  async function copyInvitation() {
    try {
      await navigator.clipboard.writeText(invitationUrl);
      setNotice("Invitation link copied.");
    } catch {
      setError("Clipboard access is unavailable. Select and copy the invitation link manually.");
    }
  }

  return <main className="school-admin-page container py-4" data-bs-theme={theme}>
    <header className="tenant-roster-header mb-4">
      <div>
        <Link href={`/${encodeURIComponent(managerSchoolSlug)}/overview`} className="small text-decoration-none">← Back to SAGA</Link>
        <p className="eyebrow text-primary mt-3 mb-1">SCHOOL WORKSPACE</p>
        <h1 className="h2 fw-bold mb-1">School administration</h1>
        <p className="text-secondary mb-0">{settings?.name || "Your school"} · You can only manage this school.</p>
      </div>
      <AccountMenu fullName={managerName} email={managerEmail} role="Teacher" profileImagePath={managerProfileImagePath}
        theme={theme} onThemeChange={setAppearance} onEditProfile={() => router.push(`/${encodeURIComponent(managerSchoolSlug)}/profile`)}
        onLogout={logout} onTenantDashboard={() => router.push("/manage")}/>
    </header>

    {error && <div className="alert alert-danger" role="alert">{error}<button type="button" className="btn-close float-end" aria-label="Dismiss error" onClick={() => setError("")}/></div>}
    {notice && <div className="alert alert-success" role="status">{notice}<button type="button" className="btn-close float-end" aria-label="Dismiss notice" onClick={() => setNotice("")}/></div>}
    {loading || !form ? <div className="surface p-5 text-center" role="status">Loading your school workspace…</div> : <>
      <section className="school-admin-shortcuts surface mb-3" aria-label="School rosters">
        <div><h2 className="h5 mb-1">{settings?.name}</h2><p className="small text-secondary mb-0">Workspace address: <code>/{settings?.slug}</code></p></div>
        <div className="d-flex flex-wrap gap-2">
          <Link className="btn btn-outline-primary btn-sm" href={`/manage/${encodeURIComponent(schoolId)}/teachers`}>Manage teachers</Link>
          <Link className="btn btn-outline-primary btn-sm" href={`/manage/${encodeURIComponent(schoolId)}/students`}>Manage students</Link>
        </div>
      </section>
      <div className="school-admin-grid">
        <section className="surface school-admin-card">
          <div className="tenant-panel-header"><div><h2 className="h5 mb-1">School profile</h2><small className="text-secondary">Branding, privacy contacts, and billing contact.</small></div>
            <span className="school-admin-color-preview" style={{ backgroundColor: form.primaryColor }} aria-label="Current brand color"/></div>
          <form onSubmit={save}>
            <div className="row g-3">
              <div className="col-12"><label className="form-label" htmlFor="school-name">Official school name</label><input id="school-name" className="form-control" value={form.name} maxLength={160} required onChange={event => setField("name", event.target.value)}/></div>
              <div className="col-6"><label className="form-label" htmlFor="school-short-name">Short name</label><input id="school-short-name" className="form-control" value={form.shortName} maxLength={24} required onChange={event => setField("shortName", event.target.value)}/></div>
              <div className="col-6"><label className="form-label" htmlFor="school-logo-text">Logo initials</label><input id="school-logo-text" className="form-control" value={form.logoText} maxLength={8} required onChange={event => setField("logoText", event.target.value)}/></div>
              <div className="col-12"><label className="form-label" htmlFor="school-portal-title">Portal title</label><input id="school-portal-title" className="form-control" value={form.portalTitle} maxLength={80} required onChange={event => setField("portalTitle", event.target.value)}/></div>
              <div className="col-12"><label className="form-label" htmlFor="school-primary-color">Brand color</label><div className="d-flex align-items-center gap-2"><input id="school-primary-color" className="form-control form-control-color" type="color" value={form.primaryColor} onChange={event => setField("primaryColor", event.target.value)}/><span className="small text-secondary">{form.primaryColor.toUpperCase()}</span></div></div>
              <div className="col-12"><hr/><h3 className="h6 mb-0">Privacy and billing contacts</h3></div>
              <div className="col-12"><label className="form-label" htmlFor="privacy-controller">Privacy controller</label><input id="privacy-controller" className="form-control" value={form.privacyController || ""} maxLength={160} onChange={event => setField("privacyController", event.target.value)}/></div>
              <div className="col-12 col-md-6"><label className="form-label" htmlFor="privacy-email">Privacy contact email</label><input id="privacy-email" className="form-control" type="email" value={form.privacyContactEmail || ""} maxLength={200} onChange={event => setField("privacyContactEmail", event.target.value)}/></div>
              <div className="col-12 col-md-6"><label className="form-label" htmlFor="billing-email">Billing email</label><input id="billing-email" className="form-control" type="email" value={form.billingEmail || ""} maxLength={200} onChange={event => setField("billingEmail", event.target.value)}/></div>
              <div className="col-12"><label className="form-label" htmlFor="privacy-url">Privacy policy URL</label><input id="privacy-url" className="form-control" type="url" value={form.privacyPolicyUrl || ""} maxLength={500} placeholder="https://" onChange={event => setField("privacyPolicyUrl", event.target.value)}/></div>
            </div>
            <button type="submit" className="btn btn-primary mt-3" disabled={saving}>{saving ? "Saving…" : "Save school profile"}</button>
          </form>
        </section>
        <section className="surface school-admin-card">
          <div className="tenant-panel-header"><div><h2 className="h5 mb-1">Invite teachers</h2><small className="text-secondary">Secure, single-use links expire after 7 days.</small></div><span className="badge text-bg-light">{invitations.length} pending</span></div>
          <form onSubmit={invite} className="school-admin-invite-form">
            <label className="form-label" htmlFor="teacher-invite-email">Teacher email address</label>
            <div className="input-group"><input id="teacher-invite-email" className="form-control" type="email" value={email} required maxLength={200} onChange={event => setEmail(event.target.value)}/><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Working…" : "Send invite"}</button></div>
          </form>
          {invitationUrl && <div className="school-admin-invite-link mt-3"><label className="form-label" htmlFor="invite-link">Secure invitation link</label><div className="input-group"><input id="invite-link" className="form-control" readOnly value={invitationUrl}/><button type="button" className="btn btn-outline-secondary" onClick={() => void copyInvitation()}>Copy</button></div></div>}
          <div className="school-admin-invitation-list mt-4">
            <h3 className="h6">Pending invitations</h3>
            {!invitations.length ? <p className="small text-secondary">No pending invitations.</p> : invitations.map(invitation => <div className="school-admin-invitation" key={invitation.id}>
              <div><b>{invitation.invitedEmail}</b><small>Teacher · expires {dateLabel(invitation.expiresAt)}</small></div>
              <button type="button" className="btn btn-outline-danger btn-sm" disabled={saving} onClick={() => void revoke(invitation.id)}>Revoke</button>
            </div>)}
          </div>
          <div className="school-admin-security-note"><b>School-scoped access</b><span>School administrators can manage this school’s roster and profile, but cannot change plans, payment records, or another school.</span></div>
        </section>
      </div>
    </>}
  </main>;
}
