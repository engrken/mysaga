"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { validDriveLink } from "@/lib/drive-link";

type UploadStage = "idle" | "preparing" | "uploading" | "saving" | "success";
type UploadUrlResponse = {
  uploadUrl: string;
  fileKey: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadHeaders: Record<string, string>;
};
type SubmissionAttachmentInput =
  | { storageProvider: "CLOUDFLARE_R2"; fileKey: string; fileName: string; fileSize: number; mimeType: string }
  | { storageProvider: "GOOGLE_DRIVE"; fileUrl: string; fileName: string; fileSize: number; mimeType: string };
type SelectedFile = { id: string; file: File };
type Props = {
  assignmentId: string;
  disabled?: boolean;
  onSubmitted: () => void;
};

const MAX_R2_FILE_SIZE = 5 * 1024 * 1024;
const GOOGLE_DRIVE_UPLOAD_URL = "https://drive.google.com/drive/u/0/my-drive";

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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function driveFileType(file: File): string {
  return file.type || "application/octet-stream";
}

export function StudentR2Uploader({ assignmentId, disabled = false, onSubmitted }: Props) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [driveLinks, setDriveLinks] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const [stage, setStage] = useState<UploadStage>("idle");
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const nextFileId = useRef(0);

  const largeFiles = useMemo(
    () => files.filter(item => item.file.size > MAX_R2_FILE_SIZE),
    [files]
  );
  const smallFiles = useMemo(
    () => files.filter(item => item.file.size <= MAX_R2_FILE_SIZE),
    [files]
  );

  function selectFiles(selected: FileList | null) {
    if (!selected?.length) return;
    const additions = Array.from(selected).map(file => ({
      id: "selected-" + nextFileId.current++,
      file
    }));
    setFiles(current => [...current, ...additions]);
    setStage("idle");
    setStatusText("");
    setError("");
    setSuccess(false);
  }

  function removeFile(id: string) {
    setFiles(current => current.filter(item => item.id !== id));
    setDriveLinks(current => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setStage("idle");
    setStatusText("");
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

    const missingDriveLink = largeFiles.find(item => !validDriveLink(driveLinks[item.id] || ""));
    if (missingDriveLink) {
      setError("Add a valid Google Drive file share link for every file larger than 5 MB. My Drive and folder links cannot be attached.");
      return;
    }

    setError("");
    setSuccess(false);
    const attachments: SubmissionAttachmentInput[] = largeFiles.map(({ file, id }) => ({
      storageProvider: "GOOGLE_DRIVE",
      fileUrl: driveLinks[id].trim(),
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
        setStatusText("Uploading file " + (index + 1) + " of " + smallFiles.length + " directly to private storage…");
        const uploaded = await fetch(presigned.uploadUrl, {
          method: "PUT",
          headers: presigned.uploadHeaders,
          body: file
        });
        if (!uploaded.ok) {
          throw new Error("R2 could not receive " + file.name + ". Check the bucket CORS settings and try again.");
        }
        attachments.push({
          storageProvider: "CLOUDFLARE_R2",
          fileKey: presigned.fileKey,
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
        onChange={event => {
          setText(event.target.value);
          setStage("idle");
          setStatusText("");
          setSuccess(false);
          setError("");
        }} disabled={disabled || busy}/>
    </label>

    <div>
      <label htmlFor={"assignment-files-" + assignmentId} className="form-label">Attachments</label>
      <input id={"assignment-files-" + assignmentId} className="form-control" type="file" multiple
        onChange={event => {
          selectFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
        disabled={disabled || busy}/>
      <p className="small text-secondary mt-2 mb-0">
        Add files in one or more batches. Each file up to 5 MB uploads directly to private SAGA storage.
        Larger files stay in Google Drive and are attached using a share link. Any file type is accepted for R2 uploads.
      </p>
    </div>

    {files.length > 0 && <div className="border rounded p-3 d-grid gap-3">
      <strong>Selected files ({files.length})</strong>
      {files.map(({ file, id }) => {
        const large = file.size > MAX_R2_FILE_SIZE;
        const driveLink = driveLinks[id] || "";
        const invalidDriveLink = !!driveLink.trim() && !validDriveLink(driveLink);
        return <div className="border-top pt-3" key={id}>
          <div className="d-flex flex-wrap justify-content-between align-items-start gap-2">
            <div className="flex-grow-1">
              <span className="text-break fw-semibold">{file.name}</span>
              <small className="d-block text-secondary">{formatFileSize(file.size)}</small>
            </div>
            <button type="button" className="btn btn-sm btn-outline-secondary"
              onClick={() => removeFile(id)} disabled={disabled || busy}
              aria-label={"Remove " + file.name}>
              Remove
            </button>
          </div>
          {large ? <div className="mt-3">
            <p className="small text-warning-emphasis mb-2">
              This file is over 5 MB. Upload it to Google Drive first. SAGA will save the share link, not a copy of the file.
            </p>
            <a className="btn btn-sm btn-outline-primary mb-3" href={GOOGLE_DRIVE_UPLOAD_URL}
              target="_blank" rel="noopener noreferrer">
              <span className="me-1" aria-hidden="true">↗</span> Open Google Drive
            </a>
            <div className="border rounded bg-body-tertiary p-3 mb-3" id={"drive-upload-help-" + id}>
              <strong className="small d-block mb-2">Upload and attach this file</strong>
              <ol className="small ps-3 mb-0">
                <li>Sign in to Google if it asks, then choose <strong>+ New → File upload</strong>.</li>
                <li>Select <strong>{file.name}</strong> from your device and wait for the upload to finish.</li>
                <li>Open the file’s <strong>Share</strong> settings. Give your teacher access, or use <strong>Anyone with the link — Viewer</strong> only when your class allows it.</li>
                <li>Copy the file’s share link, return to SAGA, and paste it below. A My Drive or folder link will not work.</li>
              </ol>
            </div>
            <label className="form-label small" htmlFor={"drive-link-" + id}>Google Drive file share link</label>
            <input id={"drive-link-" + id} className="form-control" type="url" inputMode="url"
              autoComplete="url" aria-describedby={"drive-upload-help-" + id}
              placeholder="https://drive.google.com/file/d/…"
              value={driveLink}
              onChange={event => {
                setDriveLinks(current => ({ ...current, [id]: event.target.value }));
                setStage("idle");
                setStatusText("");
                setSuccess(false);
                setError("");
              }}
              disabled={disabled || busy}/>
            {invalidDriveLink
              ? <small className="text-danger d-block mt-1">Paste a direct file link from Google Drive or Google Docs, not a folder or My Drive page.</small>
              : <small className="text-secondary d-block mt-1">Check that your teacher can open the link before submitting.</small>}
          </div> : <small className="text-success d-block mt-2">Will upload directly to private R2 storage</small>}
        </div>;
      })}
      <div className="small text-secondary">
        {smallFiles.length} file(s) will upload to private R2 · {largeFiles.length} file(s) need Google Drive links.
        The 5 MB limit applies to each R2 file individually.
      </div>
    </div>}

    {busy && <div className="d-grid gap-1" role="status" aria-live="polite">
      <progress className="w-100"/>
      <small className="text-secondary">{statusText}</small>
      <small className="text-secondary">Small file contents go directly from your browser to private R2. SAGA stores the file record and applies access checks when downloading.</small>
    </div>}
    {success && <p className="alert alert-success mb-0" role="status">{statusText}</p>}
    {error && <p className="alert alert-danger mb-0" role="alert">{error}</p>}
    <button className="btn btn-primary" type="submit" disabled={disabled || busy}>
      {stage === "preparing" ? "Preparing uploads…" : stage === "uploading" ? "Uploading attachments…"
        : stage === "saving" ? "Saving submission…" : "Submit assignment"}
    </button>
  </form>;
}
