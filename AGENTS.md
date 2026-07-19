# Developer & Agent Guidelines (AGENTS.md)

Welcome to the **TxODDS World Cup Hackathon** repository. This document serves as the single source of truth for the project's overarching aims, coding standards, and agent operational rules. All developers and AI agents working on this codebase must read and strictly adhere to these rules.

---

## 🎯 Overarching Aim of the Project

The goal of this project is to build a winning submission for the **TxODDS World Cup Hackathon** on **Solana**, leveraging **TxLINE** sports data.

### Focus Area: Modular Sports Integration
We are building a clean, production-grade foundation that supports:
1. **Real-time Event Streaming:** Subscribing to and processing SSE updates for World Cup matches (odds and scores).
2. **On-Chain Settlement Verification:** Retrieving cryptographic validation proofs from the TxLINE API and validating them on-chain using the Anchor program.
3. **Autonomous Sports Agent & Prediction Scaffolding:** Implementing the core business logic required to make trading decisions, predict match outcomes, and automatically settle bets.

---

## 💻 Rules for Coding (Developer Guide)

All code written in this repository must conform to the following standards:

### 1. Stack & Architecture
* **Language:** TypeScript (`node >= 20.0.0`).
* **Solana Framework:** Coral-XYZ `@coral-xyz/anchor` and `@solana/web3.js`.
* **API Client:** Axios for HTTP requests and standard Server-Sent Events (SSE) clients for data streams.
* **Separation of Concerns:**
  * Keep Solana configurations, IDL types, and public key constants isolated in a dedicated configuration.
  * Keep on-chain program interaction logic (subscriptions, validation) separate from off-chain data processing (SSE listeners, data parsing).
  * Keep all source code in the `src/` directory (once coding begins) and helper/runnable scripts in `scripts/`.

### 2. Secret & Wallet Management (CRITICAL)
* **Zero Private Keys in Source Code:** Never hardcode private keys, mnemonic phrases, API tokens, or JWTs.
* **Environment Variables:** Use system environment variables or a `.env` file to load settings:
  * `ANCHOR_WALLET` (path to a local wallet keyfile, e.g., `./_keys/wallet.json`)
  * `ANCHOR_PROVIDER_URL` (Solana RPC endpoint, e.g., `https://api.devnet.solana.com`)
  * `X_API_TOKEN` (API token returned by activation)
* **Git Safety:** Ensure the `.env` file, any private key JSON files, and IDE configs are added to `.gitignore`.

### 3. Solana & RPC Best Practices
* **Preflight Checks:** Always run transaction simulations (`skipPreflight: false`) before executing on-chain commands to avoid wasting SOL on failed transactions.
* **RPC Rate Limits:** Handle network rate-limiting (`429 Too Many Requests`) gracefully with exponential backoff.
* **PDA Derivation:** Always derive Program Derived Addresses (PDAs) dynamically rather than hardcoding addresses.

### 4. API & Stream Reliability
* **JWT Expiry:** The guest JWT has a lifetime. Implement retry logic that fetches a new guest JWT on `401 Unauthorized` or `403 Forbidden` responses.
* **Stream Reconnection:** SSE connections can drop. Implement automatic reconnection with a randomized exponential backoff.

---

## 🤖 Rules for Agents (AI Assistant Guide)

AI agents working in this workspace must follow these rules:

### 1. Document Integrity & References
* **Documentation Preservation:** Maintain all existing developer comments and docstrings unless explicitly instructed otherwise.
* **Clickable Links:** When referencing codebase files or functions, always format them as clickable markdown links (e.g., [Quickstart](file:///Users/huutrungle2001/Documents/OnGoing/Worldcup_Hackathon/docs/quickstart.mdx)).
* **Aesthetics Matter:** If tasked with building frontend UI or visualizations, prioritize modern design (dark mode, glassmorphism, responsive grids).

### 2. Environment Verification
* **Check Networks:** Do not attempt to run mainnet transactions/activation against devnet hosts, or vice-versa. Confirm target networks match the endpoints in [Quickstart](file:///Users/huutrungle2001/Documents/OnGoing/Worldcup_Hackathon/docs/quickstart.mdx).
* **Verify Wallet Balances:** Before proposing on-chain transactions, verify the wallet has enough SOL (mainnet/devnet) to cover fees.

### 3. Project Scaffolding Rules
* **No Source Code Yet:** The repository should stay scaffolded without raw implementation code until the architecture is agreed upon. Keep template types in [types/](file:///Users/huutrungle2001/Documents/OnGoing/Worldcup_Hackathon/types) and [idl/](file:///Users/huutrungle2001/Documents/OnGoing/Worldcup_Hackathon/idl).
* **Create Scratch Scripts:** Save testing/validation scratch code under the `/Users/huutrungle2001/.gemini/antigravity-cli/brain/<conversation-id>/scratch/` directory. Do not leave stray draft scripts in the repository root.

## 6. Development Rules for Agents

### 6.1 Core Development Rules
* **Subagent Delegation**: Summon subagents whenever the task contains genuinely independent, bounded work that can be completed in parallel or benefits from a separate expert review. Give each subagent a concrete scope and success criterion, avoid delegating tightly coupled edits that would create merge conflicts, and have the primary agent verify every delegated result before integrating or reporting it.

* **Temporary & Scratch Scripts**: All one-time test codes, verification scripts, scratch files, and temporary debug tools must be written inside the `.tmp/` directory. Writing scratch or test code in the root directory or other non-temp directories is strictly prohibited.

* **Commit rule**: All commits must follow the format `<type>(optional-scope): <short message>`.
  Examples:
  ```
  feat(auth): add Google login
  fix(api): handle empty response
  docs(readme): add setup instructions
  refactor(parser): simplify join parsing logic
  test(optimizer): add regression tests
  chore(deps): update dependencies
  ```
* **Commit Signing & Verification**: The `master` branch requires all commits to be cryptographically signed (GPG, SSH, or S/MIME). Commits that are unsigned or signed with keys not associated with a verified collaborator account on GitHub will be rejected during push.
  - Agents and collaborators must configure their Git environment to sign commits (e.g., setting `commit.gpgsign` to `true` and setting `user.signingkey` to a verified SSH/GPG key registered on GitHub) before pushing to the repository.

### 6.2 Coding Guidelines
These guidelines bias toward caution over speed. For trivial tasks, use judgment.

#### 6.2.1 Think Before Coding
**Don't assume. Don't hide confusion. Surface tradeoffs.**
* State assumptions explicitly. If uncertain, ask.
* If multiple interpretations exist, present them - don't pick silently.
* If a simpler approach exists, push back when warranted.
* If something is unclear, stop and ask for clarification.

#### 6.2.2 Simplicity First
**Minimum code that solves the problem. Nothing speculative.**
* No features beyond what was asked.
* No abstractions for single-use code.
* No "flexibility" or "configurability" that wasn't requested.
* No error handling for impossible scenarios.
* If code could be simplified, rewrite/reduce it. Ask: "Would a senior engineer say this is overcomplicated?"

#### 6.2.3 Surgical Changes
**Touch only what you must. Clean up only your own mess.**
* Don't "improve" adjacent code, comments, or formatting.
* Don't refactor things that aren't broken.
* Match existing style, even if you'd do it differently.
* Remove unused imports/variables/functions created by your changes, but do not delete pre-existing dead code unless asked.

#### 6.2.4 Goal-Driven Execution
**Define success criteria. Loop until verified.**
* Transform tasks into verifiable goals (e.g., write/run tests to reproduce/verify).
* For multi-step tasks, state a brief plan with verification steps.

