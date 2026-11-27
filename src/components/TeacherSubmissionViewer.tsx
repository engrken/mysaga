"use client";

type LegacyAttachment = { pathname: string; filename: string; contentType: string; size: number };
type SubmissionFileRow = {
  id: string;
  submittedAt: string;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  storageProvider?: "GOOGLE_DRIVE" | "CLOUDFLARE_R2" | null;
  driveUrl?: string | null;
  files?: LegacyAttachment[] | null;
  enrollment: { studentName: string; studentNumber: string | null };
};

function formatSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function formatSubmittedAt(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila"
  }).format(new Date(value));
}

export function TeacherSubmissionViewer({ activityId, submissions }: {
  activityId: string;
  submissions: SubmissionFileRow[];
}) {
  const entries = submissions.flatMap(submission => {
    const rows: Array<{
      id: string; studentName: string; studentNumber: string | null; fileName: string;
      mimeType: string; fileSize: number | null; submittedAt: string; href: string; label: string;
    }> = [];
    if (submission.fileUrl && submission.fileName) {
      rows.push({
        id: submission.id + "-r2",
        studentName: submission.enrollment.studentName,
        studentNumber: submission.enrollment.studentNumber,
        fileName: submission.fileName,
        mimeType: submission.mimeType || "File",
        fileSize: submission.fileSize ?? null,
        submittedAt: submission.submittedAt,
        href: submission.fileUrl,
        label: "View / download"
      });
    }
    for (const file of submission.files ?? []) {
      rows.push({
        id: submission.id + "-" + file.pathname,
        studentName: submission.enrollment.studentName,
        studentNumber: submission.enrollment.studentNumber,
        fileName: file.filename,
        mimeType: file.contentType,
        fileSize: file.size,
        submittedAt: submission.submittedAt,
        href: "/api/activities/files?activityId=" + encodeURIComponent(activityId) +
          "&pathname=" + encodeURIComponent(file.pathname),
        label: "Download legacy file"
      });
    }
    if (submission.driveUrl) {
      rows.push({
        id: submission.id + "-drive",
        studentName: submission.enrollment.studentName,
        studentNumber: submission.enrollment.studentNumber,
        fileName: "Legacy Google Drive link",
        mimeType: "Google Drive",
        fileSize: null,
        submittedAt: submission.submittedAt,
        href: submission.driveUrl,
        label: "Open link"
      });
    }
    return rows;
  });

  if (!entries.length) return null;
  return <div className="table-responsive mb-3">
    <table className="table table-sm table-striped align-middle">
      <caption className="caption-top">Assignment files</caption>
      <thead><tr>
        <th scope="col">Student</th><th scope="col">File</th><th scope="col">Type</th>
        <th scope="col">Size</th><th scope="col">Submitted</th><th scope="col">Action</th>
      </tr></thead>
      <tbody>{entries.map(entry => <tr key={entry.id}>
        <td className="text-break"><strong>{entry.studentName}</strong>
          {entry.studentNumber && <small className="d-block text-secondary">{entry.studentNumber}</small>}
        </td>
        <td className="text-break">{entry.fileName}</td>
        <td className="text-break"><small>{entry.mimeType}</small></td>
        <td>{formatSize(entry.fileSize)}</td>
        <td>{formatSubmittedAt(entry.submittedAt)}</td>
        <td><a href={entry.href} target="_blank" rel="noreferrer">{entry.label}</a></td>
      </tr>)}</tbody>
    </table>
  </div>;
}
