import { isRecord } from "./guards.ts";

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionFormQuestion {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
  allowOther: boolean;
  allowEmpty: boolean;
  placeholder?: string;
  dismissLabel?: string;
}

export type QuestionSelections = Record<number, ReadonlySet<number>>;
export type QuestionOtherTexts = Record<number, string>;

export function parseQuestionFormQuestions(input: unknown): QuestionFormQuestion[] | null {
  if (!isRecord(input) || !Array.isArray(input.questions)) return null;
  const questions: QuestionFormQuestion[] = [];
  for (const item of input.questions as unknown[]) {
    if (!isRecord(item) || typeof item.question !== "string" || typeof item.header !== "string" || !Array.isArray(item.options)) return null;
    const options: QuestionOption[] = [];
    for (const option of item.options as unknown[]) {
      if (!isRecord(option) || typeof option.label !== "string") return null;
      options.push({ label: option.label, description: typeof option.description === "string" ? option.description : undefined });
    }
    questions.push({
      question: item.question,
      header: item.header,
      options,
      multiSelect: item.multiSelect === true,
      allowOther: item.allowOther === true || item.isOther === true,
      allowEmpty: item.allowEmpty === true,
      placeholder: typeof item.placeholder === "string" ? item.placeholder : undefined,
      dismissLabel: typeof item.dismissLabel === "string" ? item.dismissLabel : undefined,
    });
  }
  return questions.length > 0 ? questions : null;
}

export function questionShowsTextInput(question: QuestionFormQuestion): boolean {
  return question.options.length === 0 || question.allowOther;
}

export function isQuestionAnswered(question: QuestionFormQuestion, index: number, selections: QuestionSelections, otherTexts: QuestionOtherTexts): boolean {
  const selected = selections[index];
  if (selected && selected.size > 0) return true;
  if (!questionShowsTextInput(question)) return false;
  const other = otherTexts[index]?.trim();
  if (other && other.length > 0) return true;
  return question.allowEmpty;
}

export function areQuestionsAnswered(questions: QuestionFormQuestion[] | null, selections: QuestionSelections, otherTexts: QuestionOtherTexts): boolean {
  return questions?.every((question, index) => isQuestionAnswered(question, index, selections, otherTexts)) ?? false;
}

export function buildQuestionFormAnswers(questions: QuestionFormQuestion[], selections: QuestionSelections, otherTexts: QuestionOtherTexts): Record<string, string> {
  const answers: Record<string, string> = {};
  questions.forEach((question, index) => {
    const selected = selections[index];
    const other = otherTexts[index]?.trim();
    const labels = selected ? Array.from(selected).map((at) => question.options[at].label) : [];
    if (questionShowsTextInput(question)) {
      if (other && other.length > 0) {
        answers[question.header] = question.multiSelect ? [...labels, other].join(", ") : other;
        return;
      }
      if (question.allowEmpty && question.options.length === 0) {
        answers[question.header] = "";
        return;
      }
    }
    if (labels.length > 0) answers[question.header] = labels.join(", ");
  });
  return answers;
}

export function shouldSubmitEmptyOnDismiss(questions: QuestionFormQuestion[]): boolean {
  return questions.length > 0 && questions.every((question) => question.allowEmpty && question.options.length === 0);
}

export function resolveDismissLabel(questions: QuestionFormQuestion[], fallback = "Dismiss"): string {
  return questions.find((question) => question.dismissLabel)?.dismissLabel ?? fallback;
}
