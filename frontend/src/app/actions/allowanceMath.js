import { resolveEffectiveBondBps } from '../orderUiModel';

// [TR] ArafEscrow._getMakerBondBps/_getTakerBondBps aynası (bkz. resolveEffectiveBondBps). Kontrat teminatı
//      base-unit'te AŞAĞI yuvarlar: (amount * bps) / 10_000. Approve tutarı da aynı bigint hesabıyla üretilir;
//      önceki "amount * 2" üst sınırı cüzdanda gereğinden çok büyük bir izin istiyordu.
// [EN] Mirror of the contract bond rule. The contract floors the bond in base units, so the approval is built
//      with the same bigint math instead of the old 2x over-approval.
const BAD_REP_PENALTY_BPS = 300;
const MAX_TIER = 4;

const bondBpsForTier = ({ role, tier, bondMap, reputation }) => {
  // resolveEffectiveBondBps "side" = emrin yönü; BUY → taker teminatı, SELL → maker teminatı.
  const side = role === 'taker' ? 'BUY_CRYPTO' : 'SELL_CRYPTO';
  if (reputation) return resolveEffectiveBondBps({ side, tier, bondMap, reputation }).bps;
  // [TR] İtibar okunamadıysa kontratın uygulayacağı ayar bilinmez: en kötü durum (ceza) varsayılır.
  const base = resolveEffectiveBondBps({ side, tier, bondMap, reputation: null });
  return base.bps === 0 ? 0 : base.bps + BAD_REP_PENALTY_BPS;
};

/**
 * @param role       'maker' | 'taker': onaylayan cüzdanın ödeyeceği teminat rolü
 * @param tier       0..4; bilinmiyorsa en yüksek oran (muhafazakâr)
 * @param reputation getReputation çıktısı (yoksa muhafazakâr)
 */
export const resolveAllowanceBondBps = ({ role, tier, bondMap = null, reputation = null }) => {
  const numericTier = Number(tier);
  if (Number.isInteger(numericTier) && numericTier >= 0 && numericTier <= MAX_TIER) {
    return bondBpsForTier({ role, tier: numericTier, bondMap, reputation });
  }
  let worst = 0;
  for (let t = 1; t <= MAX_TIER; t += 1) worst = Math.max(worst, bondBpsForTier({ role, tier: t, bondMap, reputation }));
  return worst;
};

export const calcBondRaw = (amountRaw, bps) => (BigInt(amountRaw) * BigInt(Math.max(0, Math.round(Number(bps) || 0)))) / 10000n;

/**
 * [TR] Doldurma (fill) için cüzdanın kontrata vermesi gereken tam token tutarı.
 *      Sell emrini dolduran taker yalnız teminat öder; buy emrini dolduran maker tutar + teminat öder.
 * [EN] Exact token amount the filler must approve: taker fills of a sell order pay the bond only; maker fills
 *      of a buy order pay amount + bond.
 */
export const computeFillAllowance = ({ side, fillAmountRaw, tier, bondMap = null, reputation = null }) => {
  const fill = BigInt(fillAmountRaw);
  if (side === 'BUY_CRYPTO') {
    const bps = resolveAllowanceBondBps({ role: 'maker', tier, bondMap, reputation });
    return fill + calcBondRaw(fill, bps);
  }
  const bps = resolveAllowanceBondBps({ role: 'taker', tier, bondMap, reputation });
  return calcBondRaw(fill, bps);
};

/**
 * [TR] Emir oluşturma için gereken tam token tutarı: sell → tutar + maker teminatı; buy → taker teminatı.
 * [EN] Exact amount to approve for order creation: sell → amount + maker bond; buy → taker bond.
 */
export const computeCreateAllowance = ({ side, totalAmountRaw, tier, bondMap = null, reputation = null }) => {
  const total = BigInt(totalAmountRaw);
  if (side === 'BUY_CRYPTO') {
    const bps = resolveAllowanceBondBps({ role: 'taker', tier, bondMap, reputation });
    return calcBondRaw(total, bps);
  }
  const bps = resolveAllowanceBondBps({ role: 'maker', tier, bondMap, reputation });
  return total + calcBondRaw(total, bps);
};
