# 🌀 Araf Protocol — Deep Oracle Research for P2P Escrow

## Purpose

This document studies a narrower and harder question than generic escrow comparison:

> **How have P2P escrow systems and related literature tried to solve the oracle problem, and what can Araf build that is both more unique and more difficult than standard escrow features?**

The target is not incremental UX. The target is a **category-defining primitive** for fiat ↔ crypto settlement.

---

## 1. Executive Thesis

Araf’s current philosophy is clear: it is **non-custodial, humanless, and oracle-independent**, and it resolves disputes using on-chain timers and economic game theory rather than external truth adjudication. fileciteturn13file0 The contract itself hard-codes this approach through state transitions such as `PAID → CHALLENGED → BLEEDING → BURNED`, along with time-decay and mutually exclusive ping paths. fileciteturn10file0

That gives Araf architectural honesty. But it does **not yet make Araf a new category**.

The deeper research outcome is this:

# **The real frontier is not “using an oracle to decide truth.” It is “using attestations to change economic physics without ever granting verdict authority.”**

That is the strongest direction for Araf.

In other words:

- do **not** add a classic oracle that says “payment happened”
- do **not** add a moderator replacement in cryptographic clothing
- do **build** a system where external proofs can **modulate decay, penalties, waiting windows, and liveness rights**
- keep final settlement inside the protocol’s own deterministic closure logic

This leads to a potentially category-defining concept:

# **Attestation-Weighted Bleeding Escrow**

or, more aggressively:

# **Oracle Without Verdict**

---

## 2. What the Oracle Problem Actually Is in Fiat Escrow

In fiat ↔ crypto escrow, the hard problem is not merely “did a transfer occur?”

It is at least five separate problems:

### 2.1 Existence
Did any off-chain payment event happen at all?

### 2.2 Authenticity
Did the evidence come from a real bank or payment interface, rather than a forged screenshot or fabricated document?

### 2.3 Attribution
Was the payment made by the correct person or expected account holder?

### 2.4 Finality
Is the payment irreversible, or can it be canceled, charged back, or clawed back later?

### 2.5 Semantic meaning
Even if a payment occurred, does it correspond to **this** trade, **this** amount, **this** counterparty, and **this** settlement window?

Most systems fail because they compress all five into one fantasy question:

> “Can the protocol know who is right?”

Usually the answer is no.

That is why many escrow systems retreat to one of three positions:

1. **human judgment**
2. **custodial override**
3. **economic timeout**

Araf is already in bucket 3. The question is whether it can evolve into a stronger form without collapsing into buckets 1 or 2.

---

## 3. Existing Solution Families in the Wild

### 3.1 Human arbitration as oracle

Bisq explicitly combines P2P networking, multisignature escrow, and a human arbitration system. Its own README says Bisq is non-custodial and uses multi-signature escrow, but also “incorporates a human arbitration system to resolve disputes.” fileciteturn15file0

What this means conceptually:
- there is no machine-verifiable proof of fiat truth
- the protocol falls back to humans who review context and evidence
- the “oracle” is therefore social and procedural

**Strength:** nuanced real-world dispute handling

**Weakness:** slow, subjective, operationally heavy, and not humanless

**Araf takeaway:** if Araf copies this path, it stops being Araf.

---

### 3.2 Bonded custody minimization without explicit truth oracle

RoboSats takes a very different route. Its README explains that it minimizes custody and trust using lightning hold invoices, and its flow uses maker and taker bonds plus automatic bond return or loss depending on compliance. fileciteturn16file0

What this means conceptually:
- the system does not prove fiat truth
- it shapes behavior with bonds and a highly structured workflow
- it replaces truth resolution with incentive alignment and coordinator-enforced protocol flow

**Strength:** very strong privacy and low oracle dependence

**Weakness:** mostly Bitcoin/Lightning-shaped; still does not solve general fiat proof semantics

**Araf takeaway:** this is closer to Araf’s philosophical family than Bisq.

---

### 3.3 Jury-based arbitration as decentralized oracle

Kleros does not pretend to eliminate external judgment. Its contracts and documentation revolve around arbitrable / arbitrator patterns, and its repository points developers to arbitrable and arbitrator contract standards. fileciteturn17file0

