import React from 'react';
import { ChartWidget, SliderWidget, DashboardWidget, InteractiveTable, ProgressWidget, JsonViewer } from './GenerativeWidgets';

export function renderWidget(language: string, code: string): React.ReactNode | null {
  switch (language) {
    case 'chart':
      return <ChartWidget source={code} />;
    case 'slider':
    case 'calculator':
      return <SliderWidget source={code} />;
    case 'dashboard':
    case 'metrics':
      return <DashboardWidget source={code} />;
    case 'table-interactive':
    case 'datatable':
      return <InteractiveTable source={code} />;
    case 'progress':
      return <ProgressWidget source={code} />;
    case 'json-interactive':
    case 'json-viewer':
      return <JsonViewer source={code} language="json" />;
    case 'yaml-interactive':
    case 'yaml-viewer':
      return <JsonViewer source={code} language="yaml" />;
    default:
      return null;
  }
}
