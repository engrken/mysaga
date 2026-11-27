"use client";

import { FormEvent, useState } from "react";

type UploadStage = "idle" | "preparing" | "uploading" | "saving" | "success";

type UploadUrlResponse = {
  uploadUrl: string;
  fileKey: string;
  publicUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
};

type Props = {
  assignmentId: string;
  disabled?: boolean;
  onSubmitted: () => void;
};

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const ACCEPTED_FILES = ".pdf,.txt,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !data) throw new Error(data?.error || "The submission could not be saved.");
  return data;
}

export function StudentR2Uploader({ assignmentId, disabled = false, onSubmitted }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || stage !== "idle") return;
    const responseText = text.trim();
    if (!file && !responseText) {
      setError("Write a response or choose a file before submitting.");
      return;
    }
    if (file && file.size > MAX_FILE_SIZE) {
      setError("The file must be 15 MB or smaller.");
      return;
    }

    setError("");
    setSuccess(false);
    try {
      let metadata: UploadUrlResponse | null = null;
      if (file) {
        setStage("preparing");
        metadata = await postJson<UploadUrlResponse>("/api/submissions/upload-url", {
          assignmentId,
          fileName: file.name,
          fileType: file.type || "application/octet-stream",
          fileSize: file.size
        });

        setStage("uploading");
        const uploaded = await fetch(metadata.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": metadata.mimeType },
          body: file
        });
        if (!uploaded.ok) {
          throw new Error("Cloudflare R2 could not accept the file. Check bucket CORS settings and try again.");
        }
      }

      setStage("saving");
      await postJson<{ ok: true; submissionId: string }>("/api/submissions", {
        assignmentId,
        text: responseText,
        ...(metadata ? {
          fileKey: metadata.fileKey,
          fileUrl: metadata.publicUrl,
          fileName: metadata.fileName,
          fileSize: metadata.fileSize,
          mimeType: metadata.mimeType
        } : {})
      });
      setStage("success");
      setSuccess(true);
      onSubmitted();
    } catch (cause) {
      setStage("idle");
      setError(cause instanceof Error ? cause.message : "The assignment could not be submitted.");
    }
  }

  const status = stage === "preparing" ? "Step 1 of 3 · Requesting a secure upload link…"
    : stage === "uploading" ? "Step 2 of 3 · Uploading directly to Cloudflare R2…"
    : stage === "saving" ? "Step 3 of 3 · Saving your submission details…"
    : stage === "success" ? "Your assignment has been submitted successfully." : "";

  return <form className="d-grid gap-3" onSubmit={submit}>
    <label>Text response
      <textarea className="form-control" maxLength={12000} rows={4} value={text}
        onChange={event => setText(event.target.value)} disabled={disabled || stage !== "idle"}/>
    </label>
    <label>Attach one file
      <input className="form-control" type="file" accept={ACCEPTED_FILES}
        onChange={event => setFile(event.target.files?.[0] ?? null)} disabled={disabled || stage !== "idle"}/>
    </label>
    <p className="small text-secondary mb-0">PDF, text, image, Office document, or ZIP · maximum 15 MB. Files are transferred directly from your browser to cloud storage.</p>
    {file && <p className="small mb-0 text-break">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>}
    {stage !== "idle" && <div className="d-grid gap-1" role="status" aria-live="polite">
      <progress className="w-100"/>
      <small className="text-secondary">{status}</small>
      {stage === "uploading" && <small className="text-secondary">The browser fetch upload does not expose byte-level progress; this indicator shows the current step until the transfer completes.</small>}
    </div>}
    {success && <p className="alert alert-success mb-0" role="status">{status}</p>}
    {error && <p className="alert alert-danger mb-0" role="alert">{error}</p>}
    <button className="btn btn-primary" type="submit" disabled={disabled || stage !== "idle"}>
      {stage === "preparing" ? "Preparing upload…" : stage === "uploading" ? "Uploading to R2…"
        : stage === "saving" ? "Saving submission…" : "Submit assignment"}
    </button>
  </form>;
}
