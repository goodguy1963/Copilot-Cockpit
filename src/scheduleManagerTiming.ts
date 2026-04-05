import { parseExpression } from "cron-parser";

type CronParseOptions = {
  currentDate: Date;
  tz?: string;
};

function buildCronOptions(currentDate: Date, tz?: string): CronParseOptions {
  return tz ? { currentDate, tz } : { currentDate };
}

export function truncateDateToMinute(date: Date): Date {
  const year = date.getFullYear();
  const month = date.getMonth();
  const dayOfMonth = date.getDate();
  return new Date(year, month, dayOfMonth, date.getHours(), date.getMinutes());
}

export function resolveNextCronRun(
  cronExpression: string,
  currentDate: Date,
  tz?: string,
  onInvalidTimezone?: (tz: string) => void,
): Date | undefined {
  try {
    return parseExpression(cronExpression, buildCronOptions(currentDate, tz)).next().toDate();
  } catch {
    if (!tz) {
      return undefined;
    }

    onInvalidTimezone?.(tz);

    try {
      return parseExpression(cronExpression, { currentDate }).next().toDate();
    } catch {
      return undefined;
    }
  }
}

export function resolvePreviousCronRun(
  cronExpression: string,
  currentDate: Date,
  tz?: string,
  onInvalidTimezone?: (tz: string) => void,
): Date | undefined {
  try {
    return parseExpression(cronExpression, buildCronOptions(currentDate, tz)).prev().toDate();
  } catch {
    if (!tz) {
      return undefined;
    }

    onInvalidTimezone?.(tz);

    try {
      return parseExpression(cronExpression, { currentDate }).prev().toDate();
    } catch {
      return undefined;
    }
  }
}

export function getCronIntervalWarning(
  cronExpression: string,
  currentDate: Date,
  warningMessage: string,
  tz?: string,
): string | undefined {
  const checkInterval = (options: CronParseOptions): string | undefined => {
    const interval = parseExpression(cronExpression, options);
    const firstRun = interval.next().toDate();
    const secondRun = interval.next().toDate();
    const diffMinutes = (secondRun.getTime() - firstRun.getTime()) / 60000;
    return diffMinutes < 30 ? warningMessage : undefined;
  };

  try {
    return checkInterval(buildCronOptions(currentDate, tz));
  } catch {
    if (!tz) {
      return undefined;
    }

    try {
      return checkInterval({ currentDate });
    } catch {
      return undefined;
    }
  }
}

export function assertValidCronExpression(
  expression: string,
  currentDate: Date,
  invalidMessage: string,
  tz?: string,
): void {
  if (!expression || !expression.trim()) {
    throw new Error(invalidMessage);
  }

  try {
    parseExpression(expression, buildCronOptions(currentDate, tz));
  } catch { if (tz) {
      try {
        const fallbackOptions: CronParseOptions = { currentDate };
        parseExpression(expression, fallbackOptions);
        return;
      } catch {
        // fall through
      }
    }

    throw new Error(invalidMessage);
  }
}
