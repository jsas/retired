// Assistant page: a list of named chats on the left, the active conversation
// on the right. Chats are remembered locally (chatStore) so the user can come
// back to one and continue it. The conversation UI is assistant-ui's
// Thread/Composer driven by our own agent loop via an external-store runtime —
// the loop, tools, prompt protocol for local models, and the confirm-before-
// apply change cards are unchanged; assistant-ui owns streaming display,
// auto-scroll, and the composer. Connecting/switching models lives on the
// separate Connections page.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import {
  Bot, Plus, Trash2, Lock, Cloud, MessageSquare, Check, X, Loader2, Wrench,
  Copy, ClipboardPaste, Download, RotateCcw, Settings2, Brain, ChevronDown,
  ChevronRight, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import type { RetirementInputs } from '../lib/retirementEngine';
import type { AppConfig } from '../lib/appConfig';
import {
  connectionReady, loadAiSettings, saveAiSettings, type AiConnection, type AiSettings,
} from '../lib/aiSettings';
import { buildAgentPrompt, parseAgentResult } from '../lib/agentIngest';
import { QA_PRESETS, buildQAPrompt } from '../lib/agentQA';
import { streamChat, type ChatMessage } from '../lib/ai/providers';
import { buildSystemPrompt, DEFAULT_SYSTEM_PROMPT, runAgentTurn, type MutationProposal } from '../lib/ai/agentLoop';
import {
  defaultContextSize, estimateTokens, planCompaction, summaryNote, COMPACT_AT,
} from '../lib/ai/context';
import { buildPromptToolInstructions, PROMPT_TOOL_MAX_CALLS } from '../lib/ai/promptTools';
import { toolSpecs } from '../lib/ai/tools';
import type { ToolContext } from '../lib/ai/tools';
import { buildPlanDigest } from '../lib/agentQA';
import { calculateHousehold } from '../lib/retirementEngine';
import {
  loadChats, saveChats, newThread, titleFromFirstMessage,
  type ChatThread,
} from '../lib/ai/chatStore';

interface AgentPageProps {
  inputs: RetirementInputs;
  config: AppConfig;
  scenarioName: string;
  scenarioList: Array<{ id: string; name: string }>;
  onApply: (patch: Partial<RetirementInputs>) => void;
  onOpenConnections: () => void;
}

// ---------------------------------------------------------------------------
// Turn model (one chat bubble's worth of state; persisted via chatStore)
// ---------------------------------------------------------------------------

interface ToolActivity {
  id: string;
  name: string;
  state: 'running' | 'done' | 'error';
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
  state?: 'streaming' | 'done' | 'aborted' | 'truncated' | 'error';
}

