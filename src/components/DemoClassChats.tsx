"use client";

import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";

type DemoMembership = "NONE" | "PENDING" | "INVITED" | "MEMBER" | "FAILED" | "REMOVED";
type DemoChatMessage = { id: string; author: string; text: string; time: string; announcement?: boolean };
type DemoChatClass = {
  code: string;
  title: string;
  term: string;
  academicYear: string;
  connected: boolean;
  displayName: string;
  rosterCount: number;
  memberCount: number;
  invitedCount: number;
  pendingCount: number;
  failedCount: number;
  studentStatus: DemoMembership;
  messages: DemoChatMessage[];
};
type DemoChatState = { googleConnected: boolean; googleEmail: string; classes: DemoChatClass[] };

const STORAGE_KEY = "saga-demo-class-chats-v1";

function seedDemoChatState(): DemoChatState {
  return {
    googleConnected: true,
    googleEmail: "andrea.flores@example.test",
    classes: [
      {
        code: "ECE 18",
        title: "Wireless Communications",
        term: "First Semester",
        academicYear: "2026–2027",
        connected: true,
        displayName: "ECE 18 · Wireless Communications",
        rosterCount: 24,
        memberCount: 18,
        invitedCount: 4,
        pendingCount: 2,
        failedCount: 0,
        studentStatus: "INVITED",
        messages: [
          { id: "ece18-1", author: "Prof. Andrea Flores", text: "Welcome to our ECE 18 class Space. I’ll post class reminders and learning resources here.", time: "8:05 AM", announcement: true },
          { id: "ece18-2", author: "Mika Cruz", text: "Thank you, Professor! Looking forward to the first activity.", time: "8:14 AM" }
        ]
      },
      {
        code: "ECE 23",
        title: "Microprocessor Systems",
        term: "First Semester",
        academicYear: "2026–2027",
        connected: false,
        displayName: "ECE 23 · Microprocessor Systems",
        rosterCount: 20,
        memberCount: 0,
        invitedCount: 0,
        pendingCount: 0,
        failedCount: 0,
        studentStatus: "NONE",
        messages: []
      }
    ]
  };
}

function loadDemoChatState(): DemoChatState {
  const seed = seedDemoChatState();
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return seed;
    const parsed = JSON.parse(raw) as Partial<DemoChatState>;
    if (!Array.isArray(parsed.classes)) return seed;
    const restored = parsed.classes.filter((item): item is DemoChatClass =>
      !!item && typeof item.code === "string" && typeof item.title === "string"
    );
    const classes = seed.classes.map(sample => {
      const saved = restored.find(item => item.code === sample.code);
      return saved ? { ...sample, ...saved, messages: Array.isArray(saved.messages) ? saved.messages : sample.messages } : sample;
    });
    restored.filter(item => !seed.classes.some(sample => sample.code === item.code)).forEach(item => classes.push(item));
    return {
      googleConnected: parsed.googleConnected === true,
      googleEmail: typeof parsed.googleEmail === "string" ? parsed.googleEmail : seed.googleEmail,
      classes
    };
  } catch {
    return seed;
  }
}

function useDemoChatSandbox() {
  const [state, setState] = useState<DemoChatState | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setState(loadDemoChatState());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !state) return;
    try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Local simulation still works for this view. */ }
  }, [ready, state]);

  return { state, setState, ready, reset: () => setState(seedDemoChatState()) };
}

function sampleClass(code: string, title: string, rosterCount: number): DemoChatClass {
  return {
    code: code || "SAMPLE CLASS",
    title: title || "Sample class",
    term: "First Semester",
    academicYear: "2026–2027",
    connected: false,
    displayName: (code || "SAMPLE CLASS") + " · " + (title || "Sample class"),
    rosterCount: Math.max(1, rosterCount || 20),
    memberCount: 0,
    invitedCount: 0,
    pendingCount: 0,
    failedCount: 0,
    studentStatus: "NONE",
    messages: []
  };
}

function updateClass(
  setState: Dispatch<SetStateAction<DemoChatState | null>>,
  code: string,
  title: string,
  rosterCount: number,
  update: (current: DemoChatClass) => DemoChatClass
) {
  setState(previous => {
    if (!previous) return previous;
    const current = previous.classes.find(item => item.code === code) || sampleClass(code, title, rosterCount);
    const next = update(current);
    const exists = previous.classes.some(item => item.code === code);
    return {
      ...previous,
      classes: exists
        ? previous.classes.map(item => item.code === code ? next : item)
        : [...previous.classes, next]
    };
  });
}

