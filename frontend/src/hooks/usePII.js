"use strict";

/**
 * usePII — Güvenli IBAN Fetch Hook
 *
 * H-03 Düzeltmesi:
 *   - IBAN asla React state'te kalıcı olarak saklanmaz
 *   - 2-adımlı backend token akışını kullanır
 *   - Trade room unmount olduğunda IBAN otomatik temizlenir
 *   - Her gösterimde yeniden fetch yapılır (cache yok)
 *
 * Kullanım:
 *   const { pii, loading, error, fetchPII, clearPII } = usePII(tradeId, authToken);
 *   <button onClick={fetchPII}>IBAN'ı Göster</button>
 *   {pii && <p>{pii.iban}</p>}
 */

import { useState, useEffect, useRef, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export function usePII(tradeId, authToken) {
  const [pii, setPii]       = useState(null);   // { bankOwner, iban, telegram }
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);
  const mountedRef = useRef(true);

  // Trade room'dan çıkınca otomatik temizle (H-03 core fix)
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      setPii(null);   // unmount → IBAN bellekten sil
    };
  }, [tradeId]);

  const fetchPII = useCallback(async () => {
    if (!tradeId || !authToken) {
      setError('Trade ID veya auth token eksik.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // ADIM 1: Auth token ile kısa ömürlü PII token al
      const tokenRes = await fetch(`${API_BASE}/api/pii/request-token/${tradeId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.json().catch(() => ({}));
        throw new Error(body.error || `Token alınamadı (${tokenRes.status})`);
      }

      const { piiToken } = await tokenRes.json();

      // ADIM 2: PII token ile şifreli IBAN'ı çöz
      const piiRes = await fetch(`${API_BASE}/api/pii/${tradeId}`, {
        headers: { 'Authorization': `Bearer ${piiToken}` },
      });

      if (!piiRes.ok) {
        const body = await piiRes.json().catch(() => ({}));
        throw new Error(body.error || `PII alınamadı (${piiRes.status})`);
      }

      const data = await piiRes.json();

      // Sadece component hâlâ mount'taysa state'e yaz
      if (mountedRef.current) {
        setPii({
          bankOwner: data.bankOwner || '—',
          iban:      data.iban      || '—',
          telegram:  data.telegram  || null,
        });
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [tradeId, authToken]);

  // Manuel temizle (örn. işlem tamamlandığında)
  const clearPII = useCallback(() => {
    setPii(null);
    setError(null);
  }, []);

  return { pii, loading, error, fetchPII, clearPII };
}
