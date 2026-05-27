import React from 'react';
import { ConnectionsSection, MessengerSection } from '@/components/sections/otto-settings';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';

/**
 * Settings → Integrations.
 *
 * Hosts external integrations (Discord, Telegram, the Otto backend / relay
 * connection status). Previously these surfaced inline on the SettingsLandingView
 * tile dashboard; centralizing them here lets users find them alongside other
 * configuration in the Settings menu.
 */
export const IntegrationsPage: React.FC = () => {
  return (
    <ScrollableOverlay outerClassName="h-full" className="w-full">
      <div className="mx-auto w-full max-w-3xl px-3 py-6 sm:px-6 sm:pt-8 space-y-6">
        <div>
          <h2 className="typography-ui-header font-semibold text-foreground">Integrations</h2>
          <p className="typography-meta text-muted-foreground">
            Connect Otto to external messengers and inspect backend connection status.
          </p>
        </div>

        <MessengerSection />

        <ConnectionsSection />
      </div>
    </ScrollableOverlay>
  );
};
