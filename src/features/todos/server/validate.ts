import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Recurrence, Scope } from "@/shared/contracts";
import { seoulToday } from "@/shared/time";
import { firstOccurrence } from "../rules";

// Request validation for the todos API. Error messages are shown to the user
// as-is, so they say what is wrong and how to fix it.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const TITLE_MAX = 200;
export const OFFSET_MAX_MIN = 7 * 24 * 60;

function isRealDate(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const dateSchema = z.string().regex(DATE_RE).refine(isRealDate);
const timeSchema = z.string().regex(TIME_RE);

const recurrenceSchema = z.discriminatedUnion("freq", [
  z.object({ freq: z.literal("daily") }),
  z.object({ freq: z.literal("weekly"), weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7) }),
  z.object({ freq: z.literal("monthly"), day: z.number().int().min(1).max(31) }),
]);

const notifySchema = z.object({
  enabled: z.boolean().optional(),
  offsetMin: z.number().int().min(0).max(OFFSET_MAX_MIN).nullable().optional(),
});

const fieldsSchema = {
  title: z.string().trim().min(1).max(TITLE_MAX),
  scope: z.enum(["work", "personal"]).optional(),
  dueDate: dateSchema.nullable().optional(),
  dueTime: timeSchema.nullable().optional(),
  recurrence: recurrenceSchema.nullable().optional(),
  notify: notifySchema.optional(),
};

const createSchema = z.object(fieldsSchema);
const patchSchema = z.object({ ...fieldsSchema, title: fieldsSchema.title.optional() });

export type TodoCreateBody = z.output<typeof createSchema>;
export type TodoPatchBody = z.output<typeof patchSchema>;

const FIELD_MESSAGES: Record<string, string> = {
  title: `제목을 적어 주세요. 제목은 1자에서 ${TITLE_MAX}자까지 쓸 수 있어요.`,
  scope: "회사 또는 개인 중 하나를 골라 주세요.",
  dueDate: "마감 날짜가 올바르지 않아요. 달력에서 날짜를 다시 골라 주세요.",
  dueTime: "마감 시간이 올바르지 않아요. 00:00부터 23:59 사이로 골라 주세요.",
  recurrence: "반복 설정이 올바르지 않아요. 매주는 요일을 하나 이상, 매월은 1일부터 31일 중 하루를 골라 주세요.",
  notify: "알림 설정이 올바르지 않아요. 알림 시점은 마감 7일 전까지만 정할 수 있어요.",
};
const FALLBACK_MESSAGE = "할 일 내용이 올바르지 않아요. 입력한 내용을 확인하고 다시 저장해 주세요.";
export const BAD_JSON_MESSAGE = "요청 형식이 올바르지 않아요. 화면을 새로 고친 뒤 다시 시도해 주세요.";
export const TIME_WITHOUT_DATE_MESSAGE = "마감 시간을 정하려면 마감 날짜도 골라 주세요.";

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

function parseWith<T>(schema: z.ZodType<T>, body: unknown): Parsed<T> {
  const result = schema.safeParse(body);
  if (result.success) return { ok: true, value: result.data };
  const field = result.error.issues[0]?.path[0];
  return { ok: false, message: (typeof field === "string" && FIELD_MESSAGES[field]) || FALLBACK_MESSAGE };
}

export const parseCreateBody = (body: unknown) => parseWith(createSchema, body);
export const parsePatchBody = (body: unknown) => parseWith(patchSchema, body);

/** The request's JSON body, or undefined when it is missing or malformed. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

/** The editable columns of a todo row. */
export interface TodoFields {
  title: string;
  scope: Scope;
  dueDate: string | null;
  dueTime: string | null;
  recurrence: Recurrence | null;
  seriesId: string | null;
  notifyEnabled: boolean;
  notifyOffsetMin: number | null;
}

export const NEW_TODO_FIELDS: TodoFields = {
  title: "",
  scope: "personal",
  dueDate: null,
  dueTime: null,
  recurrence: null,
  seriesId: null,
  notifyEnabled: true,
  notifyOffsetMin: null,
};

function normalizeRecurrence(r: Recurrence): Recurrence {
  if (r.freq !== "weekly") return r;
  return { freq: "weekly", weekdays: [...new Set(r.weekdays)].sort((a, b) => a - b) };
}

/**
 * Applies a create/patch body onto existing fields and checks the combined
 * result. A recurring todo always gets a due date (its first occurrence from
 * today) and a seriesId.
 */
export function mergeTodoFields(base: TodoFields, body: TodoPatchBody, now: Date): Parsed<TodoFields> {
  const next: TodoFields = { ...base };
  if (body.title !== undefined) next.title = body.title;
  if (body.scope !== undefined) next.scope = body.scope;
  if (body.dueDate !== undefined) next.dueDate = body.dueDate;
  if (body.dueTime !== undefined) next.dueTime = body.dueTime;
  if (body.recurrence !== undefined) next.recurrence = body.recurrence ? normalizeRecurrence(body.recurrence) : null;
  if (body.notify?.enabled !== undefined) next.notifyEnabled = body.notify.enabled;
  if (body.notify?.offsetMin !== undefined) next.notifyOffsetMin = body.notify.offsetMin;

  if (next.recurrence) {
    next.dueDate ??= firstOccurrence(next.recurrence, seoulToday(now));
    next.seriesId ??= randomUUID();
  }
  if (next.dueTime && !next.dueDate) return { ok: false, message: TIME_WITHOUT_DATE_MESSAGE };
  return { ok: true, value: next };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (id: string) => UUID_RE.test(id);
