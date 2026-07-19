# ProofGuard Implementation Plan

## 1. Product Goal

Build a deployed, autonomous market-risk agent that consumes TxLINE World Cup
scores and odds, halts a virtual in-play market when a critical match event
occurs, verifies the event through TxLINE's Solana program, and then safely
reopens or settles the market.

ProofGuard is primarily a **Trading Tools & Agents** submission. Its core value is a deterministic, auditable circuit breaker for sportsbooks and prediction-market operators.

## 2. MVP Definition

The MVP will demonstrate one complete path:

1. Receive a goal event from the TxLINE scores stream.
2. Halt the affected virtual match market immediately.
3. Correlate the goal with the latest odds and measure repricing latency.
4. Fetch a score proof using the event's real fixture ID and sequence number.
5. Validate the goal count with `validateStatV2` against the TxLINE Solana program.
6. Reopen the market only after the proof passes and newer odds are available.
7. On `action=game_finalised` with `statusId=100` and `period=100`, validate both teams' final goal totals and mark the market settled.
8. Display the complete decision and proof trail in a public dashboard.

The market is a simulation with no real funds. The MVP does **not** require a custom Anchor program or token custody.

## 3. Success Criteria

The MVP is complete when all of the following are true:

- TxLINE subscription and activation work on one explicitly selected network.
- Scores and odds SSE streams reconnect automatically with randomized exponential backoff.
- A `401` renews the guest JWT and reconnects without replacing the API token.
- Events are normalized and deduplicated by stable identifiers such as fixture ID and score sequence.
- A goal deterministically moves the virtual market from `OPEN` to `HALTED` without human input.
- Proof retrieval uses the observed score sequence; synthetic or zero sequences are rejected.
- `validateStatV2` derives `daily_scores_roots` from the proof timestamp and returns a successful result.
- Validation can be submitted with `skipPreflight: false` to produce a visible Solana receipt; read-only simulation remains available for diagnostics.
- Missing, delayed, or invalid proofs leave the market halted.
- A finalised event settles the virtual market exactly once.
- Live and historical-replay modes pass through the same normalization and rule engine.
- The deployed dashboard can be evaluated without requiring judges to fund a wallet, purchase tokens, or expose credentials.
- Unit and integration tests cover the critical state transitions and failure cases.

## 4. Scope

### In Scope for MVP

- Devnet-first TxLINE subscription, activation, and credential renewal
- Scores SSE and odds SSE ingestion
- Fixture selection from the fixtures snapshot
- Historical scores replay for demonstration when the endpoint has eligible data
- Synthetic schema-compatible replay for rule-engine tests only
- One goal circuit-breaker rule
- Final score settlement rule
- Virtual market state and append-only audit history
- Score proof retrieval and `validateStatV2`
- On-chain validation receipt or simulation details
- Responsive dark-mode operator dashboard
- Health, connection, latency, and error indicators
- Deployment, documentation, test instructions, and demo preparation

### Deferred Until the MVP Works

- Red-card and VAR circuit-breaker rules
- Multiple simultaneous fixtures
- Persistent production database
- User accounts, roles, and organization management
- Notifications through Telegram, email, or webhooks
- Advanced stale-odds anomaly models
- Mainnet deployment
- Custom Anchor market, escrow, AMM, or custody
- Real-money trading or wagering
- LLM-generated operator explanations

### Explicit Non-Goals

- Claiming cross-bookmaker arbitrage from a single consensus feed
- Allowing an LLM to halt, reopen, or settle a market
- Redistributing raw TxLINE data in the public repository
- Mixing mainnet and devnet hosts, program IDs, credentials, IDLs, or RPC endpoints
- Hardcoding wallets, tokens, JWTs, proof PDAs, or private keys

## 5. User Experience

The primary user is a sportsbook or prediction-market risk operator.

The dashboard has four focused areas:

1. **Match header:** teams, score, phase, connection health, and data freshness.
2. **Virtual market:** current state, implied probabilities, halt reason, and last transition.
3. **Agent timeline:** normalized events, rule evaluations, odds latency, retries, and decisions.
4. **Proof receipt:** fixture ID, sequence, stat keys, proof timestamp, derived PDA, validation result, network, and Solana signature or simulation logs.

The main demo should require no manual action beyond selecting a fixture or starting a replay. The agent must perform all risk decisions itself.

## 6. State Machine

The market state machine is the product's source of truth:

```text
OPEN
  | goal detected
  v
HALTED
  | proof request started
  v
PROOF_PENDING
  | proof valid + newer odds available + match not final
  v
OPEN

PROOF_PENDING
  | proof unavailable/invalid
  v
HALTED

OPEN or HALTED
  | game_finalised observed
  v
FINAL_PROOF_PENDING
  | final goals proof valid
  v
SETTLED
```

Rules:

- Duplicate or older sequences cannot cause another transition.
- Proof failure never reopens or settles a market.
- Reopening requires both a valid goal proof and a newer odds update than the triggering score event.
- Final settlement requires a real `game_finalised` record with `statusId=100` and `period=100`.
- Every transition writes an immutable audit entry containing the triggering event and reason code.

## 7. System Architecture

```text
TxLINE guest auth + activation
              |
              v
Scores SSE ----+---- Odds SSE
       \              /
        v            v
       Ingestion, normalization, deduplication
                        |
          +-------------+-------------+
          |                           |
          v                           v
  Deterministic rule engine     Proof orchestrator
          |                           |
          v                           +--> TxLINE proof API
  Virtual market state                +--> Solana validateStatV2
          |                           |
          +-------------+-------------+
                        v
                  Audit event store
                        |
                        v
               HTTP/SSE dashboard API
                        |
                        v
                 React operator UI

Historical endpoint --> Replay scheduler --> same ingestion boundary
```

