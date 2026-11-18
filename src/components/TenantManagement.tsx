"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AccountMenu, { type AccountTheme } from "./AccountMenu";
import { saveSagaTheme } from "./ThemeSync";
import { planDisplayName, SCHOOL_PLAN_LIMITS } from "@/lib/plans";
import { csvCell, daysUntil, tenantHealth, todayManila } from "@/lib/tenant-operations";

type Payment = {
  id: string; amount: number; method: string; reference: string | null;
  paidAt: string; coverageFrom: string | null; coverageTo: string | null; note: string | null;
};
type Plan = "FREE" | "PREMIUM" | "ENTERPRISE";
type Subscription = "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED";
type Tenant = {
  id: string; name: string; shortName: string; slug: string; plan: Plan;
  portalTitle: string; logoText: string; primaryColor: string;
  privacyController: string | null; privacyContactEmail: string | null;
  privacyPolicyUrl: string | null; billingEmail: string | null;
  isActive: boolean; subscriptionStatus: Subscription; subscriptionExpiresAt: string | null;
  createdAt: string; updatedAt: string;
  users: Array<{ id: string; fullName: string; email: string; createdAt: string; emailVerifiedAt: string | null; isSchoolAdmin: boolean }>;
  teacherCount: number; verifiedTeacherCount: number;
  studentCount: number; verifiedStudentCount: number; directoryCount: number;
  classCount: number; publishedClasses: number; studentSeats: number;
  paymentCount: number; totalPayments: number; tenantPayments: Payment[];
};
type Activity = {
  id: string; entity: string; action: string; createdAt: string;
  actor: { fullName: string; role: string };
};
type Invitation = { id: string; invitedEmail: string; role: "TEACHER" | "SCHOOL_ADMIN"; expiresAt: string };
type Invoice = {
  id: string; invoiceNumber: string; description: string; amount: number; currency: string;
  issuedAt: string; dueAt: string; status: "ISSUED" | "PAID" | "VOID"; paidAt: string | null; note: string | null;
};

