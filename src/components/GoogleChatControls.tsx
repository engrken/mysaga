"use client";

import { useEffect, useState } from "react";

type Connection = { connected: boolean; connection: { googleEmail: string } | null };
type Space = { spaceName: string; displayName: string; externalUserAllowed: boolean } | null;
type SpaceOption = { name: string; displayName: string; externalUserAllowed: boolean };

export default function GoogleChatControls({ subjectId }: { subjectId: string }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [space, setSpace] = useState<Space>(null);
  const [spaces, setSpaces] = useState<SpaceOption[]>([]);
  const [selectedSpaceName, setSelectedSpaceName] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const [connectionResponse, spaceResponse, spacesResponse] = await Promise.all([
      fetch("/api/teacher/google-chat/connection", { cache: "no-store" }),
      fetch(`/api/teacher/google-chat/subjects/${encodeURIComponent(subjectId)}/space`, { cache: "no-store" }),
      fetch("/api/teacher/google-chat/spaces", { cache: "no-store" })
    ]);
    if (connectionResponse.ok) setConnection(await connectionResponse.json());
    if (spaceResponse.ok) setSpace((await spaceResponse.json()).space);
    if (spacesResponse.ok) { const data = await spacesResponse.json(); setSpaces(data.spaces || []); }
  }

  useEffect(() => { void refresh(); }, [subjectId]);

  async function createSpace() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/teacher/google-chat/subjects/${encodeURIComponent(subjectId)}/space`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create the class Space.");
      setSpace(data.space);
      setMessage("Google Chat Space created and linked to this class.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the class Space."); }
    finally { setBusy(false); }
  }

  async function linkExistingSpace() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/teacher/google-chat/subjects/${encodeURIComponent(subjectId)}/space`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spaceName: selectedSpaceName })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not link this Space.");
      setSpace(data.space);
      setMessage("Existing Google Chat Space linked to this class.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not link this Space."); }
    finally { setBusy(false); }
  }

  async function sendAnnouncement() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/teacher/google-chat/subjects/${encodeURIComponent(subjectId)}/announcements`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: announcement })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not send the announcement.");
      setAnnouncement("");
      setMessage("Announcement sent to the linked Google Chat Space.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send the announcement."); }
    finally { setBusy(false); }
  }

  async function syncMembers() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/teacher/google-chat/subjects/${encodeURIComponent(subjectId)}/sync`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not sync class members.");
      setMessage(`Sync processed ${data.processed}: ${data.synced} added or already present; ${data.failed} failed; ${data.remaining} remaining.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not sync class members."); }
    finally { setBusy(false); }
  }

  return <section className="surface gradebook-card mt-3" aria-label="Google Chat class integration">
    <div className="section-heading">
      <div><span className="eyebrow">OPTIONAL CLASS TOOL</span><h2>Google Chat Space</h2>
        <p className="muted">Connect your Google account and keep this class Space aligned with the SAGA roster. Students are invited using their verified SAGA email, which must be the Google account email they use in Chat. External Gmail and Workspace invitations also depend on both organizations’ Chat policies; invited students may need to accept.</p>
      </div>
    </div>
    {!connection?.connected ? <div className="d-flex flex-wrap align-items-center gap-2">
      <a className="btn btn-outline-primary" href="/api/teacher/google-chat/connect">Connect Google account</a>
      <span className="muted small">Connect once; you can use the same account for your other classes.</span>
    </div> : <div className="d-flex flex-wrap align-items-center gap-2">
      <span className="small">Connected as <b>{connection.connection?.googleEmail}</b></span>
      {!space ? <><button className="btn btn-primary btn-sm" onClick={() => void createSpace()} disabled={busy}>Create class Space</button>
        {spaces.filter(item => item.externalUserAllowed).length > 0 && <><select className="form-select form-select-sm" style={{maxWidth: "280px"}} value={selectedSpaceName} onChange={event => setSelectedSpaceName(event.target.value)}><option value="">Or choose an existing Space…</option>{spaces.filter(item => item.externalUserAllowed).map(item => <option key={item.name} value={item.name}>{item.displayName}</option>)}</select><button className="btn btn-outline-primary btn-sm" onClick={() => void linkExistingSpace()} disabled={busy || !selectedSpaceName}>Link selected Space</button></>}</> :
        <><span className="badge text-bg-success">Space linked</span><span className="small">{space.displayName}</span>
          <button className="btn btn-outline-primary btn-sm" onClick={() => void syncMembers()} disabled={busy}>Sync class members</button></>}
    </div>}
    {space && !space.externalUserAllowed && <p className="text-warning small mt-2">This Space does not allow external Google accounts.</p>}
    {space && <div className="mt-3">
      <label className="form-label small" htmlFor={`chat-announcement-${subjectId}`}>Send a class announcement</label>
      <textarea id={`chat-announcement-${subjectId}`} className="form-control mb-2" rows={3} maxLength={4000} value={announcement} onChange={event => setAnnouncement(event.target.value)} placeholder="Write an announcement for this class…" />
      <button className="btn btn-outline-primary btn-sm" onClick={() => void sendAnnouncement()} disabled={busy || !announcement.trim()}>Send announcement</button>
    </div>}
    {message && <p className="text-success small mt-2" role="status">{message}</p>}
    {error && <p className="text-danger small mt-2" role="alert">{error}</p>}
  </section>;
}
