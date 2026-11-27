/**
 * Activity authoring and student submissions are opt-in in production.
 * Development stays writable so the workflows can be exercised locally.
 */
const production = process.env.NODE_ENV === "production";
const publicReadOnly = process.env.NEXT_PUBLIC_SAGA_ACTIVITIES_BETA_READ_ONLY;

export const activitiesReadOnly = production && publicReadOnly !== "false";

export function assertActivitiesWritable(audience: "teacher" | "student") {
  if (!production) return true;
  const flag = audience === "teacher"
    ? process.env.SAGA_ACTIVITIES_TEACHER_WRITE
    : process.env.SAGA_ACTIVITIES_STUDENT_WRITE;
  return flag === "true";
}
