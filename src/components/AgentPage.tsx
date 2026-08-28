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
  Copy, ClipboardPaste, Download,
} from 'lucide-react';
import type { RetirementInputs } from '../lib/retirementEngine';
import type { AppConfig } from '../lib/appConfig';
import {
  connectionReady, loadAiSettings, saveAiSettings, type AiSettings,
} from '../lib/aiSettings';
import { buildAgentPrompt, parseAgentResult } from '../lib/agentIngest';
import { QA_PRESETS, buildQAPrompt } from '../lib/agentQA';
import { streamChat, type ChatMessage } from '../lib/ai/providers';
import { buildSystemPrompt, runAgentTurn, type MutationProposal } from '../lib/ai/agentLoop';
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
}

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
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

/** Turn → what assistant-ui renders. Tool calls + change cards are added by a
 *  custom component below (they aren't standard message parts), so the content
 *  here is just the prose. */
function turnToMessage(t: Turn): ThreadMessageLike {
  const status =
    t.role === 'user' ? ({ type: 'complete', reason: 'unknown' } as const)
    : t.state === 'streaming' ? ({ type: 'running' } as const)
    : t.state === 'error' ? ({ type: 'incomplete', reason: 'error' } as const)
    : t.state === 'aborted' ? ({ type: 'incomplete', reason: 'cancelled' } as const)
    : t.state === 'truncated' ? ({ type: 'incomplete', reason: 'length' } as const)
    : ({ type: 'complete', reason: 'stop' } as const);
  return {
    id: t.id,
    role: t.role,
    content: [{ type: 'text', text: t.text }],
    createdAt: new Date(0),
    status,
    // Carry the full Turn through metadata.custom so the message component can
    // render tool chips + change cards.
    metadata: { custom: { turn: t as unknown as Record<string, unknown> } },
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AgentPage({ inputs, config, scenarioName, scenarioList, onApply, onOpenConnections }: AgentPageProps) {
  const [settings, setSettings] = useState<AiSettings>(loadAiSettings);
  const [chatState, setChatState] = useState(() => loadChats());
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
        {/* ---- Chat list ---- */}
        <aside className="w-52 shrink-0 flex flex-col border border-slate-200 rounded bg-white">
          <div className="flex items-center justify-between px-2.5 py-2 border-b border-slate-100">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Chats</span>
            <button
              onClick={newChat}
              className="flex items-center gap-1 text-[11px] text-violet-700 hover:text-violet-900 font-semibold"
              title="Start a new chat"
            >
              <Plus size={13} /> New
            </button>
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
              inputs={inputs}
              config={config}
              scenarioName={scenarioName}
              scenarioList={scenarioList}
              onApply={onApply}
              patchTurns={patchTurns}
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

function Conversation({ thread, ready, isLocal, toolMode, settings, inputs, config, scenarioName, scenarioList, onApply, patchTurns }: {
  thread: ChatThread;
  ready: boolean;
  isLocal: boolean;
  toolMode: 'native' | 'prompt';
  settings: AiSettings;
  inputs: RetirementInputs;
  config: AppConfig;
  scenarioName: string;
  scenarioList: Array<{ id: string; name: string }>;
  onApply: (patch: Partial<RetirementInputs>) => void;
  patchTurns: (mutate: (turns: Turn[]) => Turn[]) => void;
}) {
  const turns = thread.turns as Turn[];
  const [running, setRunning] = useState(false);
  const [loadProgress, setLoadProgress] = useState<{ progress: number; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const downloadDoneRef = useRef(false);
  const pendingDecisions = useRef(new Map<string, (d: { approved: boolean; note?: string }) => void>());

  // Cancel any in-flight request on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const toolContext: ToolContext = useMemo(() => ({
    inputs, config, scenarioName, scenarioList,
  }), [inputs, config, scenarioName, scenarioList]);

  const connection = settings.connections.find(c => c.id === settings.activeConnectionId) ?? null;

  const send = async (message: AppendMessage) => {
    const textPart = message.content.find(p => p.type === 'text');
    const content = (textPart && 'text' in textPart ? textPart.text : '').trim();
    if (!content || running || !connection) return;
    setRunning(true);

    const userTurn: Turn = { id: newTurnId(), role: 'user', text: content, tools: [], changes: [] };
    const assistantTurn: Turn = { id: newTurnId(), role: 'assistant', text: '', tools: [], changes: [], state: 'streaming' };
    patchTurns(prev => [...prev, userTurn, assistantTurn]);

    const history = toHistory(turns);
    const abort = new AbortController();
    abortRef.current = abort;

    const patchAssistant = (mutate: (t: Turn) => void) => {
      patchTurns(prev => prev.map(t => (t.id === assistantTurn.id
        ? (() => { const c = { ...t, tools: [...t.tools], changes: [...t.changes] }; mutate(c); return c; })()
        : t)));
    };

    const system = toolMode === 'prompt'
      ? buildSystemPrompt(scenarioName, { toolMode: 'prompt' }) + '\n\n' +
        buildPromptToolInstructions(toolSpecs()) + '\n\n' +
        buildPlanDigest(inputs, { results: calculateHousehold(inputs, config) })
      : buildSystemPrompt(scenarioName);

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
        onMutation: proposal =>
          new Promise(resolve => {
            patchAssistant(t => { t.changes.push({ ...proposal }); });
            pendingDecisions.current.set(proposal.callId, resolve);
          }),
      })) {
        switch (evt.type) {
          case 'text':
            patchAssistant(t => { t.text += evt.text; });
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
  };

  const decideChange = (change: PendingChange, approved: boolean) => {
    patchTurns(prev => prev.map(t => ({
      ...t,
      changes: t.changes.map(c => c.callId === change.callId ? { ...c, resolved: approved ? 'approved' : 'rejected' } : c),
    })));
    if (approved) onApply({ [change.field]: change.value } as Partial<RetirementInputs>);
    pendingDecisions.current.get(change.callId)?.({ approved });
    pendingDecisions.current.delete(change.callId);
  };

  const cancel = async () => { abortRef.current?.abort(); };

  const runtime = useExternalStoreRuntime<Turn>({
    messages: turns,
    isRunning: running,
    isDisabled: !ready,
    convertMessage: turnToMessage,
    onNew: send,
    onCancel: cancel,
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
                    <div className="flex justify-end">
                      <div className="max-w-[85%] px-3 py-2 rounded-lg bg-violet-600 text-white text-xs whitespace-pre-wrap">
                        <MessagePrimitive.Content />
                      </div>
                    </div>
                  );
                }
                return (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] space-y-2">
                      <div className="px-3 py-2 rounded-lg bg-slate-100 text-slate-800 text-xs whitespace-pre-wrap leading-relaxed">
                        <MessagePrimitive.Content />
                      </div>
                      {turn && <AssistantExtras turn={turn} onDecide={decideChange} />}
                    </div>
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

/** Renders the parts assistant-ui doesn't model, read off the Turn carried in
 *  the message's metadata.custom: tool-activity chips and the confirm-before-
 *  apply change cards. */
function AssistantExtras({ turn, onDecide }: {
  turn: Turn;
  onDecide: (change: PendingChange, approved: boolean) => void;
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
    </>
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
      {change.rationale && <div className="font-semibold text-violet-900 mb-1">{change.rationale}</div>}
      <div className="text-slate-600 mb-2">
        {change.field}: <span className="line-through">{fmtValue(change.preview.from)}</span>{' '}
        → <span className="font-semibold">{fmtValue(change.preview.to)}</span>
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
