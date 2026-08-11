import { CronExpressionParser } from 'cron-parser';

export function isValidCronExpression(expression: string): boolean {
  try {
    CronExpressionParser.parse(expression);
    return true;
  } catch {
    return false;
  }
}

export function getNextRuns(expression: string, count = 3): Date[] {
  const interval = CronExpressionParser.parse(expression);
  return interval.take(count).map((cronDate) => cronDate.toDate());
}

export type CronPresetId = 'daily' | 'weekdays' | 'hourly' | 'every-n-minutes' | 'custom';

export const CRON_PRESET_OPTIONS: { id: CronPresetId; label: string }[] = [
  { id: 'daily', label: 'Every day at HH:MM' },
  { id: 'weekdays', label: 'Weekdays at HH:MM' },
  { id: 'hourly', label: 'Every hour' },
  { id: 'every-n-minutes', label: 'Every N minutes' },
  { id: 'custom', label: 'Custom cron expression' },
];
