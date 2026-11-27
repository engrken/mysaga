import { activitiesExplorationOnly } from "@/lib/activity-feature-flags";

/**
 * Google Drive is available only as an Activities exploration capability.
 * It never enables publishing, grading, or student submission writes.
 */
export const activitiesGoogleDriveExploration =
  activitiesExplorationOnly &&
  process.env.SAGA_ACTIVITIES_GOOGLE_DRIVE_EXPLORATION === "true";

export function normalizeGoogleAccountEmail(value: string) {
  return value.trim().toLowerCase();
}
