import { PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { program, connection, walletKeypair } from "./index";
import { txLineClient } from "../txline/api";
import { logger } from "../utils/logger";
import { healthMonitor } from "../utils/health";

export function toBytes32(value: string | number[] | Uint8Array): number[] {
  const bytes = Array.isArray(value)
    ? Uint8Array.from(value)
    : value instanceof Uint8Array
    ? value
    : value.startsWith("0x")
    ? Buffer.from(value.slice(2), "hex")
    : Buffer.from(value, "base64");

  if (bytes.length !== 32) {
    throw new Error(`Expected 32 bytes, received ${bytes.length}`);
  }

  return Array.from(bytes);
}

export function toProofNodes(
  nodes: Array<{
    hash: string | number[] | Uint8Array;
    isRightSibling: boolean;
  }>
) {
  return nodes.map((node) => ({
    hash: toBytes32(node.hash),
    isRightSibling: node.isRightSibling,
  }));
}

export interface ExpectedStat {
  key: number;
  value: number;
}

export interface ProvedStat {
  key: number;
  value: number;
  period: number;
}

export interface VerificationResult {
  success: boolean;
  signature?: string;
  provedStats: ProvedStat[];
}

export interface SanitizedReceipt {
  id: string;
  fixtureId: number;
  seq: number;
  expectedStats: ExpectedStat[];
  provedStats: ProvedStat[];
  proofTimestamp: number;
  pda?: string;
  programId: string;
  network: string;
  status: "CONFIRMED" | "SIMULATED" | "REJECTED" | "FAILED";
  mode: "TRANSACTION" | "SIMULATION" | "PRECHECK";
  signature?: string;
  explorerUrl?: string;
  reason?: string;
  validatedAt: string;
}

export class ReceiptStore {
  private receipts: SanitizedReceipt[] = [];

  public addReceipt(receipt: SanitizedReceipt): void {
    // Scrub secret keys or tokens if any leaked in reason string
    const sanitizedReason = receipt.reason
      ? receipt.reason.replace(/(jwt|token|secret|walletPath)=[^&\s]+/gi, "$1=[REDACTED]")
      : undefined;

    const sanitized: SanitizedReceipt = {
      ...receipt,
      reason: sanitizedReason,
    };

    this.receipts.unshift(sanitized);
    if (this.receipts.length > 50) {
      this.receipts = this.receipts.slice(0, 50);
    }
  }

  public getReceipts(fixtureId?: number): SanitizedReceipt[] {
    if (fixtureId !== undefined && fixtureId > 0) {
      return this.receipts.filter((r) => r.fixtureId === fixtureId);
    }
    return this.receipts;
  }

  public clear(): void {
    this.receipts = [];
  }
}

export const receiptStore = new ReceiptStore();

/**
 * Validates requested expected stats before performing network or Solana calls.
 * Fails closed on invalid, non-integer, negative, or duplicate keys/values.
 */
export function validateExpectedStatsPrecheck(
  expectedStats: ExpectedStat[]
): { valid: boolean; reason?: string } {
  if (!Array.isArray(expectedStats) || expectedStats.length === 0) {
    return { valid: false, reason: "Expected stats array must not be empty" };
  }

  const seenKeys = new Set<number>();

  for (let i = 0; i < expectedStats.length; i++) {
    const stat = expectedStats[i];
    if (
      stat.key === undefined ||
      stat.key === null ||
      !Number.isInteger(stat.key) ||
      stat.key <= 0
    ) {
      return {
        valid: false,
        reason: `Invalid stat key at index ${i}: ${stat.key}`,
      };
    }

    if (
      stat.value === undefined ||
      stat.value === null ||
      !Number.isFinite(stat.value) ||
      stat.value < 0
    ) {
      return {
        valid: false,
        reason: `Invalid stat value at index ${i}: ${stat.value}`,
      };
    }

    if (seenKeys.has(stat.key)) {
      return {
        valid: false,
        reason: `Duplicate stat key detected: ${stat.key}`,
      };
    }
    seenKeys.add(stat.key);
  }

  return { valid: true };
}

/**
 * Validates TxLINE proof response identity against expected parameters before Solana execution.
 */
export function validateProofIdentity(
  fixtureId: number,
  seq: number,
  expectedStats: ExpectedStat[],
  responseData: any
): { valid: boolean; reason?: string } {
  if (!responseData || typeof responseData !== "object") {
    return { valid: false, reason: "Invalid proof response object" };
  }

  const summary = responseData.summary ?? responseData.Summary;
  if (!summary) {
    return { valid: false, reason: "Proof summary is missing" };
  }

  const responseFixtureId = Number(summary.fixtureId ?? summary.FixtureId);
  if (responseFixtureId !== fixtureId) {
    return {
      valid: false,
      reason: `Fixture ID mismatch: expected ${fixtureId}, got ${responseFixtureId}`,
    };
  }

  if (!Number.isInteger(seq) || seq <= 0) {
    return { valid: false, reason: `Invalid requested sequence: ${seq}` };
  }

  const statsToProve = responseData.statsToProve ?? responseData.StatsToProve ?? [];
  const statProofs = responseData.statProofs ?? responseData.StatProofs ?? [];

  if (statsToProve.length !== expectedStats.length) {
    return {
      valid: false,
      reason: `Stat count mismatch: expected ${expectedStats.length}, got ${statsToProve.length}`,
    };
  }

  if (statProofs.length !== expectedStats.length) {
    return {
      valid: false,
      reason: `Stat proof count mismatch: expected ${expectedStats.length}, got ${statProofs.length}`,
    };
  }

  const updateStats = summary.updateStats ?? summary.UpdateStats ?? {};
  const minTs = Number(updateStats.minTimestamp ?? updateStats.MinTimestamp ?? 0);
  if (!Number.isFinite(minTs) || minTs <= 0) {
    return { valid: false, reason: `Invalid proof timestamp: ${minTs}` };
  }

  for (let i = 0; i < expectedStats.length; i++) {
    const expected = expectedStats[i];
    const returnedStat = statsToProve[i];

    if (!returnedStat) {
      return { valid: false, reason: `Missing returned stat at index ${i}` };
    }

    const returnedKey = Number(returnedStat.key ?? returnedStat.Key);
    const returnedVal = Number(returnedStat.value ?? returnedStat.Value);

    if (returnedKey !== expected.key) {
      return {
        valid: false,
        reason: `Stat key mismatch at index ${i}: expected ${expected.key}, got ${returnedKey}`,
      };
    }

    if (returnedVal !== expected.value) {
      return {
        valid: false,
        reason: `Stat value mismatch for key ${expected.key}: expected ${expected.value}, got ${returnedVal}`,
      };
    }

    if (!statProofs[i] || !Array.isArray(statProofs[i])) {
      return { valid: false, reason: `Missing stat proof nodes at index ${i}` };
    }
  }

  return { valid: true };
}

/**
 * Builds non-tautological validateStatV2 strategy equality predicates from event-derived expected values.
 * For single stats (e.g. goal), creates one single-stat equality predicate.
 * For 2 stats (e.g. finalisation), creates two indexed single-stat equality predicates at indexes 0 and 1.
 */
export function buildV2Strategy(expectedStats: ExpectedStat[]): any {
  const discretePredicates = expectedStats.map((stat, index) => ({
    single: {
      index,
      predicate: {
        threshold: stat.value,
        comparison: { equalTo: {} },
      },
    },
  }));

  return {
    geometricTargets: [],
    distancePredicate: null,
    discretePredicates,
  };
}

export class SolanaValidator {
  public deriveDailyScoresPda(minTimestampMs: number): PublicKey {
    const epochDay = Math.floor(minTimestampMs / (24 * 60 * 60 * 1000));
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("daily_scores_roots"),
        new BN(epochDay).toArrayLike(Buffer, "le", 2),
      ],
      program.programId
    );
    return pda;
  }

  public async validateProofOnChain(
    fixtureId: number,
    seq: number,
    expectedStats: ExpectedStat[],
    submitReceipt = true
  ): Promise<VerificationResult> {
    const programIdStr = program.programId.toBase58();
    const networkStr = "devnet";
    const receiptId = `rcpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 1. Precheck expected stats
    const precheck = validateExpectedStatsPrecheck(expectedStats);
    if (!precheck.valid) {
      logger.error(`Expected stats precheck failed: ${precheck.reason}`);
      receiptStore.addReceipt({
        id: receiptId,
        fixtureId,
        seq,
        expectedStats,
        provedStats: [],
        proofTimestamp: 0,
        programId: programIdStr,
        network: networkStr,
        status: "REJECTED",
        mode: "PRECHECK",
        reason: precheck.reason,
        validatedAt: new Date().toISOString(),
      });
      return { success: false, provedStats: [] };
    }

    const statKeys = expectedStats.map((s) => String(s.key));
    logger.info(
      `Requesting stat proof from TxLINE for fixture ${fixtureId}, seq ${seq}, statKeys ${statKeys.join(
        ","
      )}`
    );

    let validationData: any;
    try {
      validationData = await txLineClient.getScoreProof(
        fixtureId,
        seq,
        statKeys.join(",")
      );
      logger.info(`✓ Fetched proof successfully.`);
    } catch (err: any) {
      logger.error(`Failed to fetch validation proof:`, err);
      receiptStore.addReceipt({
        id: receiptId,
        fixtureId,
        seq,
        expectedStats,
        provedStats: [],
        proofTimestamp: 0,
        programId: programIdStr,
        network: networkStr,
        status: "FAILED",
        mode: "SIMULATION",
        reason: `Failed to fetch proof: ${err.message || err}`,
        validatedAt: new Date().toISOString(),
      });
      return { success: false, provedStats: [] };
    }

    // 2. Validate response identity before Solana calls
    const identityCheck = validateProofIdentity(
      fixtureId,
      seq,
      expectedStats,
      validationData
    );
    if (!identityCheck.valid) {
      logger.error(`Proof response identity check failed: ${identityCheck.reason}`);
      const provedStats: ProvedStat[] = (
        validationData.statsToProve ?? []
      ).map((stat: any) => ({
        key: Number(stat.key ?? stat.Key ?? 0),
        value: Number(stat.value ?? stat.Value ?? 0),
        period: Number(stat.period ?? stat.Period ?? 0),
      }));

      const minTs = Number(
        validationData.summary?.updateStats?.minTimestamp ?? 0
      );

      receiptStore.addReceipt({
        id: receiptId,
        fixtureId,
        seq,
        expectedStats,
        provedStats,
        proofTimestamp: minTs,
        programId: programIdStr,
        network: networkStr,
        status: "REJECTED",
        mode: "PRECHECK",
        reason: identityCheck.reason,
        validatedAt: new Date().toISOString(),
      });
      return { success: false, provedStats: [] };
    }

    const minTs = validationData.summary.updateStats.minTimestamp;
    const dailyScoresPda = this.deriveDailyScoresPda(minTs);
    const pdaStr = dailyScoresPda.toBase58();

    const provedStats: ProvedStat[] = validationData.statsToProve.map(
      (stat: any) => ({
        key: Number(stat.key ?? stat.Key ?? 0),
        value: Number(stat.value ?? stat.Value ?? 0),
        period: Number(stat.period ?? stat.Period ?? 0),
      })
    );

    const payload = {
      ts: new BN(minTs),
      fixtureSummary: {
        fixtureId: new BN(validationData.summary.fixtureId),
        updateStats: {
          updateCount: validationData.summary.updateStats.updateCount,
          minTimestamp: new BN(validationData.summary.updateStats.minTimestamp),
          maxTimestamp: new BN(validationData.summary.updateStats.maxTimestamp),
        },
        eventsSubTreeRoot: toBytes32(
          validationData.summary.eventStatsSubTreeRoot
        ),
      },
      fixtureProof: toProofNodes(validationData.subTreeProof),
      mainTreeProof: toProofNodes(validationData.mainTreeProof),
      eventStatRoot: toBytes32(validationData.eventStatRoot),
      stats: validationData.statsToProve.map((stat: any, index: number) => ({
        stat,
        statProof: toProofNodes(validationData.statProofs[index]),
      })),
    };

    // 3. Build non-tautological strategy predicates from expectedStats
    const strategy = buildV2Strategy(expectedStats);

    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_400_000,
    });

    logger.info("Executing on-chain simulation via .view()...");
    try {
      const isValid = await program.methods
        .validateStatV2(payload, strategy)
        .accounts({
          dailyScoresMerkleRoots: dailyScoresPda,
        })
        .preInstructions([computeBudgetIx])
        .view();

      if (!isValid) {
        logger.error(
          `Validation simulation returned false. Predicate check failed.`
        );
        receiptStore.addReceipt({
          id: receiptId,
          fixtureId,
          seq,
          expectedStats,
          provedStats,
          proofTimestamp: minTs,
          pda: pdaStr,
          programId: programIdStr,
          network: networkStr,
          status: "FAILED",
          mode: "SIMULATION",
          reason: "On-chain simulation returned false",
          validatedAt: new Date().toISOString(),
        });
        return { success: false, provedStats };
      }
      logger.info(`✓ Validation simulation passed successfully!`);

      if (!submitReceipt || process.env.TEST_MODE === "true") {
        receiptStore.addReceipt({
          id: receiptId,
          fixtureId,
          seq,
          expectedStats,
          provedStats,
          proofTimestamp: minTs,
          pda: pdaStr,
          programId: programIdStr,
          network: networkStr,
          status: "SIMULATED",
          mode: "SIMULATION",
          validatedAt: new Date().toISOString(),
        });
        return { success: true, provedStats };
      }
    } catch (err: any) {
      logger.error(`On-chain simulation error:`, err);
      healthMonitor.updateService("solanaRpc", "UNHEALTHY", err.message);
      receiptStore.addReceipt({
        id: receiptId,
        fixtureId,
        seq,
        expectedStats,
        provedStats,
        proofTimestamp: minTs,
        pda: pdaStr,
        programId: programIdStr,
        network: networkStr,
        status: "FAILED",
        mode: "SIMULATION",
        reason: `Simulation error: ${err.message || err}`,
        validatedAt: new Date().toISOString(),
      });
      return { success: false, provedStats };
    }

    const walletBalance = await connection.getBalance(walletKeypair.publicKey);
    logger.info(
      `Current wallet balance before validation receipt: ${
        walletBalance / 1e9
      } SOL`
    );

    if (walletBalance < 10000000) {
      logger.warn(
        `Wallet balance is too low for receipt transaction. Falling back to view simulation.`
      );
      receiptStore.addReceipt({
        id: receiptId,
        fixtureId,
        seq,
        expectedStats,
        provedStats,
        proofTimestamp: minTs,
        pda: pdaStr,
        programId: programIdStr,
        network: networkStr,
        status: "SIMULATED",
        mode: "SIMULATION",
        reason: "Low wallet balance fallback to simulation",
        validatedAt: new Date().toISOString(),
      });
      return { success: true, provedStats };
    }

    logger.info(
      "Submitting validation receipt transaction (skipPreflight: false)..."
    );
    try {
      const txSig = await program.methods
        .validateStatV2(payload, strategy)
        .accounts({
          dailyScoresMerkleRoots: dailyScoresPda,
        })
        .preInstructions([computeBudgetIx])
        .rpc();

      logger.info(
        `✓ Validation receipt transaction successful! Signature: ${txSig}`
      );
      healthMonitor.updateService("solanaRpc", "HEALTHY");

      receiptStore.addReceipt({
        id: receiptId,
        fixtureId,
        seq,
        expectedStats,
        provedStats,
        proofTimestamp: minTs,
        pda: pdaStr,
        programId: programIdStr,
        network: networkStr,
        status: "CONFIRMED",
        mode: "TRANSACTION",
        signature: txSig,
        explorerUrl: `https://explorer.solana.com/tx/${txSig}?cluster=devnet`,
        validatedAt: new Date().toISOString(),
      });

      return { success: true, signature: txSig, provedStats };
    } catch (err: any) {
      logger.error("Transaction submission failed:", err);
      healthMonitor.updateService("solanaRpc", "UNHEALTHY", err.message);

      receiptStore.addReceipt({
        id: receiptId,
        fixtureId,
        seq,
        expectedStats,
        provedStats,
        proofTimestamp: minTs,
        pda: pdaStr,
        programId: programIdStr,
        network: networkStr,
        status: "FAILED",
        mode: "TRANSACTION",
        reason: `Transaction error: ${err.message || err}`,
        validatedAt: new Date().toISOString(),
      });

      throw err;
    }
  }
}

export const solanaValidator = new SolanaValidator();
