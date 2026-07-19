# ProofGuard Submission Demo Script

This script is a step-by-step walkthrough guide for recording the **ProofGuard** hackathon submission video.

---

## 🎬 Act 1: Introduction & The Problem (0:00 - 0:30)

**[Visual]**
*Screen starts on the **ProofGuard Dashboard** (http://localhost:3000) showing the clean dark-mode UI.*

**[Speech / Voiceover]**
> "Hi everyone, welcome to the demo of **ProofGuard**. 
> 
> In sports betting, bookmakers face a major challenge called **latency arbitrage** or **courtsiding**. When a goal is scored in a match, there's a lag of a few seconds before the odds feeds update. Exploitative bots use this delay to place bets on outdated, high odds.
> 
> **ProofGuard** solves this by acting as an autonomous, low-latency risk agent and circuit breaker powered by **Solana** and **TxLINE** data."

---

## 🎬 Act 2: Above-the-Fold & Scaffolding (0:30 - 1:00)

**[Visual]**
*Scroll slightly to highlight the **What is ProofGuard?** section and the **ProofGuard Journey** strip:*
*`Goal detected → Market halted → Solana proof checked → Fresh odds reopen market`*

**[Speech / Voiceover]**
> "Here on the dashboard, we have a clear overview of the ProofGuard journey. 
> 
> The system monitors the live feed. The moment a goal is detected, it halts the virtual market. It then verifies the score using cryptographic proofs validated on the Solana blockchain. Only when fresh odds arrive does the market reopen.
> 
> At the top right, you can see all our system health checks are green, showing active connection to TxLINE streams and the Solana devnet RPC."

---

## 🎬 Act 3: Starting the Historical Replay (1:00 - 1:45)

**[Visual]**
*Under the **Historical Demo Controller**, set the speed to **10x** or **50x**.*
*Click the **Run historical demo (Fixture #18257739)** button.*
*Show the progression bar and step counter immediately starting to move.*

**[Speech / Voiceover]**
> "Let's run a simulation using real historical score data from the World Cup match between **Spain** and **Argentina** (Fixture #18257739). 
> 
> We'll set the speed to **10x** and trigger the historical demo. The progression bar instantly updates, showing the live events replaying from the TxLINE snapshot.
> 
> In a second, you will see a new virtual market card appear for Spain vs Argentina in the `OPEN` state, accepting virtual trades at the starting odds."

---

## 🎬 Act 4: Observing the Circuit Breaker in Action (1:45 - 2:30)

**[Visual]**
*Click on the active card for **Fixture #18257739** to open its details panel.*
*Wait for the goal event to trigger (around Step 19, Seq 1256).*
*Highlight the card flashing/halting and transitioning to **HALTED**.*
*Show the **Solana Verification Receipt** loading on the right panel.*

**[Speech / Voiceover]**
> "Now, keep your eyes on the market. As the simulation progresses, a goal is scored!
> 
> Instantly, the state machine transitions to `HALTED`. The virtual market is locked. 
> 
> Simultaneously, the agent requests a cryptographic proof of the score from TxLINE, and sends a transaction to our Solana Anchor program. The smart contract validates the signature and persists the score.
> 
> Here on the right, you can see the **Solana Verification Receipt** marked as **Confirmed on Solana** with its corresponding **Explorer link**."

---

## 🎬 Act 5: Reopening and Settle (2:30 - 3:00)

**[Visual]**
*Watch the state transition from **HALTED** $\rightarrow$ **PROOF_PENDING**.*
*Wait for the next step where repriced odds arrive, showing state transition back to **OPEN**.*
*Wait for the final step where the game is finalized and transitions to **SETTLED**.*

**[Speech / Voiceover]**
> "Once the proof is verified on-chain, the market moves to `PROOF_PENDING`—waiting for repriced odds.
> 
> The moment the new post-goal odds arrive, the market transitions back to `OPEN`, allowing trading to resume at fair, updated prices. 
> 
> At the end of the match, the agent detects the game finalization, submits the final proof, and transitions the market status to `SETTLED`.
> 
> ProofGuard successfully protects bookmaker liquidity autonomously, securely, and transparently on Solana. Thank you!"
