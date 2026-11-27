"use client";

import { useEffect, useMemo, useState } from "react";

type Resource = {
  id: string;
  storageProvider: "GOOGLE_DRIVE" | "CLOUDFLARE_R2";
  fileUrl: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  publishedAt: string;
  subject: {
    id: string; code: string; classId: string | null; title: string;
    term: string; academicYear: string; teacher: { fullName: string };
  };
};

function sizeLabel(bytes: number) {
  if (!bytes || bytes < 0) return "Size unavailable";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium", timeZone: "Asia/Manila"
  }).format(new Date(value));
}

export default function StudentResourcesBoard({
  isDemo = false, academicYear, term
}: { isDemo?: boolean; academicYear: string; term: string }) {
  const [rows, setRows] = useState<Resource[]>([]);
  const [subjectId, setSubjectId] = useState("all");
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isDemo) return;
    let active = true;
    fetch("/api/student/resources?" + new URLSearchParams({ academicYear, term }).toString(), { cache: "no-store" })
      .then(async response => {
        ¶»§q«^