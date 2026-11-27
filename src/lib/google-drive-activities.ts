import { activitiesExplorationOnly } from "@/lib/activity-feature-flags";

const production = process.env.NODE_ENV === "production";

/**
 * Google Drive is available only as an Activities exploration capability.
 * It never enables publishing, grading, or student submission writes.
 */
export const activitiesGoogleDriveExploration =
  process.env.SAGA_ACTIVITIES_GOOGLE_DRIVE_EXPLORATION === "true" &&
  (!production || activitiesExplorationOnly);

export function normalizeGoogleAccountEmail(value: string) {
  return value.trim().toLowerCase();
}
