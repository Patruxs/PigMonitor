import { isRecord } from "./guards.ts";

export interface TodoEntry {
  text: string;
  completed: boolean;
  id?: string;
  status?: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

const TASK_STATUSES = new Set(["pending", "in_progress", "completed"]);

function taskStatusOf(value: unknown): TodoEntry["status"] | null {
  return typeof value === "string" && TASK_STATUSES.has(value) ? (value as TodoEntry["status"]) : null;
}

function claudeTodos(input: unknown): TodoEntry[] | null {
  if (!isRecord(input) || !Array.isArray(input.todos)) return null;
  const out: TodoEntry[] = [];
  for (const todo of input.todos) {
    if (!isRecord(todo) || typeof todo.content !== "string") return null;
    const status = taskStatusOf(todo.status);
    if (!status) return null;
    if (todo.activeForm !== undefined && typeof todo.activeForm !== "string") return null;
    const text = (typeof todo.activeForm === "string" ? todo.activeForm.trim() : "") || todo.content.trim();
    out.push({ text: text.length ? text : todo.content, status, completed: status === "completed" });
  }
  return out;
}

function planSteps(input: unknown): TodoEntry[] | null {
  if (!isRecord(input) || !Array.isArray(input.plan)) return null;
  const out: TodoEntry[] = [];
  for (const entry of input.plan) {
    if (!isRecord(entry) || typeof entry.step !== "string") return null;
    const status = taskStatusOf(entry.status) ?? "pending";
    out.push({ text: entry.step.trim(), status, completed: status === "completed" });
  }
  return out.filter((entry) => entry.text.length > 0);
}

export function normalizeTaskToolName(toolName: string): string {
  return toolName.trim().replace(/[.\s-]+/g, "_").toLowerCase();
}

export function extractTaskEntriesFromToolCall(toolName: string, input: unknown): TodoEntry[] | null {
  const normalized = normalizeTaskToolName(toolName);
  if (normalized === "exitplanmode") return null;
  if (normalized === "todowrite" || normalized === "todo_write") return claudeTodos(input);
  if (normalized === "update_plan") return planSteps(input);
  return null;
}
