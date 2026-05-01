import React from 'react';

export const ScheduleView: React.FC = () => (
  <div className="flex h-full flex-col gap-4 overflow-auto bg-background p-6">
    <h1 className="text-lg font-semibold text-foreground">Schedule</h1>
    <p className="text-sm leading-relaxed text-muted-foreground">
      Schedule placeholder — recurring rhythms, calendars, and automations arrive after schedule endpoints land.
    </p>
  </div>
);
