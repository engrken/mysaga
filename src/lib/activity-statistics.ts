import { gradeQuizAnswers, QuizAnswer, QuizQuestion } from "@/lib/class-activities";

type Attempt = {
  enrollmentId: string; answers: unknown; points: number | null; manualGrades: unknown; gradedAt: Date | null;
};
export function buildQuizStatistics(title: string, questions: QuizQuestion[], attempts: Attempt[], gradingMethod: string, maxScore: number) {
  const byStudent = new Map<string, Attempt[]>();
  for (const attempt of attempts) byStudent.set(attempt.enrollmentId, [...(byStudent.get(attempt.enrollmentId) ?? []), attempt]);
  const scores = [...byStudent.values()].map(list => {
    const graded = list.filter(item => item.points !== null && item.gradedAt);
    if (!graded.length) return null;
    const values = graded.map(item => item.points!);
    if (gradingMethod === "FIRST") return values[0];
    if (gradingMethod === "LAST") return values[values.length - 1];
    if (gradingMethod === "AVERAGE") return values.reduce((a, b) => a + b, 0) / values.length;
    return Math.max(...values);
  }).filter((value): value is number => value !== null);

  const questionStats = questions.map(question => {
    const marks: number[] = []; const totals: number[] = [];
    for (const attempt of attempts) {
      const answers = (attempt.answers ?? {}) as Record<string, QuizAnswer>;
      const manual = (attempt.manualGrades ?? {}) as Record<string, number>;
      const mark = question.type === "ESSAY" ? manual[question.id] : gradeQuizAnswers([question], answers).points;
      if (m¶»§q«^