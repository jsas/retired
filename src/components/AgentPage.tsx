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
  Bot, Plus, Trash2, Lock, Cloud, Plug, MessageSquare, Check, X, Loader2, Wrench,
} from 'lucide-react';
import type { RetirementInputs } from '../lib/retirementEngine';
import type { AppConfig } from '../lib/appConfig';
import {
  connectionReady, loadAiSettings, type AiSettings,
} from '../lib/aiSettings';
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
  const [settings] = useState<AiSettings>(loadAiSettings);
  const [chatState, setChatState] = useState(() => loadChats());
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
    <div className="flex gap-3 h-[calc(100vh-11rem)] min-h-[30rem]">
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

      {/* ---- Active conversation ---- */}
      <div className="flex-1 min-w-0">
        {!activeThread ? (
          <EmptyChatState ready={ready} onNew={newChat} onConnect={onOpenConnections} />
        ) : (
          <Conversation
            key={activeThread.id}
            thread={activeThread}
            ready={ready}
            isLocal={isLocal}
            connectionLabel={connection ? `${connection.label || connection.provider} · ${connection.model}` : null}
            toolMode={toolMode}
            settings={settings}
            inputs={inputs}
            config={config}
            scenarioName={scenarioName}
            scenarioList={scenarioList}
            onApply={onApply}
            onOpenConnections={onOpenConnections}
            patchTurns={patchTurns}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One conversation (assistant-ui runtime around our agent loop)
// ---------------------------------------------------------------------------

function Conversation({ thread, ready, isLocal, connectionLabel, toolMode, settings, inputs, config, scenarioName, scenarioList, onApply, onOpenConnections, patchTurns }: {
  thread: ChatThread;
  ready: boolean;
  isLocal: boolean;
  connectionLabel: string | null;
  toolMode: 'native' | 'prompt';
  settings: AiSettings;
  inputs: RetirementInputs;
  config: AppConfig;
  scenarioName: string;
  scenarioList: Array<{ id: string; name: string }>;
  onApply: (patch: Partial<RetirementInputs>) => void;
  onOpenConnections: () => void;
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
        {/* Header: connection badge + link to connections page */}
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Bot size={16} className="text-violet-600" />
          <h2 className="text-sm font-bold text-slate-900">AI Assistant</h2>
          <div className="flex items-center gap-2 ml-auto">
            {connectionLabel && (
              <span
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold ${
                  isLocal ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                }`}
                title={isLocal
                  ? 'Runs entirely on this device: no account, no key, nothing you type leaves the computer.'
                  : 'Chats go directly from this browser to the provider; the key is stored only in this browser.'}
              >
                {isLocal ? <Lock size={11} /> : <Cloud size={11} />}
                {isLocal ? 'On this device · private' : connectionLabel}
              </span>
            )}
            <button
              onClick={onOpenConnections}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              <Plug size={13} /> Connections
            </button>
          </div>
        </div>

        {/* Thread */}
        <ThreadPrimitive.Root className="flex-1 flex flex-col min-h-0 border border-slate-200 rounded bg-white">
          <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto p-3 space-y-3">
            <ThreadPrimitive.Empty>
              <EmptyThread ready={ready} onConnect={onOpenConnections} />
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

function EmptyChatState({ ready, onNew, onConnect }: {
  ready: boolean;
  onNew: () => void;
  onConnect: () => void;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center border border-slate-200 rounded bg-white py-12">
      <Bot size={32} className="text-violet-300 mb-3" />
      {!ready ? (
        <>
          <p className="text-sm font-medium text-slate-700 mb-1">Meet your planning assistant</p>
          <p className="text-xs text-slate-500 max-w-md mb-4">
            Set up a model first — the simplest runs entirely on this computer, free and private.
          </p>
          <button
            onClick={onConnect}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded hover:bg-emerald-700"
          >
            <Plug size={13} /> Set up a connection
          </button>
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}

function EmptyThread({ ready, onConnect }: { ready: boolean; onConnect: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center py-8">
      <Bot size={28} className="text-violet-300 mb-3" />
      {!ready ? (
        <>
          <p className="text-sm font-medium text-slate-700 mb-1">No provider connected</p>
          <button
            onClick={onConnect}
            className="mt-2 flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded hover:bg-emerald-700"
          >
            <Plug size={13} /> Set up a connection
          </button>
        </>
      ) : (
        <p className="text-xs text-slate-500 max-w-md">
          Ask about your plan, or describe your situation. The assistant reads your scenario and runs
          the real engine before answering; every change it proposes needs your approval.
        </p>
      )}
    </div>
  );
}