Conceptually:
- jurors become the truth layer
- the oracle is decentralized, but still human
- the protocol gains nuance but sacrifices determinism and latency

**Strength:** richer dispute semantics, partial outcomes, evidence review

**Weakness:** still a verdict system, just crowd-sourced

**Araf takeaway:** excellent reference for what **not** to become if the goal remains humanless.

---

### 3.4 Trusted hardware oracles

Town Crier is one of the clearest oracle research references. Its own README defines it as “an authenticated data feed for smart contracts,” emphasizing that current oracles provide weak provenance/confidentiality and that Town Crier uses trusted hardware (Intel SGX) to provide stronger guarantees and confidential queries. fileciteturn18file0

Conceptually:
- the oracle is no longer a person, but a TEE-backed trusted execution path
- it can fetch authenticated web data and expose it to contracts
- it tries to solve the provenance problem directly

**Strength:** stronger authenticity guarantees than a normal backend

**Weakness:** trust shifts to hardware, enclave security, remote attestation assumptions, and service operators

**Araf takeaway:** important not because Araf should become SGX-based by default, but because Town Crier proves that “web truth” can be translated into smart-contract consumable claims.

---

### 3.5 TLS proof systems / web-page notarization

TLSNotary is even more directly relevant to fiat escrow. Its README states that it allows a user to prove to an auditor that a certain HTTPS page is present in a web browser without compromising credentials, and explicitly gives the example of proving that an online bank transfer was made. fileciteturn19file0

This is crucial.

TLSNotary is not “a bank oracle” in the usual API-feed sense. It is:
- an authenticated transcript/proof family
- focused on proving what a web session showed
- able to attest to a bank page or transfer confirmation without revealing everything

**Strength:** much closer to the real escrow problem than price-feed oracles

**Weakness:** it proves a page/session statement, not necessarily irreversibility, rightful linkage, or durable settlement finality

**Araf takeaway:** this is the single most important research direction for Araf if the goal is uniqueness without surrendering architectural integrity.

---

## 4. The Deep Insight: “Payment Oracle” Is the Wrong Frame

The dominant instinct is:

> “Let’s find an oracle that tells the contract whether the payment happened.”

That is the wrong design target.

A stronger framing is:

> “Can external attestations alter the strategic incentives of the dispute machine without becoming the final judge?”

This shift matters because classic oracle integration creates four dangers:

### 4.1 Binary authority creep
Once an oracle can say “paid / unpaid,” it becomes the hidden judge.

### 4.2 Fragility
If the oracle is unavailable, compromised, censored, or incompatible with a rail, the whole system’s truth layer breaks.

### 4.3 Jurisdictional and privacy risk
To consume banking truth, the oracle may need access to highly sensitive data.

### 4.4 False ontological confidence
A positive proof of a payment page is not the same as proof of settlement finality, ownership legitimacy, or non-reversibility.

Therefore, the strongest path for Araf is not “oracle decides release.”

The strongest path is:

# **Oracle-like attestations influence the decay machine, but never own the verdict.**

---

## 5. Research-Derived Design Space for Araf

Below are the most serious and difficult directions.

---

## 6. Direction A — Attestation-Weighted Bleeding Escrow

### Core idea
A cryptographic proof or authenticated attestation should **not release funds**.

Instead, it should modify one or more of the following:
- bond decay slope
- grace period length
- crypto decay start
- auto-release eligibility
- negligence penalty
- mutual cancel fee rules

### Example
Suppose the Taker submits a high-confidence proof package:
- bank transfer confirmation attestation
- payer name assertion
- timestamped proof within trade window

The protocol does **not** say “therefore the Taker wins.”

Instead it says:
- maker bond decay goes from 26 BPS/h to 48 BPS/h
- taker bond decay drops from 42 BPS/h to 12 BPS/h
- crypto decay start is postponed by 48h

Now the dispute machine is still deterministic and non-judicial.
But the **physics of non-cooperation** has changed.

### Why this is unique
This is not a classic oracle.
This is not classic arbitration.
This is not simple no-oracle economics either.

It is:

> **proof-sensitive economics without proof-sensitive custody authority**

That is a novel category.

### Why it fits Araf
Araf already treats time as the neutral forcing function. fileciteturn13file0 fileciteturn10file0
Attestation-weighting does not destroy that. It refines it.

