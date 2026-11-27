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
      if (mark === undefined) continue;
      marks.push(mark); totals.push(attempt.points ?? 0);
    }
    const mean = marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : 0;
    const variance = marks.length ? marks.reduce((sum, value) => sum + (value - mean) ** 2, 0) / marks.length : 0;
    const totalMean = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
    const covariance = marks.length ? marks.reduce((sum, value, i) => sum + (value - mean) * (totals[i] - totalMean), 0) / marks.length : 0;
    const totalVariance = totals.length ? totals.reduce((sum, value) => sum + (value - totalMean) ** 2, 0) / totals.length : 0;
    return { id: question.id, prompt: question.prompt, type: question.type, attempts: marks.length,
      facilityIndex: marks.length ? mean / question.points * 100 : null, standardDeviation: Math.sqrt(variance),
      discriminationIndex: variance && totalVariance ? covariance / Math.sqrt(variance * totalVariance) : null };
  });
  const distribution = [0, 20, 40, 60, 80].map((lower, index) => {
    const upper = index === 4 ? 100 : lower + 20;
    return { range: `${lower}–${upper}%`, count: scores.filter(score => {
      const percent = maxScore ? score / maxScore * 100 : 0;
      return percent >= lower && (index === 4 ? percent <= upper : percent < upper);
    }).length };
  });
  return { title, attempts: attempts.length, gradedAttempts: attempts.filter(item => item.points !== null && item.gradedAt).length,
    students: scores.length, classAverage: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    maxScore, distribution, questions: questionStats };
}
