# 🌀 Araf Protocol: Game Theory Visualized

This document visually explains the core game theory of the Araf Protocol using a sequence diagram for the "Bleeding Escrow" dispute resolution process.

---

## Bleeding Escrow Sequence Diagram

This diagram illustrates the flow of events after a Taker reports a payment (`PAID` state) and the Maker disputes it, triggering the Purgatory phase.

```mermaid
sequenceDiagram
    actor Taker
    actor Maker
    participant Contract as ArafEscrow.sol
    participant Treasury

    Taker->>Contract: reportPayment()
    Contract-->>Taker: Event: PaymentReported
    note over Contract: State: PAID. 48h Grace Period timer starts.

    par Maker Actions
        Maker->>Contract: releaseFunds()
        Contract-->>Taker: Receives Crypto + Bond
        Contract-->>Maker: Receives Bond (minus fee)
        note over Contract: Outcome: RESOLVED ✅
    and Maker waits...
        Taker->>Contract: pingMaker() (after 48h)
        note over Contract: Maker has 24h to respond.
        Taker->>Contract: autoRelease() (after 24h)
        note over Contract: Outcome: RESOLVED ✅ (Maker penalized)
    and Maker disputes
        Maker->>Contract: challengeTrade() (after 1h cooldown)
        Contract-->>Maker: Event: DisputeOpened
        note over Contract: State: CHALLENGED.

        rect rgb(255, 230, 230)
            note over Taker, Maker: Grace Period (48 Hours) - No Decay
            Taker->>Maker: Off-chain communication (e.g., Telegram)
            alt Mutual Agreement
                Maker->>Contract: proposeOrApproveCancel() (EIP-712)
                Taker->>Contract: proposeOrApproveCancel() (EIP-712)
                Contract-->>Maker: Full Refund (Crypto + Bond)
                Contract-->>Taker: Full Refund (Bond)
                note over Contract: Outcome: CANCELED 🔄
            else No Agreement
                note over Taker, Maker: 48 hours pass...
            end
        end

        rect rgb(255, 200, 200)
            note over Taker, Maker: Bleeding Phase (10 Days) - Hourly Decay Starts
            loop Every Hour
                note over Contract: Bonds (and later Crypto) decay. <br/> Pressure to cooperate increases.
            end
            note over Taker, Maker: Parties can still agree to cancel or release anytime.
        end

        note over Contract: After 10 days of no resolution...
        Taker->>Contract: burnExpired()
        Contract->>Treasury: All remaining funds transferred
        note over Contract: Outcome: BURNED 💀 (Both parties lose)

    end
```