### Why it is hard
Because it requires:
- proof schema design
- proof confidence scoring
- on-chain compact encoding of evidence classes
- strict separation between **evidence affects risk** and **evidence decides truth**

### Best name
- **Attestation-Weighted Bleeding**
- **Proof-Modulated Escrow**
- **Oracle Without Verdict**

Of the three, the strongest product name is probably:

# **Oracle Without Verdict**

---

## 7. Direction B — Counterfactual Oracle Commitments

### Core idea
The parties should choose, at listing creation time, which evidence families count as valid modifiers in a later dispute.

That means each listing carries a kind of mini-constitution:
- accepted proof families
- accepted payment rail evidence types
- whether name matching matters
- whether bank-origin assertion matters
- whether open-banking evidence counts
- whether TLS proof counts
- what those proofs are allowed to affect

### Why this matters
It prevents post-dispute narrative drift.
The parties do not argue later about what counts as evidence.
They pre-commit.

### Result
The oracle policy becomes part of the listing’s canonical rules.

### Why this is unique
Very few systems make **evidence admissibility itself** a trade-level primitive.

This turns each listing into a programmable settlement constitution.

### Best framing
> **Araf listings can carry their own evidence constitution.**

That is a strong and unusual idea.

---

## 8. Direction C — Positive-Proof-Only Oracle Design

### Deep principle
In fiat settlement, “proof of payment” is much easier than “proof of non-receipt.”

A bank page can show:
- transfer initiated
- transfer confirmed
- sender name
- recipient identifier
- timestamp

But proving that the recipient **did not receive** money is much harder, often impossible, and often privacy-invasive.

### Implication for Araf
Araf should never attempt symmetrical truth logic.

Instead, it should admit only **positive attestations** and let them affect incentives asymmetrically.

Examples of positive attestations:
- transfer confirmation page proof
- sender-name match assertion
- bank-origin session proof
- signed payment instruction proof
- authenticated receipt payload proof

### Why it matters
This prevents Araf from pretending that both sides can prove equally rich facts.
That would be false.

### New principle for Araf
> **Araf should be proof-asymmetric by design.**

This is subtle but powerful.

---

## 9. Direction D — Multi-Source Attestation Thresholds

### Core idea
A single source should never flip the economics too aggressively.

Instead, Araf can require **k-of-n attestation coherence**.

For example:
- TLS proof of bank confirmation
- payer-name assertion
- rail-specific metadata match
- trade-window timestamp match

Only if 2 of 3 or 3 of 4 conditions are met does the protocol alter bleeding substantially.

### Why this is valuable
It reduces trust in any single oracle family.

### Why it is hard
This requires:
- a compact attestation taxonomy
- a confidence model
- aggregation logic
- anti-spam / anti-forgery economics

### Why it is unique
This would create a system where:
- no single oracle decides the outcome
- evidence becomes composable
- risk moves gradually, not absolutely

That is much more sophisticated than a binary oracle feed.

---

## 10. Direction E — Encrypted Evidence Vault with Delayed Revelation

### Core idea
Araf should preserve privacy by default, but allow stronger proof submission under dispute.

Flow:
1. user creates evidence package locally
2. package is encrypted client-side or wallet-scoped
3. only a hash / commitment is placed on-chain or in canonical storage
4. during dispute, selective revelation is possible
5. revealed evidence changes **bleeding weights**, not custody authority

### Why this matters
This matches the hybrid privacy model Araf already embraces for PII and encrypted receipts. fileciteturn13file0

### Why this is unique
Most systems force a bad binary choice:
- no evidence
- or full disclosure to moderator/support

Araf could create a third way:

> **evidence can exist, remain private, and still alter incentives when selectively revealed**

---

## 11. Direction F — Proof-Carrying Payment Rails

### Core idea
Every payment rail should declare its proof affordances upfront.

Examples:

| Rail | Proof Affordance |
|---|---|
| simple bank transfer | TLS statement proof possible |
| fast transfer rail | stronger timestamp semantics |
| open banking API rail | API attestation possible |
| cash deposit | weak digital proof |
| high-reversal rail | low proof reliability, higher bonds |

