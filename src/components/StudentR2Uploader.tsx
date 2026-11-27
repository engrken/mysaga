"use client";

import { FormEvent, useMemo, useState } from "react";

type UploadStage = "idle" | "preparing" | "uploading" | "saving" | "success";
type UploadUrlResponse = {
  uploadUrl: string;
  fileKey: string;
  publicUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
};
type SubmissionAttachmentInput =
  | { storageProvider: "CLOUDFLARE_R2"; fileKey: string; fileUrl: string; fileName: string; fileSize: number; mimeType: string }
  | { storageProvider: "GOOGLE_DRIVE"; fileUrl: string; fileName: string; fileSize: number; mimeType: string };
type Props = {
  assignmentId: string;
  disabled?: boolean;
  onSubmitted: () => void;
};

const MAX_R2_FILE_SIZE = 5 * 1024 * 1024;
const GOOGLE_DRIVE_UPLOAD_URL = "https://drive.google.com/drive/my-drive";

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

function fileIdentity(file: File, index: number): string {
  return [index, file.name, file.size, file.lastModified].join(":");
}

function driveFileType(file: File): string {
  return file.type || "application/octet-stream";
}

function isValidDriveLink(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["drive.google.com", "docs.google.com"].includes(url.hostname);
  } catch {
    return false;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

export function StudentR2Uploader({ assignmentId, disabled = false, onSubmitted }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [driveLinks, setDriveLinks] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const [stage, setStage] = useState<UploadStage>("idle");
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const largeFiles = useMemo(() => files
    .map((file, index) => ({ file, index, key: fileIdentity(file, index) }))
    .filter(item => item.file.size > MAX_R2_FILE_SIZE), [files]);
  const smallFiles = useMemo(() => files
    .map((file, index) => ({ file, index }))
    .filter(item => item.file.size <= MAX_R2_FILE_SIZE), [files]);

  function selectFiles(selected: FileList | null) {
    setFiles(selected ? Array.from(selected) : []);
    setDriveLinks({});
    setError("");
    setSuccess(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || stage !== "idle") return;
    const responseText = text.trim();
    if (!files.length && !responseText) {
      setError("Write a response or choose at least one attachment.");
      return;
    }

    const missingDriveLink = largeFiles.find(item => !isValidDriveLink(driveLinks[item.key] || ""));
    if (missingDriveLink) {
      setError("Add a valid Google Drive share link for every file larger than 5 MB.");
      return;
    }

    setError("");
    setSuccess(false);
    const attachments: SubmissionAttachmentInput[] = largeFiles.map(({ file, key }) => ({
      storageProvider: "GOOGLE_DRIVE",
      fileUrl: driveLinks[key].trim(),
      fileName: file.name,
      fileSize: file.size,
      mimeType: driveFileType(file)
    }));

    try {
      setStage("preparing");
      for (let index = 0; index < smallFiles.length; index++) {
        const file = smallFiles[index].file;
        setStatusText("Preparing file " + (index + 1) + " of " + smallFiles.length + " for direct R2 upload…");
        const presigned = await postJson<UploadUrlResponse>("/api/submissions/upload-url", {
          assignmentId,
          fileName: file.name,
          fileType: driveFileType(file),
          fileSize: file.size
        });

        setStage("uploading");
        setStatusText("Uploading file " + (index + 1) + " of " + smallFiles.length + " directly to R2…");
        const uploaded = await fetch(presigned.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": presigned.mimeType },
          body: file
        });
        if (!uploaded.ok) {
          throw new Error("R2 could not receive " + file.name + ". Check the bucket CORS settings and try again.");
        }
        attachments.push({
          storageProvider: "CLOUDFLARE_R2",
          fileKey: presigned.fileKey,
          fileUrl: presigned.publicUrl,
          fileName: presigned.fileName,
          fileSize: presigned.fileSize,
          mimeType: presigned.mimeType
        });
      }

      setStage("saving");
      setStatusText("Saving your submission and " + attachments.length + " attachment(s)…");
      await postJson<{ ok: true; submissionId: string }>("/api/submissions", {
        assignmentId,
        text: responseText,
        attachments
      });
      setStage("success");
      setStatusText("Your assignment has been submitted successfully.");
      setSuccess(true);
      onSubmitted();
    } catch (cause) {
      setStage("idle");
      setStatusText("");
      setError(cause instanceof Error ? cause.message : "The assignment could not be submitted.");
    }
  }

  const busy = stage !== "idle" && stage !== "success";
  return <form className="d-grid gap-3" onSubmit={submit}>
    <label>Text response (optional)
      <textarea className="form-control" maxLength={12000} rows={4} value={text}
        onChange={event => setText(event.target.value)} disabled={disabled || busy}/>
    </label>
    <div>
      <label htmlFor={"assignment-files-" + assignmentId} className="form-label">Attachments</label>
      <input id={"assignment-files-" + assignmentId} className="form-control" type="file" multiple
        onChange={event => selectFiles(event.target.files)} disabled={disabled || busy}/>
      <p className="small text-secondary mt-2 mb-0">
        Attach as many files as needed. Each file up to 5 MB uploads directly to SAGA. Larger files use Google Drive.
        Any file type is accepted for R2 uploads.
      </p>
    </div>

    {files.length > 0 && <div className="border rounded p-3 d-grid gap-2">
      <strong>Selected files ({files.length})</strong>
      {files.map((file, index) => {
        const large = file.size > MAX_R2_FILE_SIZE;
        const key = fileIdentity(file, index);
        return <div className="border-top pt-2" key={key}>
          <div className="d-flex flex-wrap justify-content-between gap-2">
            <span className="text-break">{file.name}</span>
            <small className="text-secondary">{formatFileSize(file.size)}</small>
          </div>
          {large ? <div className="mt-2">
            <p className="small text-warning-emphasis mb-2">
              Larger than 5 MB. Upload this file to Google Drive, then paste its share link below. It will not be sent to R2.
            </p>
            <a className="btn btn-sm btn-outline-primary mb-2" href={GOOGLE_DRIVE_UPLOAD_URL}
              target="_blank" rel="noreferrer">Open Google Drive to upload</a>
            <label className="form-label small" htmlFor={"drive-link-" + key}>Google Drive share link</label>
            <input id={"drive-link-" + key} className="form-control" type="url" inputMode="url"
              placeholder="https://drive.google.com/file/d/…"
              value={driveLinks[key] || ""}
              onChange={event => setDriveLinks(current => ({ ...current, [key]: event.target.value }))}
              disabled={disabled || busy}/>
            <small className="text-secondary">Make sure your teacher has permission to open the file.</small>
          </div> : <small className="text-success">Will upload directly to R2</small>}
        </div>;
      })}
      <small className="text-secondary">
        {smallFiles.length} file(s) will use R2 · {largeFiles.length} file(s) need Google Drive links
      </small>
    </div>}

    {busy && <div className="d-grid gap-1" role="status" aria-live="polite">
      <progress className="w-100"/>
      <small className="text-secondary">{statusText}</small>
      <small className="text-secondary">File contents go directly from your browser to R2. Only attachment details are sent to SAGA.</small>
    </div>}
    {success && <p className="alert alert-success mb-0" role="status">{statusText}</p>}
    {error && <p className="alert alert-danger mb-0" role="alert">{error}</p>}
    <button className="btn btn-primary" type="submit" disabled={disabled || busy}>
      {stage === "preparing" ? "Preparing uploads…" : stage === "uploading" ? "Uploading attachments…"
        : stage === "saving" ? "Saving submission…" : "Submit assignment"}
    </button>
  </form>;
}
