import { logDebug } from "./logger";
import type { ChatSessionBehavior } from "./types";

export function clampScheduleJitterSeconds(value: unknown): number {
  const parsedValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsedValue)) {
    return 0;
  }

  const flooredValue = Math.floor(parsedValue);
  return Math.min(Math.max(flooredValue, 0), 1800);
}

export async function applyScheduleJitter(maxJitterSeconds: number): Promise<void> {
  const jitterLimit = clampScheduleJitterSeconds(maxJitterSeconds);
  if (jitterLimit <= 0) {
    return;
  }

  const delayMs = Math.floor(Math.random() * jitterLimit * 1000);
  const delaySeconds = Math.round(delayMs / 1000);
  if (delaySeconds > 0) {
    logDebug(`[CopilotScheduler] Jitter: waiting ${delaySeconds}s`);
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }
}

export function normalizeScheduledTaskChatSession(
  chatSession: unknown,
  oneTime: boolean,
): ChatSessionBehavior | undefined {
  if (oneTime) {
    return undefined;
  }

  return chatSession === "new" || chatSession === "continue"
    ? chatSession
    : undefined;
}

export function normalizeScheduledTaskManualSession(
  manualSession: unknown,
  oneTime: boolean,
): boolean | undefined {
  if (oneTime) {
    return undefined;
  }

  return manualSession === true ? true : undefined;
}

export function normalizeScheduledTaskLabels(labels: unknown): string[] | undefined {
  const rawValues = Array.isArray(labels)
    ? labels
    : typeof labels === "string"
      ? labels.split(",")
      : [];
  const normalizedValues = rawValues
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);

  return normalizedValues.length > 0
    ? Array.from(new Set(normalizedValues))
    : undefined;
}

export function normalizeScheduledWindowMinutes(windowMinutes: unknown): number {
  const parsedValue =
    typeof windowMinutes === "number"
      ? windowMinutes
      : Number(windowMinutes ?? 30);
  if (!Number.isFinite(parsedValue)) {
    return 30;
  }

  const flooredValue = Math.floor(parsedValue);
  return Math.min(Math.max(flooredValue, 1), 24 * 60);
}
