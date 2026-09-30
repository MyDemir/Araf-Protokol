import { fallback, http } from 'wagmi';

// [TR] P4 — VITE_RPC_URL (varsa) birincil RPC'dir; yanıt vermezse herkese açık RPC'ye düşülür.
//      URL'siz http() yalnız herkese açık, hız sınırlı uca gider. Geçersiz değer yok sayılır.
// [EN] P4 — VITE_RPC_URL (when set) is the primary RPC with the public endpoint as fallback.
//      A bare http() only hits the rate-limited public endpoint. Invalid values are ignored.
export const resolveRpcUrl = (raw) => {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
};

export const buildRpcTransport = (rawUrl) => {
  const url = resolveRpcUrl(rawUrl);
  return url ? fallback([http(url), http()]) : http();
};
