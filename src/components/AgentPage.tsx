import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot, Send, KeyRound, Plug, Plus, Trash2, X, Check, Loader2, Wrench,
  ChevronDown, ChevronRight, Lock, Cloud,
} from 'lucide-react';
import type { RetirementInputs } from '../lib/retirementEngine';
import type { AppConfig } from '../lib/appConfig';
import {
  AI_PROVIDERS, connectionReady, defaultBaseUrlFor, defaultModelFor,
  loadAiSettings, newConnectionId, saveAiSettings,
  type AiConnection, type AiPromptPreset, type AiSettings,
} from '../lib/aiSettings';
import { streamChat, type ChatMessage } from '../lib/ai/providers';
import { buildSystemPrompt, runAgentTurn, type MutationProposal } from '../lib/ai/agentLoop';
import { buildPromptToolInstructions, PROMPT_TOOL_MAX_CALLS } from '../lib/ai/promptTools';
import { toolSpecs } from '../lib/ai/tools';
import type { ToolContext } from '../lib/ai/tools';
import { buildPlanDigest } from '../lib/agentQA';
import { calculateHousehold } from '../lib/retirementEngine';
import { WEBLLM_MODELS, fmtSize, fmtVram, webGpuAvailable, type WebLlmModelChoice } from '../lib/ai/webLlmModels';
import { buildMachineGuide, detectGpuMemoryGB, type MachineGuide } from '../lib/ai/machineGuide';
import { PROVIDER_HELP } from '../lib/ai/providerHelp';

interface AgentPageProps {
  inputs: RetirementInputs;
  config: AppConfig;
  scenarioName: string;
  scenarioList: Array<{ id: string; name: string }>;
  onApply: (patch: Partial<RetirementInputs>) => void;
}

// ---------------------------------------------------------------------------
// Transcript model (UI-side; the provider-facing history is derived from it)
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
  text: string;                 // streamed prose for assistant turns
  tools: ToolActivity[];        // tool calls made during this turn
  changes: PendingChange[];     // mutation proposals awaiting/after decision
  /** Assistant only: where the turn is in its lifecycle. */
  state?: 'streaming' | 'done' | 'aborted' | 'truncated' | 'error';
}

let turnSeq = 0;
const newTurnId = () => `turn-${++turnSeq}`;

