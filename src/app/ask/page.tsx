"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  BarChart3,
  Banknote,
  CalendarClock,
  Check,
  HandCoins,
  Lock,
  Receipt,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  TrendingUp,
  WifiOff,
} from "lucide-react";
import { useAdminGate } from "@/components/AdminGate";
import { AnswerCards } from "@/components/ask/AskCards";
import { useOnline } from "@/lib/online";
import { useBillJournal } from "@/lib/billJournal";
import { ask, type Answer, type ChatLike } from "@/lib/assistant/loop";
import { assistantErrorMessage, startAssistantChat } from "@/lib/askModel";
import { firestoreSource } from "@/lib/assistant/source";
import { createAssistantTools, TOOL_LABEL, type ToolOutcome } from "@/lib/assistant/tools";
import type { UnsentBill } from "@/lib/assistant/cashCheck";

/**
 * Ask: the admin's chat with the shop's data. The AI reads the question and
 * asks for read-only tools; the tablet runs them under the Firestore rules
 * and draws the cards from their results. The chat isn't saved: "New chat"
 * or leaving the page throws away the conversation and its name codes.
 */

interface ToolChip {
  key: number;
  label: string;
  state: "running" | "ok" | "error";
}

type Message =
  | { id: number; role: "user"; text: string }
  | {
      id: number;
      role: "ai";
      question: string;
      status: "working" | "done" | "error";
      chips: ToolChip[];
      answer?: Answer;
      outcomes: ToolOutcome[];
      error?: string;
      /** The raw error, in small print, for diagnosing a failure. */
      errorDetail?: string;
    };

const STARTERS: { title: string; sub: string; question: string; icon: React.ReactNode; fill?: boolean }[] = [
  { title: "Today's sales", sub: "Cash, credit, bills", question: "Today's sales", icon: <Receipt size={18} /> },
  { title: "This week vs last week", sub: "By day", question: "This week's sales compared with last week", icon: <BarChart3 size={18} /> },
  { title: "Who owes the most", sub: "Credit balances", question: "Which customers owe the most?", icon: <HandCoins size={18} /> },
  { title: "Tomorrow's orders", sub: "What to get ready", question: "What orders are due tomorrow?", icon: <CalendarClock size={18} /> },
  { title: "Cash check for today", sub: "Find a shortage", question: "Cash check for today: ", icon: <Banknote size={18} />, fill: true },
  { title: "Top products this month", sub: "By kg and Rs", question: "Top products this month", icon: <TrendingUp size={18} /> },
];

const MAX_QUESTION = 500;

/** This tablet's unconfirmed bills, kept current by the page, for the cash check. */
let unsentOnThisTablet: UnsentBill[] = [];

