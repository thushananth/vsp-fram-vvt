import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./db";

/**
 * The admin Ask screen's line to the language model (Groq). The browser runs
 * the whole conversation and every data tool itself, under the Firestore
 * rules; this function only relays one model turn, so the Groq key never
 * reaches a browser. It reads no shop data.
 *
 * Guards: signed-in admin who isn't switched off, App Check (enforced; tokens
 * are not consumed, which would need the Token Verifier IAM role), size caps on what is relayed, a shop-wide daily cap and a
 * per-admin per-minute cap, counted in assistantUsage/{day} (no client can
 * read or write it: the rules deny unlisted collections).
 */

export const groqApiKey = defineSecret("GROQ_API_KEY");

/** Production model on Groq with tool calling (console.groq.com/docs/models, 7 Nov 2026). */
const MODEL = "openai/gpt-oss-120b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Model turns per day for the whole shop, the owner's cap. */
const DAILY_CAP = 200;
/** Model turns per minute for one admin. */
const PER_MINUTE_CAP = 20;

const MAX_MESSAGES = 60;
const MAX_TOTAL_CHARS = 48_000;
const MAX_TOOLS = 16;
const MAX_TOOLS_CHARS = 12_000;

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface AskTurnData {
  messages: ChatMessage[];
  tools: unknown[];
}

function colomboDay(ms = Date.now()): string {
  // Asia/Colombo is UTC+5:30 all year.
  return new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
}

function checkMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) {
    throw new HttpsError("invalid-argument", `messages must be a list of 1-${MAX_MESSAGES}.`);
  }
  let chars = 0;
  const out = raw.map((m): ChatMessage => {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown }).content;
    if (role === "system" || role === "user") {
      if (typeof content !== "string") throw new HttpsError("invalid-argument", "content must be text.");
      chars += content.length;
      return { role, content };
    }
    if (role === "tool") {
      const id = (m as { tool_call_id?: unknown }).tool_call_id;
      if (typeof content !== "string" || typeof id !== "string") throw new HttpsError("invalid-argument", "Bad tool message.");
      chars += content.length;
      return { role, tool_call_id: id, content };
    }
    if (role === "assistant") {
      const calls = (m as { tool_calls?: unknown }).tool_calls;
      if (content !== null && content !== undefined && typeof content !== "string") {
        throw new HttpsError("invalid-argument", "content must be text.");
      }
      chars += typeof content === "string" ? content.length : 0;
      const toolCalls = Array.isArray(calls)
        ? calls.map((c): ToolCall => {
            const id = (c as { id?: unknown })?.id;
            const fn = (c as { function?: { name?: unknown; arguments?: unknown } }).function;
            if (typeof id !== "string" || typeof fn?.name !== "string" || typeof fn.arguments !== "string") {
              throw new HttpsError("invalid-argument", "Bad tool call.");
            }
            chars += fn.arguments.length;
            return { id, type: "function", function: { name: fn.name, arguments: fn.arguments } };
          })
        : undefined;
      return { role, content: typeof content === "string" ? content : null, ...(toolCalls?.length ? { tool_calls: toolCalls } : {}) };
    }
    throw new HttpsError("invalid-argument", "Unknown message role.");
  });
  if (chars > MAX_TOTAL_CHARS) throw new HttpsError("invalid-argument", "The conversation is too long. Start a new chat.");
  return out;
}

function checkTools(raw: unknown): unknown[] {
  if (!Array.isArray(raw) || raw.length > MAX_TOOLS || JSON.stringify(raw).length > MAX_TOOLS_CHARS) {
    throw new HttpsError("invalid-argument", "Bad tool list.");
  }
  return raw;
}

/** Count this turn, or refuse when a cap is reached. One transaction, so parallel tablets can't overshoot. */
async function countTurn(uid: string): Promise<void> {
  const ref = db.doc(`assistantUsage/${colomboDay()}`);
  const minute = Math.floor(Date.now() / 60_000);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data() ?? {};
    if ((d.turns ?? 0) >= DAILY_CAP) {
      throw new HttpsError("resource-exhausted", `Today's limit of ${DAILY_CAP} AI turns for the shop is used up. It resets at midnight.`);
    }
    const mine = d.perMinute?.[uid];
    const inThisMinute = mine?.minute === minute ? mine.count : 0;
    if (inThisMinute >= PER_MINUTE_CAP) {
      throw new HttpsError("resource-exhausted", "Too many questions in a minute. Wait a moment and try again.");
    }
    tx.set(
      ref,
      {
        turns: FieldValue.increment(1),
        [`byUser.${uid}`]: FieldValue.increment(1),
        perMinute: { [uid]: { minute, count: inThisMinute + 1 } },
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  });
}

async function callGroq(body: object, key: string): Promise<Response> {
  return fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const askAssistant = onCall<AskTurnData>(
  { secrets: [groqApiKey], enforceAppCheck: true, timeoutSeconds: 90, memory: "256MiB" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required");
    const profile = (await db.doc(`users/${uid}`).get()).data();
    if (profile?.role !== "admin" || profile.active === false) {
      throw new HttpsError("permission-denied", "Ask is for admins only.");
    }

    const messages = checkMessages(request.data?.messages);
    const tools = checkTools(request.data?.tools);
    await countTurn(uid);

    const body = {
      model: MODEL,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.2,
      max_completion_tokens: 2000,
      // Fewer thinking tokens: the free plan allows 8,000 tokens a minute.
      reasoning_effort: "low",
    };

    let res = await callGroq(body, groqApiKey.value());
    if (res.status === 429) {
      // Usually the per-minute token limit; worth one short wait.
      const wait = Number(res.headers.get("retry-after") ?? "0");
      if (wait > 0 && wait <= 20) {
        await new Promise((r) => setTimeout(r, wait * 1000 + 250));
        res = await callGroq(body, groqApiKey.value());
      }
    }

    if (!res.ok) {
      const text = (await res.text()).slice(0, 400);
      console.error("Groq refused", res.status, text);
      if (res.status === 429) {
        throw new HttpsError("resource-exhausted", "The AI service's limit is reached for now. Try again in a minute.", { status: 429, text });
      }
      if (res.status === 401 || res.status === 403) {
        throw new HttpsError("failed-precondition", "The AI service refused the shop's key.", { status: res.status });
      }
      if (res.status === 400) {
        throw new HttpsError("invalid-argument", "The AI service couldn't read this request.", { status: 400, text });
      }
      throw new HttpsError("unavailable", "The AI service didn't answer. Try again.", { status: res.status });
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const msg = json.choices?.[0]?.message ?? {};
    return {
      content: msg.content ?? "",
      toolCalls: (msg.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })),
      finishReason: json.choices?.[0]?.finish_reason ?? null,
      usage: { input: json.usage?.prompt_tokens ?? 0, output: json.usage?.completion_tokens ?? 0 },
    };
  },
);
