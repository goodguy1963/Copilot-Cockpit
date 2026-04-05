import { parseExpression } from "cron-parser";

type CronParseOptions = {
  currentDate: Date;
  tz?: string;
};

function buildCronOptions(currentDate: Date, tz?: string): CronParseOptions {
  return tz ? { currentDate, tz } : { currentDate };
}

export function truncateDateToMinute(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
  );
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
    const first = interval.next().toDate();
    const second = interval.next().toDate();
    const diffMinutes = (second.getTime() - first.getTime()) / (1000 * 60);
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
  } catch {
    if (tz) {
      try {
        parseExpression(expression, { currentDate });
        return;
      } catch {
        // fall through
      }
    }

    throw new Error(invalidMessage);
  }
}