### Why this matters
Different rails are not merely different in risk. They are different in **provability**.

This is even more fundamental than risk classification.

### Strong product framing
> **Araf does not only classify payment rails by reversal risk. It classifies them by proof geometry.**

That is a real differentiator.

---

## 12. Direction G — Open-Banking Attestation Adapters

### Core idea
Where rails support structured banking APIs or regulated account-information APIs, Araf can integrate adapters that produce signed attestations.

Important constraint:
- these attestations should not directly release escrow
- they should only feed the attestation-weight engine

### Why this matters
If done carefully, this allows Araf to benefit from rails with better machine-readable provenance **without becoming API-custodial**.

### Why it is hard
- jurisdiction fragmentation
- consent flow
- privacy/storage law
- adapter standardization
- revocation / replay semantics

### Why it could matter strategically
It creates a moat that is both product and infrastructure.

---

## 13. Direction H — Name-Match Assertions Instead of Raw PII Disclosure

Araf already understands the importance of real-name / bank-owner information in off-chain settlement flows, and the broader architecture already keeps PII encrypted off-chain. fileciteturn13file0

The more advanced version is not “show the full real name.”
It is:
- `NAME_MATCH_STRONG`
- `NAME_MATCH_WEAK`
- `BANK_OWNER_ASSERTED`
- `PAYMENT_ORIGIN_INCONSISTENT`

### Why it matters
This creates a privacy-preserving proof surface.

### Why it is more unique than basic name reveal
Because the protocol consumes **assertions**, not merely plaintext.

This is closer to long-term zk / selective disclosure design.

---

## 14. Direction I — Attestation-Triggered Liveness Rights

### Core idea
Evidence should not only affect decay slopes. It can also affect who gets liveness rights sooner.

Example:
- if the Taker submits a valid positive payment attestation, the required wait before `pingMaker()` shrinks
- if the Maker submits a valid pre-payment inconsistency attestation, challenge eligibility opens faster

### Why this matters
This changes **tempo**, not verdict.

That is entirely consistent with Araf’s philosophy: time remains the neutral enforcer, but attestation changes how much time each side is granted.

### Why this is strong
It creates a machine where evidence changes urgency rather than authority.

That is very elegant.

---

## 15. Direction J — Oracle Escalation Ladder

### Core idea
Not all trades need the same proof machinery.

Araf can define an escalation ladder:

1. **No-oracle mode** — current pure Araf logic
2. **Evidence-commit mode** — encrypted evidence commitments allowed
3. **Attestation-weighted mode** — approved proof families can shift decay
4. **Multi-source threshold mode** — high-value trades require k-of-n coherence

### Why this matters
It preserves the simplicity of the base protocol while opening a path to more sophisticated flows.

### Why it is better than a monolithic oracle feature
Because it keeps the product legible:
- small trades stay simple
- hard trades get stronger evidence layers

---

## 16. Direction K — Research-Grade Primitive: Verifiable Fiat Event Capsules

This is the hardest and most original direction.

### Concept
A **Fiat Event Capsule** would be a compact object containing:
- payment rail type
- event timestamp
- sender assertion
- recipient assertion
- amount band or exact amount commitment
- proof family identifier
- confidence level
- disclosure policy
- replay-protection nonce

A capsule could come from:
- TLS proof workflow
- open-banking adapter
- user-generated cryptographic proof flow
- future zkTLS/DECO-style attestations

### Critical constraint
A capsule does **not** say “pay out to X.”
It only says:
- this trade now runs under a different bleeding profile
- this side has earned faster liveness escalation
- this side’s bond discount/penalty changes

### Why this is category-defining
Because then Araf is no longer just an escrow.
It becomes:

> **a protocol for turning off-chain fiat events into bounded, non-sovereign economic signals**

That is much more original than another marketplace feature.

---

## 17. Direction L — “Right to Be Forgotten” Compatible Proof Architecture

The hardest version of this problem is not merely proving payment.
It is proving payment while preserving:
- privacy
- deletability
- legal minimization
- low trust in backend

Araf’s current hybrid model already strongly values off-chain encrypted PII and narrow disclosure. fileciteturn13file0

The unique research direction is:

> **How do we let evidence alter protocol economics while remaining deletable and non-custodial?**

