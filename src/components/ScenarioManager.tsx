import { useState, useEffect } from 'react';
import { Plus, Edit3, Trash2, Save, X, Copy, Check } from 'lucide-react';
import type { RetirementInputs } from '../lib/retirementEngine';

interface Scenario {
  id: string;
  name: string;
  inputs: RetirementInputs;
}

interface ScenarioManagerProps {
  scenarios: Scenario[];
  activeScenarioId: string;
  onScenariosChange: (scenarios: Scenario[]) => void;
  /** Select a scenario and navigate back to the dashboard. */
  onSelectScenario: (id: string) => void;
}

// Manage-scenarios page (was a modal). Light-themed to match the other routed
// pages; selecting a scenario loads it and returns to the projection dashboard.
export function ScenarioManager({ scenarios, activeScenarioId, onScenariosChange, onSelectScenario }: ScenarioManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  useEffect(() => {
    if (editingId) {
      const scenario = scenarios.find(s => s.id === editingId);
      if (scenario) setEditingName(scenario.name);
    }
  }, [editingId, scenarios]);

  const handleCreateNew = () => {
    const activeScenario = scenarios.find(s => s.id === activeScenarioId) ?? scenarios[0];
    const newScenario: Scenario = {
      id: `scenario-${Date.now()}`,
      name: `New Scenario ${scenarios.length + 1}`,
      inputs: JSON.parse(JSON.stringify(activeScenario.inputs))
    };
    onScenariosChange([...scenarios, newScenario]);
    onSelectScenario(newScenario.id);
  };

  const handleDuplicate = (id: string) => {
    const scenario = scenarios.find(s => s.id === id);
    if (!scenario) return;
    const newScenario: Scenario = {
      id: `scenario-${Date.now()}`,
      name: `${scenario.name} Copy`,
      inputs: JSON.parse(JSON.stringify(scenario.inputs))
    };
    onScenariosChange([...scenarios, newScenario]);
    onSelectScenario(newScenario.id);
  };

  const handleRename = () => {
    if (!editingId || !editingName.trim()) return;
    onScenariosChange(scenarios.map(s => (s.id === editingId ? { ...s, name: editingName.trim() } : s)));
    setEditingId(null);
    setEditingName('');
  };

  const handleDelete = (id: string) => {
    if (scenarios.length <= 1) return;
    const updated = scenarios.filter(s => s.id !== id);
    onScenariosChange(updated);
    if (id === activeScenarioId) onSelectScenario(updated[0].id);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Manage Scenarios</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Click a scenario to load it. Duplicate to branch a what-if; rename or delete below.
          </p>
        </div>
        <button
          onClick={handleCreateNew}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs text-white flex items-center gap-1.5"
        >
          <Plus size={12} /> New Scenario
        </button>
      </div>

      <div className="space-y-2">
        {scenarios.map(scenario => {
          const isActive = scenario.id === activeScenarioId;
          const isEditing = editingId === scenario.id;
          return (
            <div
              key={scenario.id}
              className={`flex items-center gap-2 p-3 rounded border bg-white ${
                isActive ? 'border-blue-400 ring-1 ring-blue-200' : 'border-slate-200'
              }`}
            >
              {isEditing ? (
                <div className="flex flex-1 items-center gap-2">
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    className="flex-1 px-2 py-1 bg-white border border-slate-300 rounded text-sm text-slate-900"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                  <button onClick={handleRename} className="p-1.5 hover:bg-slate-100 rounded" title="Save name">
                    <Save size={14} className="text-emerald-600" />
                  </button>
                  <button onClick={() => setEditingId(null)} className="p-1.5 hover:bg-slate-100 rounded" title="Cancel">
                    <X size={14} className="text-slate-500" />
                  </button>
                </div>
              ) : (
                <>
                  <button onClick={() => onSelectScenario(scenario.id)} className="flex-1 text-left min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">{scenario.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {isActive ? 'Active — currently loaded' : 'Click to load'}
                    </div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    {isActive && <Check size={15} className="text-blue-600 mr-1" />}
                    <button
                      onClick={() => handleDuplicate(scenario.id)}
                      className="p-1.5 hover:bg-slate-100 rounded"
                      title="Duplicate"
                    >
                      <Copy size={14} className="text-slate-500" />
                    </button>
                    <button
                      onClick={() => setEditingId(scenario.id)}
                      className="p-1.5 hover:bg-slate-100 rounded"
                      title="Rename"
                    >
                      <Edit3 size={14} className="text-slate-500" />
                    </button>
                    <button
                      onClick={() => handleDelete(scenario.id)}
                      disabled={scenarios.length <= 1}
                      className="p-1.5 hover:bg-slate-100 rounded disabled:opacity-30"
                      title={scenarios.length <= 1 ? 'Keep at least one scenario' : 'Delete'}
                    >
                      <Trash2 size={14} className="text-slate-500" />
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
