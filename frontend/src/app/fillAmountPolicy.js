/**
 * [TR] Partial-fill miktarını fail-closed şekilde doğrular.
 * [EN] Validates partial-fill amount in fail-closed mode.
 */
export const resolveValidatedFillAmountRaw = ({
  fillAmountRaw,
  remainingAmountRaw,
  minFillAmountRaw,
  lang = 'EN',
}) => {
  const remaining = BigInt(remainingAmountRaw ?? 0n);
  const minFill = BigInt(minFillAmountRaw ?? 0n);

  if (fillAmountRaw === undefined || fillAmountRaw === null || String(fillAmountRaw).trim() === '') {
    return remaining;
  }

  let requested;
  try {
    requested = BigInt(fillAmountRaw);
  } catch {
    throw new Error(
      lang === 'TR'
        ? 'Geçersiz partial fill miktarı. Lütfen sayısal bir değer girin.'
        : 'Invalid partial fill amount. Please enter a numeric value.'
    );
  }

  if (requested <= 0n) {
    throw new Error(
      lang === 'TR'
        ? 'Partial fill miktarı sıfırdan büyük olmalıdır.'
        : 'Partial fill amount must be greater than zero.'
    );
  }

  if (requested > remaining) {
    throw new Error(
      lang === 'TR'
        ? 'Partial fill miktarı kalan miktardan büyük olamaz.'
        : 'Partial fill amount cannot exceed remaining amount.'
    );
  }

  // [TR] On-chain min fill kuralı: requested < minFill yalnızca "tam kalan" dolumsa kabul edilir.
  // [EN] On-chain min-fill alignment: allow requested < minFill only if it equals remaining.
  if (requested < minFill && requested !== remaining) {
    throw new Error(
      lang === 'TR'
        ? 'Partial fill miktarı minimum fill altında. Minimumu girin veya kalan miktarın tamamını doldurun.'
        : 'Partial fill is below minimum fill. Enter at least min fill or fill the full remaining amount.'
    );
  }

  return requested;
};

