# V3 Terminology Audit

This audit classifies remaining `listing`, `createEscrow`, `lockEscrow`, and `legacy` references.

## Canonical current behavior

- `Order`, `parent order`, `child trade`, `order-first`, `backend mirror/read-model`, and `contract authority` are the canonical terms.
- Contract ABI names such as `childListingRef` are treated as immutable ABI field names only; their product meaning is a child-trade trace reference, not a Listing primitive.
- Backend `Order` routes and models are canonical read-model surfaces for parent orders.

## Compatibility/deprecated behavior

- `backend/scripts/routes/listings.js` is a deprecated read-only compatibility alias over `Order` documents. It is not mounted by canonical `app.js`; write routes return 410.
- `backend/scripts/jobs/cleanupPendingListings.js` is a deprecated no-op compatibility job retained for scheduler/app wiring stability.
- `Trade.trade_origin = DIRECT_ESCROW` and direct escrow event handlers are historical/deployment compatibility mirror values, not canonical V3 authority.
- Legacy environment aliases and legacy profile fields are compatibility concerns unrelated to the V3 market primitive.

## Stale/incorrect terminology fixed here

- Frontend user-facing copy now says parent order/order owner instead of listing/listing owner.
- Backend comments and tests now call `/api/listings` a deprecated compatibility alias rather than a canonical listing route.