const planLabel = planDisplayName;
const money = (amount: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(amount);
const dateLabel = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Manila" }) : "Not set";

function downloadSchoolReport(tenants: Tenant[]) {
  const header = ["School", "Slug", "Plan", "Activation", "Expiry", "Teachers", "Verified teachers", "Student accounts", "Verified students", "Classes", "Visible classes", "Class enrollment seats", "Directory records", "Payments", "Lifetime receipts (PHP)"];
  const rows = tenants.map(t => [
    t.name, t.slug, t.plan, t.subscriptionStatus, t.subscriptionExpiresAt?.slice(0, 10) ?? "",
    t.teacherCount, t.verifiedTeacherCount, t.studentCount, t.verifiedStudentCount,
    t.classCount, t.publishedClasses, t.studentSeats, t.directoryCount, t.paymentCount, t.totalPayments
  ]);
  const csv = "\uFEFF" + [header, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `saga-school-report-${todayManila()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function TenantManagement({ managerName, managerEmail, managerSchoolSlug, managerProfileImagePath }: {
  managerName: string; managerEmail: string; managerSchoolSlug: string; managerProfileImagePath: string | null;
}) {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selected, setSelected] = useState("");
  const [plan, setPlan] = useState<Plan>("FREE");
  const [status, setStatus] = useState<Subscription>("ACTIVE");
  const [expires, setExpires] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Bank transfer");
  const [reference, setReference] = useState("");
  const [coverageTo, setCoverageTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [sort, setSort] = useState("attention");
  const [page, setPage] = useState(1);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [activityPage, setActivityPage] = useState(1);
  const [activityMore, setActivityMore] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [activityRevision, setActivityRevision] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createShortName, setCreateShortName] = useState("");
  const [createAdminEmail, setCreateAdminEmail] = useState("");
  const [createBillingEmail, setCreateBillingEmail] = useState("");
  const [invitationUrl, setInvitationUrl] = useState("");
  const [profile, setProfile] = useState({
    name: "", shortName: "", portalTitle: "", logoText: "", primaryColor: "#2457d6",
    privacyController: "", privacyContactEmail: "", privacyPolicyUrl: "", billingEmail: ""
  });
  const [invitationEmail, setInvitationEmail] = useState("");
  const [invitationRole, setInvitationRole] = useState<"TEACHER" | "SCHOOL_ADMIN">("TEACHER");
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceDescription, setInvoiceDescription] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [invoiceDueAt, setInvoiceDueAt] = useState("");
  const [payingInvoiceId, setPayingInvoiceId] = useState("");
  const [invoicePaymentMethod, setInvoicePaymentMethod] = useState("Bank transfer");
  const [invoicePaymentReference, setInvoicePaymentReference] = useState("");

  async function load(quiet = false) {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/tenant-management/schools", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load school workspaces.");
      const schools = (data.schools ?? []) as Tenant[];
      setTenants(schools);
      setSelected(current => schools.some(entry => entry.id === current) ? current : schools[0]?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load school workspaces.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }
  useEffect(() => { void load(); }, []);
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

  const active = tenants.find(tenant => tenant.id === selected) ?? null;
  useEffect(() => {
    if (active) setPlan(active.plan);
  }, [active?.id, active?.plan]);
  useEffect(() => {
    if (active) setStatus(active.subscriptionStatus);
  }, [active?.id, active?.subscriptionStatus]);
  useEffect(() => {
    if (active) setExpires(active.subscriptionExpiresAt?.slice(0, 10) || "");
  }, [active?.id, active?.subscriptionExpiresAt]);
  useEffect(() => {
    if (!active) return;
    setProfile({
      name: active.name, shortName: active.shortName, portalTitle: active.portalTitle,
      logoText: active.logoText, primaryColor: active.primaryColor,
      privacyController: active.privacyController || "", privacyContactEmail: active.privacyContactEmail || "",
      privacyPolicyUrl: active.privacyPolicyUrl || "", billingEmail: active.billingEmail || ""
    });
    setAmount(""); setReference(""); setCoverageTo(""); setNote("");
    setInvitations([]); setInvoices([]);
    setInvitationEmail(""); setInvitationUrl("");
    setInvoiceDescription(""); setInvoiceAmount(""); setInvoiceDueAt("");
    setPayingInvoiceId(""); setInvoicePaymentMethod("Bank transfer"); setInvoicePaymentReference("");
  }, [active?.id]);

  const unsaved = !!active && (
    plan !== active.plan || status !== active.subscriptionStatus ||
    expires !== (active.subscriptionExpiresAt?.slice(0, 10) || "") || amount.trim() !== "" ||
    profile.name !== active.name || profile.shortName !== active.shortName ||
    profile.portalTitle !== active.portalTitle || profile.logoText !== active.logoText ||
    profile.primaryColor !== active.primaryColor || profile.privacyController !== (active.privacyController || "") ||
    profile.privacyContactEmail !== (active.privacyContactEmail || "") ||
    profile.privacyPolicyUrl !== (active.privacyPolicyUrl || "") || profile.billingEmail !== (active.billingEmail || "")
  );
  function selectTenant(id: string) {
    if (busy || id === selected) return;
    if (unsaved && !window.confirm("Discard unsaved tenant settings or payment details?")) return;
    setSelected(id);
    setActivityOpen(false); setActivityPage(1); setActivity([]);
    setError(""); setNotice("");
  }
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const rows = tenants.filter(tenant =>
      (!query || `${tenant.name} ${tenant.shortName} ${tenant.slug}`.toLocaleLowerCase().includes(query)) &&
      (planFilter === "ALL" || tenant.plan === planFilter) &&
      (statusFilter === "ALL" || (statusFilter === "ATTENTION" ? tenantHealth(tenant).level !== "good" : tenant.subscriptionStatus === statusFilter))
    );
    rows.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "newest") return b.createdAt.localeCompare(a.createdAt);
      if (sort === "expiring") return (daysUntil(a.subscriptionExpiresAt) ?? Infinity) - (daysUntil(b.subscriptionExpiresAt) ?? Infinity);
      const severity = (tenant: Tenant) => tenantHealth(tenant).level === "danger" ? 0 : tenantHealth(tenant).level === "warning" ? 1 : 2;
      return severity(a) - severity(b) || a.name.localeCompare(b.name);
    });
    return rows;
  }, [tenants, search, planFilter, statusFilter, sort]);
  const perPage = 12;
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);
  const kpis = useMemo(() => ({
    total: tenants.length,
    active: tenants.filter(tenant => tenant.isActive && tenant.subscriptionStatus === "ACTIVE").length,
    attention: tenants.filter(tenant => tenantHealth(tenant).level !== "good").length,
    teachers: tenants.reduce((sum, tenant) => sum + tenant.teacherCount, 0),
    students: tenants.reduce((sum, tenant) => sum + tenant.studentCount, 0),
    receipts: tenants.reduce((sum, tenant) => sum + tenant.totalPayments, 0)
  }), [tenants]);

  useEffect(() => {
    if (!selected || !activityOpen) return;
    const controller = new AbortController();
    setActivityLoading(true);
    setActivityError("");
    async function retrieve() {
      try {
        const response = await fetch(`/api/tenant-management/schools/${encodeURIComponent(selected)}/activity?page=${activityPage}`,
          { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load activity.");
        if (!controller.signal.aborted) {
          setActivity(data.events ?? []);
          setActivityMore(!!data.hasMore);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setActivityError(cause instanceof Error ? cause.message : "Could not load activity.");
      } finally {
        if (!controller.signal.aborted) setActivityLoading(false);
      }
    }
    void retrieve();
    return () => controller.abort();
  }, [selected, activityOpen, activityPage, activityRevision]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    async function retrieve() {
      try {
        const base = `/api/tenant-management/schools/${encodeURIComponent(selected)}`;
        const [inviteResponse, invoiceResponse] = await Promise.all([
          fetch(`${base}/invitations`, { cache: "no-store", signal: controller.signal }),
          fetch(`${base}/invoices`, { cache: "no-store", signal: controller.signal })
        ]);
        const [inviteData, invoiceData] = await Promise.all([inviteResponse.json(), invoiceResponse.json()]);
        if (!inviteResponse.ok) throw new Error(inviteData.error || "Could not load invitations.");
        if (!invoiceResponse.ok) throw new Error(invoiceData.error || "Could not load invoices.");
        if (!controller.signal.aborted) {
          setInvitations(inviteData.invitations || []);
          setInvoices(invoiceData.invoices || []);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load school details.");
      }
    }
    void retrieve();
    return () => controller.abort();
  }, [selected]);

  async function save() {
    if (!active || busy) return;
    if (status !== "ACTIVE" && status !== active.subscriptionStatus &&
      !window.confirm("Changing this school to an inactive subscription status will restrict access. Continue?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const payment = amount ? {
        amount: Number(amount), method, reference: reference || undefined,
        coverageTo: coverageTo || undefined, note: note || undefined
      } : undefined;
      const response = await fetch("/api/tenant-management/schools", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolId: active.id, plan, subscriptionStatus: status,
          subscriptionExpiresAt: expires || null, payment
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save tenant changes.");
      const saved = data.school as Pick<Tenant, "id" | "plan" | "subscriptionStatus" | "isActive" | "subscriptionExpiresAt" | "updatedAt">;
      setTenants(current => current.map(tenant => tenant.id === saved.id ? { ...tenant, ...saved } : tenant));
      if (planFilter !== "ALL" && saved.plan !== planFilter) {
        setPlanFilter("ALL");
        setPage(1);
      }
      const confirmation = saved.plan === active.plan
        ? "Tenant settings saved."
        : `Plan saved as ${planLabel(saved.plan)} for ${active.name}.`;
      setNotice(payment ? `${confirmation} Payment recorded.` : confirmation);
      setAmount(""); setReference(""); setCoverageTo(""); setNote("");
      setActivityRevision(revision => revision + 1);
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save tenant changes.");
    } finally {
      setBusy(false);
    }
  }

      async function createSchool(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        setBusy(true); setError(""); setNotice(""); setInvitationUrl("");
        try {
          const response = await fetch("/api/tenant-management/schools", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: createName, shortName: createShortName,
              adminEmail: createAdminEmail, billingEmail: createBillingEmail || undefined
            })
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Could not create school.");
          setCreateName(""); setCreateShortName(""); setCreateAdminEmail(""); setCreateBillingEmail("");
          setCreateOpen(false);
          setNotice(data.emailSent
            ? `Workspace created and administrator invitation sent to ${data.school.name}.`
            : `Workspace created for ${data.school.name}. Copy the administrator invitation link and share it securely.`);
          setInvitationUrl(data.invitationUrl || "");
          await load(true);
          setSelected(data.school.id);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not create school.");
        } finally {
          setBusy(false);
        }
      }
      async function saveProfile(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!active || busy) return;
        setBusy(true); setError(""); setNotice("");
        try {
          const response = await fetch(`/api/tenant-management/schools/${encodeURIComponent(active.id)}/settings`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile)
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Could not save school profile.");
          setTenants(current => current.map(tenant => tenant.id === active.id ? { ...tenant, ...data.school } : tenant));
          setNotice("School profile and contacts saved.");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not save school profile.");
        } finally {
          setBusy(false);
        }
      }
      async function createInvitation(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!active || busy) return;
        setBusy(true); setError(""); setNotice(""); setInvitationUrl("");
        try {
          const response = await fetch(`/api/tenant-management/schools/${encodeURIComponent(active.id)}/invitations`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: invitationEmail, role: invitationRole })
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Could not create invitation.");
          setInvitationEmail(""); setInvitationUrl(data.invitationUrl || "");
          setNotice(data.emailSent ? `Invitation sent to ${data.invitation.invitedEmail}.` : "Invitation created. Copy the secure link and share it with the invitee.");
          const list = await fetch(`/api/tenant-management/schools/${encodeURIComponent(active.id)}/invitations`, { cache: "no-store" });
          const listData = await list.json();
          if (!list.ok) throw new Error(listData.error || "Invitation saved, but the list could not be refreshed.");
          setInvitations(listData.invitations || []);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not create invitation.");
        } finally {
          setBusy(false);
        }
      }
      async function revokeInvitation(invitationId: string) {
        if (!active || busy || !window.confirm("Revoke this pending invitation? Its link will stop working.")) return;
        setBusy(true); setError(""); setNotice("");
        try {
          const response = await fetch(`/api/tenant-management/schools/${encodeURIComponent(active.id)}/invitations`, {
            method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invitationId })
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Could not revoke invitation.");
          setInvitations(current => current.filter(invitation => invitation.id !== invitationId));
          setNotice("Invitation revoked.");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not revoke invitation.");
        } finally {
          setBusy(false);
        }
      }
        async function setSchoolAdmin(userId: string, isSchoolAdmin: boolean) {
          if (!active || busy) return;
          setBusy(true); setError(""); setNotice("");
          try {
            const response = await fetch(`/api/tenant-management/schools/${encodeURIComponent(active.id)}/administrators`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId, isSchoolAdmin })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Could not update school administrator access.");
            setTenants(current => current.map(tenant => tenant.id !== active.id ? tenant : {
              ...tenant,
              users: tenant.users.map(user => user.id === userId ? { ...user, isSchoolAdmin: data.isSchoolAdmin } : user)
            }));
            setNotice(data.isSchoolAdmin ? "School administrator access granted." : "School administrator access removed.");
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not update school administrator access.");
          } finally {
            setBusy(false);
          }
        }
      async function createInvoice(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!active || busy) return;
        setBusy(true); setError(""); setNotice("");
        try {
          const response = await fetch(`/api/tenant-management/schools/${encodeURIComponent(active.id)}/invoices`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description: invoiceDescription, amount: Number(invoiceAmount), dueAt: invoiceDueAt })
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Could not issue invoice.");
          setInvoices(current => [data.invoice, ...current]);
          setInvoiceDescription(""); setInvoiceAmount(""); setInvoiceDueAt("");
          setNotice(data.emailSent
            ? `Invoice ${data.invoice.invoiceNumber} issued and emailed. Due-date reminders are scheduled automatically.`
            : `Invoice ${data.invoice.invoiceNumber} saved. Set a billing email and check SMTP to enable email notices.`);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not issue invoice.");
        } finally {
          setBusy(false);
        }
      }
      async function updateInvoice(invoice: Invoice, status: "PAID" | "VOID", payment?: { method: string; reference?: string }) {
        if (!active || busy) return;
        if (status === "VOID" && !window.confirm(`Void invoice ${invoice.invoiceNumber}?`)) return;
        setBusy(true); setError(""); setNotice("");
        try {
          const response = await fetch(`/api/tenant-management/schools/${encodeURIComponent(active.id)}/invoices`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ invoiceId: invoice.id, status, ...payment })
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Could not update invoice.");
          setInvoices(current => current.map(row => row.id === invoice.id ? data.invoice : row));
          setPayingInvoiceId("");
          setInvoicePaymentReference("");
          setNotice(status === "PAID" ? `Invoice ${invoice.invoiceNumber} marked paid and added to the payment ledger.` : `Invoice ${invoice.invoiceNumber} voided.`);
          await load(true);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not update invoice.");
        } finally {
          setBusy(false);
        }
      }
  function extendExpiry() {
    const today = todayManila();
    const date = new Date(`${expires && expires > today ? expires : today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 30);
    setExpires(date.toISOString().slice(0, 10));
  }
  async function copyStudentLink() {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/register?schoolId=${encodeURIComponent(active.id)}`);
      setNotice(`Student registration link copied for ${active.name}.`);
    } catch {
      setError("Clipboard permission is unavailable. Open /register and select the school manually.");
    }
  }
  const activeHealth = active ? tenantHealth(active) : null;
  const expiryDays = active ? daysUntil(active.subscriptionExpiresAt) : null;
  const isPlanUnchanged = !!active && plan === active.plan &&
    status === active.subscriptionStatus &&
    expires === (active.subscriptionExpiresAt?.slice(0, 10) || "") &&
    amount.trim() === "";

  return <main className="tenant-operations container-fluid py-4 px-3 px-lg-5" data-bs-theme={theme}>
    <header className="tenant-operations-header">
      <div><Link href="/dashboard" className="small text-decoration-none">← Back to SAGA</Link>
        <p className="text-primary fw-bold small text-uppercase mt-3 mb-1">SAGA PLATFORM ADMINISTRATION</p>
        <h1 className="h2 fw-bold mb-2">Tenant operations</h1>
        <p className="text-secondary mb-0">Schools, access, subscriptions, adoption, and audit-ready records.</p>
      </div>
      <div className="tenant-admin-controls">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => { setCreateOpen(open => !open); setError(""); setNotice(""); }} disabled={busy}>
          {createOpen ? "Close setup" : "+ Add school"}
        </button>
        <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => void load(true)} disabled={refreshing || loading || busy}>
          {refreshing ? "Refreshing…" : "Refresh data"}
        </button>
        <AccountMenu
          fullName={managerName}
          email={managerEmail}
          role="Teacher"
          profileImagePath={managerProfileImagePath}
          theme={theme}
          onThemeChange={setAppearance}
          onEditProfile={() => router.push(`/${encodeURIComponent(managerSchoolSlug)}/profile`)}
          onLogout={logout}
        />
      </div>
    </header>

    <div className="tenant-operations-note" role="note">
      Freemium is free; Premium is currently listed at <b>₱499 per school/month</b>; Pro / Enterprise pricing is by agreement.
      Invoices and payments are manual records; no customer is charged automatically. Email reminders go out 7 and 1 day before, on the due date, and 1 and 7 days after.
    </div>

    {error && <div className="alert alert-danger" role="alert">{error}<button type="button" className="btn-close float-end" aria-label="Dismiss error" onClick={() => setError("")}/></div>}
    {notice && <div className="alert alert-success" role="status">{notice}<button type="button" className="btn-close float-end" aria-label="Dismiss notice" onClick={() => setNotice("")}/></div>}
    {invitationUrl && <div className="surface tenant-invitation-created" role="status">
      <div><b>Secure invitation link</b><small>Share this link only with the invited administrator or teacher.</small></div>
      <div className="input-group"><input className="form-control" aria-label="Invitation link" readOnly value={invitationUrl}/>
        <button type="button" className="btn btn-outline-primary" onClick={async () => {
          try { await navigator.clipboard.writeText(invitationUrl); setNotice("Invitation link copied."); }
          catch { setError("Clipboard access is unavailable. Select and copy the link manually."); }
        }}>Copy</button>
      </div>
    </div>}
    {createOpen && <form className="surface tenant-create-form mb-3" onSubmit={createSchool}>
      <div><h2 className="h5 mb-1">Create a school workspace</h2><p className="small text-secondary mb-0">The initial administrator receives a secure, single-use setup link.</p></div>
      <div className="row g-3">
        <div className="col-12 col-md-6"><label className="form-label" htmlFor="create-school-name">Official school name</label><input id="create-school-name" className="form-control" value={createName} maxLength={160} required onChange={event => setCreateName(event.target.value)}/></div>
        <div className="col-12 col-md-6"><label className="form-label" htmlFor="create-school-short">Short name</label><input id="create-school-short" className="form-control" value={createShortName} maxLength={24} required onChange={event => setCreateShortName(event.target.value)}/></div>
        <div className="col-12 col-md-6"><label className="form-label" htmlFor="create-school-admin">Initial school administrator email</label><input id="create-school-admin" className="form-control" type="email" value={createAdminEmail} maxLength={200} required onChange={event => setCreateAdminEmail(event.target.value)}/></div>
        <div className="col-12 col-md-6"><label className="form-label" htmlFor="create-school-billing">Billing email <span className="text-secondary">(optional)</span></label><input id="create-school-billing" className="form-control" type="email" value={createBillingEmail} maxLength={200} onChange={event => setCreateBillingEmail(event.target.value)}/></div>
      </div>
      <div className="d-flex justify-content-end"><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Creating…" : "Create workspace & invite admin"}</button></div>
    </form>}

    <section className="tenant-kpi-grid" aria-label="Platform summary">
      {[
        { title: "School workspaces", value: String(kpis.total), hint: "Registered organizations" },
        { title: "Active schools", value: String(kpis.active), hint: "Currently enabled" },
        { title: "Needs attention", value: String(kpis.attention), hint: "Expiry, setup, or activation", attention: kpis.attention > 0 },
        { title: "Teacher / student accounts", value: `${kpis.teachers} / ${kpis.students}`, hint: "Portal registrations" },
        { title: "Recorded payments", value: money(kpis.receipts), hint: "All-time manual payment entries" }
      ].map(card => <div className={`surface tenant-kpi${card.attention ? " tenant-kpi-alert" : ""}`} key={card.title}>
        <small>{card.title}</small><strong>{card.value}</strong><span>{card.hint}</span>
      </div>)}
    </section>

    {loading ? <div className="surface p-5 text-center" role="status"><span className="spinner-border spinner-border-sm me-2" aria-hidden="true"/> Loading school workspaces…</div> :
      <div className="tenant-workspace-grid">
        <section className="surface tenant-school-list" aria-label="School directory">
          <div className="tenant-panel-header">
            <div><h2 className="h5 mb-1">School directory</h2><small className="text-secondary">{filtered.length} of {tenants.length} schools</small></div>
            <div className="tenant-export-actions">
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => downloadSchoolReport(tenants)} disabled={!tenants.length}>Export school report</button>
              <a className="btn btn-outline-primary btn-sm" href="/api/tenant-management/payments/export">Export payment ledger</a>
            </div>
          </div>
          <div className="tenant-filter-grid">
            <label><span>Search schools</span><input className="form-control" type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="School name or slug"/></label>
            <label><span>Plan</span><select className="form-select" value={planFilter} onChange={event => { setPlanFilter(event.target.value); setPage(1); }}><option value="ALL">All plans</option><option value="FREE">Freemium</option><option value="PREMIUM">Premium</option><option value="ENTERPRISE">Pro / Enterprise</option></select></label>
            <label><span>Activation / follow-up</span><select className="form-select" value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setPage(1); }}><option value="ALL">All statuses</option><option value="ATTENTION">Needs attention</option><option value="ACTIVE">Active</option><option value="PAST_DUE">Past due</option><option value="SUSPENDED">Suspended</option><option value="CANCELLED">Cancelled</option></select></label>
            <label><span>Sort</span><select className="form-select" value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}><option value="attention">Action required first</option><option value="expiring">Expiry date</option><option value="name">School name</option><option value="newest">Newest first</option></select></label>
          </div>

          <div className="tenant-table-wrap">
            <table className="table align-middle tenant-workspace-table">
              <thead><tr><th>School</th><th>Tier</th><th>Teachers</th><th>Students</th><th>Classes / seats</th><th>Health</th><th>Rosters</th></tr></thead>
              <tbody>{visible.map(tenant => {
                const health = tenantHealth(tenant);
                return <tr key={tenant.id} className={selected === tenant.id ? "tenant-row-selected" : ""}>
                  <td data-label="School"><button type="button" className="tenant-school-button" aria-pressed={selected === tenant.id} disabled={busy} onClick={() => selectTenant(tenant.id)}>
                    <b>{tenant.name}</b><small>{tenant.slug}</small>
                  </button></td>
                  <td data-label="Tier">{planLabel(tenant.plan)}</td>
                  <td data-label="Teachers">{tenant.verifiedTeacherCount}/{tenant.teacherCount} verified</td>
                  <td data-label="Students">{tenant.verifiedStudentCount}/{tenant.studentCount} verified</td>
                  <td data-label="Classes / seats">{tenant.classCount} / {tenant.studentSeats}</td>
                  <td data-label="Health"><span className={`tenant-health tenant-health-${health.level}`}>{health.label}</span></td>
                  <td data-label="Rosters"><div className="tenant-roster-links">
                    <Link href={`/manage/${encodeURIComponent(tenant.id)}/students`} className="btn btn-outline-primary btn-sm">Students</Link>
                    <Link href={`/manage/${encodeURIComponent(tenant.id)}/teachers`} className="btn btn-outline-primary btn-sm">Teachers</Link>
                  </div></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          {!filtered.length && <div className="tenant-list-empty">
            <b>No matching schools</b><p>Try a different search or reset the filters.</p>
            <button className="btn btn-outline-primary btn-sm" type="button" onClick={() => { setSearch(""); setPlanFilter("ALL"); setStatusFilter("ALL"); setPage(1); }}>Clear filters</button>
          </div>}
          {totalPages > 1 && <div className="tenant-pagination">
            <span>Page {currentPage} of {totalPages}</span>
            <div><button type="button" className="btn btn-outline-secondary btn-sm" disabled={currentPage <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
              <button type="button" className="btn btn-outline-secondary btn-sm" disabled={currentPage >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button></div>
          </div>}
          <p className="tenant-data-hint">Class seats count class-enrollment records; a student appearing in multiple classes counts more than once. Registered student accounts are counted separately.</p>
        </section>

        <section className="tenant-settings-column" aria-label="Selected school operations">
          {active ? <>
            <div className="surface tenant-settings-panel">
              <div className="tenant-panel-header">
                <div><span className="eyebrow">SELECTED SCHOOL</span><h2>{active.name}</h2><small className="text-secondary">{active.slug} · Created {dateLabel(active.createdAt)}</small><span className="badge text-bg-primary mt-2">Current plan · {planLabel(active.plan)}</span></div>
                <span className={`tenant-health tenant-health-${activeHealth?.level || "good"}`}>{activeHealth?.label}</span>
              </div>
              <div className="tenant-selected-stats">
                <div><small>Teachers</small><b>{active.teacherCount}</b><span>{active.verifiedTeacherCount} verified</span></div>
                <div><small>Students</small><b>{active.studentCount}</b><span>{active.verifiedStudentCount} verified</span></div>
                <div><small>Classes</small><b>{active.classCount}</b><span>{active.publishedClasses} visible</span></div>
                <div><small>Roster seats</small><b>{active.studentSeats}</b><span>{active.directoryCount} directory entries</span></div>
              </div>
              <div className="tenant-action-row">
                <Link className="btn btn-outline-primary btn-sm" href={`/manage/${encodeURIComponent(active.id)}/students`}>Manage students</Link>
                <Link className="btn btn-outline-primary btn-sm" href={`/manage/${encodeURIComponent(active.id)}/teachers`}>Manage teachers</Link>
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => void copyStudentLink()} disabled={!active.teacherCount}>Copy student signup link</button>
              </div>
              {!active.teacherCount && <p className="tenant-data-hint">Student signup becomes available after the first teacher registers for this school.</p>}
              {activeHealth?.level !== "good" && <div className="tenant-follow-up" role="note">
                <b>Follow-up recommended:</b> {activeHealth?.label}.
                {expiryDays !== null && expiryDays < 0 && " The expiry date alone does not disable access; review the activation status manually."}
              </div>}
              <div className="tenant-section-header"><h3>Plan and activation</h3><span>Changes are audited</span></div>
              <div className="row g-3">
                <div className="col-12 col-sm-6"><label className="form-label" htmlFor="tenant-plan">Plan</label><select id="tenant-plan" className="form-select" value={plan} disabled={busy} onChange={event => setPlan(event.target.value as Plan)}><option value="FREE">Freemium · ₱0</option><option value="PREMIUM">Premium · ₱499/month</option><option value="ENTERPRISE">Pro / Enterprise · Custom</option></select></div>
                <div className="col-12 col-sm-6"><label className="form-label" htmlFor="tenant-status">Activation</label><select id="tenant-status" className="form-select" value={status} disabled={busy} onChange={event => setStatus(event.target.value as Subscription)}><option value="ACTIVE">Active</option><option value="PAST_DUE">Past due</option><option value="SUSPENDED">Suspended</option><option value="CANCELLED">Cancelled</option></select></div>
                <div className="col-12 small text-secondary">
                  Current plan limits · {SCHOOL_PLAN_LIMITS[active.plan].teachers.toLocaleString("en-PH")} teachers,{" "}
                  {SCHOOL_PLAN_LIMITS[active.plan].classes.toLocaleString("en-PH")} classes,{" "}
                  {SCHOOL_PLAN_LIMITS[active.plan].studentSeats.toLocaleString("en-PH")} seats.
                </div>
                <div className="col-12"><label className="form-label" htmlFor="tenant-expiry">Paid-through / expiry date</label>
                  <div className="tenant-renewal-row"><input id="tenant-expiry" className="form-control" type="date" value={expires} disabled={busy} onChange={event => setExpires(event.target.value)}/>
                    <button type="button" className="btn btn-outline-primary btn-sm" onClick={extendExpiry} disabled={busy}>Extend 30 days</button></div>
                  <div className="form-text">Leave blank for no expiry. Renewal dates are saved only when you select Save.</div>
                </div>
              </div>
              <div className="tenant-section-header"><h3>Record payment</h3><span>Optional · manual entry</span></div>
              <div className="row g-3">
                <div className="col-12 col-sm-6"><label className="form-label" htmlFor="tenant-amount">Amount (PHP)</label><input id="tenant-amount" className="form-control" type="number" min="0.01" step="0.01" value={amount} disabled={busy} onChange={event => setAmount(event.target.value)}/></div>
                <div className="col-12 col-sm-6"><label className="form-label" htmlFor="tenant-method">Method</label><input id="tenant-method" className="form-control" value={method} maxLength={40} disabled={busy} onChange={event => setMethod(event.target.value)}/></div>
                <div className="col-12"><label className="form-label" htmlFor="tenant-reference">Reference</label><input id="tenant-reference" className="form-control" value={reference} maxLength={120} disabled={busy} onChange={event => setReference(event.target.value)}/></div>
                <div className="col-12"><label className="form-label" htmlFor="tenant-coverage">Coverage through</label><input id="tenant-coverage" className="form-control" type="date" value={coverageTo} disabled={busy} onChange={event => setCoverageTo(event.target.value)}/></div>
                <div className="col-12"><label className="form-label" htmlFor="tenant-note">Internal note</label><textarea id="tenant-note" className="form-control" rows={2} maxLength={500} disabled={busy} value={note} onChange={event => setNote(event.target.value)}/></div>
              </div>
              <div className="tenant-save-actions"><span>{isPlanUnchanged ? "No pending changes" : "Unsaved changes"}</span>
                <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || isPlanUnchanged}>{busy ? "Saving…" : "Save tenant settings"}</button></div>
            </div>
            <div className="surface tenant-operations-detail">
              <div className="tenant-panel-header"><div><h3>Payment history</h3><small>{active.paymentCount} recorded payment{active.paymentCount === 1 ? "" : "s"} · {money(active.totalPayments)} all time</small></div>
                <a className="btn btn-outline-primary btn-sm" href={`/api/tenant-management/payments/export?schoolId=${encodeURIComponent(active.id)}`}>Export CSV</a></div>
              {active.tenantPayments.length ? <div className="tenant-payment-list">{active.tenantPayments.map(payment => <div key={payment.id}>
                <b>{money(payment.amount)}</b><span>{payment.method} · {dateLabel(payment.paidAt)}</span>
                <small>{payment.reference || "No reference"}{payment.coverageTo ? ` · Through ${dateLabel(payment.coverageTo)}` : ""}{payment.note ? ` · ${payment.note}` : ""}</small>
              </div>)}</div> : <p className="small text-secondary mb-0">No payments recorded for this school.</p>}
              {active.paymentCount > active.tenantPayments.length && <p className="tenant-data-hint">Showing 5 recent payments; export CSV for the full ledger.</p>}
            </div>
            <div className="surface tenant-operations-detail">
              <div className="tenant-panel-header"><div><h3>Activity and accountability</h3><small>Audit events from this school and its tenant settings</small></div>
                <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => { setActivityOpen(open => !open); setActivityPage(1); }}>{activityOpen ? "Hide activity" : "View activity"}</button></div>
              {activityOpen && <>
                {activityLoading ? <p role="status" className="small text-secondary mt-3 mb-0">Loading activity…</p> : activityError ? <div className="alert alert-danger mt-3">{activityError}<button className="btn btn-link btn-sm" onClick={() => setActivityRevision(value => value + 1)}>Retry</button></div> :
                  activity.length ? <div className="tenant-activity-list">{activity.map(event => <article key={event.id}>
                    <b>{event.action}</b><small>{event.actor.fullName} · {event.entity} · {new Date(event.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</small>
                  </article>)}</div> : <p className="small text-secondary mt-3">No activity records available.</p>}
                {(activityPage > 1 || activityMore) && <div className="tenant-pagination mt-3"><span>Page {activityPage}</span><div><button className="btn btn-outline-secondary btn-sm" disabled={activityPage === 1 || activityLoading} onClick={() => setActivityPage(p => p - 1)}>Previous</button><button className="btn btn-outline-secondary btn-sm" disabled={!activityMore || activityLoading} onClick={() => setActivityPage(p => p + 1)}>Next</button></div></div>}
              </>}
            </div>
            <div className="surface tenant-operations-detail">
              <div className="tenant-panel-header"><div><h3>Teachers in this school</h3><small>Recent accounts · {active.teacherCount} total</small></div>
                <Link className="btn btn-outline-primary btn-sm" href={`/manage/${encodeURIComponent(active.id)}/teachers`}>View all</Link></div>
              {active.users.length ? <div className="tenant-teacher-list">{active.users.map(teacher => <div key={teacher.id}>
                <b>{teacher.fullName}</b><small>{teacher.email}{teacher.isSchoolAdmin ? " · School administrator" : ""}</small>
                <span className={`tenant-health tenant-health-${teacher.emailVerifiedAt ? "good" : "warning"}`}>{teacher.emailVerifiedAt ? "Verified" : "Unverified"}</span>
                <button type="button" className={`btn btn-sm ${teacher.isSchoolAdmin ? "btn-outline-secondary" : "btn-outline-primary"}`} disabled={busy} onClick={() => void setSchoolAdmin(teacher.id, !teacher.isSchoolAdmin)}>{teacher.isSchoolAdmin ? "Remove admin" : "Make admin"}</button>
              </div>)}</div> : <p className="small text-secondary mb-0">No teachers have registered for this school yet.</p>}
              {active.teacherCount > active.users.length && <p className="tenant-data-hint">Showing the eight newest teachers. Use View all for the full account roster.</p>}
            </div>
            <details className="surface tenant-operations-detail tenant-profile-details">
              <summary><span><b>Workspace profile &amp; contacts</b><small>Brand identity, privacy notice contacts, and billing reminders</small></span><span aria-hidden="true">⌄</span></summary>
              <form className="row g-3 mt-1" onSubmit={saveProfile}>
                <div className="col-12"><label className="form-label" htmlFor="profile-name">School name</label><input id="profile-name" className="form-control" value={profile.name} maxLength={160} required disabled={busy} onChange={event => setProfile(current => ({ ...current, name: event.target.value }))}/></div>
                <div className="col-6"><label className="form-label" htmlFor="profile-short-name">Short name</label><input id="profile-short-name" className="form-control" value={profile.shortName} maxLength={24} required disabled={busy} onChange={event => setProfile(current => ({ ...current, shortName: event.target.value }))}/></div>
                <div className="col-6"><label className="form-label" htmlFor="profile-logo-text">Logo initials</label><input id="profile-logo-text" className="form-control" value={profile.logoText} maxLength={8} required disabled={busy} onChange={event => setProfile(current => ({ ...current, logoText: event.target.value }))}/></div>
                <div className="col-12"><label className="form-label" htmlFor="profile-portal-title">Portal title</label><input id="profile-portal-title" className="form-control" value={profile.portalTitle} maxLength={80} required disabled={busy} onChange={event => setProfile(current => ({ ...current, portalTitle: event.target.value }))}/></div>
                <div className="col-12"><label className="form-label" htmlFor="profile-color">Brand color</label><div className="d-flex align-items-center gap-2"><input id="profile-color" className="form-control form-control-color" type="color" value={profile.primaryColor} disabled={busy} onChange={event => setProfile(current => ({ ...current, primaryColor: event.target.value }))}/><span className="small text-secondary">{profile.primaryColor.toUpperCase()}</span></div></div>
                <div className="col-12"><label className="form-label" htmlFor="profile-privacy-controller">Privacy controller</label><input id="profile-privacy-controller" className="form-control" value={profile.privacyController} maxLength={160} disabled={busy} onChange={event => setProfile(current => ({ ...current, privacyController: event.target.value }))}/></div>
                <div className="col-12 col-md-6"><label className="form-label" htmlFor="profile-privacy-email">Privacy contact email</label><input id="profile-privacy-email" className="form-control" type="email" value={profile.privacyContactEmail} maxLength={200} disabled={busy} onChange={event => setProfile(current => ({ ...current, privacyContactEmail: event.target.value }))}/></div>
                <div className="col-12 col-md-6"><label className="form-label" htmlFor="profile-billing-email">Billing email</label><input id="profile-billing-email" className="form-control" type="email" value={profile.billingEmail} maxLength={200} disabled={busy} onChange={event => setProfile(current => ({ ...current, billingEmail: event.target.value }))}/></div>
                <div className="col-12"><label className="form-label" htmlFor="profile-privacy-url">Privacy policy URL</label><input id="profile-privacy-url" className="form-control" type="url" placeholder="https://" value={profile.privacyPolicyUrl} maxLength={500} disabled={busy} onChange={event => setProfile(current => ({ ...current, privacyPolicyUrl: event.target.value }))}/></div>
                <div className="col-12 d-flex justify-content-end"><button className="btn btn-primary btn-sm" type="submit" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button></div>
              </form>
            </details>
            <div className="surface tenant-operations-detail">
              <div className="tenant-panel-header"><div><h3>Invitations</h3><small>Single-use links expire after 7 days.</small></div><span className="badge text-bg-light">{invitations.length} pending</span></div>
              <form className="row g-2 align-items-end" onSubmit={createInvitation}>
                <div className="col-12 col-md"><label className="form-label" htmlFor="invite-email">Email address</label><input id="invite-email" className="form-control" type="email" value={invitationEmail} maxLength={200} required disabled={busy} onChange={event => setInvitationEmail(event.target.value)}/></div>
                <div className="col-12 col-md-4"><label className="form-label" htmlFor="invite-role">Access</label><select id="invite-role" className="form-select" value={invitationRole} disabled={busy} onChange={event => setInvitationRole(event.target.value as "TEACHER" | "SCHOOL_ADMIN")}><option value="TEACHER">Teacher</option><option value="SCHOOL_ADMIN">School administrator</option></select></div>
                <div className="col-12 col-md-auto"><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Working…" : "Invite"}</button></div>
              </form>
              {invitations.length ? <div className="tenant-invitation-list mt-3">{invitations.map(invitation => <div key={invitation.id}>
                <span><b>{invitation.invitedEmail}</b><small>{invitation.role === "SCHOOL_ADMIN" ? "School administrator" : "Teacher"} · expires {dateLabel(invitation.expiresAt)}</small></span>
                <button type="button" className="btn btn-outline-danger btn-sm" disabled={busy} onClick={() => void revokeInvitation(invitation.id)}>Revoke</button>
              </div>)}</div> : <p className="small text-secondary mt-3 mb-0">No pending invitations.</p>}
            </div>
            <div className="surface tenant-operations-detail">
              <div className="tenant-panel-header"><div><h3>Invoices &amp; due-date reminders</h3><small>Manual billing records; no automatic charges.</small></div><span className="badge text-bg-light">{invoices.filter(invoice => invoice.status === "ISSUED").length} open</span></div>
              <form className="row g-2 align-items-end" onSubmit={createInvoice}>
                <div className="col-12"><label className="form-label" htmlFor="invoice-description">Description</label><input id="invoice-description" className="form-control" value={invoiceDescription} maxLength={200} required disabled={busy} onChange={event => setInvoiceDescription(event.target.value)}/></div>
                <div className="col-6"><label className="form-label" htmlFor="invoice-amount">Amount (PHP)</label><input id="invoice-amount" className="form-control" type="number" min="0.01" max="10000000" step="0.01" value={invoiceAmount} required disabled={busy} onChange={event => setInvoiceAmount(event.target.value)}/></div>
                <div className="col-6"><label className="form-label" htmlFor="invoice-due">Due date</label><input id="invoice-due" className="form-control" type="date" value={invoiceDueAt} required disabled={busy} onChange={event => setInvoiceDueAt(event.target.value)}/></div>
                <div className="col-12 d-flex justify-content-end"><button type="submit" className="btn btn-outline-primary btn-sm" disabled={busy}>{busy ? "Working…" : "Issue invoice"}</button></div>
              </form>
              <p className="tenant-data-hint">Automatic email reminders run 7 and 1 day before, on the due date, and 1 and 7 days overdue. Set a billing email to receive them.</p>
              {invoices.length ? <div className="tenant-invoice-list mt-2">{invoices.map(invoice => <article key={invoice.id}>
                <div><b>{invoice.invoiceNumber} · {money(invoice.amount)}</b><small>{invoice.description} · due {dateLabel(invoice.dueAt)} · {invoice.status}</small></div>
                {invoice.status === "ISSUED" && <div className="d-flex gap-2"><button type="button" className="btn btn-outline-success btn-sm" disabled={busy} onClick={() => { setPayingInvoiceId(current => current === invoice.id ? "" : invoice.id); setInvoicePaymentReference(""); }}>Record payment</button><button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => void updateInvoice(invoice, "VOID")}>Void</button></div>}
                {payingInvoiceId === invoice.id && <form className="tenant-invoice-payment-form" onSubmit={event => {
                  event.preventDefault();
                  void updateInvoice(invoice, "PAID", { method: invoicePaymentMethod, reference: invoicePaymentReference || undefined });
                }}>
                  <label className="form-label" htmlFor={`invoice-method-${invoice.id}`}>Payment method</label>
                  <input id={`invoice-method-${invoice.id}`} className="form-control" value={invoicePaymentMethod} maxLength={40} required disabled={busy} onChange={event => setInvoicePaymentMethod(event.target.value)}/>
                  <label className="form-label" htmlFor={`invoice-reference-${invoice.id}`}>Reference <span className="text-secondary">(optional)</span></label>
                  <input id={`invoice-reference-${invoice.id}`} className="form-control" value={invoicePaymentReference} maxLength={120} disabled={busy} onChange={event => setInvoicePaymentReference(event.target.value)}/>
                  <div className="d-flex gap-2"><button type="submit" className="btn btn-success btn-sm" disabled={busy}>{busy ? "Saving…" : "Confirm payment"}</button><button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => setPayingInvoiceId("")}>Cancel</button></div>
                </form>}
              </article>)}</div> : <p className="small text-secondary mt-3 mb-0">No invoices recorded.</p>}
            </div>
          </> : <div className="surface tenant-settings-panel tenant-select-empty">Select a school to manage its plan, rosters, payments, and audit history.</div>}
        </section>
      </div>}
  </main>;
}
