# TxODDS World Cup Hackathon Project Ideas

## Recommendation

The strongest practical concept is **ProofGuard**, an autonomous in-play market risk agent for the Trading Tools & Agents track. It offers the best balance of originality, deep TxLINE integration, demonstrability, and achievable scope.

The highest-ceiling alternative is **ProofPool**, a proof-settled prediction escrow for the Prediction Markets & Settlement track. It offers stronger on-chain depth but carries substantially more implementation risk.

> **Deadline note:** The official submission deadline is July 19, 2026 at 23:59 UTC, equivalent to July 20, 2026 at 06:59 ICT.

Official resources:

- [World Cup Hackathon](https://superteam.fun/earn/hackathon/world-cup/)
- [Trading Tools & Agents](https://superteam.fun/earn/listing/trading-tools-and-agents)
- [Prediction Markets & Settlement](https://superteam.fun/earn/listing/prediction-markets-and-settlement)
- [Consumer & Fan Experiences](https://superteam.fun/earn/listing/consumer-and-fan-experiences)

## Ranked Concepts

| Rank | Concept | Track | Prize potential | Build risk |
|---:|---|---|---|---|
| 1 | **ProofGuard — autonomous market circuit breaker** | Trading Tools & Agents | Highest realistic chance | Medium |
| 2 | **ProofPool — proof-settled prediction escrow** | Prediction Markets & Settlement | Highest technical ceiling | High |
| 3 | **Settlement Studio — visual TxLINE condition compiler** | Prediction Markets & Settlement | Strong B2B infrastructure angle | Medium |
| 4 | **Proof-of-Edge Agent Arena** | Trading Tools & Agents | Visually impressive demo | Medium |
| 5 | **PulseRooms — live fan micro-predictions** | Consumer & Fan Experiences | Fastest polished MVP | Low |

## 1. ProofGuard — Recommended

### Concept

ProofGuard is an autonomous risk controller for sportsbooks and prediction markets. It monitors a live match, detects events that create stale-market exposure, halts the affected market, verifies the event through TxLINE's on-chain proof system, and then safely reopens or settles the market.

### Core Flow

1. Consume the TxLINE scores and odds SSE streams.
2. Detect goals, red cards, VAR events, suspicious odds delays, and missing market suspensions.
3. Automatically transition a demo market from `OPEN` to `HALTED` to `VERIFYING`.
4. Fetch the corresponding Merkle proof using the real score-record sequence.
5. Call `validateStatV2` on Solana.
6. Reopen or settle the market only after successful verification.

### Dashboard

The product dashboard should show:

- Live match and odds timeline
- Current market state
- Agent decision and exact deterministic rule that triggered it
- Detection, halt, verification, and settlement latency
- Merkle-proof receipt, validation PDA, and Solana transaction or simulation
- Historical replay mode so judges can test the complete flow after matches end

### Why It Can Win

ProofGuard aligns directly with the Trading Tools & Agents judging criteria:

- **Core functionality and data ingestion:** Uses both TxLINE score and odds streams.
- **Autonomous operation:** Reacts and executes without manual intervention.
- **Defensible logic:** Uses a deterministic state machine and explicit rules.
- **Innovation:** Applies TxLINE verification to real-time market risk control.
- **Production readiness:** Addresses a credible problem for sportsbooks, market operators, and B2B intermediaries.

An LLM may explain agent decisions to users, but it should not control market halting or settlement. Critical decisions must remain deterministic and auditable.

### Smallest Compelling MVP

Implement one complete rule:

> When a goal or red card is received, automatically halt the market. Fetch and validate the corresponding TxLINE proof, then update or settle the market.

One end-to-end rule is more valuable than several partially implemented strategies.

## 2. ProofPool — Highest Technical Ceiling

### Concept

ProofPool is a sponsored prediction challenge in which rewards are locked in a Solana escrow and released using TxLINE proofs.

Example condition:

> Argentina wins, total corners exceed eight, and neither team receives a red card.

The application translates the condition into:

- Soccer stat keys
- A `validateStatV2` strategy
- An immutable market-condition hash
- An Anchor escrow PDA

When an `action=game_finalised` record arrives, a permissionless keeper retrieves the proof and atomically validates the outcome and releases the reward.

### Differentiation

ProofPool is stronger than a generic sportsbook because TxLINE verification is essential to the protocol. Positioning it as sponsor-funded fan rewards instead of user-funded wagering can also reduce legal and onboarding friction.

### Primary Risk

The application requires custom Anchor escrow and settlement logic, safe token handling, CPI integration, and a usable frontend. This gives it the highest technical ceiling but also the greatest delivery risk.

## 3. Settlement Studio

### Concept

Settlement Studio is a no-code developer tool that compiles readable soccer conditions into TxLINE validation strategies.

Example input:

```text
Team A goals > Team B goals
AND total red cards = 0
AND total corners >= 9
```

The tool outputs:

- Required `statKeys`
- Indexed `validateStatV2` predicates
- Proof request parameters
- Derived Merkle-root PDA
- Anchor or TypeScript integration code
- Live validation result and proof receipt

### Product Opportunity

TxLINE's cryptographic validation is powerful but technically detailed. Settlement Studio packages it into reusable infrastructure for prediction markets, insurance products, trading agents, and fan games.

To ensure it feels like a functioning product rather than only a proof explorer, include an automated webhook or callback that fires after successful verification.

## 4. Proof-of-Edge Agent Arena

### Concept

Multiple transparent trading agents receive the same TxLINE feed and compete using different strategies:

- Momentum
- Mean reversion
- Event-driven repricing
- Market-suspension protection

Each agent commits its signal and simulated entry before the result is known. Final performance is settled using verified match data, producing an auditable strategy leaderboard.

### Differentiation

The on-chain commitment prevents agents from backdating successful signals. TxLINE proofs make the performance record independently verifiable.

Do not market this as a traditional arbitrage detector unless another execution venue provides independently tradable prices. TxLINE provides a consensus price, so TxLINE data alone does not establish a cross-venue arbitrage opportunity.

## 5. PulseRooms

### Concept

PulseRooms is a mainstream second-screen experience where friends predict the next verified match event:

- Next corner
- Next card
- Goal before halftime
- Match winner
- Total-goal threshold

TxLINE updates the room in real time, calculates streaks, and creates shareable "I called it" receipts.

### Monetization

- Sponsored prediction rooms
- Branded match challenges
- Broadcaster engagement tools
- Premium private leagues

### Primary Risk

This is the easiest product to polish, but it competes in a track that strongly rewards originality. A standard live-score dashboard, prediction form, or AI commentator is unlikely to stand out without a distinctive social interaction model.

## Recommended Demonstration

The demo video should be no longer than five minutes and follow one clear narrative:

1. **Problem:** Live sports markets can remain exposed after important match events.
2. **Data ingestion:** A real or replayed TxLINE event enters the system.
3. **Autonomous action:** ProofGuard halts the demo market without human input.
4. **Verification:** The application fetches a Merkle proof and calls `validateStatV2` on Solana.
5. **Resolution:** A finalised score produces deterministic settlement or reopening.
6. **Reliability:** Briefly demonstrate SSE reconnection, JWT renewal, sequence deduplication, and failure handling.
7. **Architecture:** Show how TxLINE is essential to the product rather than a decorative data source.

Judges should be able to use a guest or replay mode without purchasing tokens, funding a wallet, or creating paid third-party accounts.

## Ideas to Avoid

- A generic live-score or odds dashboard
- A chatbot that merely summarizes TxLINE events
- An arbitrage scanner with no independent execution venue
- A full sportsbook or AMM that cannot be completed and demonstrated end to end
- Non-deterministic LLM-controlled settlement logic
- An "on-chain verified" badge without a real validation call and visible receipt
- Raw TxLINE data committed to the public repository

## Relevant Local Documentation

- [Problem Description](./PROBLEM_DESCRIPTION.md)
- [World Cup Free Tier](./worldcup.mdx)
- [Streaming Data](./examples/streaming-data.mdx)
- [On-Chain Validation](./examples/onchain-validation.mdx)
- [Soccer Feed](./scores/soccer-feed.mdx)
- [Quickstart](./quickstart.mdx)

## Final Decision

Build **ProofGuard** and submit it primarily to the Trading Tools & Agents track. If the product also includes a real escrow and proof-triggered fund release, it can additionally fit the Prediction Markets & Settlement track. Without that settlement component, keep the narrative focused on autonomous market risk management rather than diluting it across tracks.
