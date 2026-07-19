// Line-based diff utilities.
//
// Used by the "Continue" flow: we ask the LLM for the complete updated file
// content, then diff it against the original to figure out exactly what
// changed. We only ever want to detect NEW lines being added — if the LLM
// altered or removed any existing line (even whitespace-only changes),
// that's treated as unsafe and rejected rather than silently applied,
// since that would mean rewriting code the user didn't ask to change.

export type DiffOp =
  | { type: "equal"; oldIndex: number; newIndex: number; line: string }
  | { type: "delete"; oldIndex: number; line: string }
  | { type: "insert"; newIndex: number; line: string };

/**
 * Computes a line-level diff between two arrays of lines using the classic
 * LCS (Longest Common Subsequence) dynamic-programming approach. Returns an
 * ordered list of operations that transform `oldLines` into `newLines`.
 */
export function diffLines(oldLines: string[], newLines: string[]): DiffOp[] {
  const m = oldLines.length;
  const n = newLines.length;

  // dp[i][j] = length of LCS of oldLines[i..] and newLines[j..]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;

  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: "equal", oldIndex: i, newIndex: j, line: oldLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "delete", oldIndex: i, line: oldLines[i] });
      i++;
    } else {
      ops.push({ type: "insert", newIndex: j, line: newLines[j] });
      j++;
    }
  }

  while (i < m) {
    ops.push({ type: "delete", oldIndex: i, line: oldLines[i] });
    i++;
  }

  while (j < n) {
    ops.push({ type: "insert", newIndex: j, line: newLines[j] });
    j++;
  }

  return ops;
}

export interface InsertionOp {
  // The original file's 0-based line index this block should be inserted
  // AFTER. -1 means "insert at the very top of the file, before line 0".
  afterOldLine: number;
  lines: string[];
}

export interface ReplaceOp {
  // The original file's 0-based line index to replace in-place.
  oldLine: number;
  newLine: string;
}

export interface InsertionPlanResult {
  safe: boolean;
  insertions: InsertionOp[];
  // Narrow, explicitly-safe in-place edits — currently only used for
  // extending an existing import statement (e.g. adding a new named import
  // to an existing "import { x } from 'y'" line). Anything else that
  // touches an existing line is still rejected as unsafe.
  replacements: ReplaceOp[];
  reason?: string;
  offendingLine?: string;
}

/**
 * Diffs `oldContent` against `newContent` and extracts a safe insertion plan
 * — but ONLY if every change is a pure addition. If any existing line was
 * deleted or altered, returns { safe: false } instead of an insertion plan,
 * so the caller can refuse to auto-apply rather than risk silently rewriting
 * code the user didn't ask to change.
 */
function normalizeForCompare(line: string): string {
  // Ignore trailing whitespace differences the model may introduce
  // incidentally — these aren't meaningful changes and shouldn't trip the
  // "existing code was altered" safety check.
  return line.replace(/[ \t]+$/, "");
}

export function computeInsertionPlan(oldContent: string, newContent: string): InsertionPlanResult {
  let oldLines = oldContent.replace(/\r\n/g, "\n").split("\n");
  let newLines = newContent.replace(/\r\n/g, "\n").split("\n");

  // Trailing blank lines at end-of-file are common incidental noise (models
  // often add/drop one trailing newline) — trim them from both sides before
  // diffing so they don't get misread as a deletion or insertion.
  while (oldLines.length > 0 && oldLines[oldLines.length - 1] === "") oldLines.pop();
  while (newLines.length > 0 && newLines[newLines.length - 1] === "") newLines.pop();

  const oldForDiff = oldLines.map(normalizeForCompare);
  const newForDiff = newLines.map(normalizeForCompare);

  const ops = diffLines(oldForDiff, newForDiff);

  const insertions: InsertionOp[] = [];
  const replacements: ReplaceOp[] = [];
  let lastEqualOldIndex = -1;
  let currentBlock: string[] | null = null;

  const flushBlock = () => {
    if (currentBlock) {
      insertions.push({ afterOldLine: lastEqualOldIndex, lines: currentBlock });
      currentBlock = null;
    }
  };

  // A "modification" of an existing line shows up in the diff as an
  // isolated delete+insert pair with no equal line between them. A genuine,
  // necessary integration tweak (extending an import, changing a useState
  // initializer, adding a parameter) shows up as exactly ONE such isolated
  // pair. A real rewrite/refactor shows up as either several CONSECUTIVE
  // modified lines (a whole block rewritten) or many scattered single-line
  // changes across the file. We allow the former through as safe in-place
  // replacements, and reject the latter.
  const MAX_SAFE_REPLACEMENTS = 6;
  const MAX_CONSECUTIVE_REPLACEMENT_PAIRS = 1;

  let i = 0;
  let consecutivePairCount = 0;
  const pendingReplacements: ReplaceOp[] = [];

  while (i < ops.length) {
    const op = ops[i];
    const next = ops[i + 1];

    const isIsolatedPair =
      (op.type === "delete" && next?.type === "insert") ||
      (op.type === "insert" && next?.type === "delete");

    if (isIsolatedPair) {
      const deleteOp = op.type === "delete" ? op : next!;
      const insertOp = op.type === "insert" ? op : next!;

      // Check if this pair is directly adjacent to the previous one (i.e.
      // part of the same contiguous rewritten block) vs. a fresh isolated
      // change elsewhere in the file.
      consecutivePairCount =
        pendingReplacements.length > 0 &&
        pendingReplacements[pendingReplacements.length - 1].oldLine === (deleteOp as any).oldIndex - 1
          ? consecutivePairCount + 1
          : 1;

      if (consecutivePairCount > MAX_CONSECUTIVE_REPLACEMENT_PAIRS) {
        return {
          safe: false,
          insertions: [],
          replacements: [],
          reason: "The model rewrote a whole block of existing code instead of only adding new code.",
          offendingLine: oldLines[(deleteOp as any).oldIndex] ?? deleteOp.line,
        };
      }

      flushBlock();
      pendingReplacements.push({
        oldLine: (deleteOp as any).oldIndex,
        newLine: newLines[(insertOp as any).newIndex],
      });
      lastEqualOldIndex = (deleteOp as any).oldIndex;
      i += 2;
      continue;
    }

    if (op.type === "delete") {
      return {
        safe: false,
        insertions: [],
        replacements: [],
        reason: "The model modified or removed existing code instead of only adding new code.",
        offendingLine: oldLines[op.oldIndex] ?? op.line,
      };
    }

    if (op.type === "equal") {
      flushBlock();
      lastEqualOldIndex = op.oldIndex;
    } else if (op.type === "insert") {
      if (!currentBlock) currentBlock = [];
      currentBlock.push(newLines[op.newIndex]);
    }

    i++;
  }

  flushBlock();

  if (pendingReplacements.length > MAX_SAFE_REPLACEMENTS) {
    return {
      safe: false,
      insertions: [],
      replacements: [],
      reason: "Too many existing lines were changed — this looks like a broader rewrite rather than a small addition.",
      offendingLine: oldLines[pendingReplacements[0].oldLine],
    };
  }

  return { safe: true, insertions, replacements: pendingReplacements };
}