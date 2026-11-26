export const SAGA_HELP_TOPICS = [
  "class-navigation",
  "class-roster",
  "grading-setup",
  "assessments",
  "score-entry",
  "attendance",
  "class-activities",
  "final-grades",
  "grade-visibility",
  "profile-security",
  "class-chats",
  "privacy",
] as const;

export type SagaHelpTopic = (typeof SAGA_HELP_TOPICS)[number];
export type WorkspaceIntent =
  | "class-overview"
  | "enrollment-count"
  | "assessment-count"
  | "upcoming-assessments"
  | "grade-workflow"
  | "attendance-sessions"
  | "activity-overview"
  | "grade-visibility";

export type AssistantIntent =
  | { kind: "workspace"; intent: WorkspaceIntent }
  | { kind: "system-help"; topic: SagaHelpTopic }
  | { kind: "individual-record" }
  | { kind: "unknown" };

const STATIC_HELP: Record<SagaHelpTopic, string> = {
  "class-navigation": "Use My classes in the SAGA top navigation to open a class workspace. The assistant stays attached to the class from which you opened it. To ask about another class, return to My classes and open that class first.",
  "class-roster": "Inside the current class workspace, open Class roster. Use Add students to paste or import the class roster; the roster template shows the expected columns. SAGA matches an existing student portal account using the student number. Review the rows before saving.",
  "grading-setup": "Open Grading setup in the current class workspace. Choose a single Lecture/Laboratory structure or a combined Lecture and Laboratory structure, then configure the category weights. Confirm that each parent allocation totals 100% before saving the grading path. Set the class grade-equivalent scale separately.",
  assessments: "Open Assessment items in the current class workspace. Add an assessment, choose its grading category, enter the maximum points, and optionally set a due date and item weight. Save the assessment setup when finished.",
  "score-entry": "Open Record scores in the current class workspace. Choose Import scores, download the SAGA CSV template, fill in the assessment columns, then select the completed CSV file. Review the student-row preview and validation messages, then choose Validate and save. The importer accepts CSV files, not .xlsx workbooks; export your Excel data as CSV and align it with the SAGA template first. Blank cells remain unchanged, and attendance is imported separately. The Virtual Assistant cannot upload files or change score records.",
  attendance: "Open Attendance in the current class workspace to review attendance sessions. Use Attendance day to add a session, select its date and delivery type, and then record the attendance marks. SAGA treats attendance as Present, Absent, or Excused rather than ordinary points.",
  "class-activities": "Open Activities in the current class workspace to create or manage class activities and learning tasks. Review the activity status and due date before opening it to students. Student submissions and grading remain within the class workspace.",
  "final-grades": "Open Final grades & submit in the current class workspace. Review the grade sheet and its validation messages before submitting. A submitted sheet follows the school's verification workflow; a verified sheet is final. Follow the on-screen instructions if a correction or recall is required.",
  "grade-visibility": "Use the grade-visibility controls in the current class workspace to review whether the class grade records are visible to students. The class summary shows either Visible to students or Hidden from students. Confirm the selected class before changing visibility.",
  "profile-security": "Open your account menu and choose Profile/Account settings to review your teacher details. Use the security controls there to update account credentials. Keep your sign-in details private and do not share one-time verification codes.",
  "class-chats": "Use Class chats from the SAGA top navigation to access the chat area. Class-specific Google Chat controls are also available from the class roster workspace when the integration is configured for that class.",
  privacy: "SAGA remains the system of record for class and student information. Workspace questions are answered inside SAGA. For system-help requests, SAGA sends COGNIX only a fixed help-topic code—not your typed question, class identifiers, student details, scores, or attendance marks. Avoid sharing personal or confidential information in chat.",
};

function classifyHelpTopic(message: string): SagaHelpTopic | null {
  const text = message.toLocaleLowerCase();

  if (/\b(password|sign.?in|log.?in|account|profile|faculty id|verification code|otp)\b/.test(text)) return "profile-security";
  if (/\b(google chat|class chat|chats|messag(?:e|es|ing))\b/.test(text)) return "class-chats";
  if (/\b(privacy|private|data protection|personal data|student data|external model|cognix)\b/.test(text)) return "privacy";
  if (/\b(visible|visibility|publish|published|hide grades|hidden from students)\b/.test(text)) return "grade-visibility";
  if (/\b(submit|submission|verify|verification|registrar|final grades?|grade sheet|gradesheet)\b/.test(text)) return "final-grades";
  if (/\b(attendance|present|absent|excused)\b/.test(text)) return "attendance";
  if (/\b(activities|activity|assignment|learning task|student submission)\b/.test(text)) return "class-activities";
  if (/\b(?:record|enter|import|upload|add|save)\b.{0,48}\b(?:scores?|marks?|points?)\b/.test(text)
    || /\b(?:scores?|marks?|points?)\b.{0,48}\b(?:excel|spreadsheet|csv|workbook|file|template)\b/.test(text)
    || /\b(?:excel|spreadsheet|csv|workbook|file|template)\b.{0,48}\b(?:scores?|marks?|points?)\b/.test(text)
    || /\b(scorebook|score entry|bulk scores?)\b/.test(text)) return "score-entry";
  if (/\b(grading setup|grade setup|setup grades?|set[- ]?up grades?|grading path|grading configuration|grading scheme|grade scale|category weights?|weight allocation|lecture and laboratory)\b/.test(text)
    || /\b(?:setup|set[- ]?up|configure|configuration)\s+(?:(?:the|my|our|class)\s+)*(?:grades?|grading|gradebook)(?:\s+categories?)?\b/.test(text)
    || /\b(?:grade|grading)\s+(?:setup|set[- ]?up|configuration|scheme|structure|path)\b/.test(text)) return "grading-setup";
  if (/\b(assessment|quiz|exam|due date|maximum points?)\b/.test(text)) return "assessments";
  if (/\b(roster|enrollment|enrolment|add students?|import students?|student number)\b/.test(text)) return "class-roster";
  if (/\b(my classes|switch class|open class|class workspace|class navigation|change class|subject workspace)\b/.test(text)) return "class-navigation";

  return null;
}

