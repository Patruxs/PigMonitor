import assert from "node:assert/strict";
import test from "node:test";
import { areQuestionsAnswered, buildQuestionFormAnswers, parseQuestionFormQuestions } from "./question.ts";

test("an agent's questions are answered by header: picked labels joined; typed text replaces a single pick and joins multiple picks", () => {
  const questions = parseQuestionFormQuestions({
    questions: [
      { question: "Which?", header: "Pick", options: [{ label: "A" }, { label: "B" }], multiSelect: true },
      { question: "Why?", header: "Reason", options: [{ label: "Speed" }], allowOther: true },
      { question: "Also?", header: "Extra", options: [{ label: "Docs" }], multiSelect: true, allowOther: true },
    ],
  });
  assert.ok(questions);
  const selections = { 0: new Set([0, 1]), 1: new Set([0]) };
  assert.equal(areQuestionsAnswered(questions, { 0: new Set([0]) }, {}), false);
  assert.deepEqual(buildQuestionFormAnswers(questions, { ...selections, 2: new Set([0]) }, { 1: " faster ", 2: "tests" }), { Pick: "A, B", Reason: "faster", Extra: "Docs, tests" });
});
