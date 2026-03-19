# 🌀 Araf Protocol: Game Theory Visualized

This document visually explains the core game theory of the Araf Protocol using a sequence diagram for the "Bleeding Escrow" dispute resolution process.

---

## Bleeding Escrow Sequence Diagram

This diagram illustrates all possible resolution paths from the `PAID` state — mutual release, Taker auto-release, or Maker challenge.

> **Security note:** A `ConflictingPingPath` guard prevents both ping paths from being open simultaneously. If the Maker has called `pingTakerForChallenge`, the Taker cannot call `pingMaker` (autoRelease path), and vice versa. This prevents MEV/transaction ordering manipulation.

```mermaid
sequenceDiagram
    actor Taker
    actor Maker
    participant Contract as ArafEscrow.sol
    participant Treasury

    Taker->>Contract: reportPayment()
    Contract-->>Taker: Event: PaymentReported
    note over Contract: State: PAID. Taker can call pingMaker() after 48h.

    par Maker Actions
        Maker->>Contract: releaseFunds()
        Contract-->>Taker: Receives Crypto + Bond
        Contract-->>Maker: Receives Bond (minus fee)
        note over Contract: Outcome: RESOLVED ✅

    and Taker path (Maker inactive after 48h)
        note over Taker: Waits for paidAt + 48h (GRACE_PERIOD)
        Taker->>Contract: pingMaker() (after 48h — ConflictingPingPath guard active)
        note over Contract: Maker has 24h to respond.
        Taker->>Contract: autoRelease() (after 24h)
        note over Contract: Outcome: RESOLVED ✅ (2% negligence penalty from both bonds)

    and Maker dispute path (payment not received)
        note over Maker: Waits for paidAt + 24h
        Maker->>Contract: pingTakerForChallenge() (ConflictingPingPath guard active)
        note over Contract: Taker has 24h response window.
        note over Taker: Taker can resolve or cancel within 24h.
        note over Maker: After 24h with no resolution:
        Maker->>Contract: challengeTrade()
        Contract-->>Maker: Event: DisputeOpened
        note over Contract: State: CHALLENGED.

        rect rgb(255, 230, 230)
            note over Taker, Maker: Grace Period (48 Hours) — No Decay
            Taker->>Maker: Off-chain communication (e.g., Telegram)
            alt Mutual Agreement
                Maker->>Contract: proposeOrApproveCancel() (EIP-712)
                Taker->>Contract: proposeOrApproveCancel() (EIP-712)
                Contract-->>Maker: Refund (Crypto + Bond minus fee)
                Contract-->>Taker: Refund (Bond minus fee)
                note over Contract: Outcome: CANCELED 🔄
            else No Agreement
                note over Taker, Maker: 48 hours pass...
            end
        end

        rect rgb(255, 200, 200)
            note over Taker, Maker: Bleeding Phase (10 Days) — Hourly Decay Starts
            loop Every Hour
                note over Contract: Taker bond: 42 BPS/h · Maker bond: 26 BPS/h<br/>USDT (both): 34 BPS/h starting at 96h of Bleeding
            end
            note over Taker, Maker: Either party can still release or cancel at any time.
        end

        note over Contract: After 10 days (240h) of no resolution...
        Taker->>Contract: burnExpired()
        Contract->>Treasury: All remaining funds transferred
        note over Contract: Outcome: BURNED 💀 (Both parties lose — +1 failedDisputes each)

    end