/** Fold the transcript into the provider-facing chat history. Assistant tool
 *  calls and their results are replayed in order so multi-turn conversations
 *  stay coherent. */
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AgentPage({ inputs, config, scenarioName, scenarioList, onApply }: AgentPageProps) {
  const [settings, setSettings] = useState<AiSettings>(loadAiSettings);
  const [setupOpen, setSetupOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // Local-model warm-up status, shown while a web-llm engine gets ready — a
  // multi-GB download takes minutes the first time, and the GPU compile that
  // follows it (progress stops at 100% but the model isn't answering yet) can
  // take another minute on slower machines.
  const [loadProgress, setLoadProgress] = useState<{ progress: number; text: string } | null>(null);
  const downloadDoneRef = useRef(false);
  // Engine warm-up state: 'ready' once the chosen model is loaded, so the
  // first chat doesn't stall on a download and the picker can say so.
  const [engineState, setEngineState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [engineError, setEngineError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const connection = settings.connections.find(c => c.id === settings.activeConnectionId) ?? null;
  const ready = connection != null && connectionReady(connection);
  const isLocal = connection?.provider === 'webllm';
  // Local models call tools through a text protocol taught in the system
  // prompt (no native function-calling on the web-llm chat surface).
  const toolMode: 'native' | 'prompt' = isLocal ? 'prompt' : 'native';

  useEffect(() => { saveAiSettings(settings); }, [settings]);

  // Keep the newest exchange visible while streaming.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, busy]);

  // Cancel any in-flight request on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Reset the engine status when the user switches models or providers — the
  // warm engine no longer matches the selection. Tracked during render (React's
  // "derived state from props" pattern), not in an effect.
  const engineKey = `${connection?.id ?? ''}:${connection?.model ?? ''}`;
  const [prevEngineKey, setPrevEngineKey] = useState(engineKey);
  if (prevEngineKey !== engineKey) {
    setPrevEngineKey(engineKey);
    setEngineState('idle');
    setEngineError(null);
  }

  /** Download + compile the chosen local model right now, so the first chat
   *  doesn't stall. Shared progress UI with the chat-time load path. */
  const warmUpLocalModel = async () => {
    if (!connection || connection.provider !== 'webllm') return;
    setEngineState('loading');
    setEngineError(null);
    setLoadProgress({ progress: 0, text: 'Downloading the model…' });
    try {
      const { loadWebLlmEngine, loadedWebLlmModel } = await import('../lib/ai/webLlmProvider');
      await loadWebLlmEngine(connection.model, p => {
        setLoadProgress(p.progress >= 1
          ? { progress: 1, text: 'Compiling the model for your GPU…' }
          : p);
      });
      setEngineState(loadedWebLlmModel() === connection.model ? 'ready' : 'idle');
    } catch (err) {
      setEngineState('error');
      setEngineError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadProgress(null);
    }
  };

  const updateSettings = (mutate: (s: AiSettings) => void) => {
    setSettings(prev => {
      const next = structuredClone(prev);
      mutate(next);
      return next;
    });
  };

  const toolContext: ToolContext = useMemo(() => ({
    inputs, config, scenarioName, scenarioList,
  }), [inputs, config, scenarioName, scenarioList]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy || !connection) return;
    setDraft('');
    setBusy(true);

    const userTurn: Turn = { id: newTurnId(), role: 'user', text: content, tools: [], changes: [] };
    const assistantTurn: Turn = { id: newTurnId(), role: 'assistant', text: '', tools: [], changes: [], state: 'streaming' };
    setTurns(prev => [...prev, userTurn, assistantTurn]);

    // History excludes the two turns just added; mutation RESULTS from earlier
    // turns are summarized inside their tool summaries.
    const history = toHistory(turns);
    const abort = new AbortController();
    abortRef.current = abort;

    const patchAssistant = (mutate: (t: Turn) => void) => {
      setTurns(prev => prev.map(t => (t.id === assistantTurn.id ? { ...t, ...(() => { const c = { ...t, tools: [...t.tools], changes: [...t.changes] }; mutate(c); return c; })() } : t)));
    };

    // Local models need two extras in their prompt: the tool-protocol
    // instructions (they have no native tool API) and the plan digest (small
    // models do better with the numbers in front of them than chained reads).
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
      // web-llm reports download progress, then goes quiet while the GPU
      // compiles — show a distinct "compiling" state so the UI doesn't look
      // frozen between 100% and the first token.
      if (p.progress >= 1) {
        if (!downloadDoneRef.current) {
          downloadDoneRef.current = true;
          setLoadProgress({ progress: 1, text: 'Compiling the model for your GPU — this can take a minute…' });
        }
        // else: keep the compiling message; further 100% reports add nothing.
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
            // The proposal card was already added by onMutation above.
            break;
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
      // If neither 'done' nor 'error' arrived (e.g. Stop aborted the stream),
      // close the turn out so the composer doesn't stay "busy" forever.
      patchAssistant(t => {
        if (t.state === 'streaming') t.state = abort.signal.aborted ? 'aborted' : 'done';
      });
      setBusy(false);
      setLoadProgress(null);
      abortRef.current = null;
    }
  };

  // Decisions for confirm cards, keyed by tool call id so the loop's await
  // resolves exactly once per proposal.
  const pendingDecisions = useRef(new Map<string, (d: { approved: boolean; note?: string }) => void>());

  const decideChange = (turnId: string, change: PendingChange, approved: boolean) => {
    setTurns(prev => prev.map(t => {
      if (t.id !== turnId) return t;
      return {
        ...t,
        changes: t.changes.map(c => c.callId === change.callId ? { ...c, resolved: approved ? 'approved' : 'rejected' } : c),
      };
    }));
    if (approved) {
      onApply({ [change.field]: change.value } as Partial<RetirementInputs>);
    }
    pendingDecisions.current.get(change.callId)?.({ approved });
    pendingDecisions.current.delete(change.callId);
  };

  const stop = () => abortRef.current?.abort();

  return (
    <div className="flex flex-col h-[calc(100vh-11rem)] min-h-[30rem]">
      {/* Header row: connection picker + setup toggle */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Bot size={18} className="text-violet-600" />
        <h2 className="text-lg font-bold text-slate-900">AI Assistant</h2>
        <div className="flex items-center gap-2 ml-auto">
          {settings.connections.length > 0 && (
            <select
              value={settings.activeConnectionId ?? ''}
              onChange={e => updateSettings(s => { s.activeConnectionId = e.target.value || null; })}
              className="px-2 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-700"
              title="Which saved provider connection to use"
            >
              {settings.connections.map(c => (
                <option key={c.id} value={c.id}>
                  {c.label || c.provider} · {c.model}
                </option>
              ))}
            </select>
          )}
          {connection && (
            <span
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold ${
                isLocal ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
              }`}
              title={isLocal
                ? 'Runs entirely on this device: no account, no key, nothing you type leaves the computer.'
                : `Chats go directly from this browser to ${connection.provider}; the key is stored only in this browser.`}
            >
              {isLocal ? <Lock size={11} /> : <Cloud size={11} />}
              {isLocal ? 'On this device · private' : 'Cloud · direct from browser'}
            </span>
          )}
          <button
            onClick={() => setSetupOpen(o => !o)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border ${
              ready
                ? 'border-slate-300 text-slate-700 hover:bg-slate-50'
                : 'border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100'
            }`}
          >
            <KeyRound size={13} />
            {settings.connections.length ? 'Connections' : 'Connect a provider'}
          </button>
        </div>
      </div>

      {/* Privacy line — always visible, this is a BYO-key feature */}
      <p className="text-[11px] text-slate-500 leading-snug mb-3">
        Bring-your-own-key: chats go <strong className="text-slate-700">directly from your browser to the
        provider</strong> you configure; keys are stored only in this browser. The assistant can read your
        plan and run the engine, but every change it proposes needs your explicit approval. It explains
        consequences — it never advises (see the app's calculator-not-planner rule).
      </p>

      {setupOpen && (
        <ConnectionSetup
          settings={settings}
          onChange={updateSettings}
          onClose={() => setSetupOpen(false)}
          engine={{ state: engineState, error: engineError, progress: loadProgress, onUse: () => void warmUpLocalModel() }}
        />
      )}

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto border border-slate-200 rounded bg-white p-3 space-y-3">
        {turns.length === 0 && (
          <EmptyState
            ready={ready}
            prompts={settings.prompts}
            onPick={(p) => { if (ready) void send(p.text); }}
            onConnect={() => setSetupOpen(true)}
          />
        )}
        {turns.map(t => (
          <TurnView key={t.id} turn={t} onDecide={decideChange} />
        ))}
        {busy && turns.at(-1)?.text === '' && turns.at(-1)?.tools.length === 0 && (
          loadProgress ? (
            <div className="max-w-md">
              <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                <Loader2 size={13} className="animate-spin" />
                <span className="truncate">{loadProgress.text || 'Loading the local model…'}</span>
                {loadProgress.progress < 1 && (
                  <span className="ml-auto shrink-0">{Math.round(loadProgress.progress * 100)}%</span>
                )}
              </div>
              <div className="h-1.5 bg-slate-200 rounded overflow-hidden">
                <div
                  className="h-full bg-violet-500 transition-all"
                  style={{ width: `${Math.round(loadProgress.progress * 100)}%` }}
                />
              </div>
              <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-1">
                <Lock size={9} />
                First load downloads the model weights to this device (cached afterwards). After that,
                everything runs locally — nothing you type leaves this computer.
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 size={13} className="animate-spin" /> thinking…
            </div>
          )
        )}
      </div>

      {/* Composer */}
      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(draft); }
          }}
          placeholder={ready ? 'Ask about your plan, or describe your situation…' : 'Connect a provider first (top right)'}
          disabled={!ready}
          rows={2}
          className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded text-xs text-slate-800 focus:outline-none focus:border-violet-500 disabled:bg-slate-50 disabled:text-slate-400 resize-none"
        />
        {busy ? (
          <button
            onClick={stop}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 text-slate-600 text-xs font-semibold rounded hover:bg-slate-50"
          >
            <X size={13} /> Stop
          </button>
        ) : (
          <button
            onClick={() => void send(draft)}
            disabled={!ready || !draft.trim()}
            className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 text-white text-xs font-semibold rounded hover:bg-violet-700 disabled:opacity-40"
          >
            <Send size={13} /> Send
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state / prompt library
// ---------------------------------------------------------------------------

function EmptyState({ ready, prompts, onPick, onConnect }: {
  ready: boolean;
  prompts: AiPromptPreset[];
  onPick: (p: AiPromptPreset) => void;
  onConnect: () => void;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center py-8">
      <Bot size={32} className="text-violet-300 mb-3" />
      {!ready ? (
        <>
          <p className="text-sm font-medium text-slate-700 mb-1">Meet your planning assistant</p>
          <p className="text-xs text-slate-500 max-w-md mb-1">
            The simplest setup runs entirely <strong>on this computer</strong> — free, private, no
            sign-up, works offline. Your plan data never leaves the device.
          </p>
          <p className="text-xs text-slate-500 max-w-md mb-4">
            (Online providers like Claude, GPT or Gemini are also available in the advanced section.)
          </p>
          <button
            onClick={onConnect}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded hover:bg-emerald-700"
          >
            <Check size={13} /> Set up the on-computer assistant
          </button>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-slate-700 mb-1">How can I help with your plan?</p>
          <p className="text-xs text-slate-500 max-w-md mb-4">
            Start from a prompt below, or type your own question. The assistant reads your scenario
            and runs the real engine before answering.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-2xl">
            {prompts.map(p => (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className="text-left px-3 py-2.5 border border-slate-200 rounded hover:border-violet-300 hover:bg-violet-50/50"
              >
                <div className="text-xs font-semibold text-slate-800">{p.title}</div>
                <div className="text-[10px] text-slate-500 leading-snug line-clamp-2">{p.text}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transcript rendering
// ---------------------------------------------------------------------------

function TurnView({ turn, onDecide }: {
  turn: Turn;
  onDecide: (turnId: string, change: PendingChange, approved: boolean) => void;
}) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] px-3 py-2 rounded-lg bg-violet-600 text-white text-xs whitespace-pre-wrap">
          {turn.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-2">
        {turn.text && (
          <div className={`px-3 py-2 rounded-lg text-xs whitespace-pre-wrap leading-relaxed ${
            turn.state === 'error' ? 'bg-red-50 text-red-800 border border-red-200' : 'bg-slate-100 text-slate-800'
          }`}>
            {turn.text}
            {turn.state === 'streaming' && (
              <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-violet-500 animate-pulse align-text-bottom" />
            )}
          </div>
        )}
        {(turn.state === 'truncated' || turn.state === 'aborted') && (
          <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            {turn.state === 'truncated'
              ? 'The answer was cut short at the model\'s length limit — ask it to continue or to be briefer.'
              : 'Stopped early.'}
          </div>
        )}
        {turn.tools.map(tool => (
          <div key={tool.id} className="flex items-start gap-1.5 text-[11px] text-slate-500">
            {tool.state === 'running'
              ? <Loader2 size={12} className="animate-spin mt-0.5 shrink-0" />
              : <Wrench size={12} className={`mt-0.5 shrink-0 ${tool.state === 'error' ? 'text-red-500' : 'text-slate-400'}`} />}
            <span>
              <span className="font-mono">{tool.name}</span>
              {tool.state === 'running' ? ' running…' : tool.state === 'error' ? ' failed' : ''}
            </span>
          </div>
        ))}
        {turn.changes.map(change => (
          <ChangeCard key={change.callId} turnId={turn.id} change={change} onDecide={onDecide} />
        ))}
      </div>
    </div>
  );
}

function ChangeCard({ turnId, change, onDecide }: {
  turnId: string;
  change: PendingChange;
  onDecide: (turnId: string, change: PendingChange, approved: boolean) => void;
}) {
  const resolved = change.resolved;
  return (
    <div className={`border rounded p-2.5 text-xs ${
      resolved === 'approved' ? 'border-emerald-300 bg-emerald-50/60'
      : resolved === 'rejected' ? 'border-slate-200 bg-slate-50 opacity-70'
      : 'border-amber-300 bg-amber-50/60'
    }`}>
      <div className="font-semibold text-slate-800 mb-1">
        Proposed change{resolved === 'approved' ? ' — applied' : resolved === 'rejected' ? ' — declined' : ''}
      </div>
      <div className="font-mono text-[11px] text-slate-700 mb-1">
        {change.field}: {fmtValue(change.preview.from)} → <strong>{fmtValue(change.preview.to)}</strong>
      </div>
      {change.rationale && (
        <div className="text-[11px] text-slate-500 mb-2 italic">{change.rationale}</div>
      )}
      {!resolved && (
        <div className="flex items-center gap-2 mt-1.5">
          <button
            onClick={() => onDecide(turnId, change, true)}
            className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 text-white text-[11px] font-semibold rounded hover:bg-emerald-700"
          >
            <Check size={11} /> Apply
          </button>
          <button
            onClick={() => onDecide(turnId, change, false)}
            className="flex items-center gap-1 px-2.5 py-1 border border-slate-300 text-slate-600 text-[11px] font-semibold rounded hover:bg-slate-50"
          >
            <X size={11} /> Decline
          </button>
          <span className="text-[10px] text-slate-400">applies to your inputs (unsaved until you Save)</span>
        </div>
      )}
    </div>
  );
}

function fmtValue(v: unknown): string {
  if (v == null) return '—';
  if (Array.isArray(v)) return v.join(' → ');
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return String(v);
}

// ---------------------------------------------------------------------------
// Connection setup panel
// ---------------------------------------------------------------------------

function ConnectionSetup({ settings, onChange, onClose, engine }: {
  settings: AiSettings;
  onChange: (mutate: (s: AiSettings) => void) => void;
  onClose: () => void;
  engine: { state: 'idle' | 'loading' | 'ready' | 'error'; error: string | null; progress: { progress: number; text: string } | null; onUse: () => void };
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [addingProvider, setAddingProvider] = useState<(typeof AI_PROVIDERS)[number]>('gemini');
  const [guide, setGuide] = useState<MachineGuide | null>(null);

  const webllmConn = settings.connections.find(c => c.provider === 'webllm') ?? null;

  // Probe the machine once so we can recommend a model size in plain English.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const gpu = webGpuAvailable();
      const mem = gpu ? await detectGpuMemoryGB() : null;
      if (!cancelled) setGuide(buildMachineGuide(gpu, mem));
    })();
    return () => { cancelled = true; };
  }, []);

  const patch = (id: string, p: Partial<AiConnection>) => {
    onChange(s => {
      const c = s.connections.find(x => x.id === id);
      if (c) Object.assign(c, p);
    });
  };

  const ensureWebllm = () => {
    if (webllmConn) {
      onChange(s => { s.activeConnectionId = webllmConn.id; });
      return;
    }
    const id = newConnectionId();
    onChange(s => {
      s.connections.push({
        id, provider: 'webllm', label: 'On this computer', apiKey: '',
        model: guide?.recommended.id ?? defaultModelFor('webllm'),
      });
      s.activeConnectionId = id;
    });
  };

  const addCloud = () => {
    const id = newConnectionId();
    onChange(s => {
      s.connections.push({
        id, provider: addingProvider, label: '', apiKey: '',
        model: defaultModelFor(addingProvider),
        baseUrl: defaultBaseUrlFor(addingProvider),
      });
      s.activeConnectionId = id;
    });
  };

  return (
    <div className="border border-violet-200 bg-violet-50/40 rounded p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
          <Plug size={13} className="text-violet-600" /> Set up the assistant
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600" title="Close">
          <X size={14} />
        </button>
      </div>

      {/* ---- Simple: on this computer (the default for everyone) ---- */}
      <div className="border border-emerald-200 bg-emerald-50/60 rounded p-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-900">
          <Lock size={12} /> On this computer — free, private, works offline
        </div>
        {!webllmConn && (
          <p className="text-[11px] text-emerald-900/80 leading-snug mt-1">
            The model downloads once and runs here; nothing you type leaves the device.
          </p>
        )}
        {guide && !guide.webgpu && (
          <div className="text-[11px] mt-1.5">
            <div className="font-semibold text-red-700">{guide.headline}</div>
            <div className="text-slate-600 leading-snug mt-0.5">{guide.detail}</div>
          </div>
        )}

        {!webllmConn ? (
          <button
            onClick={ensureWebllm}
            disabled={guide != null && !guide.webgpu}
            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded hover:bg-emerald-700 disabled:opacity-40"
          >
            <Check size={13} />
            {guide && guide.webgpu && guide.gpuMemoryGB != null
              ? `Set up — we suggest ${guide.recommended.label}`
              : 'Set up the on-computer assistant'}
          </button>
        ) : (
          <LocalModelPicker conn={webllmConn} guide={guide} onPatch={patch} engine={engine} onClose={onClose} />
        )}
      </div>

      {/* ---- Advanced: cloud providers with API keys ---- */}
      <div className="mt-3">
        <button
          onClick={() => setAdvancedOpen(o => !o)}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800"
        >
          {advancedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          Advanced: use an online provider (needs an API key)
        </button>

        {advancedOpen && (
          <div className="mt-2 border border-slate-200 bg-white rounded p-3">
            <p className="text-[11px] text-slate-500 leading-snug mb-3">
              For stronger models. You sign up with the provider, copy an API key, and paste it here —
              the key is stored only in this browser and sent only to that provider when you chat.
            </p>

            <div className="space-y-3">
              {settings.connections.filter(c => c.provider !== 'webllm').map(c => (
                <CloudConnectionCard key={c.id} conn={c} onPatch={patch} onDelete={() => onChange(s => {
                  s.connections = s.connections.filter(x => x.id !== c.id);
                  if (s.activeConnectionId === c.id) s.activeConnectionId = s.connections[0]?.id ?? null;
                })} />
              ))}
            </div>

            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
              <select
                value={addingProvider}
                onChange={e => setAddingProvider(e.target.value as (typeof AI_PROVIDERS)[number])}
                className="px-2 py-1.5 bg-white border border-slate-300 rounded text-xs"
              >
                {AI_PROVIDERS.filter(p => p !== 'webllm').map(p => (
                  <option key={p} value={p}>{PROVIDER_HELP[p]?.name ?? p}</option>
                ))}
              </select>
              <button
                onClick={addCloud}
                className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 text-white text-xs font-semibold rounded hover:bg-violet-700"
              >
                <Plus size={13} /> Add provider
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact local-model chooser: a single row per candidate (radio, label,
 *  sizes, SUGGESTED tag, one-line blurb) with a "Use this model" button that
 *  starts the download immediately, reports progress, and closes the panel
 *  once the model is warm — no more "send a chat to start loading". */
function LocalModelPicker({ conn, guide, onPatch, engine, onClose }: {
  conn: AiConnection;
  guide: MachineGuide | null;
  onPatch: (id: string, p: Partial<AiConnection>) => void;
  engine: { state: 'idle' | 'loading' | 'ready' | 'error'; error: string | null; progress: { progress: number; text: string } | null; onUse: () => void };
  onClose: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const current = WEBLLM_MODELS.find(m => m.id === conn.model);
  const isCustom = !current;

  // Short list: the recommendation + current pick, or the three smallest when
  // there's no recommendation to anchor on. "Show all" reveals everything.
  const byVram = [...WEBLLM_MODELS].sort((a, b) => a.vramMB - b.vramMB);
  let visible: WebLlmModelChoice[];
  if (showAll) {
    visible = WEBLLM_MODELS;
  } else if (guide) {
    const short = new Set([guide.recommended.id, ...(isCustom ? [] : [conn.model])]);
    visible = WEBLLM_MODELS.filter(m => short.has(m.id));
    if (visible.length < 2) visible = byVram.slice(0, 3);
  } else {
    visible = byVram.slice(0, 3);
  }

  const loading = engine.state === 'loading';
  const pct = engine.progress ? Math.round(engine.progress.progress * 100) : 0;

  return (
    <div className="mt-2">
      <div className="space-y-1">
        {visible.map(m => (
          <label key={m.id} className={`flex items-center gap-2 px-2 py-1 rounded border text-[11px] cursor-pointer bg-white ${
            conn.model === m.id ? 'border-emerald-400 ring-1 ring-emerald-300' : 'border-slate-200 hover:bg-slate-50'
          }`}>
            <input
              type="radio"
              name="webllm-model"
              checked={conn.model === m.id}
              disabled={loading}
              onChange={() => onPatch(conn.id, { model: m.id })}
            />
            <span className="flex-1 min-w-0">
              <span className="font-semibold text-slate-800">{m.label}</span>
              <span className="text-slate-400"> · {fmtSize(m.sizeGB)} · {fmtVram(m.vramMB)}</span>
              {guide?.recommended.id === m.id && (
                <span className="ml-1.5 text-[9px] font-bold text-emerald-700 bg-emerald-100 rounded px-1 py-0.5">SUGGESTED</span>
              )}
              <span className="block text-[10px] text-slate-500 truncate">{m.blurb}</span>
            </span>
          </label>
        ))}
        {!showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="text-[11px] text-emerald-700 hover:underline pl-1"
          >
            Show all {WEBLLM_MODELS.length} models…
          </button>
        )}
        <input
          value={isCustom ? conn.model : ''}
          onChange={e => onPatch(conn.id, { model: e.target.value })}
          disabled={loading}
          placeholder="…or paste any web-llm model id"
          className="w-full px-2 py-1 border border-slate-200 rounded text-[11px] font-mono bg-white disabled:opacity-50"
        />
      </div>

      {/* Action row: download/compile now, then jump straight to the chat. */}
      <div className="mt-2.5">
        {engine.state === 'ready' ? (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <Check size={14} /> {current?.label ?? 'Model'} is ready on this device
            </span>
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded hover:bg-emerald-700"
            >
              Start chatting →
            </button>
          </div>
        ) : loading && engine.progress ? (
          <div className="max-w-md">
            <div className="flex items-center gap-2 text-xs text-slate-600 mb-1">
              <Loader2 size={13} className="animate-spin" />
              <span className="truncate">{engine.progress.text}</span>
              {engine.progress.progress < 1 && <span className="ml-auto shrink-0">{pct}%</span>}
            </div>
            <div className="h-1.5 bg-slate-200 rounded overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={engine.onUse}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded hover:bg-emerald-700"
            >
              Use this model{current ? ` · ${fmtSize(current.sizeGB)} download` : ''}
            </button>
            <span className="text-[10px] text-slate-400">downloads once, runs offline after</span>
          </div>
        )}
        {engine.state === 'error' && (
          <div className="mt-1.5 text-[11px] text-red-700">{engine.error}</div>
        )}
      </div>
    </div>
  );
}

function CloudConnectionCard({ conn: c, onPatch, onDelete }: {
  conn: AiConnection;
  onPatch: (id: string, p: Partial<AiConnection>) => void;
  onDelete: () => void;
}) {
  const help = PROVIDER_HELP[c.provider];
  return (
    <div className="border border-slate-200 bg-white rounded p-2.5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-violet-700 bg-violet-100 rounded px-1.5 py-0.5">
          {help?.name ?? c.provider}
        </span>
        {help?.easiest && (
          <span className="text-[9px] font-bold text-blue-700 bg-blue-100 rounded px-1 py-0.5">EASIEST</span>
        )}
        <input
          value={c.label}
          onChange={e => onPatch(c.id, { label: e.target.value })}
          placeholder="Label (e.g. My key)"
          className="flex-1 px-2 py-1 border border-slate-200 rounded text-xs"
        />
        <button
          onClick={onDelete}
          className="text-slate-400 hover:text-red-600"
          title="Delete this connection (the key is removed from this browser)"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {help && (
        <div className="mb-2 text-[11px] text-slate-500 leading-snug">
          {help.howTo}
          {help.keyUrl && (
            <> {' '}
              <a href={help.keyUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                Get a key here ↗
              </a>
            </>
          )}
          <span className="block text-[10px] text-slate-400 mt-0.5">{help.cost}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {c.provider !== 'ollama' && (
          <label className="block">
            <span className="block text-[10px] text-slate-500 mb-0.5">API key (stored locally only)</span>
            <input
              type="password"
              value={c.apiKey}
              onChange={e => onPatch(c.id, { apiKey: e.target.value })}
              placeholder={c.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
              autoComplete="off"
              className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-mono"
            />
          </label>
        )}
        <label className="block">
          <span className="block text-[10px] text-slate-500 mb-0.5">Model</span>
          <input
            value={c.model}
            onChange={e => onPatch(c.id, { model: e.target.value })}
            placeholder={defaultModelFor(c.provider) || 'model id'}
            className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-mono"
          />
        </label>
        {(c.provider === 'ollama' || c.provider === 'openai-compatible' || c.provider === 'openrouter' || c.provider === 'openai') && (
          <label className="block sm:col-span-2">
            <span className="block text-[10px] text-slate-500 mb-0.5">Base URL</span>
            <input
              value={c.baseUrl ?? ''}
              onChange={e => onPatch(c.id, { baseUrl: e.target.value })}
              placeholder={defaultBaseUrlFor(c.provider) ?? 'https://…/v1'}
              className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-mono"
            />
          </label>
        )}
      </div>
      {!connectionReady(c) && (
        <div className="mt-1.5 text-[10px] text-amber-700">
          Incomplete: {c.provider === 'ollama' || c.provider === 'openai-compatible'
            ? 'needs a base URL and a model'
            : 'needs an API key and a model'}.
        </div>
      )}
    </div>
  );
}
