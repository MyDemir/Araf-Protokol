"use strict";

const logger = require("../utils/logger");

/**
 * Pending Listing Cleanup Job — V3 Compatibility No-Op
 *
 * V2 dünyasında backend önce `Listing` kaydı oluşturuyor, ardından on-chain
 * `EscrowCreated` event'ini bekliyordu. Eğer zincir tarafı hiç gelmezse, saatlerce
 * `PENDING` kalan ilanlar bu job tarafından `DELETED` durumuna süpürülüyordu.
 *
 * V3'te authoritative public market nesnesi artık `Listing` değil, `Order`dur.
 * Parent order doğrudan kontratta açılır ve backend onu event ile mirror eder.
 * Bu nedenle backend'in "pending listing" diye authoritative bir iş nesnesi kalmaz.
 *
 * Sonuç:
 *   - Bu job V3'te çekirdek protokol görevi taşımaz.
 *   - Kontrat üstünde açılmamış bir order'ı backend tek başına "silme" yetkisine sahip değildir.
 *   - Bu dosya yalnız scheduler / app wiring kırılmasın diye no-op olarak tutulur.
 *
 * Eğer ileride yalnız UI amaçlı geçici bir marketplace draft koleksiyonu açılırsa,
 * o koleksiyon için ayrı ve açıkça "compat / draft cleanup" isimli bir job yazılmalıdır.
 * Bu dosya o rolü üstlenmez.
 */

let _loggedDeprecationOnce = false;

async function runPendingListingCleanup() {
  if (!_loggedDeprecationOnce) {
    logger.info(
      "[Job:PendingCleanup] V3'te pending listing cleanup deprecated — no-op çalıştırıldı."
    );
    _loggedDeprecationOnce = true;
  }

  // [TR] V3'te authoritative market nesnesi Order olduğu için burada veri mutasyonu yok.
  // [EN] No data mutation here because the authoritative market entity in V3 is Order.
  return 0;
}

module.exports = {
  runPendingListingCleanup,
};