function asksHowTo(message: string) {
  return /\b(how\s+(?:do|can|should)\s+i|where\s+(?:do|can)\s+i|how\s+to|steps?\s+(?:to|for)|guide\s+me|help\s+me|show\s+me\s+how)\b/i.test(message);
}

function asksForIndividualRecord(message: string) {
  const text = message.toLocaleLowerCase();
  const mentionsPerson = /\b(students?|learners?|pupils?|student names?|student ids?|student numbers?|lrn)\b/.test(text);
  const asksDetail = /\b(names?|ids?|lrns?|grades?|scores?|attendance|remarks?|records?|results?|marks?|submissions?)\b/.test(text);
  const asksToRetrieve = /\b(show|list|find|look up|who|which|what is|what are|tell me|give me|display|identify|view|check)\b/.test(text);
  const namedRecord = /\b(?:grades?|scores?|attendance|remarks?|records?|marks?)\s+(?:of|for)\s+[a-z][a-z'-]{1,40}/i.test(message)
    || /\b[a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?'s\s+(?:grades?|scores?|attendance|remarks?|records?|marks?)\b/i.test(message)
    || /\b(?:show|list|find|look up|check|view|tell me|what is|what are|display)\b.{0,60}\b(?:grades?|scores?|attendance|remarks?|records?|marks?)\b.{0,32}\b(?:for|of)\s+(?:student\s+)?[a-z][a-z'-]{1,40}/i.test(message);

  return (mentionsPerson && asksDetail && asksToRetrieve) || namedRecord;
}

export function classifyAssistantMessage(message: string): AssistantIntent {
  const text = message.trim();
  if (!text) return { kind: "unknown" };

  if (asksForIndividualRecord(text)) return { kind: "individual-record" };

  const lower = text.toLocaleLowerCase();
  const helpTopic = classifyHelpTopic(text);
  if (asksHowTo(text) && helpTopic) return { kind: "system-help", topic: helpTopic };

  if (/\b(how many|number of|count|total|class size|roster count)\b/.test(lower)
    && (/\b(enrolled|enrollment|enrolment|roster|class size)\b/.test(lower)
      || /\b(students?|learners?)\b.{0,24}\b(in|inside|within)\s+(?:this|the)\s+class\b/.test(lower)
      || /\b(students?|learners?)\s+(?:are\s+)?(?:enrolled|registered)\b/.test(lower)
      || /\b(students?|learners?)\b.{0,28}\bdoes\s+(?:this|the)\s+class\s+have\b/.test(lower)
      || /\b(?:this|the)\s+class\b.{0,24}\b(?:has|have|contains)\b.{0,16}\b(students?|learners?)\b/.test(lower))) {
    return { kind: "workspace", intent: "enrollment-count" };
  }

  if (/\b(due|upcoming|deadline|next seven days|next 7 days|this week)\b/.test(lower)
    && /\b(assessments?|quizzes?|exams?|items?)\b/.test(lower)) {
    return { kind: "workspace", intent: "upcoming-assessments" };
  }

  if (/\b(how many|number of|count|total)\b/.test(lower)
    && /\b(assessment|quiz|exam)\b/.test(lower)
    && !/\b(graded|marked|submitted|pending|completed|left to mark|waiting)\b/.test(lower)) {
    return { kind: "workspace", intent: "assessment-count" };
  }

  if (/\b(grade\s*sheet|gradesheet|grade workflow|workflow status|draft|submitted|verified)\b/.test(lower)) {
    return { kind: "workspace", intent: "grade-workflow" };
  }

  if (/\b(how many|number of|count|total)\b/.test(lower) && /\b(attendance sessions?|attendance days?)\b/.test(lower)) {
    return { kind: "workspace", intent: "attendance-sessions" };
  }

  if (/\b(how many|number of|count|total)\b/.test(lower) && /\b(activities|activity|assignments?)\b/.test(lower)) {
    return { kind: "workspace", intent: "activity-overview" };
  }

  if (/\b(is|are|what is|check|show)\b.{0,30}\b(visible|visibility|published|hidden)\b/.test(lower)) {
    return { kind: "workspace", intent: "grade-visibility" };
  }

  if (/\b(schedule|class details|subject details|class overview|subject overview|summari[sz]e|summary|overview|tell me about this class)\b/.test(lower)) {
    return { kind: "workspace", intent: "class-overview" };
  }

  const asksForFeatureAction = /\b(?:can|could|would)\s+you\b|\bcan\s+i\b|\bplease\b|\b(?:want|need|trying)\s+to\b/.test(lower);
  if (helpTopic && (/\b(help|guide|explain|confused|how|where|steps)\b/.test(lower) || asksForFeatureAction)) {
    return { kind: "system-help", topic: helpTopic };
  }

  return { kind: "unknown" };
}

export function getStaticHelpAnswer(topic: SagaHelpTopic) {
  return STATIC_HELP[topic];
}

export function getAssistantSuggestions() {
  return [
    "Give me an overview of this class.",
    "How many students are enrolled?",
    "What assessments are due this week?",
    "What is the current grade-sheet status?",
    "How do I record scores?",
    "How do I submit final grades?",
  ];
}
