/** Public-only flag used by the Class Workspace UI. */
export const activitiesReadOnly =
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PUBLIC_SAGA_ACTIVITIES_BETA_READ_ONLY !== "false";