This may require:
- off-chain ciphertext retention windows
- only commitments on-chain
- revocable storage pointers
- wallet-scoped decryption
- selective disclosure attestations

This is not just product work. It is publishable design work.

---

## 18. What the Literature Implies for Araf

From the systems examined:

- **Bisq** shows that human arbitration solves nuance, but violates the humanless ideal. fileciteturn15file0
- **RoboSats** shows that strong bond/game design can minimize trust without proving fiat truth. fileciteturn16file0
- **Kleros** shows that decentralized verdict systems exist, but they are still verdict systems. fileciteturn17file0
- **Town Crier** shows that authenticated external data feeds can be made stronger through trusted execution. fileciteturn18file0
- **TLSNotary** shows that bank/web-session statements can, in principle, be proven without full trust in a normal backend. fileciteturn19file0

The synthesis is:

### Araf should not become:
- a support desk
- a moderator protocol
- a jury protocol
- a binary payment oracle system

### Araf should become:
- a **deterministic closure protocol**
- with **optional, privacy-preserving, cryptographically attested evidence inputs**
- that **change the economics of delay and non-cooperation**
- without ever becoming a truth-sovereign

That is the deepest coherent evolution path.

---

## 19. Strongest New Category Statement

If Araf pursues this line seriously, the clearest differentiator is:

# **Araf can become the first humanless fiat escrow where external proofs change incentives, not verdicts.**

Alternative formulations:

- **Oracle Without Verdict**
- **Attestation-Weighted Escrow**
- **Proof-Modulated Bleeding Escrow**
- **Cryptographically Attested, Non-Judicial Settlement**

The strongest one for product and philosophy is probably:

# **Oracle Without Verdict**

because it says exactly what is new.

---

## 20. Best Next-Step Research Track for Araf

### Track 1 — Protocol theory
Design a formal model for attestation-weighted bleeding:
- state machine extensions
- evidence admissibility
- confidence thresholds
- decay modulation rules
- anti-spam economics

### Track 2 — Proof source taxonomy
Map payment rails to proof families:
- no proof
- screenshot only
- backend-encrypted receipt only
- TLS statement proof
- name assertion
- open-banking attestation
- multi-source threshold

### Track 3 — Privacy model
Define what can be:
- stored encrypted
- committed on-chain
- revealed selectively
- deleted safely

### Track 4 — Minimal viable implementation
The most practical MVP is not full DECO/zkTLS.
It is:

1. evidence commitments
2. attestation class registry
3. proof-weighted bleeding multipliers
4. no direct release authority

That alone would already be highly differentiated.

---

## 21. Final Recommendation

If the goal is to become genuinely difficult to copy and philosophically distinct, Araf should not chase ordinary marketplace differentiators.

It should build this:

# **A humanless escrow where off-chain payment evidence is admissible only as a modifier of economic pressure, never as a final judge.**

That keeps Araf’s soul intact:
- no moderator
- no oracle verdict
- no custody
- no fake certainty

But it also pushes the design frontier much further than standard P2P escrow.

---

## 22. Working Title for a Future Araf Research Section

If this becomes a design initiative, the best section title is:

# **Araf Research Track — Oracle Without Verdict**

Possible subsection titles:
- Evidence as Economic Signal
- Attestation-Weighted Bleeding
- Proof Geometry of Payment Rails
- Positive-Proof-Only Escrow Design
- Fiat Event Capsules
- Privacy-Preserving Admissibility

---

## Sources Consulted

- Araf Protocol canonical architecture and philosophy: oracle-independent, humanless, non-custodial design fileciteturn13file0
- ArafEscrow.sol state machine, timers, cancel flow, decay logic, reputation and anti-sybil mechanisms fileciteturn10file0
- Bisq README: P2P networking, multi-signature escrow, human arbitration fileciteturn15file0
- RoboSats README: Lightning hold invoices, maker/taker bonds, custody minimization fileciteturn16file0
- Kleros contracts repo README and arbitrable / arbitrator reference direction fileciteturn17file0
- Town Crier README: authenticated data feed for smart contracts via trusted hardware fileciteturn18file0
- TLSNotary README: proving HTTPS pages such as online bank transfer pages without exposing credentials fileciteturn19file0
