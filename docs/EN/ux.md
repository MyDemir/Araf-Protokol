# Araf V3 UX Notes

This document describes the frontend UX role in the current V3 architecture. It is intentionally not a repository tree.

## Canonical terminology

- **Parent order** is the public market primitive shown in the market/order surfaces.
- **Child trade** is the escrow lifecycle created when a parent order is filled.
- **Order-first** means users create or fill orders first; the contract creates child trades from fills.
- **Contract authority** lives in `ArafEscrow.sol`.
- **Backend mirror/read-model** surfaces help the UI query, coordinate, and audit state; they do not decide protocol outcomes.

## UX boundaries

Frontend components may:

- preflight wallet, network, allowance, tier, amount, and pause checks;
- present parent order side/risk/cost previews;
- submit contract writes through canonical order and child-trade functions;
- show backend mirror/read-model data while treating chain state as authoritative.

Frontend components must not:

- describe Listing as the V3 market primitive;
- treat backend read models as settlement/reputation authority;
- reintroduce `createEscrow`/`lockEscrow` as canonical user flows.

## Deprecated compatibility language

The word `listing` can appear only when naming historical or compatibility surfaces, for example the deprecated read-only `/api/listings` alias or ABI field names that cannot be renamed without a contract/API break.
