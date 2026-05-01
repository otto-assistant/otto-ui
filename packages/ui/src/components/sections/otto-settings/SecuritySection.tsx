import React from 'react';
import { useOttoSettingsStore } from '@/stores/useOttoSettingsStore';

function maskToken(token: string): string {
  if (token.length <= 8) return '••••••••';
  return token.slice(0, 4) + '••••' + token.slice(-4);
}

export const SecuritySection: React.FC = () => {
  const { security } = useOttoSettingsStore();

  if (!security) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-foreground">Security</h3>
      <div className="mt-3 space-y-3 text-xs">
        <div>
          <span className="text-muted-foreground">IPC Token</span>
          <p className="font-mono text-foreground">{maskToken(security.ipcToken)}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Allowed Discord Users</span>
          {security.allowedDiscordUsers.length === 0 ? (
            <p className="text-muted-foreground italic">None configured</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {security.allowedDiscordUsers.map((user) => (
                <li key={user} className="font-mono text-foreground">{user}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
