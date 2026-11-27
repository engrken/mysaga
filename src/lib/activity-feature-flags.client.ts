/** Public-only flags used by the Class Workspace UI. */
const production = process.env.NODE_ENV === "production";

export const activitiesReadOnly =
  production && process.env.NEXT_PUBLIC_SAGA_ACTIVITIES_BETA_READ_ONLY !== "false";

export const activitiesExplorationOnly =
  production && process.env.NEXT_PUBLIC_SAGA_ACTIVITIES_EXPLORATION_ONLY === "true";

export const activitiesPublishEnabled =
  !production || process.env.NEXT_PUBLIC_SAGA_ACTIVITIES_PUBLISH_ENABLED === "true";

export const activitiesStudentReadOnly =
  activitiesReadOnly || (production && process.env.NEXT_PUBLIC_SAGA_ACTIVITIES_STUDENT_WRITE !== "true");
