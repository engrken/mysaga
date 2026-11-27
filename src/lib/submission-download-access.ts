export type SubmissionDownloadPrincipal = {
  id: string;
  role: "TEACHER" | "STUDENT";
  schoolId: string;
  studentNumber?: string | null;
};

export type SubmissionDownloadOwnership = {
  schoolId: string;
  teacherId: string;
  enrollment: {
    studentUserId: string | null;
    studentNumber: string | null;
  };
};

export function canDownloadSubmissionFile(
  principal: SubmissionDownloadPrincipal,
  ownership: SubmissionDownloadOwnership
): boolean {
  if (principal.schoolId !== ownership.schoolId) return false;

  if (principal.role === "TEACHER") {
    return principal.id === ownership.teacherId;
  }

  if (principal.role !== "STUDENT") return false;
  if (ownership.enrollment.studentUserId) {
    return ownership.enrollment.studentUserId === principal.id;
  }

  const studentNumber = principal.studentNumber?.trim().toLocaleLowerCase();
  const enrollmentNumber = ownership.enrollment.studentNumber?.trim().toLocaleLowerCase();
  return !!studentNumber && !!enrollmentNumber && studentNumber === enrollmentNumber;
}
