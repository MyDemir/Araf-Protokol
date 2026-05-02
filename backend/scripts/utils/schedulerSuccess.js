"use strict";

/**
 * [TR] Scheduler job başarı sözleşmesi:
 *      - yalnız true veya { success:true } => başarılı
 *      - diğer tüm durumlar => başarısız (fail-closed)
 * [EN] Scheduler job success contract:
 *      - only true or { success:true } => success
 *      - everything else => failed (fail-closed)
 */
function didScheduledJobSucceed(result) {
  if (result === true) return true;
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  return result.success === true;
}

module.exports = {
  didScheduledJobSucceed,
};