function membershipLabel(status: DemoMembership) {
  switch (status) {
    case "MEMBER": return "Member";
    case "INVITED": return "Invitation sent";
    case "PENDING": return "Sync pending";
    case "FAILED": return "Needs attention";
    case "REMOVED": return "Removed from Space";
    default: return "Not yet invited";
  }
}

export function DemoGoogleChatControls({
  classCode,
  classTitle,
  rosterCount
}: {
  classCode: string;
  classTitle: string;
  rosterCount: number;
}) {
  const { state, setState, ready, reset } = useDemoChatSandbox();
  const [announcement, setAnnouncement] = useState("");
  const [notice, setNotice] = useState("");

  if (!ready || !state) return <section className="surface gradebook-card mt-3" aria-label="Google Chat demo"><p className="muted mb-0">Loading the fictional Chat simulation…</p></section>;

  const code = classCode || "SAMPLE CLASS";
  const current = state.classes.find(item => item.code === code) || sampleClass(code, classTitle, rosterCount);

  function linkSpace(action: "created" | "linked") {
    updateClass(setState, code, classTitle, rosterCount, item => ({
      ...item,
      connected: true,
      displayName: item.displayName || code + " · " + classTitle,
      pendingCount: item.rosterCount,
      studentStatus: "PENDING",
      messages: [
        ...item.messages,
        { id: "space-" + Date.now(), author: "SAGA Demo", text: action === "created" ? "A new sample Google Chat Space was created for this class." : "An existing sample Google Chat Space was linked to this class.", time: "Just now" }
      ]
    }));
    setNotice(action === "created" ? "Sample Space created and linked. This happened only in the demo." : "Sample Space linked to this class. This happened only in the demo.");
  }

  function syncRoster() {
    updateClass(setState, code, classTitle, rosterCount, item => {
      const accepted = item.studentStatus === "MEMBER";
      return {
        ...item,
        memberCount: accepted ? item.rosterCount : Math.max(0, item.rosterCount - 1),
        invitedCount: accepted ? 0 : 1,
        pendingCount: 0,
        failedCount: 0,
        studentStatus: accepted ? "MEMBER" : "INVITED",
        messages: [
          ...item.messages,
          { id: "sync-" + Date.now(), author: "SAGA Demo", text: "Roster sync completed. Sample invitations were updated for this class.", time: "Just now" }
        ]
      };
    });
    setNotice("Roster sync simulated. Sample members and invitations have been updated locally.");
  }

  function sendAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = announcement.trim();
    if (!text) return;
    updateClass(setState, code, classTitle, rosterCount, item => ({
      ...item,
      messages: [...item.messages, {
        id: "announcement-" + Date.now(),
        author: "Prof. Andrea Flores",
        text,
        time: "Just now",
        announcement: true
      }]
    }));
    setAnnouncement("");
    setNotice("Announcement added to the sample Space. No message was sent to Google Chat.");
  }

  return <section className="surface gradebook-card mt-3" aria-label="Google Chat class integration demo">
    <div className="section-heading">
      <div>
        <span className="eyebrow">FEATURE PREVIEW · SIMULATED</span>
        <h2>Google Chat Space</h2>
        <p className="muted">Try the teacher workflow with fictional account and roster data. Create or link a class Space, synchronize sample memberships, and compose a class announcement.</p>
      </div>
      <span className="badge text-bg-info">Demo only</span>
    </div>

    <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
      {state.googleConnected
        ? <><span className="badge text-bg-success">Sample account connected</span><span className="small">andrea.flores@example.test</span><button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => { setState(previous => previous ? { ...previous, googleConnected: false } : previous); setNotice("Sample Google connection disconnected."); }}>Disconnect sample account</button></>
        : <><span className="small text-body-secondary">No sample Google account connected.</span><button type="button" className="btn btn-outline-primary btn-sm" onClick={() => { setState(previous => previous ? { ...previous, googleConnected: true, googleEmail: "andrea.flores@example.test" } : previous); setNotice("Fictional Google account connected for this simulation."); }}>Connect sample Google account</button></>}
    </div>

    {!current.connected
      ? <div className="d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={!state.googleConnected} onClick={() => linkSpace("created")}>＋ Create sample Space</button>
          <button type="button" className="btn btn-outline-primary btn-sm" disabled={!state.googleConnected} onClick={() => linkSpace("linked")}>Link existing sample Space</button>
          {!state.googleConnected && <span className="small text-body-secondary align-self-center">Connect the sample account first.</span>}
        </div>
      : <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
          <span className="badge text-bg-success">Space linked</span>
          <span className="small fw-semibold">{current.displayName}</span>
          <button type="button" className="btn btn-outline-primary btn-sm" disabled={!state.googleConnected} onClick={syncRoster}>Sync sample class roster</button>
        </div>}

    {current.connected && <form onSubmit={sendAnnouncement} className="mt-2">
      <label className="form-label small fw-semibold" htmlFor={"demo-announcement-" + code.replace(/[^a-z0-9]/gi, "-")}>Send a class announcement</label>
      <textarea id={"demo-announcement-" + code.replace(/[^a-z0-9]/gi, "-")} className="form-control mb-2" rows={3} maxLength={4000} value={announcement} onChange={event => setAnnouncement(event.target.value)} placeholder="Write an announcement for this sample class…"/>
      <div className="d-flex flex-wrap align-items-center gap-2">
        <button type="submit" className="btn btn-outline-primary btn-sm" disabled={!announcement.trim()}>Add sample announcement</button>
        <span className="small text-body-secondary">Appears in the Student and Teacher Class Chats preview.</span>
      </div>
    </form>}

    {current.connected && <div className="border-top mt-3 pt-3">
      <div className="small fw-semibold mb-2">Sample roster status</div>
      <div className="d-flex flex-wrap gap-3 small">
        <span>{current.memberCount} members</span><span>{current.invitedCount} invitations</span><span>{current.pendingCount} syncing</span><span>{current.failedCount} need attention</span>
        <span className="text-body-secondary">Student preview: {membershipLabel(current.studentStatus)}</span>
      </div>
    </div>}

    {current.messages.length > 0 && <div className="mt-3">
      <div className="small fw-semibold mb-2">Recent sample activity</div>
      <ul className="list-group list-group-flush">
        {current.messages.slice(-3).reverse().map(message => <li className="list-group-item px-0 py-2" key={message.id}>
          <div className="d-flex flex-wrap justify-content-between gap-2"><strong className="small">{message.author}</strong><span className="small text-body-secondary">{message.time}</span></div>
          <p className="small mb-0">{message.text}</p>
        </li>)}
      </ul>
    </div>}

    {notice && <p className="small text-success mt-3 mb-0" role="status">{notice}</p>}
    <p className="small text-body-secondary mt-3 mb-0">Simulation only: these buttons never access Google APIs, invite real people, or change SAGA records.</p>
    <button type="button" className="btn btn-link btn-sm px-0 mt-1" onClick={() => { reset(); setAnnouncement(""); setNotice("Chat sample data restored."); }}>Reset chat simulation</button>
  </section>;
}

