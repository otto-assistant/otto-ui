import React from 'react';
import { usePersonaStore } from '@/stores/usePersonaStore';

const sliders = [
  { key: 'proactivity' as const, label: 'Proactivity', min: 'Reactive', max: 'Proactive' },
  { key: 'verbosity' as const, label: 'Verbosity', min: 'Concise', max: 'Verbose' },
  { key: 'tone' as const, label: 'Tone', min: 'Formal', max: 'Casual' },
];

export const BehaviorSliders: React.FC = () => {
  const { config, updateBehavior } = usePersonaStore();

  if (!config) return null;

  return (
    <div className="flex flex-col gap-4">
      <label className="text-sm font-medium text-foreground">Behavior</label>
      {sliders.map(({ key, label, min, max }) => (
        <div key={key} className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground">{label}</span>
            <span className="text-xs text-muted-foreground">{config.behavior[key]}</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={config.behavior[key]}
            onChange={(e) => updateBehavior(key, Number(e.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
          />
          <div className="flex justify-between">
            <span className="text-xs text-muted-foreground">{min}</span>
            <span className="text-xs text-muted-foreground">{max}</span>
          </div>
        </div>
      ))}
    </div>
  );
};
