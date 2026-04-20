"use strict";

const MAX_TIMER_MS = 2_147_483_647;

/**
 * [TR] Timer env parser:
 *      - yalnız güvenli pozitif integer kabul eder
 *      - Node timer üst sınırını aşan değerleri reddeder
 * [EN] Safe timer parser for setTimeout/setInterval boundaries.
 */
function parsePositiveTimerMs(raw, fallbackMs) {
  if (raw === undefined || raw === null || raw === "") return fallbackMs;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallbackMs;
  if (!Number.isInteger(parsed)) return fallbackMs;
  if (parsed <= 0) return fallbackMs;
  if (parsed > MAX_TIMER_MS) return fallbackMs;

  return parsed;
}

module.exports = {
  MAX_TIMER_MS,
  parsePositiveTimerMs,
};
