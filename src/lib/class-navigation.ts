/** Permanent, human-readable SAGA class links scoped to the logged-in teacher. */
export const CLASS_SECTIONS = ["setup", "roster", "items", "activities", "announcements", "resources", "record", "attendance", "analytics", "final"] as const;
export type ClassSection = (typeof CLASS_SECTIONS)[number];

export function isClassSection(value: unknown): value is ClassSection {
  return typeof value === "string" && (CLASS_SECTIONS as readonly string[]).includes(value);
}

export type ClassListItem = {
  id: string;
  code: string;
  academicYear: string;
  term: string;
};

export function courseCodeSlug(code: string) {
  return code.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "class";
}

/**
 * A plain course code is used when unique in this teacher's courses.
 * Repeated course codes are disambiguated using their stable database ID,
 * because a teacher may teach the same code in multiple terms or sections.
 */
export function classRouteKey(item: Pick<ClassListItem, "id" | "code">, catalog: Pick<ClassListItem, "id" | "code">[]) {
  const code = courseCodeSlug(item.code);
  const isDuplicate = catalog.some(other => other.id !== item.id && courseCodeSlug(other.code) === code);
  return isDuplicate ? `${code}--${item.id}` : code;
}

export function resolveClassRoute(slug: string, catalog: ClassListItem[]) {
  const direct = catalog.find(item => classRouteKey(item, catalog) === slug);
  if (direct) return dire¶»§q«^