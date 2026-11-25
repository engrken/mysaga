export type AcademicPeriodSubject = {
  academicYear: string;
  term: string;
};

function normalizeAcademicYear(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[–—−]/g, "-").replace(/\s+/g, "");
}

function normalizeAcademicTerm(value: string) {
  return value.trim().toLocaleLowerCase()
    .replace(/\bfirst\b/g, "1st")
    .replace(/\bsecond\b/g, "2nd")
    .replace(/\bthird\b/g, "3rd")
    .replace(/\s+/g, " ");
}

export function isSameAcademicPeriod(subject: AcademicPeriodSubject, academicYear: string, term: string) {
  return normalizeAcademicYear(subject.academicYear) === normalizeAcademicYear(academicYear)
    && normalizeAcademicTerm(subject.term) === normalizeAcademicTerm(term);
}
