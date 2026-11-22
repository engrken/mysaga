"use client";

import { useEffect, useState } from "react";

type Connection = { connected: boolean; connection: { googleEmail: string } | null };
type Space = { spaceName: string; displayName: string; externalUserAllowed: boolean } | null;

export default function GoogleChatControls({ subjectId }: { subjectId: string }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [space, setSpace] = useState<Space>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const [connectionResponse, spaceResponse] = await Promise.all([
      fetch("/api/teacher/google-chat/connection", { cache: "no-store" }),
      fetch(`/api/teacher/google-chat/subjects/${encodeURIComponent(subjectId)}/space`, { cache: "no-store" })
    ]);
    if (connectionResponse.ok) setConnection(await connectionResponse.json());
    if (spaceResponse.ok) setSpace((await spaceResponse.json()).space);
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

  async function syncMembers() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/teacher/google-chat/subjects/${encodeURIComponent(subjectId)}/sync`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not sync class members.");
      setMessage(`Sync complete: ${data.synced} added or already present; ${data.failed} need attention.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not sync class members."); }
    finally { setBusy(false); }
  }

  return <section className="surface gradebook-card mt-3" aria-label="Google Chat class integration">
    <div className="section-heading">
      <div><span className="eyebrow">OPTIONAL CLASS TOOL</span><h2>Google Chat Space</h2>
        <p className="muted">Connect your Google account and keep this class Space aligned with the SAGA roster. Student invitations may require acceptance.</p>
      </div>
    </div>
    {!connection?.connected ? <div className="d-flex flex-wrap align-items-center gap-2">
      <a className="btn btn-outline-primary" href="/api/teacher/google-chat/connect">Connect Google account</a>
      <span className="muted small">Connect once; you can use the same account for your other classes.</span>
    </div> : <div className="d-flex flex-wrap align-items-center gap-2">
      <span className="small">Connected as <b>{connection.connection?.googleEmail}</b></span>
      {!space ? <button className="btn btn-primary btn-sm" onClick={() => void createSpace()} disabled={busy}>Create class Space</button> :
        <><span className="badge text-bg-success">Space linked</span><span className="small">{space.displayName}</span>
          <button className="btn btn-outline-primary btn-sm" onClick={() => void syncMembers()} disabled={busy}>Sync class members</button></>}
    </div>}
    {space && !space.externalUserAllowed && <p className="text-warning small mt-2">This Space does not allow external Google accounts.</p>}
    {message && <p className="text-success small mt-2" role="status">{message}</p>}
    {error && <p className="text-danger small mt-2" role="alert">{error}</p>}
  </section>;
}
