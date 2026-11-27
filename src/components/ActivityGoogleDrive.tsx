"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Mode = "open" | "picker";
type Props = {
  subjectId: string;
  mode: Mode;
  fileUrl?: string;
  files?: Array<{ url: string; label: string }>;
  onPicked?: (file: { url: string; name: string }) => void;
};
type Config = {
  clientId: string;
  apiKey?: string;
  appId?: string;
  identityVerified?: boolean;
  email?: string | null;
};
type CredentialResponse = { credential?: string };
type PickerDocument = { id?: string; name?: string; url?: string };
type PickerData = { action?: string; docs?: PickerDocument[] };
type PickerBuilder = {
  addView: (view: string) => PickerBuilder;
  setOAuthToken: (token: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  setTitle: (title: string) => PickerBuilder;
  setCallback: (callback: (data: PickerData) => void) => PickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
};
type GoogleNamespace = {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string;
        callback: (response: CredentialResponse) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
      }) => void;
      renderButton: (element: HTMLElement, options: Record<string, string | number | boolean>) => void;
    };
  };
  picker?: {
    ViewId: { DOCS: string };
    Action: { PICKED: string };
    PickerBuilder: new () => PickerBuilder;
  };
};
type BrowserWindow = Window & {
  google?: GoogleNamespace;
  gapi?: { load: (name: string, callback: () => void) => void };
};

function loadScript(id: string, src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing?.dataset.loaded === "true") return resolve();
    const script = existing ?? document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error("Google's sign-in tools could not be loaded. Check your connection and try again.")), { once: true });
    if (!existing) document.head.appendChild(script);
  });
}

function validDriveUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["drive.google.com", "docs.google.com"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function ActivityGoogleDrive({ subjectId, mode, fileUrl, files = [], onPicked }: Props) {
  const [config, setConfig] = useState<Config | null>(null);
  const [scriptsReady, setScriptsReady] = useState(false);
  const [verifiedEmail, setVerifiedEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const signInMount = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setConfig(null);
    setScriptsReady(false);
    setVerifiedEmail("");
    setError("");
    fetch("/api/activities/google-drive?mode=" + mode + "&subjectId=" + encodeURIComponent(subjectId), { cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Google services are not configured.");
        if (active) {
          setConfig(data as Config);
          if (data.identityVerified && data.email) setVerifiedEmail(String(data.email));
        }
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : "Google services are not configured.");
      });
    return () => { active = false; };
  }, [mode, subjectId]);

  useEffect(() => {
    if (!config) return;
    let active = true;
    void (async () => {
      try {
        if (mode === "picker") {
          await loadScript("saga-google-api-client", "https://apis.google.com/js/api.js");
          const gapi = (window as BrowserWindow).gapi;
          if (!gapi) throw new Error("Google Picker could not be initialized.");
          await new Promise<void>(resolve => gapi.load("picker", resolve));
        } else if (!config.identityVerified) {
          await loadScript("saga-google-identity-services", "https://accounts.google.com/gsi/client");
        }
        if (active) setScriptsReady(true);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Google's sign-in tools could not be loaded.");
      }
    })();
    return () => { active = false; };
  }, [config, mode]);

  const verifyIdentity = useCallback(async (googleCredential: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/activities/google-drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId, mode: "identity", credential: googleCredential }),
        cache: "no-store"
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Google sign-in could not be verified.");
      setVerifiedEmail(String(data.email || ""));
      setNotice("Your Google account matches your SAGA Portal email.");
    } catch (reason) {
      setVerifiedEmail("");
      setError(reason instanceof Error ? reason.message : "Google sign-in could not be verified.");
    } finally {
      setBusy(false);
    }
  }, [subjectId]);

  useEffect(() => {
    if (mode !== "open" || config?.identityVerified || !config || !scriptsReady || !signInMount.current) return;
    const google = (window as BrowserWindow).google;
    if (!google) {
      setError("Google Sign-In could not be initialized. Refresh the page and try again.");
      return;
    }
    google.accounts.id.initialize({
      client_id: config.clientId,
      auto_select: false,
      cancel_on_tap_outside: true,
      callback: response => {
        if (response.credential) void verifyIdentity(response.credential);
        else setError("Google did not return a sign-in credential. Please try again.");
      }
    });
    signInMount.current.replaceChildren();
    google.accounts.id.renderButton(signInMount.current, {
      theme: "outline",
      size: "large",
      shape: "rectangular",
      text: "continue_with",
      width: 250
    });
  }, [config, mode, scriptsReady, verifyIdentity]);

  async function chooseFromDrive() {
    if (!config?.apiKey || !config.appId || busy) return;
    const google = (window as BrowserWindow).google;
    if (!google?.picker) {
      setError("Google Picker is not ready. Refresh the page and try again.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("Connecting to Google Drive…");
    try {
      const tokenResponse = await fetch(
        "/api/activities/google-drive?mode=picker&action=token&subjectId=" + encodeURIComponent(subjectId),
        { cache: "no-store" }
      );
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenData.accessToken) {
        throw new Error(tokenData.error || "Your Google Drive connection needs to be refreshed.");
      }
      const picker = new google.picker.PickerBuilder()
        .addView(google.picker.ViewId.DOCS)
        .setOAuthToken(String(tokenData.accessToken))
        .setDeveloperKey(config.apiKey)
        .setAppId(config.appId)
        .setTitle("Choose an Activity Material")
        .setCallback(result => {
          if (result.action !== google.picker!.Action.PICKED || !result.docs?.length) return;
          const doc = result.docs[0];
          if (!doc.id) {
            setError("Google Drive did not return a file ID. Please select another file.");
            return;
          }
          const url = doc.url && validDriveUrl(doc.url)
            ? doc.url
            : "https://drive.google.com/open?id=" + encodeURIComponent(doc.id);
          onPicked?.({ url, name: doc.name || "Google Drive file" });
          setNotice("Selected " + (doc.name || "Google Drive file") + ". Remember to give enrolled students viewing permission in Google Drive.");
          setError("");
        })
        .build();
      picker.setVisible(true);
      setNotice("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Google Drive could not be opened.");
      setNotice("");
    } finally {
      setBusy(false);
    }
  }

  function openDriveFile(url: string) {
    if (!validDriveUrl(url)) {
      setError("This Google Drive link is invalid. Ask your subject teacher to check the activity material.");
      return;
    }
    const opened = window.open(url, "_blank");
    if (opened) opened.opener = null;
    else setError("Your browser blocked the new tab. Allow pop-ups for SAGA Portal, then try again.");
  }

  return <div className="d-grid gap-2">
    {mode === "picker" ? (
      <div className="d-flex flex-wrap align-items-center gap-2">
        {verifiedEmail && <span className="badge text-bg-success">Google services connected · {verifiedEmail}</span>}
        <button type="button" className="btn btn-sm btn-outline-primary"
          disabled={busy || !scriptsReady || !verifiedEmail} onClick={() => void chooseFromDrive()}>
          {busy ? "Connecting…" : "Select from Google Drive"}
        </button>
      </div>
    ) : verifiedEmail ? (
      <div className="d-flex flex-wrap align-items-center gap-2">
        <span className="badge text-bg-success">Google account verified · {verifiedEmail}</span>
        <div className="d-flex flex-wrap gap-2">
          {(files.length ? files : fileUrl ? [{ url: fileUrl, label: "Open in Google Drive" }] : [])
            .map(item => <button key={item.url} type="button" className="btn btn-sm btn-outline-primary"
              onClick={() => openDriveFile(item.url)}>{item.label}</button>)}
        </div>
      </div>
    ) : (
      <div>
        <div ref={signInMount} aria-label="Verify Google account for Drive access"/>
        {busy && <small className="text-secondary" role="status">Checking that your Google email matches your SAGA account…</small>}
      </div>
    )}
    {notice && <p className="small text-success mb-0" role="status">{notice}</p>}
    {error && <p className="alert alert-danger small mb-0" role="alert">{error}</p>}
  </div>;
}