let turnSeq = 0;
const newTurnId = () => `turn-${++turnSeq}`;

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
  connection: AiConnection,
  isLocal: boolean,
  excerpt: string,
  abort: AbortController,
): Promise<string> {
  const req = {
    system:
      'You condense a retirement-planning conversation into a running digest for the model ' +
      'that continues it. Preserve every concrete fact (ages, balances, benefit amounts, ' +
      'start ages, decisions made, changes the user approved or rejected) and drop the prose. ' +
      'Reply with ONLY the digest — bullet points, under 200 words.',
    messages: [{ role: 'user' as const, content: excerpt }],
    tools: [],
    maxTokens: 400,
    signal: abort.signal,
  };
  let text = '';
  const stream = isLocal
    ? (await import('../lib/ai/webLlmProvider')).streamWebLlm(connection, req)
    : streamChat(connection, req);
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
    : t.state === 'error' ? ({ type: 'incomplete', reason: 'error' } as const)
    : t.state === 'aborted' ? ({ type: 'incomplete', reason: 'cancelled' } as const)
    : t.state === 'truncated' ? ({ type: 'incomplete', reason: 'length' } as const)
    : ({ type: 'complete', reason: 'stop' } as const);
  return { ...base, status };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AgentPage({ inputs, config, scenarioName, scenarioList, onApply, onOpenConnections }: AgentPageProps) {
  const [settings, setSettings] = useState<AiSettings>(loadAiSettings);
  const [chatState, setChatState] = useState(() => loadChats());
  // Chat list: pinned open (default) or collapsed to a slim strip. Session-
  // only — not worth persisting.
  const [chatsPinned, setChatsPinned] = useState(true);
  useEffect(() => { saveAiSettings(settings); }, [settings]);
  useEffect(() => { saveChats(chatState); }, [chatState]);

  const connection = settings.connections.find(c => c.id === settings.activeConnectionId) ?? null;
  const ready = connection != null && connectionReady(connection);
  const isLocal = connection?.provider === 'webllm';
  const toolMode: 'native' | 'prompt' = isLocal ? 'prompt' : 'native';

  // The active thread object (creating one lazily if the store is empty).
  const activeThread: ChatThread | null =
    chatState.threads.find(t => t.id === chatState.activeThreadId) ?? null;

  const setActiveThread = (id: string | null) =>
    setChatState(prev => ({ ...prev, activeThreadId: id }));

  const newChat = () => {
    const t = newThread(scenarioName, Date.now());
    setChatState(prev => ({ threads: [t, ...prev.threads], activeThreadId: t.id }));
  };

  const deleteChat = (id: string) => {
    setChatState(prev => {
      const threads = prev.threads.filter(t => t.id !== id);
      return {
        threads,
        activeThreadId: prev.activeThreadId === id ? (threads[0]?.id ?? null) : prev.activeThreadId,
      };
    });
  };

  /** Switch the active connection (and implicitly its model) from the header
   *  picker. */
  const chooseConnection = (id: string) =>
    setSettings(prev => ({ ...prev, activeConnectionId: id }));

  /** Patch the active thread's turns (and bump updatedAt / title). */
  const patchTurns = (mutate: (turns: Turn[]) => Turn[]) => {
    setChatState(prev => {
      const id = prev.activeThreadId;
      if (!id) return prev;
      return {
        ...prev,
        threads: prev.threads.map(t => {
          if (t.id !== id) return t;
          const turns = mutate(t.turns as Turn[]);
          // Title the chat from the first user message once it exists.
          const firstUser = turns.find(x => x.role === 'user');
          const title = t.title === 'New chat' && firstUser ? titleFromFirstMessage(firstUser.text) : t.title;
          return { ...t, turns, title, updatedAt: Date.now() };
        }),
      };
    });
  };

  /** Patch non-turn fields of the active thread (e.g. its system note). */
  const patchThread = (patch: Partial<ChatThread>) => {
    setChatState(prev => {
      const id = prev.activeThreadId;
      if (!id) return prev;
      return {
        ...prev,
        threads: prev.threads.map(t => (t.id === id ? { ...t, ...patch } : t)),
      };
    });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-11rem)] min-h-[30rem]">
      {/* Header: title + model picker + connections link. Lives on the page so
          it's visible in chat, empty, and copy/paste modes alike. */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Bot size={16} className="text-violet-600" />
        <h2 className="text-sm font-bold text-slate-900">AI Assistant</h2>
        <div className="flex items-center gap-2 ml-auto">
          <ModelPicker
            settings={settings}
            activeId={settings.activeConnectionId}
            onChoose={chooseConnection}
            onLoadModel={onOpenConnections}
          />
          {connection && (
            <span
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold ${
                isLocal ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
              }`}
              title={isLocal
                ? 'Runs entirely on this device: no account, no key, nothing you type leaves the computer.'
                : 'Chats go directly from this browser to the provider; the key is stored only in this browser.'}
            >
              {isLocal ? <Lock size={11} /> : <Cloud size={11} />}
              {isLocal ? 'On this device · private' : 'Direct browser → provider'}
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-3 flex-1 min-h-0">
        {/* ---- Chat list: pinned open, or collapsed to a slim strip ---- */}
        {chatsPinned ? (
          <aside className="w-52 shrink-0 flex flex-col border border-slate-200 rounded bg-white">
            <div className="flex items-center justify-between px-2.5 py-2 border-b border-slate-100">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Chats</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={newChat}
                  className="flex items-center gap-1 text-[11px] text-violet-700 hover:text-violet-900 font-semibold"
                  title="Start a new chat"
                >
                  <Plus size={13} /> New
                </button>
                <button
                  onClick={() => setChatsPinned(false)}
                  className="text-slate-400 hover:text-slate-700"
                  title="Collapse the chat list to the left"
                >
                  <ChevronsLeft size={13} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
              {chatState.threads.length === 0 && (
                <p className="text-[11px] text-slate-400 px-1.5 py-2">No chats yet. Start a new one.</p>
              )}
              {chatState.threads.map(t => (
                <div
                  key={t.id}
                  className={`group flex items-center gap-1.5 rounded px-2 py-1.5 cursor-pointer text-[11px] ${
                    t.id === chatState.activeThreadId ? 'bg-violet-100 text-violet-900' : 'hover:bg-slate-50 text-slate-700'
                  }`}
                  onClick={() => setActiveThread(t.id)}
                >
                  <MessageSquare size={12} className="shrink-0 text-slate-400" />
                  <span className="flex-1 min-w-0 truncate">{t.title}</span>
                  <button
                    onClick={e => { e.stopPropagation(); deleteChat(t.id); }}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-600 shrink-0"
                    title="Delete this chat"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </aside>
        ) : (
          <aside className="w-9 shrink-0 flex flex-col items-center gap-2 border border-slate-200 rounded bg-white py-2">
            <button
              onClick={() => setChatsPinned(true)}
              className="text-slate-400 hover:text-slate-700"
              title="Show the chat list"
            >
              <ChevronsRight size={14} />
            </button>
            <button
              onClick={newChat}
              className="text-violet-700 hover:text-violet-900"
              title="Start a new chat"
            >
              <Plus size={14} />
            </button>
            <div className="flex-1 overflow-y-auto flex flex-col items-center gap-1.5 w-full px-1">
              {chatState.threads.map(t => (
                <button
                  key={t.id}
                  onClick={() => { setActiveThread(t.id); setChatsPinned(true); }}
                  title={t.title}
                  className={`flex items-center justify-center w-6 h-6 rounded ${
                    t.id === chatState.activeThreadId ? 'bg-violet-100 text-violet-700' : 'text-slate-400 hover:bg-slate-50'
                  }`}
                >
                  <MessageSquare size={13} />
                </button>
              ))}
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
              settings={settings}
              onSettingsChange={setSettings}
              inputs={inputs}
              config={config}
              scenarioName={scenarioName}
              scenarioList={scenarioList}
              onApply={onApply}
              patchTurns={patchTurns}
              patchThread={patchThread}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Model picker in the header: every configured connection's model, plus a
 *  "Load model…" escape hatch that opens the Connections page. Choosing an
 *  entry makes that connection (and its model) active. */
function ModelPicker({ settings, activeId, onChoose, onLoadModel }: {
  settings: AiSettings;
  activeId: string | null;
  onChoose: (id: string) => void;
  onLoadModel: () => void;
}) {
  if (settings.connections.length === 0) {
    return (
      <button
        onClick={onLoadModel}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700"
      >
        <Download size={13} /> Load a model
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <select
        value={activeId ?? ''}
        onChange={e => {
          if (e.target.value === '__load__') onLoadModel();
          else if (e.target.value) onChoose(e.target.value);
        }}
        className="px-2 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 focus:outline-none focus:border-violet-500 max-w-56"
        title="Pick which model answers. Add or download models on the Connections page."
      >
        {settings.connections.map(c => (
          <option key={c.id} value={c.id}>
            {c.label || c.provider} · {c.model}
          </option>
        ))}
        <option value="__load__">Load a model…</option>
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One conversation (assistant-ui runtime around our agent loop)
// ---------------------------------------------------------------------------

function Conversation({ thread, ready, isLocal, toolMode, settings, onSettingsChange, inputs, config, scenarioName, scenarioList, onApply, patchTurns, patchThread }: {
  thread: ChatThread;
  ready: boolean;
  isLocal: boolean;
  toolMode: 'native' | 'prompt';
  settings: AiSettings;
  onSettingsChange: (mutate: (prev: AiSettings) => AiSettings) => void;
  inputs: RetirementInputs;
  config: AppConfig;
  scenarioName: string;
  scenarioList: Array<{ id: string; name: string }>;
  onApply: (patch: Partial<RetirementInputs>) => void;
  patchTurns: (mutate: (turns: Turn[]) => Turn[]) => void;
  patchThread: (patch: Partial<ChatThread>) => void;
}) {
  const turns = thread.turns as Turn[];
  const [running, setRunning] = useState(false);
  const [loadProgress, setLoadProgress] = useState<{ progress: number; text: string } | null>(null);
  // Speed of the current/last reply, measured while it streams. Tokens are
  // estimated from characters (~4 chars/token) since prompt-mode streams give
  // us no provider counts.
  const [tps, setTps] = useState<number | null>(null);
  const statsRef = useRef<{ start: number; first: number | null; chars: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const downloadDoneRef = useRef(false);
  const pendingDecisions = useRef(new Map<string, (d: { approved: boolean; note?: string }) => void>());

  // Cancel any in-flight request on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const toolContext: ToolContext = useMemo(() => ({
    inputs, config, scenarioName, scenarioList,
  }), [inputs, config, scenarioName, scenarioList]);

  const connection = settings.connections.find(c => c.id === settings.activeConnectionId) ?? null;

  // Estimated context usage for the meter. Mirror what runTurn actually sends:
  // prompt-mode (local) prepends the tool catalog AND the computed plan digest
  // to the system prompt — that's the bulk of a local model's small window, so
  // omitting it (as an earlier gauge did) read far too low. This runs the
  // engine once per render; cheap for a household plan, and it makes the meter
  // honest about what the local model must fit.
  const contextUsed = useMemo(() => {
    if (!connection) return 0;
    const basePrompt = settings.systemPromptOverride;
    const base = toolMode === 'prompt'
      ? buildSystemPrompt(scenarioName, { toolMode: 'prompt', basePrompt, config }) + '\n\n' +
        buildPromptToolInstructions(toolSpecs()) + '\n\n' +
        buildPlanDigest(inputs, { results: calculateHousehold(inputs, config) })
      : buildSystemPrompt(scenarioName, { basePrompt, config });
    const system = thread.systemNote?.trim() ? `${base}\n\n${thread.systemNote.trim()}` : base;
    const history = toHistory(turns);
    if (thread.contextSummary) {
      return estimateTokens(system, [{ role: 'user', content: summaryNote(thread.contextSummary) }, ...history]);
    }
    return estimateTokens(system, history);
  }, [connection, settings.systemPromptOverride, thread.systemNote, thread.contextSummary, turns, toolMode, scenarioName, inputs, config]);

  /**
   * Run one assistant turn: append (or replace) a streaming assistant bubble
   * and drive the agent loop against the given prior history. Shared by send
   * (new user message) and regenerate (re-run after an existing user message).
   */
  const runTurn = async (priorTurns: Turn[], content: string, appendUser: boolean) => {
    if (!content || running || !connection) return;
    setRunning(true);
    statsRef.current = { start: Date.now(), first: null, chars: 0 };
    setTps(null);

    const userTurn: Turn | null = appendUser
      ? { id: newTurnId(), role: 'user', text: content, tools: [], changes: [] }
      : null;
    const assistantTurn: Turn = { id: newTurnId(), role: 'assistant', text: '', tools: [], changes: [], state: 'streaming' };
    patchTurns(prev => userTurn ? [...prev, userTurn, assistantTurn] : [...prev, assistantTurn]);

    const abort = new AbortController();
    abortRef.current = abort;

    const patchAssistant = (mutate: (t: Turn) => void) => {
      patchTurns(prev => prev.map(t => (t.id === assistantTurn.id
        ? (() => { const c = { ...t, tools: [...t.tools], changes: [...t.changes] }; mutate(c); return c; })()
        : t)));
    };

    const basePrompt = settings.systemPromptOverride;
    const baseSystem = toolMode === 'prompt'
      ? buildSystemPrompt(scenarioName, { toolMode: 'prompt', basePrompt, config }) + '\n\n' +
        buildPromptToolInstructions(toolSpecs()) + '\n\n' +
        buildPlanDigest(inputs, { results: calculateHousehold(inputs, config) })
      : buildSystemPrompt(scenarioName, { basePrompt, config });
    // The chat's standing instructions go last so they read as the user's own
    // voice; they can steer tone/focus but the base prompt's rules come first.
    const system = thread.systemNote?.trim()
      ? `${baseSystem}\n\nAdditional instructions for this chat:\n${thread.systemNote.trim()}`
      : baseSystem;

    // Fit the conversation into the model's context window: when the estimated
    // usage crosses the trigger, the oldest turns are folded away and replaced
    // by the running digest. The transcript itself is never altered — only
    // what the provider sees. The digest is written by the model (below) the
    // first time turns are dropped; until then a placeholder note stands in.
    const contextSize = connection.contextSize ?? defaultContextSize(connection.provider);
    const fullHistory = toHistory(priorTurns);
    const compaction = planCompaction({
      system,
      messages: fullHistory,
      contextSize,
      priorSummary: thread.contextSummary ?? '',
    });
    const history = compaction.messages;
    if (compaction.compacted) {
      patchAssistant(t => { t.tools.push({ id: `compact-${Date.now().toString(36)}`, name: 'context compacted', state: 'done', summary: 'Older messages were summarized to fit the context window.' }); });
    }

    if (isLocal) {
      downloadDoneRef.current = false;
      setLoadProgress({ progress: 0, text: 'Preparing the local model…' });
    }
    const reportLoad = (p: { progress: number; text: string }) => {
      if (p.progress >= 1) {
        if (!downloadDoneRef.current) {
          downloadDoneRef.current = true;
          setLoadProgress({ progress: 1, text: 'Compiling the model for your GPU — this can take a minute…' });
        }
      } else {
        setLoadProgress(p);
      }
    };

    try {
      for await (const evt of runAgentTurn({
        context: toolContext,
        history,
        userMessage: content,
        system,
        chat: async function* (req) {
          if (isLocal) {
            const { streamWebLlm } = await import('../lib/ai/webLlmProvider');
            yield* streamWebLlm(connection, { ...req, signal: abort.signal }, reportLoad);
          } else {
            yield* streamChat(connection, { ...req, signal: abort.signal });
          }
        },
        signal: abort.signal,
        toolMode,
        maxRounds: toolMode === 'prompt' ? PROMPT_TOOL_MAX_CALLS : undefined,
        config,
        onMutation: proposal =>
          new Promise(resolve => {
            patchAssistant(t => { t.changes.push({ ...proposal }); });
            pendingDecisions.current.set(proposal.callId, resolve);
          }),
      })) {
        switch (evt.type) {
          case 'text':
            patchAssistant(t => { t.text += evt.text; });
            if (statsRef.current) {
              statsRef.current.chars += evt.text.length;
              statsRef.current.first ??= Date.now();
              const secs = (Date.now() - statsRef.current.first) / 1000;
              if (secs > 0.5) setTps(statsRef.current.chars / 4 / secs);
            }
            break;
          case 'reasoning':
            patchAssistant(t => { t.reasoning = (t.reasoning ?? '') + evt.text; });
            break;
          case 'tool_start':
            patchAssistant(t => { t.tools.push({ id: evt.call.id, name: evt.call.name, state: 'running' }); });
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
        if (t.state === 'streaming') t.state = abort.signal.aborted ? 'aborted' : 'done';
      });
      setRunning(false);
      setLoadProgress(null);
      abortRef.current = null;
    }

    // Write (or extend) the running digest after a compacted turn, so the next
    // request carries a real summary rather than the placeholder. Fire-and-
    // forget: it must not block the reply, and a failure just means the next
    // compaction reuses the prior digest.
    if (compaction.compacted && compaction.excerptToDigest) {
      void digestHistory(connection, isLocal, compaction.excerptToDigest, abort)
        .then(digest => { if (digest) patchThread({ contextSummary: digest }); })
        .catch(() => { /* keep the prior digest */ });
    }
  };

  const decideChange = (change: PendingChange, approved: boolean) => {
    patchTurns(prev => prev.map(t => ({
      ...t,
      changes: t.changes.map(c => c.callId === change.callId ? { ...c, resolved: approved ? 'approved' : 'rejected' } : c),
    })));
    if (approved) onApply(changePatch(change) as Partial<RetirementInputs>);
    pendingDecisions.current.get(change.callId)?.({ approved });
    pendingDecisions.current.delete(change.callId);
  };

  const send = async (message: AppendMessage) => {
    const textPart = message.content.find(p => p.type === 'text');
    const content = (textPart && 'text' in textPart ? textPart.text : '').trim();
    await runTurn(turns, content, true);
  };

  /** Regenerate: drop every turn after the user message that preceded the
   *  assistant reply, then re-run from that message. parentId is the id of
   *  that user turn (null only for a leading assistant message — regenerate
   *  is offered on user-preceded replies only, so this won't fire). */
  const reload = async (parentId: string | null) => {
    if (running || !parentId) return;
    const idx = turns.findIndex(t => t.id === parentId);
    if (idx === -1 || turns[idx].role !== 'user') return;
    const prior = turns.slice(0, idx + 1);
    patchTurns(() => prior);
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

  const cancel = async () => { abortRef.current?.abort(); };

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
        <ThreadPrimitive.Root className="flex-1 flex flex-col min-h-0 border border-slate-200 rounded bg-white">
          <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto p-3 space-y-3">
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
                          <MessageActionButton onClick={() => void reload(message.id)} title="Generate a response to this message">
                            <Bot size={12} />
                          </MessageActionButton>
                        )}
                        <DeleteButton running={running} onDelete={() => deleteMessage(message.id)} />
                      </div>
                      {/* Render the turn's own text rather than the converted
                          message part — the bubble must never depend on the
                          runtime's content conversion, so it can't vanish
                          while the assistant reply streams below it. */}
                      <div className="max-w-[85%] px-3 py-2 rounded-lg bg-violet-600 text-white text-xs whitespace-pre-wrap">
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
                return (
                  <div className="group flex justify-start items-start gap-1">
                    <div className="max-w-[85%] space-y-2">
                      {(thinking || turn?.text || turn?.reasoning || turn?.state === 'error') && (
                        <div className="px-3 py-2 rounded-lg bg-slate-100 text-slate-800 text-xs whitespace-pre-wrap leading-relaxed">
                          {thinking ? (
                            <span className="flex items-center gap-1.5 text-slate-400 italic">
                              <Loader2 size={11} className="animate-spin" /> Thinking…
                            </span>
                          ) : (
                            <MessagePrimitive.Content />
                          )}
                        </div>
                      )}
                      {turn?.reasoning && (
                        // Keyed on the turn so each reply's block starts open
                        // while it streams and the user folds it once done.
                        <ReasoningBlock key={turn.id} reasoning={turn.reasoning} streaming={streaming && !turn.text} />
                      )}
                      {turn && (
                        <AssistantExtras turn={turn} onDecide={decideChange} tokensPerSecond={tps} />
                      )}
                    </div>
                    {!streaming && (
                      <div className="flex flex-col gap-0.5 pt-1.5">
                        {message.isLast && (
                          <MessageActionButton onClick={() => void reload(message.parentId)} title="Regenerate this response">
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
            {running && loadProgress && (
              <div className="max-w-md">
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                  <Loader2 size={13} className="animate-spin" />
                  <span className="truncate">{loadProgress.text || 'Loading the local model…'}</span>
                  {loadProgress.progress < 1 && (
                    <span className="ml-auto shrink-0">{Math.round(loadProgress.progress * 100)}%</span>
                  )}
                </div>
                <div className="h-1.5 bg-slate-200 rounded overflow-hidden">
                  <div className="h-full bg-violet-500 transition-all" style={{ width: `${Math.round(loadProgress.progress * 100)}%` }} />
                </div>
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
                  limit={connection.contextSize ?? defaultContextSize(connection.provider)}
                  compacted={Boolean(thread.contextSummary)}
                />
              )}
            </div>
            <ComposerPrimitive.Root className="flex items-end gap-2">
              <ComposerPrimitive.Input
                placeholder={ready ? 'Ask about your plan, or describe your situation…' : 'Connect a provider first (Connections page)'}
                disabled={!ready}
                rows={2}
                className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded text-xs text-slate-800 focus:outline-none focus:border-violet-500 disabled:bg-slate-50 disabled:text-slate-400 resize-none"
              />
              {running ? (
                <ComposerPrimitive.Cancel asChild>
                  <button className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 text-slate-600 text-xs font-semibold rounded hover:bg-slate-50">
                    <X size={13} /> Stop
                  </button>
                </ComposerPrimitive.Cancel>
              ) : (
                <ComposerPrimitive.Send asChild>
                  <button
                    disabled={!ready}
                    className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 text-white text-xs font-semibold rounded hover:bg-violet-700 disabled:opacity-40"
                  >
                    Send
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

/** The model's chain-of-thought, shown collapsibly so it never clutters the
 *  answer. Open while it streams (so the thinking is visible live); the user
 *  folds it away once the answer arrives. */
function ReasoningBlock({ reasoning, streaming }: { reasoning: string; streaming: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-violet-200 rounded bg-violet-50/60">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-[10px] font-semibold text-violet-700 hover:text-violet-900"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Brain size={11} />
        {streaming ? 'Thinking…' : 'Reasoning'}
        {streaming && <Loader2 size={10} className="animate-spin ml-auto" />}
      </button>
      {open && (
        <div className="px-2 pb-2 text-[11px] text-slate-600 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto italic">
          {reasoning}
        </div>
      )}
    </div>
  );
}

/** Renders the parts assistant-ui doesn't model, read off the Turn carried in
 *  the message's metadata.custom: tool-activity chips, the confirm-before-
 *  apply change cards, and the measured reply speed. */
function AssistantExtras({ turn, onDecide, tokensPerSecond }: {
  turn: Turn;
  onDecide: (change: PendingChange, approved: boolean) => void;
  tokensPerSecond: number | null;
}) {
  return (
    <>
      {turn.tools.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {turn.tools.map(tool => (
            <span
              key={tool.id}
              title={tool.summary}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                tool.state === 'running' ? 'bg-violet-100 text-violet-700'
                : tool.state === 'error' ? 'bg-red-100 text-red-700'
                : 'bg-slate-200 text-slate-600'
              }`}
            >
              {tool.state === 'running' ? <Loader2 size={9} className="animate-spin" /> : <Wrench size={9} />}
              {tool.name}
            </span>
          ))}
        </div>
      )}
      {turn.changes.map(change => (
        <ChangeCard key={change.callId} change={change} onDecide={onDecide} />
      ))}
      {tokensPerSecond != null && turn.state !== 'streaming' && (
        <div className="text-[10px] text-slate-400">~{tokensPerSecond.toFixed(1)} tok/s</div>
      )}
    </>
  );
}

