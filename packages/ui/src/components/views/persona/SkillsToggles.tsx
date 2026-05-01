import React from 'react';
import { usePersonaStore } from '@/stores/usePersonaStore';
import { RiFlashlightLine } from '@remixicon/react';

export const SkillsToggles: React.FC = () => {
  const { config, toggleSkill } = usePersonaStore();

  if (!config || config.skills.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-foreground">Skills</label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {config.skills.map((skill) => (
          <div
            key={skill.name}
            className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3"
          >
            <RiFlashlightLine className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <div className="text-sm font-medium text-foreground">{skill.name}</div>
              <div className="text-xs text-muted-foreground">{skill.description}</div>
            </div>
            <button
              onClick={() => toggleSkill(skill.name)}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                skill.enabled ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${
                  skill.enabled ? 'left-[18px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
