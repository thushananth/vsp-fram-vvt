import { round2, round3 } from "@/lib/billLines";
import type { FieldSpec } from "./schema";
import { ToolInputError, type Row } from "./types";

/**
 * Filtering, sorting and adding up rows in code. Firestore only ever gets the
 * one range filter a collection needs (the shop has no composite indexes);
 * every other condition the model asks for is applied here, on rows that are
 * already masked, so a code like C7 compares as it is.
 */

export const OPERATORS = ["==", "!=", "<", "<=", ">", ">=", "in", "contains"] as const;
export type Operator = (typeof OPERATORS)[number];

export interface Condition {
  field: string;
  op: Operator;
  value: unknown;
}

/** Most rows one query call returns. Beyond that the model must aggregate. */
export const MAX_ROWS = 300;
export const DEFAULT_ROWS = 20;
/** Most groups one aggregate call returns. */
export const MAX_GROUPS = 100;

function known(fields: Record<string, FieldSpec>, field: unknown, what: string): FieldSpec {
  if (typeof field !== "string" || !(field in fields)) {
    throw new ToolInputError(
      `Unknown ${what} ${JSON.stringify(field)}. Allowed: ${Object.keys(fields).join(", ")}.`,
    );
  }
  return fields[field];
}

export function parseConditions(raw: unknown, fields: Record<string, FieldSpec>): Condition[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ToolInputError("where must be a list of {field, op, value}.");
  if (raw.length > 12) throw new ToolInputError("At most 12 conditions in where.");
  return raw.map((c) => {
    if (!c || typeof c !== "object") throw new ToolInputError("Each where item must be {field, op, value}.");
    const { field, op, value } = c as Record<string, unknown>;
    const spec = known(fields, field, "field");
    if (!OPERATORS.includes(op as Operator)) {
      throw new ToolInputError(`Unknown operator ${JSON.stringify(op)}. Allowed: ${OPERATORS.join(" ")}.`);
    }
    if (op === "in") {
      // The tool schema has one type per argument, so a list may come as "a, b".
      const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",").map((v) => v.trim()) : null;
      if (!list) throw new ToolInputError(`"in" needs a list value for ${field}.`);
      return {
        field: field as string,
        op: "in" as const,
        value: spec.type === "number" ? list.map(Number) : spec.type === "boolean" ? list.map((v) => v === true || v === "true") : list,
      };
    }
    if (op === "contains" && typeof value !== "string") {
      throw new ToolInputError(`"contains" needs a text value for ${field}.`);
    }
    if (spec.type === "boolean" && typeof value === "string") {
      if (value !== "true" && value !== "false") throw new ToolInputError(`${field} is true or false.`);
      return { field: field as string, op: op as Operator, value: value === "true" };
    }
    if (value === "null") return { field: field as string, op: op as Operator, value: null };
    if (spec.type === "number" && op !== "in" && op !== "contains" && value !== null && typeof value !== "number") {
      const n = Number(value);
      if (Number.isNaN(n)) throw new ToolInputError(`${field} is a number; got ${JSON.stringify(value)}.`);
      return { field: field as string, op: op as Operator, value: n };
    }
    if (spec.values && (op === "==" || op === "!=") && typeof value === "string" && !spec.values.includes(value)) {
      throw new ToolInputError(`${field} is one of ${spec.values.join(", ")}; got ${JSON.stringify(value)}.`);
    }
    return { field: field as string, op: op as Operator, value };
  });
}

function norm(v: unknown): unknown {
  return typeof v === "string" ? v.trim().toLowerCase() : v;
}

function test(row: Row, c: Condition): boolean {
  const left = norm(row[c.field]);
  const right = norm(c.value);
  switch (c.op) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case "in":
      return (c.value as unknown[]).map(norm).includes(left);
    case "contains":
      return typeof left === "string" && left.includes(right as string);
    default: {
      if (left === null || left === undefined) return false;
      const a = left as number | string;
      const b = right as number | string;
      if (c.op === "<") return a < b;
      if (c.op === "<=") return a <= b;
      if (c.op === ">") return a > b;
      return a >= b;
    }
  }
}