function AskScreen() {
  const gate = useAdminGate("Ask", "It reads the whole shop's sales, credit and profit, so it stays with admins.");
  const online = useOnline();
  const journal = useBillJournal();

  useEffect(() => {
    unsentOnThisTablet = journal.map((e) => ({
      id: e.id,
      no: e.no,
      createdAt: e.createdAt,
      cashierId: e.cashierId,
      total: e.total,
      paid: e.paid,
      kind: e.kind,
      state: e.state,
    }));
  }, [journal]);

  const tools = useMemo(
    () => createAssistantTools({ source: firestoreSource, unsentBills: () => unsentOnThisTablet }),
    [],
  );
  const chatRef = useRef<ChatLike | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const working = messages.some((m) => m.role === "ai" && m.status === "working");

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages]);

  // Leaving the page drops the chat: nothing to save, nothing to carry over.
  useEffect(() => () => abortRef.current?.abort(), []);

  const patch = useCallback((id: number, change: (m: Extract<Message, { role: "ai" }>) => Partial<Extract<Message, { role: "ai" }>>) => {
    setMessages((all) => all.map((m) => (m.id === id && m.role === "ai" ? { ...m, ...change(m) } : m)));
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const question = raw.trim().slice(0, MAX_QUESTION);
      if (!question || working) return;
      setDraft("");
      const userId = nextId.current++;
      const aiId = nextId.current++;
      setMessages((all) => [
        ...all,
        { id: userId, role: "user", text: question },
        { id: aiId, role: "ai", question, status: "working", chips: [], outcomes: [] },
      ]);
      if (!navigator.onLine) {
        patch(aiId, () => ({ status: "error", error: "Ask needs the internet. Try again when the wifi is back." }));
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        chatRef.current ??= startAssistantChat();
        const answer = await ask({
          chat: chatRef.current,
          tools,
          question,
          signal: controller.signal,
          onEvent: (e) => {
            if (e.type === "tool-start") {
              patch(aiId, (m) => ({ chips: [...m.chips, { key: e.key, label: TOOL_LABEL[e.name] ?? e.name, state: "running" }] }));
            } else {
              const label = tools.masker.unmask(e.outcome.label);
              patch(aiId, (m) => {
                const chips = m.chips.map((c) => (c.key === e.key ? { ...c, label, state: e.outcome.ok ? ("ok" as const) : ("error" as const) } : c));
                return { chips, outcomes: [...m.outcomes, e.outcome] };
              });
            }
          },
        });
        patch(aiId, () => ({ status: "done", answer, outcomes: answer.outcomes }));
      } catch (err) {
        // A stopped or failed turn can leave the model's history half-written
        // (a tool call with no answer), so the next question starts fresh.
        // Name codes and cached reads are kept, so it can still pick up the thread.
        chatRef.current = null;
        if ((err as Error)?.name === "AbortError") {
          patch(aiId, () => ({ status: "error", error: "Stopped." }));
        } else {
          const { message, detail } = assistantErrorMessage(err);
          console.error("Ask failed", err);
          patch(aiId, () => ({ status: "error", error: message, errorDetail: detail }));
        }
      } finally {
        abortRef.current = null;
      }
    },
    [patch, tools, working],
  );

  function newChat() {
    abortRef.current?.abort();
    chatRef.current = null;
    tools.reset();
    setMessages([]);
    setDraft("");
  }

  function pickStarter(s: (typeof STARTERS)[number]) {
    if (s.fill) {
      setDraft(s.question);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
      return;
    }
    void send(s.question);
  }

  if (gate) return gate;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-125px)] max-w-3xl flex-col p-4 pb-0 md:min-h-[calc(100dvh-110px)] md:px-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Ask</h1>
          <p className="text-sm font-medium text-muted">Questions about sales, credit and orders</p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={newChat}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 text-sm font-bold text-muted hover:text-ink"
          >
            <Trash2 size={16} />
            <span className="hidden sm:inline">New chat</span>
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-4 pb-6">
        {!online && (
          <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/[0.08] p-4">
            <WifiOff size={22} className="shrink-0 text-warning" />
            <div>
              <b className="block font-extrabold text-warning">Ask needs the internet</b>
              <p className="text-sm font-medium text-muted">
                The till keeps working offline, but questions go to the AI online. Try again when the wifi is back.
              </p>
            </div>
          </div>
        )}

        {messages.length === 0 ? (
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink-800 text-[#8fb4ff]">
                <Sparkles size={20} />
              </span>
              <h2 className="text-lg font-extrabold tracking-tight">What do you want to know?</h2>
              <p className="text-sm font-medium text-muted">
                Ask in English or Tamil. Answers come from your bills, payments and orders. Nothing is changed.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {STARTERS.map((s) => {
                const cash = s.fill;
                return (
                  <button
                    key={s.title}
                    onClick={() => pickStarter(s)}
                    disabled={!online}
                    className="flex min-h-[60px] items-center gap-3 rounded-2xl border border-border bg-surface px-3.5 py-3 text-left hover:bg-ground disabled:opacity-50"
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        cash ? "bg-warning/10 text-warning" : "bg-accent/10 text-accent"
                      }`}
                    >
                      {s.icon}
                    </span>
                    <span className="min-w-0">
                      <b className="block text-sm font-bold">{s.title}</b>
                      <small className="block text-xs font-medium text-muted">{s.sub}</small>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="flex items-start gap-2.5 px-1 text-[12.5px] font-medium text-muted">
              <Lock size={15} className="mt-0.5 shrink-0" />
              Customer and staff names are sent to the AI as codes. The chat isn&apos;t saved and clears when you leave this page.
            </p>
          </div>
        ) : (
          messages.map((m) =>
            m.role === "user" ? (
              <div
                key={m.id}
                className="max-w-[88%] self-end whitespace-pre-wrap rounded-[18px_18px_6px_18px] bg-accent px-3.5 py-2.5 text-[15px] font-semibold text-white"
              >
                {m.text}
              </div>
            ) : (
              <AiMessage key={m.id} message={m} masker={tools.masker} onRetry={() => void send(m.question)} canRetry={online && !working} />
            ),
          )
        )}
        <div ref={endRef} className="scroll-mb-36" />
      </div>

      {/* Sticks above the bottom bar on long chats; sits at the foot of the page on short ones. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
        className="sticky bottom-[60px] z-[5] -mx-4 bg-gradient-to-b from-ground/0 via-ground to-ground px-4 pb-3 pt-4 md:-mx-6 md:px-6"
      >
        <div
          className={`flex items-end gap-2 rounded-[28px] border border-border bg-surface py-1.5 pl-4 pr-1.5 shadow-[0_6px_20px_-10px_rgba(15,22,41,0.25)] ${
            online ? "" : "opacity-60"
          }`}
        >
          <textarea
            ref={inputRef}
            id="ask-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_QUESTION))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            rows={1}
            disabled={!online}
            placeholder={online ? "Ask about sales, credit or orders" : "Ask needs the internet"}
            aria-label="Ask a question"
            className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-[15px] outline-none placeholder:text-muted-2 [field-sizing:content]"
          />
          {working ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              aria-label="Stop"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink text-white"
            >
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              disabled={!online || !draft.trim()}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:bg-muted-2"
            >
              <ArrowUp size={20} strokeWidth={2.4} />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-center text-[11px] font-medium text-muted-2">
          The AI can make mistakes. Figures in cards come from your data.
        </p>
      </form>
    </div>
  );
}

function AiMessage({
  message,
  masker,
  onRetry,
  canRetry,
}: {
  message: Extract<Message, { role: "ai" }>;
  masker: ReturnType<typeof createAssistantTools>["masker"];
  onRetry: () => void;
  canRetry: boolean;
}) {
  const { status, chips, answer, outcomes, error, errorDetail } = message;
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="flex items-start gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-ink-800 text-[#8fb4ff]">
          <Sparkles size={15} />
        </span>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span
                key={c.key}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  c.state === "running"
                    ? "border-accent/30 bg-accent/5 text-accent"
                    : c.state === "error"
                      ? "border-border bg-surface text-muted-2 line-through"
                      : "border-border bg-surface text-muted"
                }`}
              >
                {c.state === "running" ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent/25 border-t-accent motion-reduce:animate-none" />
                ) : c.state === "ok" ? (
                  <Check size={12} strokeWidth={3} className="text-success" />
                ) : null}
                {c.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {status === "working" && (
        <div role="status" aria-label="Working on it" className="skeleton-in flex flex-col gap-2">
          <span className="skeleton block h-3 w-[85%] rounded-md" />
          <span className="skeleton block h-3 w-[60%] rounded-md" />
          <span className="skeleton block h-24 rounded-2xl" />
        </div>
      )}

      {status === "done" && answer && (
        <>
          <p className="max-w-[62ch] whitespace-pre-wrap text-[15px] leading-relaxed">
            {answer.segments.map((s, i) =>
              s.code ? (
                <span key={i} className="border-b-[1.5px] border-dotted border-muted-2" title="Sent to the AI as a code">
                  {s.text}
                </span>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </p>
          <AnswerCards outcomes={outcomes} masker={masker} />
        </>
      )}

      {status === "error" && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-muted">{error}</p>
            {errorDetail && <p className="mt-1 break-words font-mono text-[11px] text-muted-2">{errorDetail}</p>}
          </div>
          {canRetry && (
            <button
              onClick={onRetry}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-ground px-3 text-sm font-bold"
            >
              <RotateCcw size={15} />
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Ask is paused until its reads are capped properly. Set true to bring it back (and its nav item in AppShell). */
const ASK_ENABLED = false;

export default function AskPage() {
  if (ASK_ENABLED) return <AskScreen />;
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-lg font-semibold text-ink">Ask is paused</h1>
      <p className="mt-2 text-sm text-muted">The assistant is switched off for now. Reports, Profit and Dashboard have the same figures.</p>
      <Link href="/" className="mt-6 inline-flex min-h-12 items-center rounded-xl bg-ink px-5 text-sm font-semibold text-white">
        Back to billing
      </Link>
    </div>
  );
}
