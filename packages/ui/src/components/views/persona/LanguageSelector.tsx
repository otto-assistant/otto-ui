import React from 'react';
import { usePersonaStore } from '@/stores/usePersonaStore';
import { RiGlobalLine } from '@remixicon/react';

const languages = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'ja', label: 'Japanese' },
  { code: 'zh', label: 'Chinese' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' },
];

export const LanguageSelector: React.FC = () => {
  const { config, updateConfig } = usePersonaStore();

  if (!config) return null;

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-foreground">Language</label>
      <div className="relative w-fit">
        <RiGlobalLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <select
          value={config.language}
          onChange={(e) => updateConfig({ language: e.target.value })}
          className="appearance-none rounded-lg border border-border bg-surface py-2 pl-9 pr-8 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {languages.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