export function applyWhere(rows: Row[], where: Condition[]): Row[] {
  return where.length ? rows.filter((r) => where.every((c) => test(r, c))) : rows;
}

export interface Sort {
  field: string;
  direction: "asc" | "desc";
}

export function parseSort(raw: unknown, fields: Record<string, FieldSpec>): Sort | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "string") {
    known(fields, raw, "orderBy field");
    return { field: raw, direction: "asc" };
  }
  const { field, direction } = raw as Record<string, unknown>;
  known(fields, field, "orderBy field");
  if (direction !== undefined && direction !== "asc" && direction !== "desc") {
    throw new ToolInputError('orderBy.direction is "asc" or "desc".');
  }
  return { field: field as string, direction: (direction as "asc" | "desc") ?? "asc" };
}

export function applySort(rows: Row[], sort: Sort | null): Row[] {
  if (!sort) return rows;
  const sign = sort.direction === "desc" ? -1 : 1;
  return [...rows].sort((x, y) => {
    const a = x[sort.field] as number | string | null;
    const b = y[sort.field] as number | string | null;
    if (a === b) return 0;
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    return (a < b ? -1 : 1) * sign;
  });
}

export function parseLimit(raw: unknown): number {
  if (raw === undefined || raw === null) return DEFAULT_ROWS;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) throw new ToolInputError("limit must be a whole number from 1.");
  if (n > MAX_ROWS) throw new ToolInputError(`limit is at most ${MAX_ROWS}. For totals use aggregate.`);
  return n;
}

export function parseFieldList(raw: unknown, fields: Record<string, FieldSpec>, what: string, numeric = false): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ToolInputError(`${what} must be a list of field names.`);
  return raw.map((f) => {
    const spec = known(fields, f, `${what} field`);
    if (numeric && spec.type !== "number") throw new ToolInputError(`${f} is not a number, so it can't be summed.`);
    return f as string;
  });
}

export interface AggregateResult {
  count: number;
  sums: Record<string, number>;
  groups?: { key: unknown; count: number; sums: Record<string, number> }[];
  moreGroups?: number;
}

const roundSum = (field: string, v: number) => (field === "qty" ? round3(v) : round2(v));

/** Counts and sums worked out here, so the model never adds numbers itself. */
export function aggregate(rows: Row[], sum: string[], groupBy: string | null): AggregateResult {
  const blank = () => Object.fromEntries(sum.map((f) => [f, 0])) as Record<string, number>;
  const total = { count: 0, sums: blank() };
  const groups = new Map<string, { key: unknown; count: number; sums: Record<string, number> }>();
  for (const r of rows) {
    total.count += 1;
    for (const f of sum) total.sums[f] += Number(r[f] ?? 0) || 0;
    if (groupBy) {
      const key = r[groupBy] ?? null;
      const k = JSON.stringify(key);
      const g = groups.get(k) ?? { key, count: 0, sums: blank() };
      g.count += 1;
      for (const f of sum) g.sums[f] += Number(r[f] ?? 0) || 0;
      groups.set(k, g);
    }
  }
  const fix = (s: Record<string, number>) => {
    for (const f of sum) s[f] = roundSum(f, s[f]);
    return s;
  };
  const result: AggregateResult = { count: total.count, sums: fix(total.sums) };
  if (groupBy) {
    const first = sum[0];
    const sorted = [...groups.values()]
      .map((g) => ({ ...g, sums: fix(g.sums) }))
      .sort((a, b) => (first ? b.sums[first] - a.sums[first] : b.count - a.count));
    result.groups = sorted.slice(0, MAX_GROUPS);
    if (sorted.length > MAX_GROUPS) result.moreGroups = sorted.length - MAX_GROUPS;
  }
  return result;
}
