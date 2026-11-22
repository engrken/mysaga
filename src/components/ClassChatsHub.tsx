"use client";

import { useEffect, useState } from "react";

type MembershipStatus = "PENDING" | "INVITED" | "MEMBER" | "REMOVED" | "FAILED";
type ChatClass = {
  subjectId: string;
  classId: string | null;
  code: string;
  title: string;
  term: string;
  academicYear: string;
  displayName: string;
  spaceUri: string | null;
  externalUserAllowed: boolean;
  rosterCount?: number;
  membershipCounts?: Record<string, number>;
  membershipStatus?: MembershipStatus | null;
};
type HubResponse = { role: "TEACHER" | "STUDENT"; classes: ChatClass[]; error?: string };

function studentStatus(status: MembershipStatus | null | undefined) {
  switch (status) {
    case "MEMBER": return { label: "Member", tone: "success" };
    case "INVITED": return { label: "Invitation sent", tone: "info" };
    case "PENDING": return { label: "Sync pending", tone: "warning" };
    case "FAILED": return { label: "Needs attention", tone: "danger" };
    case "REMOVED": return { label: "Removed from Space", tone: "secondary" };
    default: return { label: "Not yet invited", tone: "secondary" };
  }
}

export default function ClassChatsHub({ role }: { role: "TEACHER" | "STUDENT" }) {
  const [classes, setClasses] = useState<ChatClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/class-chats", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json() as HubResponse;
        if (!response.ok) throw new Error(data.error || "Could not load your class Spaces.");
        setClasses(Array.isArray(data.classes) ? data.classes : []);
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load your class Spaces.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  return <section className="section-block class-chats-page">
    <div className="section-heading">
      <div>
        <span className="eyebrow">CLASS COMMUNICATION</span>
        <h2>Class Chats</h2>
        <p className="muted">{role === "TEACHER"
          ? "A quick launchpad for the Google Chat Spaces connected to your subjects. Manage invitations and roster synchronization from each class roster."
          : "Open the Google Chat Spaces for your enrolled classes. Your teacher manages class invitations and membership."}</p>
      </div>
      {!loading && !error && <span className="badge text-bg-light">{classes.length} Space{classes.length === 1 ? "" : "s"}</span>}
    </div>

    {loading && <div className="inline-empty" role="status"><span className="spinner-border spinner-border-sm me-2" aria-hidden="true"/>Loading your class Spaces…</div>}
    {error && <div className="alert alert-warning" role="alert">{error}</div>}

    {!loading && !error && classes.length === 0 && <div className="empty-state">
      <div className="empty-icon">▣</div>
      <h3>{role === "TEACHER" ? "No class Spaces linked yet" : "No class Spaces available yet"}</h3>
      <p>{role === "TEACHER"
        ? "Open a class, go to its roster, and create or link a Google Chat Space. It will appear here automatically."
        : "When one of your teachers connects a Google Chat Space to an enrolled class, it will appear here."}</p>
      {role === "TEACHER" && <p className="muted small mb-0">The Class Chats page is an overview. Class roster tools remain the place to invite students, retry synchronization, and send announcements.</p>}
    </div>}

    {!loading && !error && classes.length > 0 && <div className="row g-3">
      {classes.map(item => {
        const status = studentStatus(item.membershipStatus);
        const counts = item.membershipCounts || {};
        const joined = counts.MEMBER || 0;
        const invited = counts.INVITED || 0;
        const failed = counts.FAILED || 0;
        const pending = counts.PENDING || 0;
        return <div className="col-12 col-xl-6" key={item.subjectId}>
          <article className="surface rounded-3 p-3 h-100 d-flex flex-column gap-3">
            <div className="d-flex justify-content-between align-items-start gap-3">
              <div className="min-w-0">
                <span className="eyebrow">{item.classId ? item.classId + " · " : ""}{item.code}</span>
                <h3 className="h5 mb-1">{item.title}</h3>
                <p className="muted small mb-0">{item.term} · {item.academicYear}</p>
              </div>
              <span className="badge text-bg-success flex-shrink-0">Connected</span>
            </div>

            <div className="border-top pt-3">
              <div className="d-flex flex-wrap align-items-center gap-2">
                <span className="small fw-semibold">{item.displayName}</span>
                {role === "STUDENT"
                  ? <span className={`badge text-bg-${status.tone}`}>{status.label}</span>
                  : <span className="badge text-bg-light">{item.rosterCount || 0} enrolled</span>}
              </div>
              {role === "TEACHER" && <p className="muted small mt-2 mb-0">
                {joined} member{joined === 1 ? "" : "s"} joined · {invited} invitation{invited === 1 ? "" : "s"} pending
                {pending ? ` · ${pending} syncing` : ""}
                {failed ? ` · ${failed} need attention` : ""}
              </p>}
              {role === "STUDENT" && <p className="muted small mt-2 mb-0">
                {item.membershipStatus === "MEMBER"
                  ? "You are a member of this class Space."
                  : item.membershipStatus === "INVITED"
                    ? "Your invitation is waiting for you in Google Chat."
                    : item.membershipStatus === "FAILED"
                      ? "Your teacher may need to retry the class membership sync."
                      : item.membershipStatus === "PENDING"
                        ? "Your class membership is being synchronized."
                        : item.membershipStatus === "REMOVED"
                          ? "Your Chat membership was removed. Contact your teacher if this seems incorrect."
                          : "Your teacher has not sent your Chat invitation yet."}
              </p>}
            </div>

            <div className="mt-auto d-flex flex-wrap align-items-center justify-content-between gap-2">
              <span className="muted small">Google Chat Space</span>
              {item.spaceUri
                ? <a className="btn btn-primary btn-sm" href={item.spaceUri} target="_blank" rel="noopener noreferrer">Open Space <span aria-hidden="true">↗</span></a>
                : <span className="small text-body-secondary" title="The owning teacher needs to refresh this Space link.">Space link unavailable</span>}
            </div>
          </article>
        </div>;
      })}
    </div>}
  </section>;
}
