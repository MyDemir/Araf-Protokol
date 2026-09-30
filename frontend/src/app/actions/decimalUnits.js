// [TR] Dize tabanlı ondalık ayrıştırma. parseFloat -> String -> parseUnits zinciri büyük/küçük değerlerde üstel
//      gösterim üretir ("1e-7", "1e21") ve viem parseUnits bunu reddeder ya da yanlış okur; ayrıca kayan nokta
//      hatası girilen tutarı değiştirebilir. Burada yalnız düz ondalık dize kabul edilir, hesap bigint iledir.
// [EN] String-based decimal parsing: no float round-trip, no exponent notation, pure bigint math.

/**
 * @returns {bigint|null} geçersizse null. `truncate` false iken decimals'tan fazla kesir hanesi geçersizdir.
 */
export const parseDecimalToUnits = (value, decimals, { truncate = false } = {}) => {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!/^\d*\.?\d*$/.test(text) || text === '' || text === '.') return null;
  const d = Number(decimals);
  if (!Number.isInteger(d) || d < 0 || d > 36) return null;
  const [intPart = '', fracPart = ''] = text.split('.');
  if (fracPart.length > d && !truncate) return null;
  const frac = fracPart.slice(0, d).padEnd(d, '0');
  return BigInt(`${intPart || '0'}${frac}`);
};

const FIAT_SCALE = 12;

/**
 * [TR] Minimum fiat limitini kripto taban birimine çevirir: floor(minFiat * 10^d / rate).
 *      Kontrat minFill > 0 ister; sıfıra düşerse 1 taban birime çekilir. Sonuç toplamı aşamaz.
 * [EN] Converts the minimum fiat limit to token base units (floor), clamped to [1, total].
 * @returns {bigint|null} girdiler ondalık dize değilse null
 */
export const computeMinFillRaw = ({ minFiat, rate, totalAmountRaw, tokenDecimals }) => {
  const total = BigInt(totalAmountRaw);
  const minFiatText = String(minFiat ?? '').trim();
  if (minFiatText === '') return total;
  const minFiatScaled = parseDecimalToUnits(minFiatText, FIAT_SCALE, { truncate: true });
  const rateScaled = parseDecimalToUnits(rate, FIAT_SCALE, { truncate: true });
  if (minFiatScaled === null || rateScaled === null || rateScaled <= 0n) return null;
  if (minFiatScaled === 0n) return total;
  let minFill = (minFiatScaled * (10n ** BigInt(tokenDecimals))) / rateScaled;
  if (minFill < 1n) minFill = 1n;
  return minFill > total ? total : minFill;
};
