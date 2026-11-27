import { NextResponse } from "next/server";
import { tenantInvitationDigest } from "@/lib/tenant-invitations";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { checkAuthThrottle } from "@/lib/rate-limit";
import { SCHOOL_PLAN_LIMITS } from "@/lib/plans";
import { resolveTeacherSchoolTarget } from "@/lib/teacher-school-registration";
import { normalizeFacultyId } from "@/lib/account-identifiers";
import type { School } from "@/generated/prisma/client";
import { consumeEmailChallenge, emailVerificationFields, issueEmailChallenge } from "@/lib/email-verification";
import { syncGoogleChatEnrollment } from "@/lib/google-chat";
import { shareClassResourcesWithEnrollment } from "@/lib/class-resource-access";

const bodySchema = z.object({
  schoolId: z.string().min(1).optional(), schoolName: z.string().trim().min(2).max(160).optional(),
  fullName: z.string().trim().min(2).max(120).optional(), email: z.string().trim().email().max(200),
  password: z.string().min(12).max(100), role: z.enum(["TEACHER", "STUDENT"]),
  studentNumber: z.string().trim().max(40).optional(), facultyId: z.string().trim().max(40).optional(), inviteCode: z.string().optional(),
  invitationToken: z.string().regex(/^[a-f0-9]{64}$/).optional(), acknowledgedPrivacyNotice: z.literal(true),
  acknowledgedTerms: z.literal(true), termsVersion: z.literal("2026-11-12"),
  ...emailVerificationFields
});

function schoolIden¶»§q«^