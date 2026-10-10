import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, type PressableStateCallbackType, type TextStyle } from "react-native";
import { areQuestionsAnswered, buildQuestionFormAnswers, isQuestionAnswered, parseQuestionFormQuestions, questionShowsTextInput, resolveDismissLabel, shouldSubmitEmptyOnDismiss, type QuestionFormQuestion } from "../shared/question.ts";
import { hostColours, RADIUS, SPACING } from "./kit/theme.ts";
import { PlanCard, useIsCompact } from "./message.tsx";
import type { PermissionAction, PermissionRequest, PermissionResponse } from "./timeline.ts";
import { ToolCallDetailsContent } from "./tool-details.tsx";
import { NO_OUTLINE } from "./kit/platform.ts";


function hoveredOf(state: PressableStateCallbackType): boolean {
  return (state as PressableStateCallbackType & { hovered?: boolean }).hovered === true;
}

function QuestionFormCard({ theme, permission, isResponding, onRespond }: { theme: PluginTheme; permission: PermissionRequest; isResponding: boolean; onRespond: (response: PermissionResponse) => void }) {
  const compact = useIsCompact();
  const questions = useMemo(() => parseQuestionFormQuestions(permission.input), [permission.input]);
  const [selections, setSelections] = useState<Record<number, Set<number>>>({});
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({});
  const [action, setAction] = useState<"submit" | "dismiss" | null>(null);
  const [active, setActive] = useState(0);
  if (!questions) return null;
  const index = Math.min(active, questions.length - 1);
  const question: QuestionFormQuestion = questions[index];
  const isLast = index === questions.length - 1;
  const allAnswered = areQuestionsAnswered(questions, selections, otherTexts);
  const activeAnswered = isQuestionAnswered(question, index, selections, otherTexts);
  const primaryDisabled = isResponding || (isLast ? !allAnswered : !activeAnswered);
  const toggle = (optionIndex: number) => {
    const next = new Set(selections[index] ?? []);
    if (question.multiSelect) {
      if (next.has(optionIndex)) next.delete(optionIndex);
      else next.add(optionIndex);
    } else if (next.has(optionIndex)) next.clear();
    else {
      next.clear();
      next.add(optionIndex);
    }
    setSelections((had) => ({ ...had, [index]: next }));
    if (!question.multiSelect && otherTexts[index]) {
      setOtherTexts((had) => {
        const rest = { ...had };
        delete rest[index];
        return rest;
      });
    }
    if (!question.multiSelect && next.size > 0) setActive(Math.min(index + 1, questions.length - 1));
  };
  const setOther = (value: string) => {
    setOtherTexts((had) => ({ ...had, [index]: value }));
    if (!question.multiSelect && value.length > 0) setSelections((had) => (!had[index] || had[index].size === 0 ? had : { ...had, [index]: new Set<number>() }));
  };
  const submit = () => {
    if (!allAnswered || isResponding) return;
    setAction("submit");
    onRespond({ behavior: "allow", updatedInput: { ...permission.input, answers: buildQuestionFormAnswers(questions, selections, otherTexts) } });
  };
  const dismiss = () => {
    setAction("dismiss");
    if (shouldSubmitEmptyOnDismiss(questions)) return onRespond({ behavior: "allow", updatedInput: { ...permission.input, answers: buildQuestionFormAnswers(questions, selections, otherTexts) } });
    onRespond({ behavior: "deny", message: "Dismissed by user" });
  };
  const primary = () => {
    if (!isLast) {
      if (!activeAnswered || isResponding) return;
      setActive((at) => Math.min(at + 1, questions.length - 1));
      return;
    }
    submit();
  };
  const dismissLabel = resolveDismissLabel(questions);
  const primaryLabel = isLast ? "Submit" : "Next";
  const selected = selections[index] ?? new Set<number>();
  const other = otherTexts[index] ?? "";
  const borderAccent = hostColours(theme).borderAccent;
  return (
    <View style={{ padding: SPACING[3], borderRadius: SPACING[2], borderWidth: 1, gap: SPACING[3], backgroundColor: theme.colors.surface1, borderColor: theme.colors.border }}>
      {questions.length > 1 ? (
        <View accessibilityRole="tablist" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACING[1], paddingHorizontal: SPACING[3] }}>
          {questions.map((q, at) => {
            const on = at === index;
            return (
              <Pressable key={q.header} accessibilityRole="tab" accessibilityLabel={`Question ${at + 1} of ${questions.length}`} accessibilityState={{ selected: on }} disabled={isResponding} onPress={() => setActive(at)} style={(state) => ({ flexDirection: "row", alignItems: "center", gap: SPACING[1], minHeight: 28, paddingHorizontal: SPACING[2], paddingVertical: SPACING[1], borderRadius: RADIUS.md, borderWidth: 1, backgroundColor: on || hoveredOf(state) ? theme.colors.surface2 : theme.colors.surface1, borderColor: on ? theme.colors.foregroundMuted : theme.colors.border, opacity: state.pressed ? 0.9 : 1 })}>
                {isQuestionAnswered(q, at, selections, otherTexts) ? <Icon name="Check" size={12} color={on ? theme.colors.foreground : theme.colors.foregroundMuted} /> : null}
                <Text numberOfLines={1} style={{ fontSize: 14, color: on ? theme.colors.foreground : theme.colors.foregroundMuted }}>
                  {q.header}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingHorizontal: SPACING[3], paddingBottom: SPACING[1] }}>
        <Text style={{ flex: 1, fontSize: 14, lineHeight: 22, color: theme.colors.foreground }}>{question.question}</Text>
      </View>
      <View key={question.question} style={{ gap: SPACING[2] }}>
        {question.options.length > 0 ? (
          <View style={{ gap: SPACING[1] }} {...(!question.multiSelect ? { accessibilityRole: "radiogroup" as const, accessibilityLabel: question.question } : {})}>
            {question.options.map((option, optionIndex) => {
              const on = selected.has(optionIndex);
              return (
                <Pressable key={option.label} onPress={() => toggle(optionIndex)} disabled={isResponding} accessibilityRole={question.multiSelect ? "checkbox" : "radio"} accessibilityLabel={option.label} accessibilityState={{ checked: on }} style={(state) => ({ flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING[3], paddingVertical: SPACING[2], borderRadius: RADIUS.md, ...(hoveredOf(state) || on ? { backgroundColor: theme.colors.surface2 } : {}), ...(state.pressed ? { opacity: 0.9 } : {}) })}>
                  <View style={{ flex: 1, flexDirection: "row", alignItems: "flex-start", gap: SPACING[2] }}>
                    <View style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center", borderWidth: 1, marginTop: 2, borderRadius: question.multiSelect ? 4 : 999, borderColor: on ? theme.colors.accent : hostColours(theme).foregroundExtraMuted, backgroundColor: on && question.multiSelect ? theme.colors.accent : "transparent" }}>
                      {on && question.multiSelect ? <Icon name="Check" size={12} color={theme.colors.accentForeground} /> : null}
                      {on && !question.multiSelect ? <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: theme.colors.accent }} /> : null}
                    </View>
                    <View style={{ flex: 1, gap: SPACING[1] }}>
                      <Text style={{ fontSize: 14, lineHeight: 22, color: on ? theme.colors.foreground : theme.colors.foregroundMuted }}>{option.label}</Text>
                      {option.description ? <Text style={{ fontSize: 14, lineHeight: 20, color: theme.colors.foregroundMuted }}>{option.description}</Text> : null}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {questionShowsTextInput(question) ? (
          <TextInput
            accessibilityLabel={question.question}
            placeholder={question.placeholder ?? (question.options.length === 0 ? "Type your answer..." : "Other...")}
            placeholderTextColor={theme.colors.foregroundMuted}
            value={other}
            onChangeText={setOther}
            onSubmitEditing={primary}
            editable={!isResponding}
            blurOnSubmit={false}
            style={[{ borderWidth: 1, borderRadius: RADIUS.lg, paddingHorizontal: SPACING[3], paddingVertical: SPACING[3], fontSize: 14, borderColor: other.length > 0 ? borderAccent : theme.colors.border, color: theme.colors.foreground, backgroundColor: theme.colors.surface2 }, NO_OUTLINE]}
          />
        ) : null}
      </View>
      <View style={{ gap: SPACING[2], ...(!compact ? { flexDirection: "row", justifyContent: "flex-start", alignItems: "center" } : {}) }}>
        <Pressable onPress={dismiss} disabled={isResponding} accessibilityRole="button" accessibilityLabel={dismissLabel} style={(state) => ({ paddingVertical: SPACING[2], paddingHorizontal: SPACING[3], borderRadius: RADIUS.md, alignItems: "center", borderWidth: 1, backgroundColor: hoveredOf(state) ? theme.colors.surface2 : theme.colors.surface1, borderColor: borderAccent, opacity: state.pressed ? 0.9 : 1 })}>
          {action === "dismiss" ? (
            <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2] }}>
              <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
              <Text style={{ fontSize: 14, color: theme.colors.foregroundMuted }}>{dismissLabel}</Text>
            </View>
          )}
        </Pressable>
        <Pressable onPress={primary} disabled={primaryDisabled} accessibilityRole="button" accessibilityLabel={primaryLabel} style={(state) => ({ paddingVertical: SPACING[2], paddingHorizontal: SPACING[3], borderRadius: RADIUS.md, alignItems: "center", borderWidth: 1, backgroundColor: theme.colors.accent, borderColor: theme.colors.accent, opacity: primaryDisabled ? 0.5 : state.pressed ? 0.9 : 1 })}>
          {action === "submit" ? (
            <ActivityIndicator size="small" color={theme.colors.accentForeground} />
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2] }}>
              <Icon name="Check" size={14} color={theme.colors.accentForeground} />
              <Text style={{ fontSize: 14, color: theme.colors.accentForeground }}>{primaryLabel}</Text>
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function planOf(request: PermissionRequest): string | undefined {
  const fromMetadata = request.metadata?.planText;
  if (typeof fromMetadata === "string" && fromMetadata) return fromMetadata;
  const candidate = request.input?.plan;
  return typeof candidate === "string" ? candidate : undefined;
}

function defaultActions(isPlan: boolean): PermissionAction[] {
  return [
    { id: "reject", label: "Deny", behavior: "deny", variant: "danger", intent: "dismiss" },
    { id: "accept", label: isPlan ? "Implement" : "Accept", behavior: "allow", variant: "primary" },
  ];
}

export function PermissionRequestCard({ theme, permission, onRespond }: { theme: PluginTheme; permission: PermissionRequest; onRespond: (requestId: string, response: PermissionResponse) => Promise<void> }) {
  const compact = useIsCompact();
  const [responding, setResponding] = useState<string | null>(null);
  useEffect(() => setResponding(null), [permission.id]);
  const isPlan = permission.kind === "plan";
  const title = isPlan ? "Plan" : (permission.title ?? permission.name ?? "Permission Required");
  const actions = permission.kind === "question" ? [] : permission.actions && permission.actions.length > 0 ? permission.actions : defaultActions(isPlan);
  const plan = planOf(permission);
  const respond = (response: PermissionResponse, actionId: string) => {
    setResponding(actionId);
    void onRespond(permission.id, response).catch(() => setResponding(null));
  };
  if (permission.kind === "question") return <QuestionFormCard theme={theme} permission={permission} isResponding={responding !== null} onRespond={(response) => respond(response, "question")} />;
  const borderAccent = hostColours(theme).borderAccent;
  const footer = (
    <>
      <Text style={{ fontSize: 14, marginTop: SPACING[1], marginBottom: SPACING[1], color: theme.colors.foregroundMuted }}>How would you like to proceed?</Text>
      <View style={{ gap: SPACING[2], ...(!compact ? { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-start", alignItems: "center", width: "100%" } : {}) }}>
        {actions.map((action) => {
          const primary = action.variant === "primary";
          const colour = primary ? theme.colors.foreground : theme.colors.foregroundMuted;
          return (
            <Pressable
              key={action.id}
              accessibilityRole="button"
              disabled={responding !== null}
              onPress={() => respond(action.behavior === "allow" ? { behavior: "allow", selectedActionId: action.id } : { behavior: "deny", selectedActionId: action.id, message: "Denied by user" }, action.id)}
              style={(state) => ({ paddingVertical: SPACING[2], paddingHorizontal: SPACING[3], borderRadius: RADIUS.md, alignItems: "center", borderWidth: 1, backgroundColor: hoveredOf(state) ? theme.colors.surface2 : theme.colors.surface1, borderColor: borderAccent, opacity: state.pressed ? 0.9 : 1 })}
            >
              {responding === action.id ? (
                <ActivityIndicator size="small" color={colour} />
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2] }}>
                  <Icon name={action.behavior === "allow" ? "Check" : "X"} size={14} color={colour} />
                  <Text style={{ fontSize: 14, color: colour }}>{action.label}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </>
  );
  if (isPlan && plan) return <PlanCard theme={theme} title={title} description={permission.description} text={plan} outcome="pending" footer={footer} compact />;
  return (
    <View style={{ marginVertical: SPACING[3], padding: SPACING[3], borderRadius: SPACING[2], borderWidth: 1, gap: SPACING[2], backgroundColor: theme.colors.surface1, borderColor: theme.colors.border }}>
      <Text style={{ fontSize: 14, lineHeight: 22, color: theme.colors.foreground }}>{title}</Text>
      {permission.description ? <Text style={{ fontSize: 14, lineHeight: 20, color: theme.colors.foregroundMuted }}>{permission.description}</Text> : null}
      {plan ? <PlanCard theme={theme} title="Proposed plan" text={plan} compact /> : null}
      {!isPlan ? <ToolCallDetailsContent theme={theme} detail={permission.detail ?? { type: "unknown", input: permission.input ?? null, output: null }} maxHeight={200} /> : null}
      {footer}
    </View>
  );
}
