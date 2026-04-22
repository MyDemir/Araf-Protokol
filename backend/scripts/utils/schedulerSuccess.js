"use strict";

/**
 * [TR] Scheduler job başarı sözleşmesi:
 *      - false veya { success:false } => başarısız
 *      - diğer tüm durumlar => başarılı kabul edilir
 * [EN] Scheduler job success contract:
 *      - false or { success:false } => failed
 *      - everything else => treated as successful
 */
function didScheduledJobSucceed(result) {
  if (result === false) return false;
  if (result && typeof result === "object" && typeof result.success === "boolean") {
    return result.success;
  }
  return true;
}

module.exports = {
  didScheduledJobSucceed,
};
