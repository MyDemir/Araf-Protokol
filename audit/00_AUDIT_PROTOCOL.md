# Mainnet Readiness Audit Protocol

Bu belge, MyDemir/Araf-Protokol için bu turdaki audit çalışma protokolünü tanımlar.

## Amaç
Mainnet’e engel olabilecek kritik/yüksek riskli güvenlik, correctness, hesaplama, state-machine ve operasyonel problemleri satır bazlı inceleme ile tespit etmek.

## Kapsam ve Sınırlar
- Bu turda kod değişikliği/fix/refactor/test ekleme yok.
- Yalnız inceleme ve raporlama.
- Bu çalışma P0 discovery odaklı değildir.

## Zorunlu Yöntem
1. Önce `docs/TR/ux.md` okunur.
2. Dosya sırası için `docs/TR/ux.md` canonical source kabul edilir.
3. İnceleme fazlara bölünür.
4. Her fazda yalnız o faz için verilen dosyalar incelenir.
5. Her dosya açılıp gerçekten okunur.
6. Büyük dosyalarda fonksiyon-fonksiyon ilerlenir.
7. Dosya değerlendirmesi sadece grep/search sonucu ile yapılmaz.
8. Bulgu, ilgili kod okunmadan yazılmaz.
9. İlişkili dosyalar aynı faz içinde cross-reference edilir.
10. Varsayım yapılmaz.
11. Emin olunmayan bulgular `uncertain` olarak işaretlenir ve gereken ek dosya belirtilir.
12. Her bulguda file path + mümkünse line/function referansı verilir.
13. Gerekirse “Bulgu yok” denebilir.

## Rapor Dosyaları
- `audit/00_AUDIT_PROTOCOL.md`
- `audit/MASTER_AUDIT_LOG.md`
- `audit/phase-XX-*.md`

## Severity Seviyeleri
- MAINNET-BLOCKER
- CRITICAL
- HIGH
- MEDIUM
- LOW
- OPTIMIZATION
- INFO

## Kategori Seti
- security
- access-control
- accounting-math
- state-machine
- oracle/offchain-authority
- ABI-drift
- worker-mirror
- auth-session
- PII-data-protection
- deployment-env
- testing-gap
- gas-performance
- frontend-tx-orchestration
- docs-mismatch

## Faz Rapor Şablonu

```md
# Phase XX — <Başlık>

## Scope
İncelenen dosyalar.

## Method
Dosyalar nasıl okundu?
Satır/fonksiyon bazlı mı?
İlişkili dosyalar hangileriyle çapraz kontrol edildi?

## File-by-File Notes
| Dosya | Durum | İnceleme derinliği | Not |

## Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |

## No-Finding Notes
Bulgu çıkmayan ama incelenen alanlar.

## Cross-File Observations
Dosyalar arası tutarsızlık, drift veya coupling.

## Follow-up Needed
Bir sonraki fazda bakılması gereken dosyalar.
```

## İlke Notları
- Oracle-free dispute modeli korunur.
- Backend/frontend ekonomik hüküm otoritesi haline getirilmez.
- Release, cancel, burn, payout, settlement authority kontratta kalır.
- İnsan/personel doğrulaması eklenmez.
- Risk skoru/backend verisi on-chain sonucu belirlemez.
