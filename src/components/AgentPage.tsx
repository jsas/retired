// Assistant page: a list of named chats on the left, the active conversation
// on the right. Chats are remembered locally (chatStore) so the user can come
// back to one and continue it. The conversation UI is assistant-ui's
// Thread/Composer driven by our own agent loop via an external-store runtime —
// the loop, tools, prompt protocol for local models, and the confirm-before-
// apply change cards are unchanged; assistant-ui owns streaming display,
// auto-scroll, and the composer. Connecting/switching models lives on the
// separate Connections page.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppLocale } from '../lib/localeContext';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useExternalStoreRuntime,
  useThreadViewportStore,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import {
  Bot, Plus, Trash2, Lock, Cloud, MessageSquare, Check, X, Loader2, Wrench,
  Copy, ClipboardPaste, Download, RotateCcw, Settings2, Brain, ChevronDown,
  ChevronRight, ChevronsLeft, ChevronsRight, AlertTriangle, Info,
} from 'lucide-react';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import type { AppConfig } from '@retired/engine-core/appConfig';
import {
  connectionReady, getAiSettings, subscribeAiSettings, updateAiSettings,
  resolveAiPromptSend, resolveLocalToolCapable, isLocalProvider,
  type AiConnection, type AiSettings,
} from '../lib/aiSettings';
import { buildAgentPrompt, parseAgentResult } from '../lib/agentIngest';
import { QA_PRESETS, buildQAPrompt } from '../lib/agentQA';
import { createBridge, type Bridge, type ChatMessage } from '@retired/ai-bridge';
import { Progress } from '../design/primitives';
import { assembleSystemPrompt, DEFAULT_SYSTEM_PROMPT, runAgentTurn, type MutationProposal } from '../lib/ai/agentLoop';
import { createMcpToolExecutor } from '../lib/ai/mcpClient';
import type { View } from '../lib/viewRoutes';
import type { Locale } from '../lib/locale';
import {
  defaultContextSize, estimateTokens, planCompaction, summaryNote, COMPACT_AT,
} from '../lib/ai/context';
import { reasoningTail } from '../lib/ai/reasoningPreview';
import { PROMPT_TOOL_MAX_CALLS } from '../lib/ai/promptTools';
import type { ToolContext } from '@retired/mcp-tools/tools';
import type { MemoryStore } from '@retired/mcp-tools/memoryStore';
import {
  captureCheckpoint, appendCheckpoint, decodeRevertPatch,
  type PlanCheckpoint,
} from '@retired/mcp-tools/checkpoints';
import { WEBLLM_MODELS } from '../lib/ai/webLlmModels';
import { BONSAI_MODELS } from '../lib/ai/bonsaiModels';
import { activeCatalogKey, chatPickerEntries, pickModel, useModelCatalog } from '../lib/modelCatalog';
import { provenanceLine } from '../lib/ai/modelProvenance';
import { buildPlanDigest } from '../lib/agentQA';
import { calculateHousehold } from '@retired/engine-core/retirementEngine';
import {
  getChats, subscribeChats, updateChats, newThread, titleFromFirstMessage,
  type ChatThread,
} from '../lib/ai/chatStore';
import {
  subscribeRuns, getRunsVersion, getRun, hasActiveRun, runSnapshot, startRun, setRunPhase, setRunProgress,
  setRunDecision, takeRunDecision, abortRun, endRun,
} from '../lib/ai/chatRuns';
import { resetWebLlmChat, loadedWebLlmModel } from '../lib/ai/webLlmProvider';
import { resetBonsaiChat, loadedBonsaiModel } from '../lib/ai/bonsaiProvider';
import { Markdown } from './Markdown';

interface AgentPageProps {
  inputs: RetirementInputs;
  config: AppConfig;
  scenarioName: string;
  scenarioList: Array<{ id: string; name: string }>;
  /** Which scenario is active (list_scenarios marks it in the listing). */
  activeScenarioId?: string;
  /** Saved inputs of any scenario by id (list_scenarios withDetails). */
  scenarioInputsById?: (id: string) => RetirementInputs | undefined;
  onApply: (patch: Partial<RetirementInputs>) => void;
  /** Mint a partner plan and link the current plan to it (propose_spouse create). */
  onCreateSpousePlan?: (name?: string, inputs?: RetirementInputs) => string;
  onOpenConnections: () => void;
  /** Agent memory (scenario + global); absent only if the store failed to open. */
  memory?: MemoryStore;
  /** Active scenario id at render time — reads stay live via the ref below. */
  memoryScenarioId?: string;
  /** Agent scenario navigation: switch active scenario / save-current-as-new. */
  onOpenScenario?: (id: string) => void;
  onSaveScenarioAs?: (name: string) => string;
  /** Docked mode: render just the conversation column in the beta's
   *  right rail — no page header, no chat-list sidebar (a slim strip handles
   *  chat switching so the rail can stay at its 340px floor). */
  docked?: boolean;
  /** Hide the inner "AI Assistant" title (the beta page chrome already says
   *  Assistant — an inner h2 would be a second header). Controls and the
   *  connection badge stay. */
  hideTitle?: boolean;
  /** The view the host page is on when AgentPage mounts — for the ambient
   *  prompt line and find_page's "already here" tag. */
  currentView?: View;
  /** Route the host to a view (the action behind an approved propose_navigate
   *  card). Its presence also advertises `canNavigate` to the tools: no prop,
   *  and the card degrades to a shareable #/hash result. */
  onNavigate?: (view: View) => void;
  /** Assistant language (Canadian English / French). */
  locale?: Locale;
}

// ---------------------------------------------------------------------------
// Turn model (one chat bubble's worth of state; persisted via chatStore)
// ---------------------------------------------------------------------------

interface ToolActivity {
  id: string;
  name: string;
  state: 'running' | 'done' | 'error';
  /** Input arguments the model sent (pretty-printed on demand). */
  args?: Record<string, unknown>;
  /** Result content (truncated to 4000 chars by the event handler). */
  summary?: string;
}

interface PendingChange extends MutationProposal {
  resolved?: 'approved' | 'rejected';
  /** Legacy persisted shape (pre-patch proposals) tolerated on load. */
  field?: string;
  value?: unknown;
}

/** The inputs patch a change applies on approval. Current proposals carry
 *  `patch` directly; older saved threads stored a single field/value pair. */
function changePatch(change: PendingChange): Record<string, unknown> {
  if (change.patch && Object.keys(change.patch).length > 0) return change.patch;
  return change.field != null ? { [change.field]: change.value } : {};
}

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Chain-of-thought streamed by reasoning models (gpt-oss, DeepSeek, Qwen).
   *  Kept separate from `text` so the answer stays clean; shown collapsibly. */
  reasoning?: string;
  tools: ToolActivity[];
  changes: PendingChange[];
  /** 'needs-decision': the loop is PAUSED on a proposed change awaiting the
   *  user's Accept/Decline. Distinct from 'streaming' (which means the model
   *  is actively replying) so a reload doesn't leave the bubble looking busy
   *  forever, and so the spinner clears while the card waits. */
  state?: 'streaming' | 'done' | 'aborted' | 'truncated' | 'error' | 'needs-decision';
  /** Catalog / connection model the user had selected. */
  askedModel?: string;
  /** Provider-reported model that actually answered (OpenRouter free router). */
  servedModel?: string;
}

let turnSeq = 0;
const newTurnId = () => `turn-${++turnSeq}`;

/** Store titles keep the English sentinel `'New chat'` (patchTurnsOf compares it). Translate at display. */
function displayThreadTitle(title: string, t: (key: string) => string): string {
  return title === 'New chat' ? t('assistant.newChat') : title;
}

/** The context window to plan around for a connection. An explicit setting
 *  wins. For a LOCAL model on auto (no setting), plan against the model's own
 *  ceiling rather than the small default — the engine loads as big as the GPU
 *  holds and the per-request window is clamped to what actually loaded, so a
 *  slightly-optimistic plan here just compacts a touch early on a weak GPU. */
function effectiveContextLimit(connection: AiConnection): number {
  if (connection.contextSize) return connection.contextSize;
  if (connection.provider === 'webllm') {
    return WEBLLM_MODELS.find(m => m.id === connection.model)?.maxWindow ?? defaultContextSize('webllm');
  }
  if (connection.provider === 'bonsai') {
    return BONSAI_MODELS.find(m => m.id === connection.model)?.maxWindow ?? defaultContextSize('bonsai');
  }
  return defaultContextSize(connection.provider);
}

/** Fold the transcript into the provider-facing chat history. */
function toHistory(turns: Turn[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const t of turns) {
    if (t.role === 'user') {
      messages.push({ role: 'user', content: t.text });
      continue;
    }
    if (t.state === 'error') continue; // don't teach the model its own failures
    messages.push({
      role: 'assistant',
      content: t.text,
      toolCalls: t.tools.length
        ? t.tools.map(tool => ({ id: tool.id, name: tool.name, args: {} }))
        : undefined,
    });
    if (t.tools.length) {
      messages.push({
        role: 'user',
        content: '',
        toolResults: t.tools.map(tool => ({
          toolCallId: tool.id,
          content: tool.summary ?? '(no output)',
          isError: tool.state === 'error',
        })),
      });
    }
  }
  return messages;
}

/** Ask the model to condense compacted history into a short running digest.
 *  Uses a minimal one-off request (no tools, small max_tokens) so it stays
 *  cheap. Returns '' when nothing usable came back. */
async function digestHistory(
  bridge: Bridge,
  excerpt: string,
  abort: AbortController,
): Promise<string> {
  let text = '';
  const stream = bridge.streamChat({
    system:
      'You condense a retirement-planning conversation into a running digest for the model ' +
      'that continues it. Preserve every concrete fact (ages, balances, benefit amounts, ' +
      'start ages, decisions made, changes the user approved or rejected) and drop the prose. ' +
      'Reply with ONLY the digest — bullet points, under 200 words.',
    messages: [{ role: 'user' as const, content: excerpt }],
    tools: [],
    maxTokens: 400,
    signal: abort.signal,
  });
  for await (const evt of stream) {
    if (evt.type === 'text') text += evt.text;
  }
  return text.trim();
}

/** Turn → what assistant-ui renders. Tool calls + change cards are added by a
 *  custom component below (they aren't standard message parts), so the content
 *  here is just the prose. Status is only valid on assistant messages — the
 *  converter throws otherwise — so user turns carry none. */
