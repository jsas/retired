import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Plus, Edit3, Trash2, Save, X, Copy } from 'lucide-react';
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
  onSelectScenario: (id: string) => void;
}

export interface ScenarioManagerHandle {
  open: () => void;
}

export const ScenarioManager = forwardRef<ScenarioManagerHandle, ScenarioManagerProps>(function ScenarioManager({ scenarios, activeScenarioId, onScenariosChange, onSelectScenario }, ref) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  useImperativeHandle(ref, () => ({ open: () => setIsOpen(true) }));

  useEffect(() => {
    if (editingId) {
      const scenario = scenarios.find(s => s.id === editingId);
      if (scenario) {
        setEditingName(scenario.name);
      }
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
    setIsOpen(false);
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

    const updated = scenarios.map(s =>
      s.id === editingId ? { ...s, name: editingName } : s
    );
    onScenariosChange(updated);
    setEditingId(null);
    setEditingName('');
  };

  const handleDelete = (id: string) => {
    if (scenarios.length <= 1) return;

    const updated = scenarios.filter(s => s.id !== id);
    onScenariosChange(updated);

    if (id === activeScenarioId) {
      onSelectScenario(updated[0].id);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg w-96 max-h-[80vh] overflow-hidden">
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Manage Scenarios</h3>
          <button
            onClick={() => setIsOpen(false)}
            className="text-neutral-500 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
          {scenarios.map(scenario => (
            <div
              key={scenario.id}
              className={`relative group flex items-center justify-between p-2.5 rounded ${
                scenario.id === activeScenarioId
                  ? 'bg-blue-600/20 border border-blue-600'
                  : 'bg-neutral-800 hover:bg-neutral-700'
              }`}
            >
              <button
                onClick={() => {
                  onSelectScenario(scenario.id);
                  setIsOpen(false);
                }}
                className="flex-1 text-left"
              >
                <div className="text-xs text-white">{scenario.name}</div>
                <div className="text-[10px] text-neutral-500">
                  {scenario.id === activeScenarioId ? 'Active' : 'Inactive'}
                </div>
              </button>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                <button
                  onClick={() => handleDuplicate(scenario.id)}
                  className="p-1 hover:bg-neutral-600 rounded"
                  title="Duplicate"
                >
                  <Copy size={12} className="text-neutral-400" />
                </button>
                <button
                  onClick={() => setEditingId(scenario.id)}
                  className="p-1 hover:bg-neutral-600 rounded"
                  title="Rename"
                >
                  <Edit3 size={12} className="text-neutral-400" />
                </button>
                <button
                  onClick={() => handleDelete(scenario.id)}
                  disabled={scenarios.length <= 1}
                  className="p-1 hover:bg-neutral-600 rounded disabled:opacity-30"
                  title="Delete"
                >
                  <Trash2 size={12} className="text-neutral-400" />
                </button>
              </div>

              {editingId === scenario.id && (
                <div className="absolute right-4 top-4 bg-neutral-800 border border-neutral-700 rounded p-2 flex items-center gap-2 z-10">
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    className="px-2 py-1 bg-neutral-900 border border-neutral-600 rounded text-xs text-white w-40"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                  />
                  <button onClick={handleRename} className="p-1 hover:bg-neutral-700 rounded">
                    <Save size={12} className="text-emerald-400" />
                  </button>
                  <button onClick={() => setEditingId(null)} className="p-1 hover:bg-neutral-700 rounded">
                    <X size={12} className="text-neutral-500" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-neutral-800 flex justify-between">
          <button
            onClick={handleCreateNew}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs text-white flex items-center gap-1.5"
          >
            <Plus size={12} />
            New Scenario
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-xs text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
});
