"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  id: string; title: string; body: string; pinned: boolean; publishedAt: string;
  subject: { id: string; code: string; classId: string | null; title: string; term: string; academicYear: string; teacher: { fullName: string } };
};

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila"
  }).format(new Date(value));
}

export default function StudentAnnouncementBoard({ isDemo = false, academicYear, term }: { isDemo?: boolean; academicYear: string; term: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [subjectId, setSubjectId] = useState("all");
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isDemo) return;
    let active = true;
    fetch("/api/student/announcements?" + new URLSearchParams({ academicYear, term }).toString(), { cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load announcements.");
        if (active) setRows(Array.isArray(data.announcements) ? data.announcements : []);
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Could not load announcements."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { acti¶»§q«^