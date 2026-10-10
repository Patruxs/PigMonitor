export interface DiffSegment {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
  segments?: DiffSegment[];
}

function splitIntoLines(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

function splitIntoWords(text: string): string[] {
  const result: string[] = [];
  let current = "";
  let inWord = false;
  for (const char of text) {
    const isWordChar = /\w/.test(char);
    if (isWordChar !== inWord && current) {
      result.push(current);
      current = "";
    }
    inWord = isWordChar;
    current += char;
  }
  if (current) result.push(current);
  return result;
}

function lcsTable<T>(a: T[], b: T[]): number[][] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

function buildSegments(words: string[], inLcs: Set<number>): DiffSegment[] {
  const segments: DiffSegment[] = [];
  let currentText = "";
  let currentChanged: boolean | null = null;
  words.forEach((word, index) => {
    const changed = !inLcs.has(index);
    if (currentChanged === null || changed === currentChanged) {
      currentText += word;
      currentChanged = changed;
      return;
    }
    segments.push({ text: currentText, changed: currentChanged });
    currentText = word;
    currentChanged = changed;
  });
  if (currentText) segments.push({ text: currentText, changed: currentChanged ?? false });
  return segments;
}

function computeWordLevelDiff(oldLine: string, newLine: string): { oldSegments: DiffSegment[]; newSegments: DiffSegment[] } {
  const oldWords = splitIntoWords(oldLine);
  const newWords = splitIntoWords(newLine);
  const dp = lcsTable(oldWords, newWords);
  const oldInLcs = new Set<number>();
  const newInLcs = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < oldWords.length && j < newWords.length) {
    if (oldWords[i] === newWords[j]) {
      oldInLcs.add(i);
      newInLcs.add(j);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
    else j += 1;
  }
  return { oldSegments: buildSegments(oldWords, oldInLcs), newSegments: buildSegments(newWords, newInLcs) };
}

export function buildLineDiff(originalText: string, updatedText: string): DiffLine[] {
  const originalLines = splitIntoLines(originalText);
  const updatedLines = splitIntoLines(updatedText);
  if (originalLines.length === 0 && updatedLines.length === 0) return [];
  const dp = lcsTable(originalLines, updatedLines);
  const diff: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < originalLines.length && j < updatedLines.length) {
    if (originalLines[i] === updatedLines[j]) {
      diff.push({ type: "context", content: ` ${originalLines[i]}` });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({ type: "remove", content: `-${originalLines[i]}` });
      i += 1;
    } else {
      diff.push({ type: "add", content: `+${updatedLines[j]}` });
      j += 1;
    }
  }
  for (; i < originalLines.length; i += 1) diff.push({ type: "remove", content: `-${originalLines[i]}` });
  for (; j < updatedLines.length; j += 1) diff.push({ type: "add", content: `+${updatedLines[j]}` });
  for (let index = 0; index < diff.length - 1; index++) {
    const curr = diff[index];
    const next = diff[index + 1];
    if (curr.type === "remove" && next.type === "add") {
      const { oldSegments, newSegments } = computeWordLevelDiff(curr.content.slice(1), next.content.slice(1));
      curr.segments = oldSegments;
      next.segments = newSegments;
    }
  }
  return diff;
}

export function parseUnifiedDiff(diffText?: string): DiffLine[] {
  const diff: DiffLine[] = [];
  for (const line of splitIntoLines(diffText ?? "")) {
    if (!line.length) diff.push({ type: "context", content: line });
    else if (line.startsWith("@@")) diff.push({ type: "header", content: line });
    else if (line.startsWith("+")) {
      if (!line.startsWith("+++")) diff.push({ type: "add", content: line });
    } else if (line.startsWith("-")) {
      if (!line.startsWith("---")) diff.push({ type: "remove", content: line });
    } else if (line.startsWith("diff --git") || line.startsWith("index ")) continue;
    else if (line.startsWith("\\ No newline")) diff.push({ type: "header", content: line });
    else diff.push({ type: "context", content: line });
  }
  return diff;
}
