import React from "react";
import { humanizeCron } from "./humanizeCron";

interface CronHumanizerProps {
  cron: string;
  className?: string;
}

export const CronHumanizer: React.FC<CronHumanizerProps> = ({ cron, className }) => (
  <span className={className} title={cron}>
    {humanizeCron(cron)}
  </span>
);