### Proposed Module Boundaries

All implementation will remain under `src/`, with runnable operational helpers under `scripts/`:

- `src/config/` — network profiles, environment validation, program constants
- `src/txline/` — guest auth, activation, API client, snapshots, and SSE connections
- `src/domain/` — normalized events, virtual market types, and invariants
- `src/agent/` — rules, state machine, deduplication, and audit events
- `src/solana/` — provider creation, PDA derivation, proof mapping, simulation, and submission
- `src/replay/` — historical replay scheduling and synthetic test events
- `src/server/` — health, state, timeline, proof, and browser event-stream endpoints
- `src/web/` — responsive React dashboard
- `scripts/` — subscription/activation, connectivity checks, and controlled demo helpers

Secrets remain server-side. The browser receives only sanitized market state, audit records, and public Solana identifiers.

## 8. Network and Security Approach

Development defaults to **devnet**. Mainnet is a separate, optional release gate.

Before any transaction:

- Verify `ANCHOR_PROVIDER_URL`, TxLINE API host, program ID, TxL mint, IDL, and wallet all target the same network.
- Verify the wallet has enough SOL on that network.
- Simulate the transaction and use `skipPreflight: false` for submission.
- Derive every PDA dynamically.

Required secrets:

- `ANCHOR_WALLET`
- `ANCHOR_PROVIDER_URL`
- `X_API_TOKEN` after activation

Runtime JWTs and API tokens must never be returned to the browser or written to logs. `.env`, wallet JSON files, and runtime replay data remain ignored by Git.

## 9. Reliability Model

- Retry HTTP `429` and transient `5xx` responses with capped exponential backoff and jitter.
- Renew the guest JWT on `401`; treat `403` as a network, subscription, or bundle configuration error.
- Reconnect dropped SSE streams with jitter and a maximum retry cap that resets after a healthy interval.
- Deduplicate score records by fixture ID and observed sequence.
- Track separate freshness timestamps for scores, odds, Solana RPC, and the dashboard connection.
- Keep the virtual market halted when proof or data freshness is uncertain.
- Make state transitions idempotent so reconnects and replay cannot settle twice.

## 10. Delivery Milestones

| Milestone | Outcome | Estimate |
|---|---|---:|
| M0 — Architecture gate | Network, MVP, state machine, and interfaces approved | 0.5 day |
| M1 — Foundation | TypeScript project, configuration, logging, and tests run locally | 0.5 day |
| M2 — TxLINE connection | Subscription/activation, snapshots, both SSE streams, and reconnects work | 1 day |
| M3 — Autonomous agent | Goal rule, deduplication, virtual market, and audit trail work | 0.75 day |
| M4 — Verification | Proof retrieval, PDA derivation, simulation, and validation receipt work | 1 day |
| M5 — Product UI | Live/replay dashboard demonstrates the complete state machine | 1 day |
| M6 — Hardening and release | Failure tests, deployment, README, feedback, and demo video are ready | 1 day |

Expected solo delivery: **approximately 5–6 focused working days**, assuming a funded wallet and valid TxLINE access are available. A shorter build should cut deferred features, not validation, reliability, or testing.

> **Schedule reality:** The published hackathon deadline is July 19, 2026 at
> 23:59 UTC. This full MVP is not responsibly deliverable from the current
> documentation-only scaffold within the remaining deadline window. The
> estimate above is the realistic implementation schedule to use if an
> extension, late-submission path, or post-hackathon continuation is available.

## 11. Test Strategy

- **Unit tests:** normalizers, event keys, rule predicates, state transitions, backoff, and PDA epoch-day derivation.
- **Fixture tests:** schema-compatible synthetic score and odds messages, including duplicate and out-of-order sequences.
- **Integration tests:** mocked `401`, `403`, `429`, stream disconnects, delayed proof availability, and invalid proof shapes.
- **Devnet smoke tests:** subscription status, stream connectivity, one real proof simulation, and one submitted validation transaction.
- **End-to-end demo test:** historical event enters, market halts, proof validates, newer odds arrive, market reopens, final event settles once.

## 12. Release and Demo Plan

Deploy one public application containing the backend worker and frontend so stream state is consistent. Provide:

- Live mode when a covered fixture is active
- Historical replay mode backed by TxLINE's historical endpoint when data is eligible
- Clearly labeled synthetic mode for UI and state-machine testing only
- Health page and preflight diagnostics
- Public repository and setup instructions
- Network, program ID, endpoints, and Solana receipts in the UI
- A demo video under five minutes
- A concise TxLINE integration list and honest API feedback

The demo narrative is:

1. Show an open market and healthy live connections.
2. Inject or replay a goal record through the normal ingestion boundary.
3. Watch ProofGuard halt automatically.
4. Show proof retrieval, PDA derivation, and `validateStatV2`.
5. Show a newer odds update and safe reopening.
6. Replay `game_finalised` and show one-time settlement.
7. Briefly demonstrate a disconnect or invalid proof keeping the market safe.

## 13. Architecture Approval Gate

Implementation should begin only after the project owner approves these decisions:

- Devnet-first network strategy
- Virtual market with no funds or custom Anchor program
- Goal and finalisation as the only mandatory MVP rules
- Single actively monitored fixture for the first release
- One deployable TypeScript service with a React dashboard
- Historical replay plus synthetic test mode

Detailed implementation and progress tracking live in [TODO.md](./TODO.md).
