"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { upload as uploadPrivateBlob } from "@vercel/blob/client";
import { ActivityRichEditor } from "@/components/ActivityRichEditor";
import { activitiesReadOnly } from "@/lib/activity-feature-flags.client";

type ClassInfo = { id: string; code: string; title: string; term: string; academicYear: string; gradeStatus: string; teacher: { fullName: string } };
type CategoryOption = { id: string; label: string };
type QuestionType = "MULTIPLE_CHOICE" | "TRUE_FALSE" | "ESSAY" | "SHORT_ANSWER";
type LessonPage = { id: string; title: string; content: string; nextPageId: string | null; branches: { label: string; targetPageId: string }[] };
type Attachment = { pathname: string; filename: string; contentType: string; size: number };
type InlineQuestion = { type: QuestionType; prompt: string; choices: string; answer: string; answerText: string; points: string };
type Question = { id: string; type: QuestionType; prompt: string; options: string[]; answer?: number; answerText?: string; points: number };
type BankQuestionItem = Pick<Question, "id" | "prompt" | "type" | "points"> & { topic: string | null };
type Submission = { text: string | null; driveUrl: string | null; files?: Attachment[]; offline?: boolean;
  points: number | null; feedback: string | null; submittedAt: string; graded?: boolean; gradedAt?: string | null;
  answers?: Record<string, string | number> };
type TeacherSubmission = Submission & { i¶»§q«^