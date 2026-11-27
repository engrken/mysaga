"use client";

import { FormEvent, useEffect, useState } from "react";

type Announcement = {
  id: string; title: string; body: string; pinned: boolean;
  publishedAt: string; expiresAt: string | null;
};
type Props = { subjectId: string; readOnly?: boolean };

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila"
  }).format(new Date(value));
}

export default function ClassAnnouncementPanel({ subjectId, readOnly = false }: Props) {
  const [rows, setRows] = useState<Announcement[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    const response = await fetch(`/api/teacher/subjects/${encodeURIComponent(subjectId)}/announcements`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load class announcements.");
    setRows(Array.isArray(data.announcements) ? data.announcements : []);
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/teacher/subjects/${encodeURIComponent(subjectId)}/announcements`, { cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        ¶»§q«^