function turnToMessage(t: Turn): ThreadMessageLike {
  const base = {
    id: t.id,
    role: t.role,
    content: [{ type: 'text' as const, text: t.text }],
    createdAt: new Date(0),
    // Carry the full Turn through metadata.custom so the message component can
    // render tool chips + change cards.
    metadata: { custom: { turn: t as unknown as Record<string, unknown> } },
  };
  if (t.role === 'user') return base;
  const status =
    t.state === 'streaming' ? ({ type: 'running' } as const)
    // Paused-on-approval is NOT running: a 'running' status makes assistant-ui's
    // default renderer paint its ● in-progress bullet, and the action bar hides.
    : t.state === 'needs-decision' ? ({ type: 'complete', reason: 'stop' } as const)
    : t.state === 'error' ? ({ type: 'incomplete', reason: 'error' } as const)
    : t.state === 'aborted' ? ({ type: 'incomplete', reason: 'cancelled' } as const)
    : t.state === 'truncated' ? ({ type: 'incomplete', reason: 'length' } as const)
    : ({ type: 'complete', reason: 'stop' } as const);
  return { ...base, status };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/* The docked chat picker: a clickable icon in a slim strip that drops down to
   select, start, or delete a chat. The rail's width stays for the conversation —
   no permanent chat list. Flat, hairline, f7. */
export function DockChatPicker({ threads, activeThreadId, onSelect, onNew, onDelete, modelPicker }: {
  threads: ChatThread[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  /** The model picker rides this strip in docked mode — the dock has no full
   *  header, and without it there'd be no way to switch models once one is
   *  connected (the offline CTA that links to Connections only shows before). */
  modelPicker?: ReactNode;
}) {
  const { t } = useTranslation('pages');
  // Runs are keyed by thread id in the registry; a chat that is thinking
  // elsewhere shows the same spinner the conversation bubble shows.
  const runsVersion = useSyncExternalStore(subscribeRuns, getRunsVersion, getRunsVersion);
  const runStates = useMemo(() => runSnapshot(), [runsVersion]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = threads.find(t => t.id === activeThreadId);
  const activeRunning = active != null && runStates.has(active.id);

  return (
    <div ref={ref} className="relative flex items-center gap-1 border-b border-slate-200 px-2 py-1.5">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={t('assistant.chooseChat')}
        title={t('assistant.chooseChat')}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] text-slate-700 hover:text-slate-900"
      >
        <MessageSquare size={13} className="shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 truncate">{active ? displayThreadTitle(active.title, t) : t('assistant.noChat')}</span>
        {activeRunning && <Loader2 size={12} className="shrink-0 animate-spin text-slate-400" aria-label={t('assistant.thisChatAnswering')} />}
        <ChevronDown size={13} className="shrink-0 text-slate-400" />
      </button>
      <button
        type="button"
        onClick={onNew}
        aria-label={t('assistant.newTitle')}
        title={t('assistant.newTitle')}
        className="shrink-0 p-1 text-slate-500 hover:text-slate-900"
      >
        <Plus size={14} />
      </button>
      {modelPicker && <div className="shrink-0">{modelPicker}</div>}
      {open && (
        <div className="absolute left-0 top-full z-50 w-full border border-slate-200 bg-white">
          {threads.length === 0 && (
            <p className="px-2.5 py-2 text-[11px] text-slate-400">{t('assistant.noChats')}</p>
          )}
          {threads.map(thread => {
            const run = runStates.get(thread.id);
            return (
              <div
                key={thread.id}
                className={`group flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-[12px] ${
                  thread.id === activeThreadId ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-50'
                }`}
                onClick={() => { onSelect(thread.id); setOpen(false); }}
              >
                {run
                  ? <Loader2 size={12} className="shrink-0 animate-spin text-slate-500" aria-label={run.phase === 'parked' ? t('assistant.waiting') : t('assistant.answering')} />
                  : <MessageSquare size={12} className="shrink-0 text-slate-400" />}
                <span className="min-w-0 flex-1 truncate">{displayThreadTitle(thread.title, t)}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDelete(thread.id); }}
                  aria-label={t('assistant.deleteChat')}
                  className="shrink-0 text-slate-300 opacity-0 hover:text-rose-600 group-hover:opacity-100"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AgentPage({ inputs, config, scenarioName, scenarioList, activeScenarioId, scenarioInputsById, onApply, onCreateSpousePlan, onOpenConnections, memory, memoryScenarioId, onOpenScenario, onSaveScenarioAs, docked, hideTitle, currentView, onNavigate, locale }: AgentPageProps) {
  const { t } = useTranslation('pages');
  const settings = useSyncExternalStore(subscribeAiSettings, getAiSettings, getAiSettings);
  const setSettings = (next: AiSettings) => updateAiSettings(() => next);
  // The chat store is MODULE-level (chatStore.ts): a background run keeps
  // appending turns after this component unmounts (page navigation, thread
  // switch), so the transcript can't live in React state. Read + write go
  // through the store; useSyncExternalStore re-renders on change.
  const chatState = useSyncExternalStore(subscribeChats, getChats, getChats);
  // The run registry (chatRuns.ts) — who is currently thinking, parked on a
  // confirm card, or loading a local model, keyed by thread id. The thread
  // lists read it to show the thinking spinner next to a running chat.
  const runsVersion = useSyncExternalStore(subscribeRuns, getRunsVersion, getRunsVersion);
  const runStates = useMemo(() => runSnapshot(), [runsVersion]);
  // Chat list: pinned open (default) or collapsed to a slim strip. Session-
  // only — not worth persisting.
  const [chatsPinned, setChatsPinned] = useState(true);

  const connection = settings.connections.find(c => c.id === settings.activeConnectionId) ?? null;

  // The shared model-selection surface: the bridge holds the saved connections
  // + the built-in model registry, and owns the provider stack (remote +
  // local). The agent loop streams through it rather than calling a provider
  // adapter directly, so selection/config live in one place. Rebuilt whenever
  // the settings change (a new connection, a key edit, a model switch).
  const bridge: Bridge = useMemo(() => {
    const b = createBridge({ connections: settings.connections });
    // Selection follows the active connection (set at construction, not as a
    // render side effect). Falls back to a ready connection / recommended
    // built-in when the active id is missing.
    if (settings.activeConnectionId) b.selectConnection(settings.activeConnectionId);
    return b;
  }, [settings.connections, settings.activeConnectionId]);

  const ready = connection != null && connectionReady(connection);
  const isLocal = connection != null && isLocalProvider(connection.provider);
  // Local tool mode: catalog `toolCapable` is the default (1.7B off, 4B+ on).
  // Settings → Assistant can force a model on or off for testing without
  // editing the catalog. Cloud connections always use native tools (until
  // Send tools is unchecked).
  const localMeta = !isLocal || !connection
    ? undefined
    : connection.provider === 'bonsai'
      ? BONSAI_MODELS.find(m => m.id === connection.model)
      : WEBLLM_MODELS.find(m => m.id === connection.model);
  const toolCapable = !isLocal || resolveLocalToolCapable(
    localMeta?.toolCapable,
    connection ? settings.toolCapableByModel?.[connection.model] : undefined,
  );
  const toolMode: 'native' | 'prompt' | 'off' = !isLocal ? 'native' : toolCapable ? 'prompt' : 'off';

  // The active thread object (creating one lazily if the store is empty).
  const activeThread: ChatThread | null =
    chatState.threads.find(t => t.id === chatState.activeThreadId) ?? null;

  const setActiveThread = (id: string | null) =>
    updateChats(prev => {
      // Switching threads must not carry the local engine's KV cache over:
      // the engine reuses it when the next request happens to match its last
      // conversation, so a different chat could inherit this one's context
      // (the "new chat sees the same window" bug). Reset before the switch —
      // but NEVER while a run is in flight on either side: the engine is one
      // shared resource and a mid-stream reset would corrupt the background
      // reply. A thread switch away from a running chat just leaves it running.
      if (id !== prev.activeThreadId && !hasActiveRun()) {
        void resetWebLlmChat();
        void resetBonsaiChat();
      }
      return { ...prev, activeThreadId: id };
    });

  const newChat = () => {
    const t = newThread(scenarioName, Date.now());
    // A fresh thread starts from an EMPTY context — never the last chat's
    // KV cache (see setActiveThread).
    if (!hasActiveRun()) {
      void resetWebLlmChat();
      void resetBonsaiChat();
    }
    updateChats(prev => ({ threads: [t, ...prev.threads], activeThreadId: t.id }));
  };

  const deleteChat = (id: string) => {
    // A running chat can't be deleted — its run would keep writing into a
    // thread that no longer exists (and the user would lose the stop button).
    // Stop it first, then the delete lands on a quiet thread.
    if (getRun(id)) abortRun(id);
    updateChats(prev => {
      const threads = prev.threads.filter(t => t.id !== id);
      return {
        threads,
        activeThreadId: prev.activeThreadId === id ? (threads[0]?.id ?? null) : prev.activeThreadId,
      };
    });
  };

  /** Patch ONE thread's turns (and bump updatedAt / title). Runs target their
   *  own thread by id — the active thread can switch mid-run, so the run may
   *  be writing to a thread that isn't the one on screen. */
  const patchTurnsOf = (threadId: string) => (mutate: (turns: Turn[]) => Turn[]) => {
    updateChats(prev => ({
      ...prev,
      threads: prev.threads.map(t => {
        if (t.id !== threadId) return t;
        const turns = mutate(t.turns as Turn[]);
        // Title the chat from the first user message once it exists.
        const firstUser = turns.find(x => x.role === 'user');
        const title = t.title === 'New chat' && firstUser ? titleFromFirstMessage(firstUser.text) : t.title;
        return { ...t, turns, title, updatedAt: Date.now() };
      }),
    }));
  };

  /** Patch non-turn fields of one thread (e.g. its system note or digest). */
  const patchThreadOf = (threadId: string) => (patch: Partial<ChatThread>) => {
    updateChats(prev => ({
      ...prev,
      threads: prev.threads.map(t => (t.id === threadId ? { ...t, ...patch } : t)),
    }));
  };

  /** Record an automatic checkpoint on one thread: the plan as it was JUST
   *  BEFORE an approved change landed. Ring-buffered per thread; kept in the
   *  chat store so revert history survives a reload. */
  const recordCheckpointOn = (threadId: string) => (label: string, inputsBefore: RetirementInputs) => {
    updateChats(prev => ({
      ...prev,
      threads: prev.threads.map(t => (t.id === threadId
        ? { ...t, checkpoints: appendCheckpoint(t.checkpoints ?? [], captureCheckpoint(label, inputsBefore)) }
        : t)),
    }));
  };

  return (
    <div className={`flex flex-col ${docked ? 'h-full min-h-0' : 'h-[calc(100vh-11rem)] min-h-[30rem]'}`}>
      {/* Header: title + model picker + connections link. Lives on the page so
          it's visible in chat, empty, and copy/paste modes alike. Docked mode
          drops it — the rail is too narrow and the beta chrome owns the
          assistant's on/off. */}
      {!docked && (
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {!hideTitle && <h2 className="text-sm font-bold text-slate-900">{t('assistant.title')}</h2>}
          <span
            className="border border-amber-300 bg-amber-50 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700"
            title={t('assistant.experimentalTitle')}
          >
            {t('assistant.experimental')}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <ModelPicker
              settings={settings}
              onChange={setSettings}
              onLoadModel={onOpenConnections}
            />
            {connection && (
              <span
                className={`flex items-center gap-1 px-2 py-1 text-[10px] font-semibold ${
                  isLocal ? 'border border-slate-900 text-slate-900' : 'bg-slate-100 text-slate-600'
                }`}
                title={isLocal ? t('assistant.onDeviceTitle') : t('assistant.cloudTitle')}
              >
                {isLocal ? <Lock size={11} /> : <Cloud size={11} />}
                {isLocal ? t('assistant.onDevice') : t('assistant.cloud')}
              </span>
            )}
            {isLocal && !toolCapable && (
              <span
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold bg-amber-50 text-amber-800"
                title={t('assistant.answersOnlyTitle')}
              >
                {t('assistant.answersOnly')}
              </span>
            )}
          </div>
        </div>
      )}

      <div className={`flex gap-3 flex-1 min-h-0 ${docked ? 'gap-0 flex-col' : ''}`}>
        {/* Docked: a slim header strip — the chat picker is a clickable icon
            that drops down to select a chat, so the rail keeps its width for
            the conversation instead of a permanent list. */}
        {docked && (
          <DockChatPicker
            threads={chatState.threads}
            activeThreadId={chatState.activeThreadId}
            onSelect={setActiveThread}
            onNew={newChat}
            onDelete={deleteChat}
            modelPicker={
              <ModelPicker
                settings={settings}
                onChange={setSettings}
                onLoadModel={onOpenConnections}
              />
            }
          />
        )}
        {/* ---- Chat list (full page only): pinned open, or a slim strip. ----
            Both variants show the thinking spinner on a running chat — the
            registry re-renders them the moment any thread's run state moves. */}
        {docked ? null : chatsPinned ? (
          <aside className="w-52 shrink-0 flex flex-col border border-slate-200 bg-white">
            <div className="flex items-center justify-between px-2.5 py-2 border-b border-slate-100">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{t('assistant.chats')}</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={newChat}
                  className="flex items-center gap-1 font-semibold text-slate-900 text-[11px] hover:text-slate-600"
                  title={t('assistant.newTitle')}
                >
                  <Plus size={13} /> {t('assistant.new')}
                </button>
                <button
                  onClick={() => setChatsPinned(false)}
                  className="text-slate-400 hover:text-slate-900"
                  title={t('assistant.collapseList')}
                >
                  <ChevronsLeft size={13} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
              {chatState.threads.length === 0 && (
                <p className="text-[11px] text-slate-400 px-1.5 py-2">{t('assistant.noChats')}</p>
              )}
              {chatState.threads.map(thread => {
                const run = runStates.get(thread.id);
                return (
                  <div
                    key={thread.id}
                    className={`group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer text-[11px] ${
                      thread.id === chatState.activeThreadId ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                    onClick={() => setActiveThread(thread.id)}
                  >
                    {run
                      ? <Loader2 size={12} className="shrink-0 animate-spin text-slate-500" aria-label={run.phase === 'parked' ? t('assistant.waiting') : t('assistant.answering')} />
                      : <MessageSquare size={12} className="shrink-0 text-slate-400" />}
                    <span className="flex-1 min-w-0 truncate">{displayThreadTitle(thread.title, t)}</span>
                    <button
                      onClick={e => { e.stopPropagation(); deleteChat(thread.id); }}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-700 shrink-0"
                      title={t('assistant.deleteChat')}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </aside>
        ) : (
          <aside className="w-9 shrink-0 flex flex-col items-center gap-2 border border-slate-200 bg-white py-2">
            <button
              onClick={() => setChatsPinned(true)}
              className="text-slate-400 hover:text-slate-900"
              title={t('assistant.showList')}
            >
              <ChevronsRight size={14} />
            </button>
            <button
              onClick={newChat}
              className="text-slate-900 hover:text-slate-600"
              title={t('assistant.newTitle')}
            >
              <Plus size={14} />
            </button>
            <div className="flex-1 overflow-y-auto flex flex-col items-center gap-1.5 w-full px-1">
              {chatState.threads.map(thread => {
                const run = runStates.get(thread.id);
                const shown = displayThreadTitle(thread.title, t);
                return (
                  <button
                    key={thread.id}
                    onClick={() => { setActiveThread(thread.id); setChatsPinned(true); }}
                    title={run ? (run.phase === 'parked' ? t('assistant.waitingTitle', { title: shown }) : t('assistant.answeringTitle', { title: shown })) : shown}
                    className={`flex items-center justify-center w-6 h-6 ${
                      thread.id === chatState.activeThreadId ? 'bg-slate-900 text-white' : 'text-slate-400 hover:bg-slate-100'
                    }`}
                  >
                    {run
                      ? <Loader2 size={13} className="animate-spin" aria-label={run.phase === 'parked' ? t('assistant.waiting') : t('assistant.answering')} />
                      : <MessageSquare size={13} />}
                  </button>
                );
              })}
            </div>
          </aside>
        )}

        {/* ---- Active conversation, or the copy/paste fallback ---- */}
        <div className="flex-1 min-w-0">
          {!ready ? (
            <OfflineAssistant
              inputs={inputs}
              config={config}
              hasConnections={settings.connections.length > 0}
              onApply={onApply}
              onConnect={onOpenConnections}
              compact={docked}
            />
          ) : !activeThread ? (
            <EmptyChatState onNew={newChat} />
          ) : (
            <Conversation
              key={activeThread.id}
              thread={activeThread}
              ready={ready}
              isLocal={isLocal}
              toolMode={toolMode}
              bridge={bridge}
              settings={settings}
              onSettingsChange={updateAiSettings}
              inputs={inputs}
              config={config}
              scenarioName={scenarioName}
              scenarioList={scenarioList}
              activeScenarioId={activeScenarioId}
              scenarioInputsById={scenarioInputsById}
              onApply={onApply}
              onCreateSpousePlan={onCreateSpousePlan}
              patchTurns={patchTurnsOf(activeThread.id)}
              patchThread={patchThreadOf(activeThread.id)}
              recordCheckpoint={recordCheckpointOn(activeThread.id)}
              currentView={currentView}
              onNavigate={onNavigate}
              locale={locale}
              memory={memory}
              memoryScenarioId={memoryScenarioId}
              onOpenScenario={onOpenScenario}
              onSaveScenarioAs={onSaveScenarioAs}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** The select itself, fed a pre-built catalog so node tests can render it
 *  without the hook (cache probe / listModels). */
export function ModelPickerSelect({ entries, activeKey, onPick, onLoadModel }: {
  entries: import('../lib/modelCatalog').ModelCatalogEntry[];
  activeKey: string | null;
  onPick: (key: string) => void;
  onLoadModel: () => void;
}) {
  const { t } = useTranslation('pages');
  const value = entries.some(e => e.key === activeKey) ? (activeKey ?? '') : '';
  return (
    <div className="flex items-center gap-1.5">
      <select
        value={value}
        onChange={e => {
          if (e.target.value === '__load__') onLoadModel();
          else if (e.target.value) onPick(e.target.value);
        }}
        className="max-w-56 border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 focus:border-slate-900 focus:outline-none"
        title={t('assistant.pickerTitle')}
      >
        {entries.length === 0 && <option value="">{t('assistant.noModels')}</option>}
        {entries.map(e => (
          <option key={e.key} value={e.key}>
            {e.local
              ? `${e.label}${e.cached === false ? t('assistant.downloadSuffix') : ''}`
              : `${e.label}${e.connectionLabel ? ` · ${e.connectionLabel}` : ''}`}
          </option>
        ))}
        <option value="__load__">{t('assistant.moreModels')}</option>
      </select>
    </div>
  );
}

/** Chat-dock picker: shortlisted models only (plus the one in use). Full
 *  catalog lives on the Models page behind "More models…". */
export function ModelPicker({ settings, onChange, onLoadModel }: {
  settings: AiSettings;
  onChange: (next: AiSettings) => void;
  onLoadModel: () => void;
}) {
  const { entries } = useModelCatalog(settings);
  return (
    <ModelPickerSelect
      entries={chatPickerEntries(entries, settings)}
      activeKey={activeCatalogKey(settings)}
      onPick={key => {
        const entry = entries.find(x => x.key === key);
        if (entry) onChange(pickModel(settings, entry));
      }}
      onLoadModel={onLoadModel}
    />
  );
}

// ---------------------------------------------------------------------------
// One conversation (assistant-ui runtime around our agent loop)
// ---------------------------------------------------------------------------

/** Assemble the system prompt body for a turn. Shared with Settings so the
 *  Assistant preview matches the wire. The live plan digest for chat-only
 *  modes is NOT here — it rides as a pinned leading history message (see
 *  planContextMessage) so a plan edit doesn't invalidate the engine's cached
 *  system prefix. */
function buildSystemBody(
  toolMode: 'native' | 'prompt' | 'off',
  scenarioName: string,
  settings: AiSettings,
  config: AppConfig,
  currentView?: View,
  chatNote?: string,
  locale?: Locale,
): string {
  const send = resolveAiPromptSend(settings.promptSend);
  const toolOverride = toolMode === 'native' ? settings.toolInstructionsNative
    : toolMode === 'prompt' ? settings.toolInstructionsPrompt
    : settings.toolInstructionsOff;
  return assembleSystemPrompt({
    scenarioName,
    toolMode,
    send,
    basePrompt: settings.systemPromptOverride,
    config,
    currentView,
    locale,
    toolInstructions: toolOverride,
    chatNote,
  });
}

/** The live plan digest for chat-only local models ('prompt' and 'off'
 *  modes), which have no tool to read the plan. It rides as the FIRST HISTORY
 *  message — not inside the system prompt. The local engine keeps one
 *  conversation across requests and reuses its KV cache when the request
 *  matches what it last saw; a plan digest baked into the system text changes
 *  with every approved edit, breaking that match and forcing a full re-prefill
 *  of the whole conversation every turn (the window the user saw every chat
 *  share). As a pinned leading history message it only invalidates the prefix
 *  when the plan actually changes, and a NEW chat — whose digest is the same
 *  but whose turns are empty — can never be mistaken for a continuation of a
 *  longer one. */
function planContextMessage(
  toolMode: 'native' | 'prompt' | 'off',
  inputs: RetirementInputs,
  config: AppConfig,
  includePlanDigest: boolean,
): ChatMessage | null {
  if (!includePlanDigest || toolMode === 'native') return null;
  return {
    role: 'user',
    content: buildPlanDigest(inputs, { results: calculateHousehold(inputs, config) }),
  };
}

// The LIVE plan bindings a run's tools read through. A run can outlive the
// Conversation that started it (thread switch, page navigation unmounts the
// dock), and its tool calls must see the plan as it is NOW — not frozen at
// the unmounted component's last render. The mounted Conversation writes
// these on every render; the getters in toolContext read them at tool-
// execution time. One AgentPage is mounted at a time (App guarantees it), so
// module-level is correct, not a leak.
const livePlan: {
  inputs: RetirementInputs | null;
  config: AppConfig | null;
  memory: MemoryStore | undefined;
  memoryScenarioId: string | undefined;
  currentView: View | undefined;
  locale: Locale | undefined;
} = {
  inputs: null,
  config: null,
  memory: undefined,
  memoryScenarioId: undefined,
  currentView: undefined,
  locale: undefined,
};

function Conversation({ thread, ready, isLocal, toolMode, bridge, settings, onSettingsChange, inputs, config, scenarioName, scenarioList, activeScenarioId, scenarioInputsById, onApply, onCreateSpousePlan, patchTurns, patchThread, recordCheckpoint, memory, memoryScenarioId, onOpenScenario, onSaveScenarioAs, currentView, onNavigate, locale }: {
  thread: ChatThread;
  ready: boolean;
  isLocal: boolean;
  toolMode: 'native' | 'prompt' | 'off';
  bridge: Bridge;
  settings: AiSettings;
  onSettingsChange: (mutate: (prev: AiSettings) => AiSettings) => void;
  inputs: RetirementInputs;
  config: AppConfig;
  scenarioName: string;
  scenarioList: Array<{ id: string; name: string }>;
  activeScenarioId?: string;
  scenarioInputsById?: (id: string) => RetirementInputs | undefined;
  onApply: (patch: Partial<RetirementInputs>) => void;
  onCreateSpousePlan?: (name?: string, inputs?: RetirementInputs) => string;
  patchTurns: (mutate: (turns: Turn[]) => Turn[]) => void;
  patchThread: (patch: Partial<ChatThread>) => void;
  recordCheckpoint: (label: string, inputsBefore: RetirementInputs) => void;
  memory?: MemoryStore;
  memoryScenarioId?: string;
  onOpenScenario?: (id: string) => void;
  onSaveScenarioAs?: (name: string) => string;
  currentView?: View;
  onNavigate?: (view: View) => void;
  locale?: Locale;
}) {
  const { t } = useTranslation('pages');
  const threadId = thread.id;
  const turns = thread.turns as Turn[];
  // Run state lives in the registry (chatRuns.ts), keyed by THIS thread id —
  // not in component state — so a run survives unmount (thread switch, page
  // navigation) and the thread lists can show who's thinking. Subscribe to
  // the registry; `run` is this thread's record (null = idle).
  useSyncExternalStore(subscribeRuns, getRunsVersion, getRunsVersion);
  const run = getRun(threadId);
  /** This chat has a live or parked run (Stop button, send/delete guards). */
  const running = run != null;
  // Local-model load/compile progress rides the run record, so the bar
  // survives thread switches too (component state died with the chat).
  const loadProgress = run?.progress ?? null;
  // The local engine is one shared resource: while ANY chat runs, no other
  // chat can ask the local model anything (the engine would interleave two
  // conversations into one KV cache). Cloud providers parallelize fine.
  const localEngineBusy = isLocal && hasActiveRun() && run == null;
  // Speed of the current/last reply, measured while it streams. Tokens are
  // estimated from characters (~4 chars/token) since prompt-mode streams give
  // us no provider counts.
  const [tps, setTps] = useState<number | null>(null);
  const statsRef = useRef<{ start: number; first: number | null; chars: number } | null>(null);
  const downloadDoneRef = useRef(false);
  // Approved propose_navigate cards queue their destination here instead of
  // routing on the spot: routing immediately would unmount the dock mid-
  // stream and kill the assistant's own acknowledgment. runTurn's finally
  // flushes the queue once the turn is over — but ONLY while this chat is
  // still the active one (a background chat finishing must not yank the user
  // to another page; the route waits until they come back and it's still last).
  const pendingNavigation = useRef<View[]>([]);
  // Filled in by SnapToBottomOnSend (inside the viewport) with the store's
  // scrollToBottom. send() calls it so a new user message snaps the reply into
  // view — the ONE auto-jump we keep now that the library's own triggers are
  // off (they re-pinned on every streaming update and blocked scrolling up).
  const snapToBottomRef = useRef<(() => void) | null>(null);

  /** Like patchTurns but lets the mutator also RETURN a value computed from
   *  the up-to-date turns (avoids acting on a stale `turns` closure, and keeps
   *  a truncate + read atomic so the external store can't drop a message
   *  between the two). */
  const reduceTurns = <R,>(fn: (turns: Turn[]) => { turns: Turn[]; result: R }): R => {
    let result!: R;
    patchTurns(prev => {
      const out = fn(prev);
      result = out.result;
      return out.turns;
    });
    return result;
  };

  // Publish the live plan bindings for tool execution. Runs outlive this
  // component (thread switch / page navigation), so a module-level holder —
  // not a ref that dies with the unmount — is what a background run's tools
  // read through. The props are current on every render of the mounted chat.
  livePlan.inputs = inputs;
  livePlan.config = config;
  livePlan.memory = memory;
  livePlan.memoryScenarioId = memoryScenarioId;
  livePlan.currentView = currentView;
  livePlan.locale = locale;

  // Checkpoints live in the chat store (per thread) — read them through the
  // store at tool-execution time so a revert proposal sees the list as it is
  // NOW (it grows as changes are approved, including by background runs).
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;
  const toolContext: ToolContext = useMemo(() => ({
    get inputs() { return livePlan.inputs!; },
    get config() { return livePlan.config!; },
    get checkpoints() {
      const t = getChats().threads.find(x => x.id === threadIdRef.current);
      return (t?.checkpoints ?? []) as PlanCheckpoint[];
    },
    get memory() { return livePlan.memory; },
    get memoryScenarioId() { return livePlan.memoryScenarioId; },
    get currentView() { return livePlan.currentView; },
    get locale() { return livePlan.locale; },
    scenarioName, scenarioList, activeScenarioId, scenarioInputsById,
    onOpenScenario, onSaveScenarioAs,
    // Advertise the card path only if the host can actually route (see
    // ToolContext.canNavigate); the routing itself happens on approval.
    canNavigate: onNavigate != null,
  }), [scenarioName, scenarioList, activeScenarioId, scenarioInputsById, onOpenScenario, onSaveScenarioAs, onNavigate]);

  // The MCP-backed tool executor. The server re-resolves the LIVE context on
  // every call, so the executor closes over the memoized context object (its
  // getters already read through the refs above). Memoized on the same deps.
  const mcpExecutor = useMemo(
    () => createMcpToolExecutor(() => toolContext),
    [toolContext],
  );

  const connection = settings.connections.find(c => c.id === settings.activeConnectionId) ?? null;

  // Unchecking send flags must actually take effect on the NEXT message. The
  // local engine reuses its KV cache when the next request "matches" the last
  // conversation — so a previous persona/tool blurb stays in GPU memory even
  // after the app stops sending it. Reset whenever the assembled system (or
  // the digest/tools flags that ride beside it) changes. Skip mid-run: a
  // reset would corrupt the in-flight reply.
  const sendForReset = resolveAiPromptSend(settings.promptSend);
  const systemFingerprint = `${buildSystemBody(toolMode, scenarioName, settings, config, currentView, thread.systemNote, locale)}|digest:${sendForReset.includePlanDigest}|tools:${sendForReset.sendTools}|mode:${toolMode}`;
  const fingerprintRef = useRef(systemFingerprint);
  useEffect(() => {
    if (fingerprintRef.current === systemFingerprint) return;
    fingerprintRef.current = systemFingerprint;
    if (isLocal && !hasActiveRun()) {
      void resetWebLlmChat();
      void resetBonsaiChat();
    }
  }, [systemFingerprint, isLocal]);

  // Estimated context usage for the meter. Mirror what runTurn actually sends:
  // prompt-mode (local) prepends the tool catalog AND the computed plan digest
  // to the system prompt — that's the bulk of a local model's small window, so
  // omitting it (as an earlier gauge did) read far too low. This runs the
  // engine once per render; cheap for a household plan, and it makes the meter
  // honest about what the local model must fit.
  const contextUsed = useMemo(() => {
    if (!connection) return 0;
    const send = resolveAiPromptSend(settings.promptSend);
    const system = buildSystemBody(toolMode, scenarioName, settings, config, currentView, thread.systemNote, locale);
    const planContext = planContextMessage(toolMode, inputs, config, send.includePlanDigest);
    const history = toHistory(turns);
    const full = planContext ? [planContext, ...history] : history;
    if (thread.contextSummary) {
      return estimateTokens(system, [{ role: 'user', content: summaryNote(thread.contextSummary) }, ...full]);
    }
    return estimateTokens(system, full);
  }, [connection, settings, thread.systemNote, thread.contextSummary, turns, toolMode, scenarioName, inputs, config, currentView]);

  /**
   * Run one assistant turn: append (or replace) a streaming assistant bubble
   * and drive the agent loop against the given prior history. Shared by send
   * (new user message), regenerate (re-run after an existing user message),
   * and resume (continue a turn paused on a proposed change).
   *
   * `resumeTurnId` continues the EXISTING paused turn instead of appending a
   * new bubble: the user just clicked Accept/Decline on a change card from a
   * previous session (or after an accidental cancel), so the loop must pick up
   * after that proposal rather than start a fresh turn that would re-propose.
   */
  const runTurn = async (priorTurns: Turn[], content: string, appendUser: boolean, resumeTurnId?: string) => {
    if (!content || running || !connection || localEngineBusy) return;
    // Register the run BEFORE any patch: the registry record is what keeps
    // this run alive across the Conversation unmounting (thread switch, page
    // navigation) — the loop below closes over threadId and the registry, not
    // over component state.
    const abort = startRun(threadId);
    statsRef.current = { start: Date.now(), first: null, chars: 0 };
    setTps(null);

    const resuming = resumeTurnId != null;
    const userTurn: Turn | null = appendUser
      ? { id: newTurnId(), role: 'user', text: content, tools: [], changes: [] }
      : null;
    const assistantTurn: Turn = resuming
      ? priorTurns.find(t => t.id === resumeTurnId)!
      : { id: newTurnId(), role: 'assistant', text: '', tools: [], changes: [], state: 'streaming', askedModel: connection.model };
    if (!resuming) {
      patchTurns(prev => userTurn ? [...prev, userTurn, assistantTurn] : [...prev, assistantTurn]);
    } else {
      // Flip the paused bubble back to actively-working, and CLEAR its streamed
      // state. In prompt mode the pre-approval prose was buffered into this same
      // bubble; leaving it (and the old tool chips / the resolved change card)
      // in place makes the continued reply append on top — re-sending the old
      // answer and stacking a duplicate Applied card next to the decided one.
      patchTurns(prev => prev.map(t => (t.id === resumeTurnId
        ? { ...t, text: '', reasoning: undefined, tools: [], changes: [], state: 'streaming', askedModel: connection.model, servedModel: undefined }
        : t)));
    }

    const patchAssistant = (mutate: (t: Turn) => void) => {
      patchTurns(prev => prev.map(t => (t.id === assistantTurn.id
        ? (() => { const c = { ...t, tools: [...t.tools], changes: [...t.changes] }; mutate(c); return c; })()
        : t)));
    };

    const send = resolveAiPromptSend(settings.promptSend);
    const system = buildSystemBody(toolMode, scenarioName, settings, config, currentView, thread.systemNote, locale);

    // Fit the conversation into the model's context window: when the estimated
    // usage crosses the trigger, the oldest turns are folded away and replaced
    // by the running digest. The transcript itself is never altered — only
    // what the provider sees. The digest is written by the model (below) the
    // first time turns are dropped; until then a placeholder note stands in.
    //
    // On resume, the paused assistant turn (with its proposal) must stay OUT
    // of the history — the loop re-runs it, and duplicating it would teach the
    // model the proposal was already answered. The decision rides as the user
    // message instead ("I accepted/declined the change you proposed…").
    const historyTurns = resuming ? priorTurns.filter(t => t.id !== resumeTurnId) : priorTurns;
    const contextSize = effectiveContextLimit(connection);
    const planContext = planContextMessage(toolMode, inputs, config, send.includePlanDigest);
    const fullHistory = toHistory(historyTurns);
    // The plan digest message must never be a compaction victim: a tool-less
    // local model that loses it can no longer see the plan at all. Plan the
    // fold on the conversation turns alone, then pin the digest back in front.
    // The planner treats `system` as fixed overhead, so pass the digest's
    // estimated cost in there — the kept tail is then sized for digest + turns.
    const compaction = planCompaction({
      system: system + (planContext ? `\n\n${planContext.content}` : ''),
      messages: fullHistory,
      contextSize,
      priorSummary: thread.contextSummary ?? '',
    });
    if (planContext) compaction.messages.unshift(planContext);
    const history = compaction.messages;
    if (compaction.compacted) {
      patchAssistant(t => { t.tools.push({ id: `compact-${Date.now().toString(36)}`, name: 'context compacted', state: 'done', summary: 'Older messages were summarized to fit the context window.' }); });
    }

    // Even after compaction the request can exceed the window: the fixed
    // overhead (persona + tool catalog + plan digest) plus the verbatim tail
    // may simply not fit a small local model's compiled context — a fresh chat
    // has no history to compact, so it's the overhead alone that overflows.
    // Catching it here gives the user something they can act on instead of the
    // engine's raw "prompt tokens exceed context window size" dump.
    if (isLocal && estimateTokens(system, [...history, { role: 'user', content }]) > contextSize * COMPACT_AT) {
      patchAssistant(t => {
        t.state = 'error';
        t.text =
          `This local model's context window (${contextSize.toLocaleString()} tokens) is too small to hold your plan ` +
          'summary and this conversation — even after older messages were compacted. On the Connections page, raise ' +
          '"How much the model reads at once" (if your GPU has the memory), pick a model compiled for a larger ' +
          'window, or switch to a cloud provider (Advanced), which offers a much bigger window.';
      });
      setRunProgress(threadId, null);
      endRun(threadId);
      return;
    }

    const loadedLocal = connection.provider === 'bonsai' ? loadedBonsaiModel() : loadedWebLlmModel();
    if (isLocal && loadedLocal !== connection.model) {
      // Only a turn that might actually DOWNLOAD/COMPILE the model shows the
      // progress bar. When the engine is already resident, streamWebLlm reuses
      // it and never calls onProgress — the bar would sit at 0% for the whole
      // reply (the "Preparing the local model… on every chat" bug).
      downloadDoneRef.current = false;
      setRunProgress(threadId, { progress: 0, text: 'Preparing the local model…' });
    }
    const reportLoad = (p: { progress: number; text: string }) => {
      // progress 1 means the engine is loaded (web-llm and Bonsai both report
      // Ready at 1). Leaving a "Compiling…" bar after that is the stuck
      // overlay you get once the model is already thinking. First token also
      // clears it, but reasoning-only openings never emit text.
      if (p.progress >= 1) {
        downloadDoneRef.current = true;
        setRunProgress(threadId, null);
      } else {
        setRunProgress(threadId, p);
      }
    };

    try {
      for await (const evt of runAgentTurn({
        context: toolContext,
        // Route every tool call through the in-page MCP server (the engine's
        // real protocol boundary) instead of invoking the catalog in-process.
        executeCall: mcpExecutor,
        history,
        userMessage: content,
        system,
        chat: async function* (req) {
          // The bridge routes to the selected model's provider — remote or
          // local — and forwards web-llm load progress. Selection is set from
          // the active connection when the bridge is built (see above).
          yield* bridge.streamChat({ ...req, signal: abort.signal }, reportLoad);
        },
        signal: abort.signal,
        // sendTools off (or a questions-only local model) = chat only:
        // maxRounds 0 is one generation with the assembled system, not the
        // wrap-up pass that would rebuild a default persona.
        toolMode: send.sendTools ? toolMode : 'off',
        maxRounds: !send.sendTools || toolMode === 'off' ? 0
          : toolMode === 'prompt' ? PROMPT_TOOL_MAX_CALLS
          : undefined,
        config,
        onMutation: proposal =>
          new Promise(resolve => {
            patchAssistant(t => {
              t.changes.push({ ...proposal });
              // The loop is now parked on the user's decision — mark the turn
              // so the UI stops the busy spinner and a reload can re-bind the
              // decision instead of losing the loop.
              t.state = 'needs-decision';
            });
            // The resolver lives in the REGISTRY, not a component ref: the
            // user can switch threads while this run is parked, and the card
            // must still resume the loop when they come back and click it.
            setRunPhase(threadId, 'parked');
            setRunDecision(threadId, proposal.callId, resolve);
          }),
      })) {
        switch (evt.type) {
          case 'text':
            setRunProgress(threadId, null);
            patchAssistant(t => { t.text += evt.text; });
            if (statsRef.current) {
              statsRef.current.chars += evt.text.length;
              statsRef.current.first ??= Date.now();
              const secs = (Date.now() - statsRef.current.first) / 1000;
              if (secs > 0.5) setTps(statsRef.current.chars / 4 / secs);
            }
            break;
          case 'reasoning':
            setRunProgress(threadId, null);
            patchAssistant(t => { t.reasoning = (t.reasoning ?? '') + evt.text; });
            break;
          case 'promote_reasoning':
            // Untagged CoT was shown live as thinking; this round is the
            // answer. Peel just this round's live tokens off the thinking
            // block (earlier tool-round thoughts stay) and put them in the
            // reply.
            patchAssistant(t => {
              if (t.reasoning) {
                const i = t.reasoning.lastIndexOf(evt.text);
                t.reasoning = i >= 0
                  ? (t.reasoning.slice(0, i) + t.reasoning.slice(i + evt.text.length)).trim() || undefined
                  : t.reasoning;
              }
              t.text += evt.text;
            });
            if (statsRef.current) {
              statsRef.current.chars += evt.text.length;
              statsRef.current.first ??= Date.now();
            }
            break;
          case 'tool_start':
            setRunProgress(threadId, null);
            patchAssistant(t => { t.tools.push({ id: evt.call.id, name: evt.call.name, state: 'running', args: evt.call.args }); });
            break;
          case 'tool_result':
            patchAssistant(t => {
              const tool = t.tools.find(x => x.id === evt.call.id);
              if (tool) {
                tool.state = evt.isError ? 'error' : 'done';
                tool.summary = evt.content.slice(0, 4000);
              }
            });
            break;
          case 'mutation':
            break; // proposal card already added by onMutation above
          case 'error':
            patchAssistant(t => { t.state = 'error'; t.text = t.text ? `${t.text}\n\n${evt.message}` : evt.message; });
            break;
          case 'done':
            patchAssistant(t => {
              if (evt.servedModel) t.servedModel = evt.servedModel;
              if (t.state !== 'error') {
                t.state = evt.stopReason === 'max_tokens'
                  ? 'truncated'
                  : evt.stopReason === 'aborted' ? 'aborted' : 'done';
              }
            });
            break;
        }
      }
    } catch (err) {
      patchAssistant(t => {
        t.state = 'error';
        t.text = err instanceof Error ? err.message : String(err);
      });
    } finally {
      patchAssistant(t => {
        // Only flip a turn that's still ACTIVELY working. A 'needs-decision'
        // turn is parked on an approval card (the loop's promise is pending) —
        // leave it paused; deciding the card resumes it. A 'streaming' turn
        // here means the generator ended without a 'done' (usually an abort).
        if (t.state === 'streaming') t.state = abort.signal.aborted ? 'aborted' : 'done';
      });
      setRunProgress(threadId, null);
      // The run is over (or parked waiting on a decision) — the registry
      // record must go so the lists stop spinning and the thread can be
      // deleted. A PARKED run: the turn state says 'needs-decision', the
      // resolver is dead (the loop generator returned), and the resume path
      // below (decideChange's no-live-loop fallback) starts a NEW run on
      // decision. So ending the registry record here is correct for both.
      endRun(threadId);
      // Turn fully over (reply persisted, run unregistered) — NOW it's safe
      // to honor any approved propose_navigate. Last queued destination
      // wins: mid-turn re-proposals mean the user's real destination was the
      // later one, and routing through both would double-jump. A run that
      // finished in the BACKGROUND never navigates — yanking the user off
      // whatever they're reading to serve a chat they left is hostile; the
      // route is only honored if this chat is still the one on screen.
      if (pendingNavigation.current.length > 0 && getChats().activeThreadId === threadId) {
        const target = pendingNavigation.current[pendingNavigation.current.length - 1];
        pendingNavigation.current = [];
        onNavigate?.(target);
      }
    }

    // Write (or extend) the running digest after a compacted turn, so the next
    // request carries a real summary rather than the placeholder. Fire-and-
    // forget: it must not block the reply, and a failure just means the next
    // compaction reuses the prior digest.
    if (compaction.compacted && compaction.excerptToDigest) {
      void digestHistory(bridge, compaction.excerptToDigest, abort)
        .then(digest => { if (digest) patchThread({ contextSummary: digest }); })
        .catch(() => { /* keep the prior digest */ });
    }
  };

  const decideChange = (change: PendingChange, approved: boolean) => {
    patchTurns(prev => prev.map(t => ({
      ...t,
      changes: t.changes.map(c => c.callId === change.callId ? { ...c, resolved: approved ? 'approved' : 'rejected' } : c),
    })));
    if (approved) {
      if (change.navigate != null) {
        // Page-navigation card: no plan change to checkpoint and nothing to
        // merge into inputs (the patch is empty by design). Queue the route —
        // the host unmounts this chat when the view leaves 'agent', so moving
        // now would abort the assistant's reply mid-stream (see
        // pendingNavigation). runTurn's finally navigates once the turn is over.
        pendingNavigation.current.push(change.navigate);
      } else {
        // Snapshot the plan BEFORE the patch lands — the automatic checkpoint
        // propose_revert rolls back to. The label is the card's, so the model
        // (and the user) can name the checkpoint later.
        recordCheckpoint(change.label ?? 'Plan change', inputs);
        if (change.createPartner) {
          onCreateSpousePlan?.(change.createPartner.name, change.createPartner.inputs);
        } else {
          // Revert patches carry encoded undefined-removals; decode them here so
          // the spread in App's onApply actually deletes the keys.
          const raw = changePatch(change);
          const decoded = change.revert ? decodeRevertPatch(raw) : raw;
          onApply(decoded as Partial<RetirementInputs>);
        }
      }
    }
    const live = takeRunDecision(threadId, change.callId);
    if (live) {
      // The loop that proposed this is parked on the promise — resolve it and
      // it continues on its own. Flip the turn back to 'streaming' so the state
      // machine resumes correctly: without this it stays 'needs-decision' with
      // all changes resolved, which the UI reads as "stuck waiting for you" and
      // shows the regenerate banner even though the reply is live again.
      patchTurns(prev => prev.map(t => (t.changes.some(c => c.callId === change.callId) && t.state === 'needs-decision'
        ? { ...t, state: 'streaming' }
        : t)));
      // The run leaves 'parked' and goes back to actively streaming.
      setRunPhase(threadId, 'streaming');
      live({ approved });
      return;
    }
    // No live loop (page reloaded, the turn was cancelled while parked, or
    // the run's finally already ended the registry record): resume the paused
    // turn with the decision so the assistant acknowledges it instead of the
    // card just going quiet.
    const turn = turns.find(t => t.changes.some(c => c.callId === change.callId));
    if (turn && !running) {
      void runTurn(
        turns,
        approved
          ? `I accepted the change you proposed (${change.label ?? 'plan update'}). Continue.`
          : `I declined the change you proposed (${change.label ?? 'plan update'}). Don't apply it — answer with that in mind.`,
        false,
        turn.id,
      );
    }
  };

  const send = async (message: AppendMessage) => {
    const textPart = message.content.find(p => p.type === 'text');
    const content = (textPart && 'text' in textPart ? textPart.text : '').trim();
    // Snap the new exchange into view, then let the user scroll freely.
    snapToBottomRef.current?.();
    await runTurn(turns, content, true);
  };

  /** Regenerate: drop every turn after the user message that preceded the
   *  assistant reply, then re-run from that message. parentId is the id of
   *  that user turn (null only for a leading assistant message — regenerate
   *  is offered on user-preceded replies only, so this won't fire).
   *
   *  The truncation is computed from CURRENT state (not the `turns` closure,
   *  which can be stale) and the kept list always includes that user message —
   *  an earlier version could drop it when the closure was out of date. */
  const reload = async (parentId: string | null) => {
    if (running || !parentId) return;
    const prior = reduceTurns(prev => {
      const idx = prev.findIndex(t => t.id === parentId);
      if (idx === -1 || prev[idx].role !== 'user') return { turns: prev, result: null };
      return { turns: prev.slice(0, idx + 1), result: prev.slice(0, idx + 1) };
    });
    if (!prior || prior.length === 0) return;
    await runTurn(prior, prior[prior.length - 1].text, false);
  };

  /** Remove one turn. Deleting an assistant turn keeps the conversation
   *  intact; deleting a user turn also drops the assistant reply that
   *  followed it, so the transcript stays a clean user→assistant pairing. */
  const deleteMessage = (messageId: string) => {
    if (running) return;
    patchTurns(prev => {
      const idx = prev.findIndex(t => t.id === messageId);
      if (idx === -1) return prev;
      const drop = new Set([messageId]);
      if (prev[idx].role === 'user' && prev[idx + 1]?.role === 'assistant') drop.add(prev[idx + 1].id);
      return prev.filter(t => !drop.has(t.id));
    });
  };

  const cancel = async () => { abortRun(threadId); };

  const runtime = useExternalStoreRuntime<Turn>({
    messages: turns,
    isRunning: running,
    isDisabled: !ready,
    convertMessage: turnToMessage,
    onNew: send,
    onCancel: cancel,
    onReload: reload,
    onDelete: deleteMessage,
    // The runtime rewrites the list itself on some flows (e.g. cancel after
    // send); hand the rewrite straight back into the chat store.
    setMessages: next => patchTurns(() => next.map(t => ({ ...t }))),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex flex-col h-full">
        {/* Thread */}
        <ThreadPrimitive.Root className="flex-1 flex flex-col min-h-0 border border-slate-200 bg-white">
          {/* All four auto-scroll triggers OFF. The defaults re-pin to the
              bottom on content growth (autoScroll), on run start, on
              initialize, and on the store's selectionChanged event — and in an
              external-store runtime that event fires on every streaming update,
              so scrolling back up during a reply kept getting yanked to the
              bottom. With them off the viewport is a plain scroller; we snap
              to the latest reply only when the USER sends a message (see
              SnapToBottomOnSend), and offer a ScrollToBottom button for the
              trip back down after reading history. */}
          <ThreadPrimitive.Viewport
            autoScroll={false}
            scrollToBottomOnRunStart={false}
            scrollToBottomOnInitialize={false}
            scrollToBottomOnThreadSwitch={false}
            className="flex-1 overflow-y-auto p-3 space-y-3"
          >
            <ThreadPrimitive.Empty>
              <EmptyThread />
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages>
              {({ message }) => {
                const turn = message.metadata?.custom?.turn as Turn | undefined;
                if (message.role === 'user') {
                  return (
                    <div className="group flex justify-end items-start gap-1">
                      <div className="flex flex-col gap-0.5 pt-1.5">
                        {/* A trailing user message with no reply yet (e.g. after
                            deleting the assistant turns) gets a way to generate
                            one — otherwise there's nothing to regenerate and
                            nothing to send. */}
                        {message.isLast && !running && (
                          <MessageActionButton onClick={() => void reload(message.id)} title={t('assistant.generate')}>
                            <Bot size={12} />
                          </MessageActionButton>
                        )}
                        <DeleteButton running={running} onDelete={() => deleteMessage(message.id)} />
                      </div>
                      {/* Render the turn's own text rather than the converted
                          message part — the bubble must never depend on the
                          runtime's content conversion, so it can't vanish
                          while the assistant reply streams below it. */}
                      <div className="max-w-[85%] min-w-0 bg-slate-900 px-3 py-2 text-xs text-white whitespace-pre-wrap [overflow-wrap:anywhere]">
                        {turn?.text ?? <MessagePrimitive.Content />}
                      </div>
                    </div>
                  );
                }
                const streaming = turn?.state === 'streaming';
                // While the local model's weights load, the dedicated progress
                // bar below the messages owns the "busy" indication — the bubble
                // must NOT also show a "Thinking…" spinner, or the two stack.
                // Once loadProgress clears (load done / generation started) the
                // bubble takes over: spinner only until SOMETHING (prose or
                // chain-of-thought) arrives, then content. The spinner always
                // clears the moment there's anything to read.
                const thinking = !loadProgress && streaming && !turn?.text && !turn?.reasoning;
                // The model proposed a change and is parked on the Accept /
                // Decline card. NOT busy — the spinner and the ● bullet must
                // both clear while the card waits.
                const needsDecision = turn?.state === 'needs-decision';
                // A paused turn whose card is already answered (an abort landed
                // while it waited) — tell the user it's stuck, offer a way out.
                const stuckPaused = needsDecision && turn != null && turn.changes.every(c => c.resolved);
                // Render the turn's OWN text, never MessagePrimitive.Content:
                // the default renderer draws assistant-ui's ● in-progress
                // bullet for any running/empty message, which is exactly the
                // stray dot a tool-only or paused reply showed. Our text (or a
                // "working…" placeholder while tools run with no prose yet) is
                // always the right thing.
                //
                // ONE busy signal at a time: while chain-of-thought is streaming
                // the Reasoning block below already shows "Thinking…", so the
                // bubble must NOT also spin "Working…" — the two stacked labels
                // read as if two things are running at once. The bubble only
                // shows "Working…" for a tool-only reply with no reasoning yet.
                const working = !thinking && !turn?.reasoning && streaming && !turn?.text && (turn?.tools.length ?? 0) > 0;
                const showBubble = thinking || working || turn?.text || turn?.state === 'error';
                // A turn that RESUMED after a decision has resolved change cards
                // in its history plus NEW text streaming in. Render the resolved
                // cards ABOVE the new text so the continued answer appears after
                // them (chronological), not above them. On a first-pass turn the
                // cards are unresolved and stay in AssistantExtras below.
                const resumedWithCards = turn != null && turn.changes.some(c => c.resolved) && (streaming || turn.text.length > 0);
                const historicalCards = resumedWithCards ? turn.changes.filter(c => c.resolved) : [];
                return (
                  <div className="group flex justify-start items-start gap-1">
                    {/* Fixed 85% (not max-width): the column doesn't hug its
                        content, so a collapsed reasoning block or the
                        Thinking/Working placeholder keeps the same width a
                        full reply has — blocks never shrink to a pill. */}
                    <div className="w-[85%] min-w-0 space-y-2">
                      {historicalCards.map(change => (
                        <ChangeCard key={change.callId} change={change} onDecide={decideChange} />
                      ))}
                      {turn?.reasoning && (
                        // Reasoning sits ABOVE the answer (chronological: the
                        // model thought first). Keyed on the turn so each
                        // reply's block starts open while it streams and the
                        // user folds it once done. The spinner clears the
                        // moment the answer text arrives OR the turn pauses on
                        // an approval — not just when the whole turn ends.
                        <ReasoningBlock
                          key={turn.id}
                          reasoning={turn.reasoning}
                          streaming={streaming && !turn.text && !needsDecision}
                        />
                      )}
                      {showBubble && (
                        <div className="relative px-3 py-2 bg-slate-100 text-slate-800 text-xs leading-relaxed [overflow-wrap:anywhere]">
                          {/* Activity spinner in the bubble's top-right corner
                              while it's a placeholder (thinking / working) —
                              same treatment as the reasoning block. */}
                          {(thinking || working) && (
                            <Loader2 size={11} className="animate-spin absolute top-1.5 right-1.5 text-slate-400 pointer-events-none" />
                          )}
                          {thinking ? (
                            <span className="text-slate-400 italic">{t('assistant.thinkingEllipsis')}</span>
                          ) : working ? (
                            <span className="text-slate-400 italic">{t('assistant.working')}</span>
                          ) : (
                            // Assistant prose renders as markdown (headings,
                            // lists, tables, code fences) — parsed by `marked`
                            // and sanitized by DOMPurify (see lib/ai/markdown).
                            // User bubbles and reasoning stay plain text.
                            <Markdown text={turn?.text ?? ''} />
                          )}
                        </div>
                      )}
                      {stuckPaused && (
                        <div className="px-3 py-2 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] leading-snug">
                          {t('assistant.stuck')}
                        </div>
                      )}
                      {turn && (
                        <AssistantExtras turn={turn} onDecide={decideChange} tokensPerSecond={tps} hideResolvedCards={resumedWithCards} />
                      )}
                    </div>
                    {/* Actions show whenever the turn isn't actively streaming —
                        including a paused (needs-decision) turn, so a stuck one
                        can be regenerated or deleted. */}
                    {(!streaming || needsDecision) && (
                      <div className="flex flex-col gap-0.5 pt-1.5">
                        {turn && <ProvenanceButton asked={turn.askedModel} served={turn.servedModel} />}
                        {message.isLast && (
                          <MessageActionButton onClick={() => void reload(message.parentId)} title={t('assistant.regenerate')}>
                            <RotateCcw size={12} />
                          </MessageActionButton>
                        )}
                        <DeleteButton running={running} onDelete={() => deleteMessage(message.id)} />
                      </div>
                    )}
                  </div>
                );
              }}
            </ThreadPrimitive.Messages>
            {/* Registers the store's scrollToBottom with the page so send() can
                snap a fresh exchange into view (the one auto-jump we keep now
                that the library's scroll triggers are off), and shows a small
                "back to latest" cue ONLY when scrolled well up. Built by hand
                rather than ThreadPrimitive.ScrollToBottom because the store's
                isAtBottom flag is only maintained by the auto-scroll hook we
                disabled — it would never flip, so the library button never
                appeared. */}
            <ScrollControls register={snapToBottomRef} />
            {running && loadProgress && (
              <div className="max-w-md">
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                  <Loader2 size={13} className="animate-spin" />
                  <span className="truncate">{loadProgress.text || t('assistant.loadingLocal')}</span>
                  {loadProgress.progress < 1 && (
                    <span className="ml-auto shrink-0">{Math.round(loadProgress.progress * 100)}%</span>
                  )}
                </div>
                <Progress pct={loadProgress.progress * 100} className="h-1.5" />
              </div>
            )}
          </ThreadPrimitive.Viewport>

          {/* Composer */}
          <div className="border-t border-slate-100 p-2.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
              <SystemNoteEditor
                note={thread.systemNote ?? ''}
                onChange={note => patchThread({ systemNote: note || undefined })}
              />
              <BasePromptEditor
                override={settings.systemPromptOverride ?? ''}
                onChange={text => onSettingsChange(prev => ({ ...prev, systemPromptOverride: text || undefined }))}
              />
              {connection && (
                <ContextMeter
                  used={contextUsed}
                  limit={effectiveContextLimit(connection)}
                  compacted={Boolean(thread.contextSummary)}
                />
              )}
            </div>
            <ComposerPrimitive.Root className="flex items-end gap-2">
              <ComposerPrimitive.Input
                placeholder={
                  !ready ? t('assistant.placeholderOffline')
                  : localEngineBusy ? t('assistant.placeholderBusy')
                  : t('assistant.placeholderAsk')}
                disabled={!ready || localEngineBusy}
                rows={2}
                className="flex-1 border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-slate-900 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400 resize-none"
              />
              {running ? (
                <ComposerPrimitive.Cancel asChild>
                  <button className="flex items-center gap-1.5 border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-900 hover:text-slate-900">
                    <X size={13} /> {t('assistant.stop')}
                  </button>
                </ComposerPrimitive.Cancel>
              ) : (
                <ComposerPrimitive.Send asChild>
                  <button
                    disabled={!ready}
                    className="flex items-center gap-1.5 bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
                  >
                    {t('assistant.send')}
                  </button>
                </ComposerPrimitive.Send>
              )}
            </ComposerPrimitive.Root>
          </div>
        </ThreadPrimitive.Root>
      </div>
    </AssistantRuntimeProvider>
  );
}

/** Lives inside the thread viewport so it can reach the viewport store. Three
 *  jobs: stick-to-bottom (while the user is at the bottom, content growth —
 *  streaming text, growing reasoning blocks — keeps the view pinned; scrolling
 *  up releases the pin, scrolling back re-pins it), hand the store's
 *  scrollToBottom up to the page via `register` (so send() can snap a new
 *  exchange into view AND re-pin), and render a small "back to latest" cue
 *  ONLY when the user has scrolled well up from the bottom. The threshold
 *  (SCROLL_UP_SHOW_PX) keeps it out of the way during normal reading. */
const SCROLL_UP_SHOW_PX = 240;
function ScrollControls({ register }: { register: React.MutableRefObject<(() => void) | null> }) {
  const { t } = useTranslation('pages');
  const store = useThreadViewportStore();
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    register.current = () => store.getState().scrollToBottom({ behavior: 'smooth' });
    return () => { register.current = null; };
  }, [store, register]);

  // Watch the scrollable element for stick-to-bottom AND the jump cue. The
  // element arrives after mount, so poll once via rAF rather than assume it's
  // there. The library's own auto-scroll hooks are off (see the Viewport
  // props): they re-pinned on every streaming update and blocked reading
  // history. This is the same pin/unpin contract as useStickToBottom, spelled
  // against the store's element because the hook's callback-ref attach doesn't
  // fit an element assistant-ui owns.
  useEffect(() => {
    let raf = 0;
    let cleanup: (() => void) | null = null;
    const attach = () => {
      const el = store.getState().element.viewport;
      if (!el) { raf = requestAnimationFrame(attach); return; }

      // Pin state lives in a ref (stream-frequency updates, no re-renders).
      // A "self-scroll" guard marks our own programmatic scrolls so they can't
      // read as user scrolls and unpin the view.
      let pinned = true;
      let selfScrolling = false;
      let selfScrollTimer = 0;
      const dist = () => el.scrollHeight - el.scrollTop - el.clientHeight;
      const snap = () => {
        selfScrolling = true;
        clearTimeout(selfScrollTimer);
        el.scrollTop = el.scrollHeight;
        selfScrollTimer = window.setTimeout(() => { selfScrolling = false; }, 150);
      };
      const update = () => {
        const d = dist();
        setShowJump(d > SCROLL_UP_SHOW_PX);
      };
      const onScroll = () => {
        if (selfScrolling) return;
        pinned = dist() <= NEAR_BOTTOM_PX;
        update();
      };
      // Content growth is what we follow: streaming text swaps and new blocks.
      // rAF-deferred for the same reason as useStickToBottom: observer
      // callbacks fire pre-layout and a same-tick scrollHeight is stale.
      const scheduleSnap = () => {
        requestAnimationFrame(() => { if (pinned) snap(); update(); });
      };
      const mo = new MutationObserver(scheduleSnap);
      mo.observe(el, { childList: true, subtree: true, characterData: true });
      const ro = new ResizeObserver(scheduleSnap);
      ro.observe(el);

      el.addEventListener('scroll', onScroll, { passive: true });
      cleanup = () => {
        mo.disconnect();
        ro.disconnect();
        el.removeEventListener('scroll', onScroll);
        clearTimeout(selfScrollTimer);
      };
    };
    attach();
    return () => { cancelAnimationFrame(raf); cleanup?.(); };
  }, [store]);

  if (!showJump) return null;
  return (
    <button
      onClick={() => store.getState().scrollToBottom({ behavior: 'smooth' })}
      className="self-center mb-1 flex items-center gap-1 px-2 py-0.5 bg-white/90 border border-slate-200 text-slate-400 text-[10px] hover:text-slate-600 hover:border-slate-300"
      title={t('assistant.latestTitle')}
    >
      <ChevronDown size={10} /> {t('assistant.latest')}
    </button>
  );
}

/**
 * Stick-to-bottom scrolling for one scroller element, with user override.
 *
 * While the user is "at the bottom" (within NEAR_BOTTOM_PX), any content
 * growth — streaming text, a growing reasoning block — keeps the view pinned
 * to the latest line. The moment they scroll up past that threshold the pin
 * releases and the view stops following; scrolling back to the bottom re-pins
 * it. "Scrolled up" always means the USER did it: the pin's own programmatic
 * scrolls are marked and never unpin themselves.
 *
 * Returns pin() to force the view back to the bottom (re-pins), and a ref to
 * hand the element to. Attach by passing the ref to the scroller.
 */
const NEAR_BOTTOM_PX = 48;
function useStickToBottom() {
  // Refs, not state: the scroll handler runs at stream frequency and a state
  // flip would re-render every line. Closures below read these live.
  const pinnedRef = useRef(true);
  const selfScrollingRef = useRef(false);
  const selfScrollTimer = useRef(0);
  // The detach fn for whichever element is currently attached (callback-ref
  // pattern: the scroller may mount/unmount as blocks expand/collapse), and
  // the element itself so pin() can reach it.
  const detachRef = useRef<(() => void) | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);

  const attach = (el: HTMLElement | null) => {
    detachRef.current?.();
    detachRef.current = null;
    elementRef.current = el;
    if (!el) return;
    // A freshly mounted scroller starts pinned (its content is at the top,
    // which IS the bottom when empty).
    pinnedRef.current = true;

    const distanceFromBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight;
    const snap = () => {
      selfScrollingRef.current = true;
      clearTimeout(selfScrollTimer.current);
      el.scrollTop = el.scrollHeight;
      // The instant scroll emits one scroll event; hold the guard until it has
      // passed so the pin never unpins itself.
      selfScrollTimer.current = window.setTimeout(() => { selfScrollingRef.current = false; }, 150);
    };

    const onScroll = () => {
      if (selfScrollingRef.current) return; // our own pin-scroll: never unpins
      pinnedRef.current = distanceFromBottom() <= NEAR_BOTTOM_PX;
    };

    // Content growth is what we follow: text updates, new blocks, everything.
    // MutationObserver callbacks run BEFORE layout settles, so scrollHeight
    // read in the same tick is stale — snap() would land short of the true
    // bottom and the pane visibly lags the stream. Requesting an animation
    // frame defers the scroll until after layout, landing exactly at the
    // bottom every time.
    const scheduleSnap = () => { if (pinnedRef.current) requestAnimationFrame(snap); };
    const ro = new ResizeObserver(scheduleSnap);
    ro.observe(el);
    const mo = new MutationObserver(scheduleSnap);
    mo.observe(el, { childList: true, subtree: true, characterData: true });

    el.addEventListener('scroll', onScroll, { passive: true });
    detachRef.current = () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener('scroll', onScroll);
      clearTimeout(selfScrollTimer.current);
    };
  };

  useEffect(() => () => detachRef.current?.(), []);

  const pin = () => {
    pinnedRef.current = true;
    const el = elementRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // Handed to the scroller as a callback ref so attach runs exactly when the
  // element enters/leaves the DOM. STABLE across renders (useCallback, no
  // deps): React re-invokes an inline callback ref on every re-render —
  // attach(null) + attach(el) — and attach resets the pin to true, which
  // silently re-pinned the pane after the user had scrolled away (streaming
  // re-renders every chunk). Stable identity means attach runs on real
  // mounts/unmounts only, so the pin survives re-renders.
  const elRef = useCallback((el: HTMLElement | null) => { attach(el); }, []);

  return { elRef, pin };
}

/** The model's chain-of-thought, shown collapsibly so it never clutters the
 *  answer. Open while it streams (so the thinking is visible live); the user
 *  folds it away once the answer arrives.
 *
 *  Header shows the static label ("Thinking" while streaming, "Reasoning"
 *  after) when EXPANDED; when COLLAPSED and streaming it appends the CURRENT
 *  last line (updating live — the lines scroll by). A spinner sits in the
 *  block's top-right corner either way. The body sticks to the bottom the
 *  same way the thread does. */
function ReasoningBlock({ reasoning, streaming }: { reasoning: string; streaming: boolean }) {
  const { t } = useTranslation('pages');
  const [open, setOpen] = useState(true);
  const { elRef, pin } = useStickToBottom();
  // The tail of the reasoning for the COLLAPSED header: the LAST ~90 chars of
  // the stream (word-boundary clipped), NOT the last line — prose-style
  // reasoners (OpenRouter z-ai/glm-*) emit whole paragraphs as one line, so a
  // last-LINE preview pins the paragraph's opening words for the entire stream
  // and the header reads frozen. The tail tracks the newest text either way:
  // line-per-step models (DeepSeek) behave as before, prose models scroll live.
  // Recomputed per render — reasoning streams in as text chunks, so this
  // updates live and the collapsed header reads like the lines are scrolling by.
  const lastLine = reasoningTail(reasoning);
  // Header text: EXPANDED shows the static label only (the body carries the
  // content); COLLAPSED appends the live last line while streaming.
  const headerText = streaming
    ? open ? t('assistant.thinking') : lastLine ? t('assistant.thinkingDash', { line: lastLine }) : t('assistant.thinkingEllipsis')
    : t('assistant.reasoning');
  // Re-pin ONLY on a real (re)open — a freshly expanded body starts at the
  // latest line. NOT on the streaming flip: that re-pins mid-conversation
  // after the user has deliberately scrolled up, yanking them back down.
  // Ongoing growth is pinned by the stick-to-bottom observer in the hook
  // (whose pin state now survives re-renders — see elRef there).
  useEffect(() => { if (open) pin(); }, [open]);
  return (
    <div className="relative min-w-0 border border-slate-200 bg-slate-50">
      {/* Activity spinner pinned to the block's top-right corner while the
          stream is live — visible whether the body is open or collapsed. */}
      {streaming && (
        <Loader2 size={10} className="animate-spin absolute top-1.5 right-1.5 text-slate-400 pointer-events-none" />
      )}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full px-2 py-1 pr-6 text-[10px] font-semibold text-slate-500 hover:text-slate-900 text-left"
      >
        {open ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
        <Brain size={11} className="shrink-0" />
        <span className="truncate flex-1" title={streaming ? lastLine : undefined}>
          {headerText}
        </span>
      </button>
      {open && (
        <div
          ref={elRef as unknown as React.Ref<HTMLDivElement>}
          className="px-2 pb-2 text-[11px] text-slate-600 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto italic [overflow-wrap:anywhere]"
        >
          {reasoning}
        </div>
      )}
    </div>
  );
}

/** Renders the parts assistant-ui doesn't model, read off the Turn carried in
 *  the message's metadata.custom: tool-activity chips, the confirm-before-
 *  apply change cards, and the measured reply speed. */
function AssistantExtras({ turn, onDecide, tokensPerSecond, hideResolvedCards = false }: {
  turn: Turn;
  onDecide: (change: PendingChange, approved: boolean) => void;
  tokensPerSecond: number | null;
  /** Resolved cards already rendered above the bubble (resumed turn) — skip
   *  them here so they don't appear twice. */
  hideResolvedCards?: boolean;
}) {
  const { t } = useTranslation('pages');
  const cards = hideResolvedCards ? turn.changes.filter(c => !c.resolved) : turn.changes;
  return (
    <>
      {turn.tools.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {turn.tools.map(tool => (
            <ToolChip key={tool.id} tool={tool} />
          ))}
        </div>
      )}
      {cards.map(change => (
        <ChangeCard key={change.callId} change={change} onDecide={onDecide} />
      ))}
      {turn.state === 'truncated' && (
        <div className="flex items-start gap-1.5 border-l-2 border-amber-500 px-2 py-1.5 text-[11px] leading-snug text-amber-800">
          <AlertTriangle size={11} className="mt-px shrink-0" />
          <span>
            {turn.text ? t('assistant.truncatedRetry') : t('assistant.truncatedNone')}
          </span>
        </div>
      )}
      {tokensPerSecond != null && turn.state !== 'streaming' && (
        <div className="text-[10px] text-slate-400">{t('assistant.toks', { n: tokensPerSecond.toFixed(1) })}</div>
      )}
    </>
  );
}

/** One tool call in the activity row: a compact chip that expands ON CLICK
 *  (not hover — hover expands are easy to trigger accidentally and impossible
 *  to keep open while moving to the text) into its inputs and output. Same
 *  collapsed size as the old plain chips; click again to fold it back. */
function ToolChip({ tool }: { tool: ToolActivity }) {
  const { t } = useTranslation('pages');
  const [open, setOpen] = useState(false);
  const hasDetail = tool.args != null || tool.summary != null;
  return (
    <div className="min-w-0">
      <button
        onClick={() => hasDetail && setOpen(o => !o)}
        disabled={!hasDetail}
        className={`flex items-center gap-1 border px-1.5 py-0.5 text-[10px] font-medium ${
          tool.state === 'running' ? 'border-slate-900 bg-slate-900 text-white'
          : tool.state === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700'
          : 'border-slate-200 bg-slate-100 text-slate-600'
        } ${hasDetail ? 'hover:border-slate-900 hover:text-slate-900 cursor-pointer' : 'cursor-default'}
        ${tool.state === 'running' ? 'hover:border-slate-700 hover:bg-slate-700 hover:text-white' : ''}`}
        title={hasDetail ? t('assistant.toolDetails') : undefined}
      >
        {tool.state === 'running' ? <Loader2 size={9} className="animate-spin" /> : <Wrench size={9} />}
        {tool.name}
        {hasDetail && (open ? <ChevronDown size={9} className="shrink-0" /> : <ChevronRight size={9} className="shrink-0" />)}
      </button>
      {open && (
        <div className="mt-1 border border-slate-200 bg-slate-50 p-2 text-[10px] leading-snug space-y-1.5 max-h-64 overflow-y-auto [overflow-wrap:anywhere]">
          {tool.args != null && (
            <div>
              <div className="font-semibold text-slate-500 uppercase tracking-wide text-[9px] mb-0.5">{t('assistant.input')}</div>
              <pre className="text-slate-700 whitespace-pre-wrap font-mono">{JSON.stringify(tool.args, null, 2)}</pre>
            </div>
          )}
          {tool.summary != null && (
            <div>
              <div className="font-semibold text-slate-500 uppercase tracking-wide text-[9px] mb-0.5">
                {tool.state === 'error' ? t('assistant.error') : t('assistant.output')}
              </div>
              <pre className={`whitespace-pre-wrap font-mono ${tool.state === 'error' ? 'text-rose-700' : 'text-slate-700'}`}>{tool.summary}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Per-chat standing instructions, appended to the built system prompt. A
 *  collapsed one-line button by default; opens into a small editor. */
function SystemNoteEditor({ note, onChange }: { note: string; onChange: (note: string) => void }) {
  const { t } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(note);
  if (!open) {
    return (
      <button
        onClick={() => { setDraft(note); setOpen(true); }}
        className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 hover:text-slate-900"
        title={t('assistant.customTitle')}
      >
        <Settings2 size={11} />
        {note.trim() ? t('assistant.customOn') : t('assistant.custom')}
      </button>
    );
  }
  return (
    <div className="mb-2 border border-slate-200 bg-slate-50 p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          {t('assistant.customHeading')}
        </span>
        <button
          onClick={() => setOpen(false)}
          className="text-slate-400 hover:text-slate-900"
          title={tc('close')}
        >
          <X size={12} />
        </button>
      </div>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        rows={2}
        placeholder={t('assistant.customPlaceholder')}
        className="w-full border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-700 focus:border-slate-900 focus:outline-none resize-none"
      />
      <div className="flex justify-end gap-2 mt-1">
        <button
          onClick={() => { onChange(draft.trim()); setOpen(false); }}
          className="bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-700"
        >
          {tc('save')}
        </button>
      </div>
    </div>
  );
}

/** Estimated context-window usage as a small bar. Amber near the compaction
 *  trigger, red past it; the tooltip explains the estimate and compaction. */
function ContextMeter({ used, limit, compacted }: { used: number; limit: number; compacted: boolean }) {
  const { t } = useTranslation('pages');
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const over = used > limit * COMPACT_AT;
  const hard = used > limit;
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
  const titleKey = hard ? 'assistant.ctxHard' : compacted ? 'assistant.ctxCompacted' : 'assistant.ctxOk';
  return (
    <span
      className="flex items-center gap-1.5 ml-auto"
      title={t(titleKey, { used: fmt(used), limit: fmt(limit), pct: Math.round(COMPACT_AT * 100) })}
    >
      <span className={`text-[10px] font-semibold ${hard ? 'text-rose-700' : over ? 'text-amber-700' : 'text-slate-400'}`}>
        ~{fmt(used)}/{fmt(limit)}
      </span>
      <Progress pct={pct} className={`w-16 h-1.5 ${hard ? '[&>div]:bg-rose-500' : over ? '[&>div]:bg-amber-500' : ''}`} />
    </span>
  );
}

/** The assistant's base persona prompt, editable across all chats. A collapsed
 *  one-line button by default; opens into an editor pre-filled with whatever
 *  is currently in effect (the user's override, or the built-in default they
 *  can use as a starting point). Clearing it restores the default. */
function BasePromptEditor({ override, onChange }: { override: string; onChange: (text: string) => void }) {
  const { t } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(override);
  const customized = override.trim().length > 0;
  if (!open) {
    return (
      <button
        onClick={() => { setDraft(customized ? override : DEFAULT_SYSTEM_PROMPT); setOpen(true); }}
        className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 hover:text-slate-900"
        title={t('assistant.basePromptTitle')}
      >
        <Bot size={11} />
        {customized ? t('assistant.basePromptCustom') : t('assistant.basePrompt')}
      </button>
    );
  }
  return (
    <div className="mb-2 w-full border border-slate-200 bg-slate-50 p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          {t('assistant.baseHeading')}
        </span>
        <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-900" title={tc('close')}>
          <X size={12} />
        </button>
      </div>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        rows={10}
        className="w-full border border-slate-300 bg-white px-2 py-1.5 font-mono text-[11px] text-slate-700 focus:border-slate-900 focus:outline-none resize-y"
      />
      <div className="flex items-center justify-between gap-2 mt-1">
        <button
          onClick={() => { setDraft(DEFAULT_SYSTEM_PROMPT); }}
          className="text-[10px] font-semibold text-slate-400 hover:text-slate-900"
          title={t('assistant.resetDefaultTitle')}
        >
          {t('assistant.resetDefault')}
        </button>
        <div className="flex gap-2">
          {customized && (
            <button
              onClick={() => { onChange(''); setOpen(false); }}
              className="border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-slate-900 hover:text-slate-900"
              title={t('assistant.useDefaultTitle')}
            >
              {t('assistant.useDefault')}
            </button>
          )}
          <button
            onClick={() => { onChange(draft.trim() === DEFAULT_SYSTEM_PROMPT.trim() ? '' : draft.trim()); setOpen(false); }}
            className="bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-700"
          >
            {tc('save')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Small hover-revealed button next to a bubble. */
function MessageActionButton({ onClick, title, children }: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900 opacity-0 group-hover:opacity-100 transition-opacity"
    >
      {children}
    </button>
  );
}

/** Per-reply who-answered icon. OpenRouter's free router hides the real model
 *  unless we stash the served id from the stream. Always visible (not hover-only)
 *  so the user can see it without hunting. */
function ProvenanceButton({ asked, served }: { asked?: string; served?: string }) {
  const { t } = useTranslation('pages');
  const line = provenanceLine(asked, served);
  if (!line) return null;
  const routed = Boolean(asked && served && asked !== served);
  const title = routed
    ? t('assistant.askedServed', { asked, served })
    : t('assistant.answeredBy', { line });
  return (
    <button
      type="button"
      title={title}
      className="p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
      aria-label={title}
    >
      <Info size={12} />
    </button>
  );
}

/** Per-message delete; hidden while a reply is streaming. */
function DeleteButton({ running, onDelete }: { running: boolean; onDelete: () => void }) {
  const { t } = useTranslation('pages');
  if (running) return null;
  return (
    <MessageActionButton onClick={onDelete} title={t('assistant.deleteMsg')}>
      <Trash2 size={12} />
    </MessageActionButton>
  );
}

/** A proposed edit to the plan. Nothing is applied until the user clicks
 *  Accept — the model can only ever propose. */
function ChangeCard({ change, onDecide }: {
  change: PendingChange;
  onDecide: (change: PendingChange, approved: boolean) => void;
}) {
  const { t } = useTranslation('pages');
  return (
    <div className="min-w-0 border border-slate-300 bg-white p-2.5 text-xs">
      <div className="mb-1 font-semibold text-slate-900">{change.label ?? (change.field ? t('assistant.setField', { field: change.field }) : t('assistant.proposed'))}</div>
      {change.rationale && <div className="mb-1 text-slate-500 [overflow-wrap:anywhere]">{change.rationale}</div>}
      <div className="mb-2 space-y-0.5 text-slate-600 [overflow-wrap:anywhere]">
        <PreviewLines preview={change.preview} />
      </div>
      {change.resolved ? (
        <div className={`flex items-center gap-1 font-semibold ${change.resolved === 'approved' ? 'text-blue-700' : 'text-slate-400'}`}>
          {change.resolved === 'approved' ? <Check size={12} /> : <X size={12} />}
          {change.resolved === 'approved' ? t('assistant.applied') : t('assistant.declined')}
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => onDecide(change, true)}
            className="flex items-center gap-1 bg-slate-900 px-2.5 py-1 font-semibold text-white hover:bg-slate-700"
          >
            <Check size={12} /> {t('assistant.accept')}
          </button>
          <button
            onClick={() => onDecide(change, false)}
            className="flex items-center gap-1 border border-slate-300 px-2.5 py-1 font-semibold text-slate-600 hover:border-slate-900 hover:text-slate-900"
          >
            <X size={12} /> {t('assistant.decline')}
          </button>
        </div>
      )}
    </div>
  );
}

function fmtValue(v: unknown, locale: string): string {
  if (v == null) return '—';
  if (typeof v === 'number') return v.toLocaleString(locale);
  return String(v);
}

/** Render a proposal's preview: a single from→to line for scalar fields, or a
 *  compact line per entry for structural proposals (objects/arrays are
 *  JSON-compacted so a spouse/reverse-mortgage block stays readable). */
function PreviewLines({ preview }: { preview: Record<string, unknown> }) {
  const { t } = useTranslation('pages');
  const { locale } = useAppLocale();
  const entries = Object.entries(preview);
  const isFromTo = (v: unknown): v is { from: unknown; to: unknown } =>
    !!v && typeof v === 'object' && 'from' in (v as object) && 'to' in (v as object);
  const compactVal = (v: unknown): string =>
    typeof v === 'object' && v !== null ? JSON.stringify(v) : fmtValue(v, locale);
  return (
    <>
      {entries.map(([key, value]) => {
        if (isFromTo(value)) {
          return (
            <div key={key}>
              {key}: <span className="line-through">{fmtValue(value.from, locale)}</span>{' '}
              → <span className="font-semibold">{fmtValue(value.to, locale)}</span>
            </div>
          );
        }
        if (key === 'add') {
          return <div key={key}>{t('assistant.adds', { value: compactVal(value) })}</div>;
        }
        if (Array.isArray(value)) {
          return <div key={key}>{key}: <span className="font-semibold">{value.join('; ')}</span></div>;
        }
        return <div key={key}>{key}: <span className="font-semibold">{compactVal(value)}</span></div>;
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

function EmptyChatState({ onNew }: { onNew: () => void }) {
  const { t } = useTranslation('pages');
  return (
    <div className="h-full flex flex-col items-center justify-center border border-slate-200 bg-white py-12 text-center">
      <Bot size={32} className="mb-3 text-slate-300" />
      <p className="mb-1 text-sm font-medium text-slate-700">{t('assistant.emptyTitle')}</p>
      <p className="mb-4 max-w-md text-xs text-slate-500">
        {t('assistant.emptyLead')}
      </p>
      <button
        onClick={onNew}
        className="flex items-center gap-1.5 bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
      >
        <Plus size={13} /> {t('assistant.newChat')}
      </button>
    </div>
  );
}

function EmptyThread() {
  const { t } = useTranslation('pages');
  return (
    <div className="h-full flex flex-col items-center justify-center py-8 text-center">
      <Bot size={28} className="mb-3 text-slate-300" />
      <p className="text-xs text-slate-500 max-w-md">
        {t('assistant.emptyThread')}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Offline assistant: no ready connection. The old "Tune inputs" and "Ask a
// question" flows — copy a self-contained prompt to any AI, and (for tuning)
// paste the JSON reply back through the local validation/apply path.
// ---------------------------------------------------------------------------

function OfflineAssistant({ inputs, config, hasConnections, onApply, onConnect, compact = false }: {
  inputs: RetirementInputs;
  config: AppConfig;
  hasConnections: boolean;
  onApply: (patch: Partial<RetirementInputs>) => void;
  onConnect: () => void;
  /** Docked rail: keep the empty state to a short stack, not a two-column copy-prompt desk. */
  compact?: boolean;
}) {
  const { t } = useTranslation('pages');
  const [tab, setTab] = useState<'ask' | 'tune'>('ask');
  const [showCopy, setShowCopy] = useState(!compact);
  const results = useMemo(() => calculateHousehold(inputs, config), [inputs, config]);

  return (
    <div className="h-full overflow-y-auto border border-slate-200 bg-white">
      <div className={`border-b border-slate-100 ${compact ? 'space-y-2 p-3' : 'flex flex-wrap items-center gap-3 p-4'}`}>
        <div className={compact ? '' : 'min-w-52 flex-1'}>
          <p className={`font-semibold text-slate-800 ${compact ? 'text-xs' : 'text-sm'}`}>{t('assistant.noModel')}</p>
          <p className={`mt-0.5 leading-snug text-slate-500 ${compact ? 'text-[10.5px]' : 'text-[11px]'}`}>
            {compact ? t('assistant.offlineCompact') : t('assistant.offlineLead')}
          </p>
        </div>
        <button
          onClick={onConnect}
          className={`flex items-center gap-1.5 bg-slate-900 text-xs font-semibold text-white hover:bg-slate-700 ${compact ? 'w-full justify-center px-3 py-2' : 'shrink-0 px-3 py-1.5'}`}
        >
          <Download size={13} /> {hasConnections ? t('assistant.setupConn') : t('assistant.loadModel')}
        </button>
        {compact && (
          <button
            type="button"
            onClick={() => setShowCopy(v => !v)}
            className="w-full border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:border-slate-900 hover:text-slate-900"
          >
            {showCopy ? t('assistant.hideCopy') : t('assistant.copyInstead')}
          </button>
        )}
      </div>

      {showCopy && (
        <>
          <div className={`flex gap-4 ${compact ? 'px-3 pt-2' : 'px-4 pt-3'}`}>
            {(['ask', 'tune'] as const).map(tabKey => (
              <button
                key={tabKey}
                onClick={() => setTab(tabKey)}
                className={`-mb-px border-b-2 px-1 pb-2 text-xs font-medium ${tab === tabKey
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-900'}`}
              >
                {tabKey === 'ask' ? t('assistant.askQuestion') : t('assistant.tuneInputs')}
              </button>
            ))}
          </div>

          {tab === 'ask' ? (
            <AskQuestionPanel inputs={inputs} results={results} compact={compact} />
          ) : (
            <TuneInputsPanel inputs={inputs} onApply={onApply} />
          )}
        </>
      )}
    </div>
  );
}

/** Copy a question prompt (plan + computed results + question) to paste into
 *  any external AI. Nothing is ingested back. */
function AskQuestionPanel({ inputs, results, compact = false }: {
  inputs: RetirementInputs;
  results: ReturnType<typeof calculateHousehold>;
  compact?: boolean;
}) {
  const { t } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const { locale } = useAppLocale();
  const [presetId, setPresetId] = useState(QA_PRESETS[0].id);
  const [customQuestion, setCustomQuestion] = useState('');
  const [copied, setCopied] = useState(false);
  const preset = QA_PRESETS.find(p => p.id === presetId) ?? QA_PRESETS[0];
  const prompt = useMemo(
    () => buildQAPrompt(inputs, { results }, preset, customQuestion),
    [inputs, results, preset, customQuestion],
  );

  const copy = () => {
    navigator.clipboard.writeText(prompt).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => window.prompt('Copy this prompt:', prompt),
    );
  };

  const presetTitle = t(`assistant.qa.${preset.id}.title`);

  return (
    <div className={`p-4 grid grid-cols-1 gap-4 ${compact ? '' : 'sm:grid-cols-[240px_1fr]'}`}>
      <div className="space-y-1">
        {QA_PRESETS.map(p => (
          <button
            key={p.id}
            onClick={() => setPresetId(p.id)}
            className={`w-full border px-2.5 py-1.5 text-left text-xs ${presetId === p.id
              ? 'border-slate-900 bg-slate-50 font-medium text-slate-900'
              : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900'}`}
          >
            <div className="font-medium">{t(`assistant.qa.${p.id}.title`)}</div>
            <div className={`text-[10px] ${presetId === p.id ? 'text-slate-600' : 'text-slate-400'}`}>{t(`assistant.qa.${p.id}.blurb`)}</div>
          </button>
        ))}
        <div>
          <label className="mb-1 mt-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            {t('assistant.ownQuestion')}
          </label>
          <textarea
            value={customQuestion}
            onChange={e => setCustomQuestion(e.target.value)}
            placeholder={t('assistant.customQPlaceholder')}
            className="h-16 w-full border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-700 focus:border-slate-900 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-semibold text-slate-800">
          {customQuestion.trim() ? t('assistant.promptCustom') : t('assistant.promptPreset', { title: presetTitle })}
        </div>
        <p className="mb-2 text-[11px] leading-snug text-slate-500">
          {t('assistant.askLead')}
        </p>
        <textarea
          readOnly
          value={prompt}
          onFocus={e => e.target.select()}
          className="h-64 w-full border border-slate-300 bg-slate-50 px-2.5 py-2 font-mono text-[10px] text-slate-600 focus:outline-none"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={copy}
            className="flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? tc('copied') : t('assistant.copyPrompt')}
          </button>
          <span className="num text-[10px] text-slate-400">{t('assistant.tokens', { n: Math.round(prompt.length / 4).toLocaleString(locale) })}</span>
        </div>
      </div>
    </div>
  );
}

/** Copy a tuning prompt, then paste the AI's JSON reply back through the local
 *  validation/apply path (the "local update api"): field-by-field checks, then
 *  write the patch to the plan. */
function TuneInputsPanel({ inputs, onApply }: {
  inputs: RetirementInputs;
  onApply: (patch: Partial<RetirementInputs>) => void;
}) {
  const { t } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const [copied, setCopied] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [ingest, setIngest] = useState<ReturnType<typeof parseAgentResult> | null>(null);
  const prompt = useMemo(() => buildAgentPrompt(inputs), [inputs]);

  const copy = () => {
    navigator.clipboard.writeText(prompt).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => window.prompt('Copy this prompt:', prompt),
    );
  };

  const apply = () => {
    if (ingest?.ok && ingest.patch) {
      onApply(ingest.patch);
      setPasteText('');
      setIngest(null);
    }
  };

  return (
    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <div className="mb-1.5 text-xs font-semibold text-slate-800">{t('assistant.copyPromptTitle')}</div>
        <p className="mb-2 text-[11px] leading-snug text-slate-500">
          {t('assistant.tuneLead')}
        </p>
        <textarea
          readOnly
          value={prompt}
          onFocus={e => e.target.select()}
          className="h-56 w-full border border-slate-300 bg-slate-50 px-2.5 py-2 font-mono text-[10px] text-slate-600 focus:outline-none"
        />
        <button
          onClick={copy}
          className="mt-2 flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? tc('copied') : t('assistant.copyPrompt')}
        </button>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-semibold text-slate-800">{t('assistant.pasteJson')}</div>
        <p className="mb-2 text-[11px] leading-snug text-slate-500">
          {t('assistant.pasteLead')}
        </p>
        <textarea
          value={pasteText}
          onChange={e => { setPasteText(e.target.value); setIngest(null); }}
          placeholder='{"cppStartAge":70, "oasStartAge":70, ...}'
          className="h-56 w-full border border-slate-300 bg-white px-2.5 py-2 font-mono text-[10px] text-slate-700 focus:border-slate-900 focus:outline-none"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => setIngest(parseAgentResult(pasteText, inputs))}
            disabled={!pasteText.trim()}
            className="flex items-center gap-1.5 border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-900 hover:text-slate-900 disabled:opacity-40"
          >
            <ClipboardPaste size={13} /> {t('assistant.validate')}
          </button>
          {ingest?.ok && (
            <button
              onClick={apply}
              className="flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
            >
              <Check size={13} /> {t('assistant.applyN', { count: ingest.applied.length })}
            </button>
          )}
        </div>

        {ingest && (
          <div className="mt-3 text-[11px] leading-snug space-y-1">
            {ingest.error && <div className="text-rose-700">✕ {ingest.error}</div>}
            {ingest.applied.length > 0 && (
              <div className="text-blue-700">✓ {t('assistant.willApply', { list: ingest.applied.join('; ') })}</div>
            )}
            {ingest.warnings.map((w, i) => (
              <div key={i} className="text-amber-700">⚠ {w}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
