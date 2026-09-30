// [TR] Zincir ile backend aynası arasındaki gecikmeyi yönetir. Tx sonrası kontrattan okunan durum "pin"lenir;
//      ayna (backend listener) beklenen duruma yetişene kadar daha eski durumlar yok sayılır. Böylece iyimser
//      güncelleme gecikmeli aynayla ezilmez ve biten trade odaya geri dönmez.
// [EN] Bridges chain-vs-mirror lag: after a tx the on-chain state is pinned and older mirror states are ignored
//      until the mirror catches up (or the pin expires), so optimistic updates are not overwritten.

// ArafEscrow.TradeState enum sırası.
export const TRADE_STATE_BY_INDEX = ['OPEN', 'LOCKED', 'PAID', 'CHALLENGED', 'RESOLVED', 'CANCELED', 'BURNED'];

const RANK = { OPEN: 0, LOCKED: 1, PAID: 2, CHALLENGED: 3, RESOLVED: 4, CANCELED: 4, BURNED: 4 };
const TERMINAL = new Set(['RESOLVED', 'CANCELED', 'BURNED']);

// [TR] Ayna gecikmesi için üst süre; sonrasında pin bırakılır (ayna/zincir farkı kalıcı olmasın).
export const TRADE_STATE_PIN_TTL_MS = 90_000;

export const tradeStateRank = (state) => (state in RANK ? RANK[state] : -1);
export const isTerminalTradeState = (state) => TERMINAL.has(state);

/** getTrade çıktısından (isimli ya da tuple) durum adını okur; okunamazsa null. */
export const mapChainTradeState = (onchainTrade) => {
  if (!onchainTrade) return null;
  const raw = onchainTrade.state ?? onchainTrade[12];
  if (raw === undefined || raw === null) return null;
  const index = Number(raw);
  return Number.isInteger(index) ? (TRADE_STATE_BY_INDEX[index] ?? null) : null;
};

/**
 * [TR] Tx sonrası kullanılacak durum: RPC bir blok geride kalıp eski durum döndürebilir; tx başarılı olduğu için
 *      beklenen durumdan daha eski bir okuma güvenilmez sayılır.
 */
export const resolveConfirmedState = (chainState, expectedState) => {
  if (!chainState) return expectedState;
  return tradeStateRank(chainState) >= tradeStateRank(expectedState) ? chainState : expectedState;
};

export const createStatePin = (onchainId, state, now = Date.now()) => ({
  onchainId: String(onchainId),
  state,
  rank: tradeStateRank(state),
  expiresAt: now + TRADE_STATE_PIN_TTL_MS,
});

/**
 * [TR] Backend listesine pin uygular. Ayna pin'den eskiyse (rank küçük): terminal pin'de trade listeden çıkarılır,
 *      aksi halde durum pin'lenen durumla değiştirilir. Ayna yetiştiyse ya da pin süresi dolduysa pin bırakılır.
 * @returns {{ trades: Array, pin: object|null }} pin null ise temizlenmelidir
 */
export const applyStatePin = (trades, pin, now = Date.now()) => {
  if (!pin || now > pin.expiresAt) return { trades, pin: null };
  const key = pin.onchainId;
  const match = trades.find((t) => String(t?.onchain_escrow_id ?? '') === key);
  if (!match) {
    // Terminal pin: ayna trade'i zaten listelemiyor → yetişmiş demektir.
    return { trades, pin: isTerminalTradeState(pin.state) ? null : pin };
  }
  if (tradeStateRank(match.status) >= pin.rank) return { trades, pin: null };
  if (isTerminalTradeState(pin.state)) {
    return { trades: trades.filter((t) => t !== match), pin };
  }
  return { trades: trades.map((t) => (t === match ? { ...t, status: pin.state } : t)), pin };
};
