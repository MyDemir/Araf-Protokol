# Repo Cleanup Planı — Root `test/` Konsolidasyonu

> Amaç: Package-local test klasörlerini tek bir root `test/` ağacı altında toplamak ve mevcut package-local CI çalışma modelini korumak.
>
> Bu PR runtime kaynak kodunu, contract logic'ini, backend route/service davranışını veya frontend app davranışını değiştirmez; yalnızca test dosyalarının konumu ile test runner config/import path'leri güncellenir.

## 1) Gerçekleşen hedef layout

Artık önerilen ve uygulanan test layout'u aşağıdaki gibidir:

```text
test/
  contracts/**
  backend/**
  frontend/**
```

- `contracts/test/**` içindeki 16 Hardhat testi `test/contracts/**` altına taşındı.
- `backend/test/**` içindeki 60 Jest testi `test/backend/**` altına taşındı.
- `frontend/src/test/**` içindeki 54 Vitest testi ve `setupTests.js` `test/frontend/**` altına taşındı.
- Root `test/testarea.md` boş placeholder dosyası silindi.

## 2) Eski path → yeni path özeti

| Eski konum | Yeni konum | Durum |
|---|---|---|
| `contracts/test/**` | `test/contracts/**` | Root test ağacına taşındı; Hardhat `paths.tests` bu klasörü gösteriyor. |
| `backend/test/**` | `test/backend/**` | Root test ağacına taşındı; Jest config root `test/backend/**/*.test.js` dosyalarını seçiyor. |
| `frontend/src/test/**` | `test/frontend/**` | Root test ağacına taşındı; Vitest setup/include path'leri güncellendi. |
| `frontend/src/test/setupTests.js` | `test/frontend/setupTests.js` | Vitest setup dosyası root test ağacına taşındı. |
| `test/testarea.md` | — | Boş placeholder olduğu için silindi. |

## 3) Package-local runner modeli

CI ve root script'ler package-local komutlara delegate etmeye devam eder:

- Backend: `working-directory: backend`, `npm test`
- Frontend: `working-directory: frontend`, `npm test`
- Contracts: `working-directory: contracts`, `npm test` ve `npm run test:abi-drift`
- Root: `npm run test:backend`, `npm run test:frontend`, `npm run test:contracts`, `npm run test:abi-drift`, `npm run test:all`

Bu modelin korunması için config değişikliği package klasörlerinde yapıldı; CI working-directory değişikliği gerekmedi.

## 4) Config değişiklikleri

| Config/script | Değişiklik |
|---|---|
| `contracts/hardhat.config.js` | `paths.tests` değeri `../test/contracts` yapıldı. |
| `backend/jest.config.cjs` | Root repo dizinini `rootDir` kabul eden ve `test/backend/**/*.test.js` dosyalarını seçen Jest config eklendi. |
| `backend/package.json` | `npm test`, `jest --config ./jest.config.cjs --forceExit` çalıştıracak şekilde güncellendi. |
| `frontend/vite.config.js` | `setupFiles` ve `include` root `test/frontend` konumuna göre güncellendi; Vite FS erişimi için `server.fs.allow: ['..']` eklendi. |
| `frontend/scripts/run-vitest.js` | `test/frontend/...` argümanlarını `../test/frontend/...` olarak, legacy `frontend/src/test/...` argümanlarını da yeni root test path'ine normalize edecek şekilde güncellendi. |

## 5) Import/path düzeltmeleri

Taşınan testlerde assertion rewrite yapılmadı. Sadece yeni konuma göre relative path/import düzeltmeleri uygulandı:

- Contract testlerinde `../scripts/...`, `../artifacts/...` ve Hardhat config path referansları `../../contracts/...` köküne göre düzeltildi.
- Backend testlerinde `../scripts/...` import/mock/path referansları `../../backend/scripts/...` olacak şekilde düzeltildi.
- Frontend testlerinde `../app/...`, `../hooks/...`, `../abi/...`, `../components/...`, `../dev/...` ve `../App.jsx` referansları `../../frontend/src/...` köküne göre düzeltildi.
- `process.cwd()` varsayımıyla package working-directory üzerinden okunan dokümantasyon/static path'ler korunarak CI modeli bozulmadı.

## 6) Geçersizleşen eski öneriler

Önceki plan dokümanında `frontend/test/**`, root `test/**` veya package dışına taşıma için “riskli/defer” değerlendirmeleri vardı. Bu PR ile root `test/` konsolidasyonu uygulandığı için bu eski öneriler artık geçersizdir.

Güncel guardrail şudur:

- Yeni test dosyaları ilgili root alt klasöre eklenmelidir: `test/contracts`, `test/backend` veya `test/frontend`.
- Package-local runner'lar ve CI working-directory modeli korunmalıdır.
- Runtime kaynak kodu değişmeden, yalnız test config/import path güncellemeleri yapılmalıdır.
