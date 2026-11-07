"use client";

import { httpsCallable, FunctionsError } from "firebase/functions";
import { functions } from "@/lib/firebase";
import type { ChatLike } from "@/lib/assistant/loop";
import { systemInstruction } from "@/lib/assistant/loop";
import { createOpenAIChat, type Transport, type TransportReply, type WireMessage } from "@/lib/assistant/openaiChat";
import { TOOL_DECLARATIONS } from "@/lib/assistant/tools";

/**
 * The Ask screen's model: Groq (openai/gpt-oss-120b), reached only through
 * the askAssistant Cloud Function, which holds the key, checks the caller is
 * an admin and counts the daily cap. Kept outside src/lib/assistant on
 * purpose: that folder is lint-barred from calling Cloud Functions, so no
 * data tool can ever reach one.
 */

const askAssistant = httpsCallable<{ messages: WireMessage[]; tools: unknown[] }, TransportReply>(
  functions,
  "askAssistant",
  // The function enforces App Check (a token from the real app on the shop's
  // address) but doesn't consume it, so the normal cached token is used.
  { timeout: 95_000 },
);

const transport: Transport = async (request) => (await askAssistant(request)).data;

/** A fresh conversation. "New chat" and leaving the page start another. */
export function startAssistantChat(nowMs: number = Date.now()): ChatLike {
  return createOpenAIChat({ transport, system: systemInstruction(nowMs), tools: TOOL_DECLARATIONS });
}

/** What to tell the admin when the AI can't be reached, plus the raw error in small print. */
export function assistantErrorMessage(err: unknown): { message: string; detail: string } {
  const fe = err instanceof FunctionsError ? err : null;
  const raw = err instanceof Error ? err.message : String(err);
  const extra = fe?.details ? JSON.stringify(fe.details).slice(0, 300) : "";
  const detail = [fe?.code, raw.slice(0, 300), extra].filter(Boolean).join(" · ");
  const message = (() => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return "Ask needs the internet. Try again when the wifi is back.";
    switch (fe?.code) {
      case "functions/resource-exhausted":
      case "functions/permission-denied":
      case "functions/invalid-argument":
        return raw; // the function's own words
      case "functions/unauthenticated":
        return "Ask couldn't confirm this device (App Check) or your sign-in. Reload the page and try again.";
      case "functions/failed-precondition":
        return "The AI service refused the shop's key. The key needs checking in Secret Manager.";
      case "functions/not-found":
        return "Ask isn't set up on the server yet.";
      case "functions/deadline-exceeded":
        return "The AI took too long to answer. Try again.";
      default:
        return "The AI didn't answer. Check the connection and try again.";
    }
  })();
  return { message, detail };
}
