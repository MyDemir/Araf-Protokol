# Frontend Context Migration — Current Gap Report (PR92/PR94/PR95)

Bu rapor repo gerçekliğine göre hazırlanmıştır. Kod değişikliği yapılmamıştır; yalnızca mevcut durum doğrulanmıştır.

## 1) PR 92 iskeleti şu an main’de hangi dosyalarda aktif?

PR92 ile gelen context tabanlı iskeletin aktif kullanım izleri:

- Context registry/layout:
  - `frontend/src/app/contexts/registry/contextRegistry.js`
  - `frontend/src/app/contexts/registry/contextLayouts.js`
  - `frontend/src/app/contexts/registry/contextGuards.js`
- Context page katmanları:
  - `frontend/src/app/contexts/operations/*`
  - `frontend/src/app/contexts/profile/*`
  - `frontend/src/app/contexts/trade-room/*`
- Uygulama view kompozisyonu:
  - `frontend/src/app/AppViews.jsx` (`renderOperations`, `renderProfileContext`, `renderTradeRoom` delegasyonu)
- Context navigation action wiring:
  - `frontend/src/app/actions/tradeNavigationActions.js`

## 2) PR 94 runtime entegrasyonu hangi davranışları gerçekten değiştirdi?

PR94 runtime entegrasyon etkileri doğrulandı:

- Provider zinciri runtime’da netleşti:
  - `main.jsx` içinde `WagmiProvider -> QueryClientProvider -> ErrorBoundary -> AppProviders -> App` sıralaması.
- Shell katmanı App root’a taşındı:
  - `App.jsx` içinde `AppShell` kullanımı var.
- SystemStatusBar davranışları shell üzerinden standartlaştı:
  - `frontend/src/app/shell/SystemStatusBar.jsx` içinde pending backend sync dahil durum göstergeleri var.
- Test doğrulaması:
  - `AppSmoke.test.jsx` shell/provider hattını source-level doğruluyor.

## 3) PR 95 açık olduğu için Trade Room migration’da hangi dosyalara tekrar dokunulmamalı?

Parçalı risk azaltma için aşağıdaki dosyalarda büyük yapısal refactor yapılmamalı (sadece parity-fix düzeyi):

- `frontend/src/app/AppViews.jsx` (orchestration-only kalmalı)
- `frontend/src/app/AppModals.jsx` (trade-room migration kapsamı dışında)
- `frontend/src/App.jsx`, `frontend/src/main.jsx` (PR94 runtime hattı)
- `frontend/src/app/shell/*`, `frontend/src/app/providers/*`
- `frontend/src/app/copy/*` (copy dictionary toplu taşınmamalı)

## 4) Eski AppViews/AppModals/App.jsx içinde hâlâ yeni componentlere taşınmamış gerçek davranışlar nelerdir?

### AppViews
- Trade room orchestration doğru ayrılmış olsa da bazı UI/branch kararları halen `TradeRoomPage` içinde monolitik kalmış, alt panel bileşenlerine tam dağılmamış durumda.
- Pending backend sync fallback AppViews içinde kalıyor (bu bilinçli olarak doğru yer).

### AppModals
- Maker/profile/history/feedback akışları hâlâ büyük modal dosyasında; context page’lere tam ayrıştırma yapılmamış.

### App.jsx
- Session/auth/contract/data orchestrasyonu App root’ta yoğun; bu PR kapsamı dışında fakat migration backlog’u olarak duruyor.

## 5) Taşınacak davranışları dosya dosya listele

### Operations Center
- Mevcut: `contexts/operations/*` aktif.
- Kalan: operasyon kartlarındaki bazı durum kopyaları ve filtre davranışlarının model katmanına daha fazla taşınması.

### Profile Context
- Mevcut: `ProfileContextPage` aktif.
- Kalan: modal içi profile alt-akışlarının AppModals’tan ayrıştırılması (küçük PR’larla).

### Trade Room
- Mevcut: `TradeRoomPage` owner, AppViews delegator.
- Kalan: TradeRoomPage içindeki büyük inline branch’lerin (`LOCKED/PAID/CHALLENGED` alt panelleri) mevcut alt bileşenlere daha temiz dağıtımı.

### SystemStatusBar / guardrails
- Mevcut: `AppShell` + `SystemStatusBar` runtime’da aktif.
- Kalan: guardrail mesajlarının raw enum sızıntısı olmadan normalize edilmesi.

### Market / Maker flow
- Mevcut: AppViews + AppModals içinde side-aware akışlar çalışıyor.
- Kalan: maker modal validation/copy bloklarının daha test edilebilir küçük birimlere ayrılması.

### PII / Payment profile
- Mevcut: PIIDisplay + profile payout draft canonicalization var.
- Kalan: PII/secure payment UI paritelerinin trade-room alt panellerine tam ayrıştırılması.

### Settlement queue
- Mevcut: Settlement card + queue metrikleri operasyon tarafında var.
- Kalan: settlement quick counts ve proposal action görünümlerinin tek model kaynaktan beslenmesi.

### Copy dictionary
- Mevcut: TR/EN karma stringler farklı dosyalarda dağınık.
- Kalan: davranış değiştirmeden copy dictionary konsolidasyonu (ayrı küçük PR).

## 6) Riskler

- **Davranış kaybı:** Büyük JSX taşımasında mikro-state branch kaybı riski devam ediyor.
- **settlementProposal kaybı:** navigation/action zincirinde `settlementProposal` taşınması kritik (mevcut test var, korunmalı).
- **PAID+taker ping/auto-release parity:** geri getirildi ama regresyon riski yüksek; test kapsamı sürekli korunmalı.
- **pending backend sync görünürlüğü:** AppViews fallback + SystemStatusBar ikili görünürlüğü karışmamalı.
- **raw enum user-facing leakage:** decision model / guidance metinlerinde ham key gösterimi görülebilir.
- **tests missing or stale:** source-level testler güçlü, fakat behavioral UI testleri daha da genişletilebilir.

## 7) Sonraki kod PR’ları için küçük parçalara bölünmüş uygulama planı

1. **PR-A (TradeRoom decomposition only):**
   - `TradeRoomPage` içindeki inline panel branch’leri mevcut bileşenlere taşı (dosya eklemeden).
   - Hedef: okunabilirlik + parity testleri.

2. **PR-B (Timer/guidance normalization):**
   - `TimerStack` ve guidance copy’lerini raw key göstermeyecek şekilde normalize et.
   - Hedef: user-facing metin kalitesi.

3. **PR-C (AppModals incremental split):**
   - Maker/Profile alt bloklarını mevcut context page bileşenlerine küçük adımlarla kaydır.
   - Hedef: AppModals yüzey alanını azaltmak.

4. **PR-D (Copy consolidation no behavior change):**
   - Dağınık TR/EN metinleri dictionary’ye topla (strict no-behavior-change).

5. **PR-E (Regression net):**
   - Trade room + settlement + navigation için behavior testlerini genişlet.

---

## Doğrulama için kullanılan komutlar

- `git log --oneline -n 8`
- `git diff --stat HEAD~4..HEAD`
- `sed -n '1,260p' frontend/src/App.jsx`
- `sed -n '1,240p' frontend/src/main.jsx`
- `sed -n '1,280p' frontend/src/app/AppModals.jsx`
- `rg -n "buildAppViews|AppShell|SystemStatusBar|AppProviders|tradeRoom|renderTradeRoom|pendingBackendSync" ...`
- `rg -n "context|shell|trade room|TradeRoom|AppViews|AppProviders|SystemStatusBar|tradeNavigationActions|Settlement" frontend/src/test/*`