/** Per-chat standing instructions, appended to the built system prompt. A
 *  collapsed one-line button by default; opens into a small editor. */
function SystemNoteEditor({ note, onChange }: { note: string; onChange: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(note);
  if (!open) {
    return (
      <button
        onClick={() => { setDraft(note); setOpen(true); }}
        className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 hover:text-violet-700"
        title="Add standing instructions for this chat (appended to the system prompt)"
      >
        <Settings2 size={11} />
        {note.trim() ? 'Custom instructions: on' : 'Custom instructions'}
      </button>
    );
  }
  return (
    <div className="mb-2 border border-slate-200 rounded p-2 bg-slate-50">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Custom instructions for this chat
        </span>
        <button
          onClick={() => setOpen(false)}
          className="text-slate-400 hover:text-slate-700"
          title="Close"
        >
          <X size={12} />
        </button>
      </div>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        rows={2}
        placeholder='e.g. "Keep answers short" or "Focus on the TFSA vs RRSP trade-off".'
        className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-[11px] text-slate-700 focus:outline-none focus:border-violet-500 resize-none"
      />
      <div className="flex justify-end gap-2 mt-1">
        <button
          onClick={() => { onChange(draft.trim()); setOpen(false); }}
          className="px-2.5 py-1 bg-violet-600 text-white text-[11px] font-semibold rounded hover:bg-violet-700"
        >
          Save
        </button>
      </div>
    </div>
  );
}

/** Estimated context-window usage as a small bar. Amber near the compaction
 *  trigger, red past it; the tooltip explains the estimate and compaction. */
function ContextMeter({ used, limit, compacted }: { used: number; limit: number; compacted: boolean }) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const over = used > limit * COMPACT_AT;
  const hard = used > limit;
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
  return (
    <span
      className="flex items-center gap-1.5 ml-auto"
      title={
        `Estimated context usage: ~${fmt(used)} of ${fmt(limit)} tokens (~4 chars/token). ` +
        (hard
          ? 'Over the model\'s context window — raise "Context window" for this connection on the Connections page, or older messages will be summarized aggressively.'
          : compacted
            ? 'Older messages have been compacted into a summary to fit.'
            : `Past ${Math.round(COMPACT_AT * 100)}% the oldest messages are summarized to fit.`)
      }
    >
      <span className={`text-[10px] font-semibold ${hard ? 'text-red-600' : over ? 'text-amber-600' : 'text-slate-400'}`}>
        ~{fmt(used)}/{fmt(limit)}
      </span>
      <span className="w-16 h-1.5 bg-slate-200 rounded overflow-hidden">
        <span
          className={`block h-full transition-all ${hard ? 'bg-red-500' : over ? 'bg-amber-500' : 'bg-violet-400'}`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}

/** The assistant's base persona prompt, editable across all chats. A collapsed
 *  one-line button by default; opens into an editor pre-filled with whatever
 *  is currently in effect (the user's override, or the built-in default they
 *  can use as a starting point). Clearing it restores the default. */
function BasePromptEditor({ override, onChange }: { override: string; onChange: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(override);
  const customized = override.trim().length > 0;
  if (!open) {
    return (
      <button
        onClick={() => { setDraft(customized ? override : DEFAULT_SYSTEM_PROMPT); setOpen(true); }}
        className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 hover:text-violet-700"
        title="View and edit the assistant's base persona prompt (applies to every chat)"
      >
        <Bot size={11} />
        {customized ? 'Base prompt: customized' : 'Base prompt'}
      </button>
    );
  }
  return (
    <div className="mb-2 border border-slate-200 rounded p-2 bg-slate-50 w-full">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Base persona prompt (all chats)
        </span>
        <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700" title="Close">
          <X size={12} />
        </button>
      </div>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        rows={10}
        className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-[11px] text-slate-700 focus:outline-none focus:border-violet-500 resize-y font-mono"
      />
      <div className="flex items-center justify-between gap-2 mt-1">
        <button
          onClick={() => { setDraft(DEFAULT_SYSTEM_PROMPT); }}
          className="text-[10px] font-semibold text-slate-400 hover:text-violet-700"
          title="Restore the built-in default persona"
        >
          Reset to default
        </button>
        <div className="flex gap-2">
          {customized && (
            <button
              onClick={() => { onChange(''); setOpen(false); }}
              className="px-2.5 py-1 border border-slate-300 text-slate-600 text-[11px] font-semibold rounded hover:bg-slate-100"
              title="Stop customizing and use the built-in default"
            >
              Use default
            </button>
          )}
          <button
            onClick={() => { onChange(draft.trim() === DEFAULT_SYSTEM_PROMPT.trim() ? '' : draft.trim()); setOpen(false); }}
            className="px-2.5 py-1 bg-violet-600 text-white text-[11px] font-semibold rounded hover:bg-violet-700"
          >
            Save
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
      className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 opacity-0 group-hover:opacity-100 transition-opacity"
    >
      {children}
    </button>
  );
}

/** Per-message delete; hidden while a reply is streaming. */
function DeleteButton({ running, onDelete }: { running: boolean; onDelete: () => void }) {
  if (running) return null;
  return (
    <MessageActionButton onClick={onDelete} title="Delete this message">
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
  return (
    <div className="border border-violet-200 bg-violet-50 rounded-lg p-2.5 text-xs">
      <div className="font-semibold text-violet-900 mb-1">{change.label ?? (change.field ? `Set ${change.field}` : 'Proposed change')}</div>
      {change.rationale && <div className="text-violet-800/80 mb-1">{change.rationale}</div>}
      <div className="text-slate-600 mb-2 space-y-0.5">
        <PreviewLines preview={change.preview} />
      </div>
      {change.resolved ? (
        <div className={`flex items-center gap-1 font-semibold ${change.resolved === 'approved' ? 'text-emerald-700' : 'text-slate-500'}`}>
          {change.resolved === 'approved' ? <Check size={12} /> : <X size={12} />}
          {change.resolved === 'approved' ? 'Applied' : 'Declined'}
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => onDecide(change, true)}
            className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 text-white font-semibold rounded hover:bg-emerald-700"
          >
            <Check size={12} /> Accept
          </button>
          <button
            onClick={() => onDecide(change, false)}
            className="flex items-center gap-1 px-2.5 py-1 border border-slate-300 text-slate-600 font-semibold rounded hover:bg-slate-100"
          >
            <X size={12} /> Decline
          </button>
        </div>
      )}
    </div>
  );
}

function fmtValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return v.toLocaleString('en-CA');
  return String(v);
}

/** Render a proposal's preview: a single from→to line for scalar fields, or a
 *  compact line per entry for structural proposals (objects/arrays are
 *  JSON-compacted so a spouse/reverse-mortgage block stays readable). */
function PreviewLines({ preview }: { preview: Record<string, unknown> }) {
  const entries = Object.entries(preview);
  const isFromTo = (v: unknown): v is { from: unknown; to: unknown } =>
    !!v && typeof v === 'object' && 'from' in (v as object) && 'to' in (v as object);
  return (
    <>
      {entries.map(([key, value]) => {
        if (isFromTo(value)) {
          return (
            <div key={key}>
              {key}: <span className="line-through">{fmtValue(value.from)}</span>{' '}
              → <span className="font-semibold">{fmtValue(value.to)}</span>
            </div>
          );
        }
        if (key === 'add') {
          return <div key={key}>adds <span className="font-semibold">{compact(value)}</span></div>;
        }
        if (Array.isArray(value)) {
          return <div key={key}>{key}: <span className="font-semibold">{value.join('; ')}</span></div>;
        }
        return <div key={key}>{key}: <span className="font-semibold">{compact(value)}</span></div>;
      })}
    </>
  );
}

const compact = (v: unknown): string =>
  typeof v === 'object' && v !== null ? JSON.stringify(v) : fmtValue(v);

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

function EmptyChatState({ onNew }: { onNew: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center border border-slate-200 rounded bg-white py-12">
      <Bot size={32} className="text-violet-300 mb-3" />
      <p className="text-sm font-medium text-slate-700 mb-1">Start a conversation</p>
      <p className="text-xs text-slate-500 max-w-md mb-4">
        Each chat is saved on this device so you can come back to it.
      </p>
      <button
        onClick={onNew}
        className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white text-xs font-semibold rounded hover:bg-violet-700"
      >
        <Plus size={13} /> New chat
      </button>
    </div>
  );
}

function EmptyThread() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center py-8">
      <Bot size={28} className="text-violet-300 mb-3" />
      <p className="text-xs text-slate-500 max-w-md">
        Ask about your plan, or describe your situation. The assistant reads your scenario and runs
        the real engine before answering; every change it proposes needs your approval.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Offline assistant: no ready connection. The old "Tune inputs" and "Ask a
// question" flows — copy a self-contained prompt to any AI, and (for tuning)
// paste the JSON reply back through the local validation/apply path.
// ---------------------------------------------------------------------------

function OfflineAssistant({ inputs, config, hasConnections, onApply, onConnect }: {
  inputs: RetirementInputs;
  config: AppConfig;
  hasConnections: boolean;
  onApply: (patch: Partial<RetirementInputs>) => void;
  onConnect: () => void;
}) {
  const [tab, setTab] = useState<'ask' | 'tune'>('ask');
  const results = useMemo(() => calculateHousehold(inputs, config), [inputs, config]);

  return (
    <div className="h-full overflow-y-auto border border-slate-200 rounded bg-white">
      <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-52">
          <p className="text-sm font-semibold text-slate-800">No model connected</p>
          <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
            Copy a self-contained prompt into any AI (ChatGPT, Claude, …) below — or connect a model
            (even one that runs privately on this device) to chat right here.
          </p>
        </div>
        <button
          onClick={onConnect}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded hover:bg-emerald-700 shrink-0"
        >
          <Download size={13} /> {hasConnections ? 'Set up a connection' : 'Load a model'}
        </button>
      </div>

      <div className="flex gap-1 px-4 pt-3">
        {(['ask', 'tune'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-2.5 py-1 text-xs font-medium rounded ${tab === t ? 'bg-violet-50 text-violet-700' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {t === 'ask' ? 'Ask a question' : 'Tune inputs'}
          </button>
        ))}
      </div>

      {tab === 'ask' ? (
        <AskQuestionPanel inputs={inputs} results={results} />
      ) : (
        <TuneInputsPanel inputs={inputs} onApply={onApply} />
      )}
    </div>
  );
}

/** Copy a question prompt (plan + computed results + question) to paste into
 *  any external AI. Nothing is ingested back. */
function AskQuestionPanel({ inputs, results }: {
  inputs: RetirementInputs;
  results: ReturnType<typeof calculateHousehold>;
}) {
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

  return (
    <div className="p-4 grid grid-cols-1 sm:grid-cols-[240px_1fr] gap-4">
      <div className="space-y-1">
        {QA_PRESETS.map(p => (
          <button
            key={p.id}
            onClick={() => setPresetId(p.id)}
            className={`w-full text-left px-2.5 py-1.5 rounded border text-xs ${presetId === p.id
              ? 'border-violet-300 bg-violet-50 text-violet-800'
              : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
          >
            <div className="font-medium">{p.title}</div>
            <div className={`text-[10px] ${presetId === p.id ? 'text-violet-600' : 'text-slate-500'}`}>{p.blurb}</div>
          </button>
        ))}
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mt-2 mb-1">
            …or your own question
          </label>
          <textarea
            value={customQuestion}
            onChange={e => setCustomQuestion(e.target.value)}
            placeholder="Type a custom question; it replaces the preset."
            className="w-full h-16 px-2 py-1.5 bg-white border border-slate-300 rounded text-[11px] text-slate-700 focus:outline-none focus:border-violet-500"
          />
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-800 mb-1.5">
          Prompt{customQuestion.trim() ? ' (custom question)' : ` — ${preset.title}`}
        </div>
        <p className="text-[11px] text-slate-500 mb-2 leading-snug">
          Embeds your plan <em>and the computed results</em>, so the AI answers from the real numbers.
          Once you paste, that AI provider reads your plan under its own privacy policy.
        </p>
        <textarea
          readOnly
          value={prompt}
          onFocus={e => e.target.select()}
          className="w-full h-64 px-2.5 py-2 bg-slate-50 border border-slate-300 rounded text-[10px] font-mono text-slate-600 focus:outline-none"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={copy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-semibold rounded hover:bg-violet-700"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy prompt'}
          </button>
          <span className="text-[10px] text-slate-400">~{Math.round(prompt.length / 4).toLocaleString()} tokens</span>
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
        <div className="text-xs font-semibold text-slate-800 mb-1.5">1 · Copy the prompt</div>
        <p className="text-[11px] text-slate-500 mb-2 leading-snug">
          A self-contained prompt describing your plan, the levers, and the exact JSON format to reply
          with. Paste it into any AI. <strong className="text-slate-700">Heads up:</strong> once you paste,
          that provider reads your full plan under its own privacy policy.
        </p>
        <textarea
          readOnly
          value={prompt}
          onFocus={e => e.target.select()}
          className="w-full h-56 px-2.5 py-2 bg-slate-50 border border-slate-300 rounded text-[10px] font-mono text-slate-600 focus:outline-none"
        />
        <button
          onClick={copy}
          className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-semibold rounded hover:bg-violet-700"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy prompt'}
        </button>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-800 mb-1.5">2 · Paste the AI's JSON reply</div>
        <p className="text-[11px] text-slate-500 mb-2 leading-snug">
          Paste the model's JSON below. It's validated field-by-field — unknown fields ignored,
          out-of-range values rejected with reasons — then applied to your inputs.
        </p>
        <textarea
          value={pasteText}
          onChange={e => { setPasteText(e.target.value); setIngest(null); }}
          placeholder='{"cppStartAge":70, "oasStartAge":70, ...}'
          className="w-full h-56 px-2.5 py-2 bg-white border border-slate-300 rounded text-[10px] font-mono text-slate-700 focus:outline-none focus:border-violet-500"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => setIngest(parseAgentResult(pasteText, inputs))}
            disabled={!pasteText.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 text-slate-700 text-xs font-semibold rounded hover:bg-slate-50 disabled:opacity-40"
          >
            <ClipboardPaste size={13} /> Validate
          </button>
          {ingest?.ok && (
            <button
              onClick={apply}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded hover:bg-emerald-700"
            >
              <Check size={13} /> Apply {ingest.applied.length} change{ingest.applied.length === 1 ? '' : 's'}
            </button>
          )}
        </div>

        {ingest && (
          <div className="mt-3 text-[11px] leading-snug space-y-1">
            {ingest.error && <div className="text-red-600">✕ {ingest.error}</div>}
            {ingest.applied.length > 0 && (
              <div className="text-emerald-700">✓ Will apply: {ingest.applied.join('; ')}</div>
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
