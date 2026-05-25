import React from 'react';
import { usePersonaStore } from '@/stores/usePersonaStore';

export const SystemPromptEditor: React.FC = () => {
  const { config, updateConfig } = usePersonaStore();

  if (!config) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">System Prompt</label>
        <span className="text-xs text-muted-foreground">
          {config.systemPrompt.length} chars
        </span>
      </div>
      <textarea
        value={config.systemPrompt}
        onChange={(e) => updateConfig({ systemPrompt: e.target.value })}
        className="min-h-[200px] w-full resize-y rounded-lg border border-border bg-surface p-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        placeholder="Enter system prompt..."
      />
    </div>
  );
};
