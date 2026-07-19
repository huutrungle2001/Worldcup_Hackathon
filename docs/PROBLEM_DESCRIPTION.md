# World Cup Hackathon — Superteam Earn & TxODDS

Welcome to the TxODDS World Cup Hackathon workspace. This document outlines the problem description, tracks, rules, deadlines, and eligibility criteria for the hackathon.

---

## 🏆 Overview

* **Host Platform:** [Superteam Earn](https://superteam.fun/earn/hackathon/world-cup)
* **Sponsor:** **TxODDS** (TxLINE - High-Performance On-Chain Sports Data Layer)
* **Prize Pool:** **$50,000 USD**
* **Duration:** 24 June – 19 July 2026
* **Winner Announcement:** 29 July 2026

Developers are challenged to build innovative sports, trading, and consumer products powered by **TxLINE**, a cryptographically verifiable sports data layer anchored to the **Solana** blockchain.

---

## 🛤️ Submission Tracks

The hackathon features **three tracks** with a total prize pool of $50,000:

### 1. Prediction Markets & Settlement ($18,000)
* **Objective:** Build prediction markets, settlement protocols, oracle infrastructure, or on-chain verification systems.
* **Key Challenge:** Leverage TxLINE’s Merkle proof validation system to settle sports predictions or bets on-chain without relying on centralized administrators or multi-sigs.
* **Technological Focus:** Solana programs (Rust/Anchor) interacting with the TxLINE pricing matrix and verification PDAs.

### 2. Trading Tools & Agents ($16,000)
* **Objective:** Design autonomous trading agents, analysis dashboards, alerts, or automation tools.
* **Key Challenge:** Consume real-time match events and consensus betting odds via TxLINE Server-Sent Events (SSE) streams, identify inefficiencies, generate signals, and execute programmatic strategies with cryptographically verified data.
* **Technological Focus:** Backend scripts, trading bots, event streaming (SSE), data analytics, and automated wallet signing.

### 3. Consumer & Fan Experiences ($16,000)
* **Objective:** Create engaging user-facing fan experiences, mini-games, social features, or live companion apps.
* **Key Challenge:** Design rich visual experiences that integrate real-time World Cup fixtures, live scores, and odds.
* **Technological Focus:** Frontend frameworks (Next.js, React), styling (CSS/Tailwind), mobile-responsive layouts, and interactive wallet connectors.

---

## 🔑 Key Resources & Data Access

To facilitate building, TxODDS provides a **World Cup Free Tier** that does not require any TxL payment (only standard Solana SOL transaction fees).

### 1. Developer Documentation
The official TxLINE documentation is cloned locally inside the [docs/](file:///Users/huutrungle2001/Documents/OnGoing/Worldcup_Hackathon/docs) folder:
* **Getting Started & Setup:** [Quickstart](file:///Users/huutrungle2001/Documents/OnGoing/Worldcup_Hackathon/docs/quickstart.mdx)
* **Free Tier Details:** [World Cup Free Tier](file:///Users/huutrungle2001/Documents/OnGoing/Worldcup_Hackathon/docs/worldcup.mdx)
* **Tiers & Pricing:** [Subscription Tiers](file:///Users/huutrungle2001/Documents/OnGoing/Worldcup_Hackathon/docs/subscription-tiers.mdx)

### 2. Networks and Program Addresses
Always use the correct network credentials:

| Network | Program ID | TxL Mint Address | API Base Host |
| :--- | :--- | :--- | :--- |
| **Mainnet** | `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA` | `Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL` | `https://txline.txodds.com` |
| **Devnet** | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` | `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG` | `https://txline-dev.txodds.com` |

---

## 📊 Provided Data

The following data resources are configured in the [data/](file:///Users/huutrungle2001/Documents/OnGoing/Worldcup_Hackathon/data) directory:
* **Leagues Coverage:** [SoccerSupportedLeagues.csv](file:///Users/huutrungle2001/Documents/OnGoing/Worldcup_Hackathon/data/SoccerSupportedLeagues.csv) lists all covered soccer leagues.
* **JSON Schemas:** Structured JSON event schemas for scoring and match events are available in [data/schemas/](file:///Users/huutrungle2001/Documents/OnGoing/Worldcup_Hackathon/data/schemas) (including basketball and US football).

---

## 📝 Submission & Eligibility Requirements

To qualify for prizes, you must provide:
1. **Public Repository:** Link to your public GitHub repository containing clean, documented source code.
2. **Working MVP:** Link to your live, publicly accessible working Minimum Viable Product.
3. **Demo Video:** A short, publicly viewable video (YouTube, Loom, etc.) explaining your project and demonstrating its functionality.
4. **Social post (Optional):** Link to an X post or profile for your project.
