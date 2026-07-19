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