export function DemoClassChatsHub({ role }: { role: "TEACHER" | "STUDENT" }) {
  const { state, setState, ready, reset } = useDemoChatSandbox();
  const [openCode, setOpenCode] = useState("");

  if (!ready || !state) return <section className="section-block class-chats-page"><p className="muted">Loading fictional class Spaces…</p></section>;

  const spaces = state.classes.filter(item => item.connected);

  function acceptInvitation(code: string, title: string, rosterCount: number) {
    updateClass(setState, code, title, rosterCount, item => ({
      ...item,
      studentStatus: "MEMBER",
      memberCount: Math.min(item.rosterCount, item.memberCount + 1),
      invitedCount: Math.max(0, item.invitedCount - 1),
      messages: [...item.messages, {
        id: "joined-" + Date.now(),
        author: "Mika Cruz",
        text: "Mika Cruz accepted the invitation and joined the sample Space.",
        time: "Just now"
      }]
    }));
  }

  return <section className="section-block class-chats-page">
    <div className="section-heading">
      <div>
        <span className="eyebrow">CLASS COMMUNICATION · FICTIONAL DATA</span>
        <h2>Class Chats</h2>
        <p className="muted">{role === "TEACHER"
          ? "A sample launchpad for the Google Chat Spaces connected to your classes. Configure a Space and synchronize the roster from the class roster tools."
          : "Explore sample Google Chat Spaces for your enrolled classes. Your teacher manages invitations and class membership."}</p>
      </div>
      <div className="d-flex flex-wrap gap-2 align-items-center">
        <span className="badge text-bg-light">{spaces.length} sample Space{spaces.length === 1 ? "" : "s"}</span>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => { reset(); setOpenCode(""); }}>Reset simulation</button>
      </div>
    </div>

    <div className="alert alert-info py-2 small" role="note">
      <strong>Safe demo:</strong> names, classes, invitations, and messages are fictional. Open Space, accept invitation, and announcements are simulated in this browser tab; nothing is sent to Google Chat.
    </div>

    {spaces.length === 0
      ? <div className="empty-state">
          <div className="empty-icon">▣</div>
          <h3>{role === "TEACHER" ? "No sample Spaces linked yet" : "No sample Spaces available yet"}</h3>
          <p>{role === "TEACHER"
            ? "Open a class roster and create or link a sample Google Chat Space to see it here."
            : "When a teacher links a sample Space to one of your classes, it will appear here."}</p>
        </div>
      : <div className="row g-3">
          {spaces.map(item => {
            const expanded = openCode === item.code;
            return <div className="col-12 col-xl-6" key={item.code}>
              <article className="surface rounded-3 p-3 h-100 d-flex flex-column gap-3">
                <div className="d-flex justify-content-between align-items-start gap-3">
                  <div className="min-w-0">
                    <span className="eyebrow">{item.code}</span>
                    <h3 className="h5 mb-1">{item.title}</h3>
                    <p className="muted small mb-0">{item.term} · {item.academicYear}</p>
                  </div>
                  <span className="badge text-bg-success flex-shrink-0">Connected</span>
                </div>
                <div className="border-top pt-3">
                  <div className="d-flex flex-wrap align-items-center gap-2">
                    <span className="small fw-semibold">{item.displayName}</span>
                    {role === "STUDENT"
                      ? <span className={"badge " + (item.studentStatus === "MEMBER" ? "text-bg-success" : item.studentStatus === "INVITED" ? "text-bg-info" : "text-bg-warning")}>{membershipLabel(item.studentStatus)}</span>
                      : <span className="badge text-bg-light">{item.rosterCount} enrolled</span>}
                  </div>
                  {role === "TEACHER"
                    ? <p className="muted small mt-2 mb-0">{item.memberCount} members joined · {item.invitedCount} invitations pending{item.pendingCount ? " · " + item.pendingCount + " syncing" : ""}{item.failedCount ? " · " + item.failedCount + " need attention" : ""}</p>
                    : <p className="muted small mt-2 mb-0">{item.studentStatus === "MEMBER"
                      ? "You are a member of this sample class Space."
                      : item.studentStatus === "INVITED"
                        ? "Your sample invitation is waiting for you. Accept it here to preview the joined state."
                        : item.studentStatus === "PENDING"
                          ? "Your sample class membership is being synchronized."
                          : item.studentStatus === "FAILED"
                            ? "This sample invitation needs a teacher to retry the sync."
                            : "Your teacher has not sent a sample Chat invitation yet."}</p>}
                </div>
                <div className="mt-auto d-flex flex-wrap align-items-center justify-content-between gap-2">
                  <span className="muted small">Google Chat Space · demo preview</span>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpenCode(expanded ? "" : item.code)}>{expanded ? "Close conversation" : "Open sample conversation"}</button>
                </div>
                {role === "STUDENT" && item.studentStatus === "INVITED" && <button type="button" className="btn btn-outline-success btn-sm align-self-start" onClick={() => acceptInvitation(item.code, item.title, item.rosterCount)}>Accept sample invitation</button>}
                {expanded && <div className="border rounded-3 p-3 bg-body-tertiary">
                  <div className="d-flex justify-content-between align-items-center gap-2 mb-2"><strong className="small">Sample conversation</strong><span className="badge text-bg-secondary">Fictional</span></div>
                  {item.messages.length === 0
                    ? <p className="small text-body-secondary mb-0">No sample messages yet. A teacher can post an announcement from the class roster panel.</p>
                    : <div className="d-grid gap-2">
                        {item.messages.slice(-6).map(message => <div className="rounded-3 border bg-body p-2" key={message.id}>
                          <div className="d-flex flex-wrap justify-content-between gap-2"><strong className="small">{message.author}{message.announcement ? " · Announcement" : ""}</strong><span className="small text-body-secondary">{message.time}</span></div>
                          <p className="small mb-0 mt-1">{message.text}</p>
                        </div>)}
                      </div>}
                </div>}
              </article>
            </div>;
          })}
        </div>}

    {role === "STUDENT" && spaces.length > 0 && <p className="small text-body-secondary mt-3 mb-0">Signed-in sample student: Mika Cruz · SAGA Sample College. Your sample membership state is shown for demonstration only.</p>}
  </section>;
}
