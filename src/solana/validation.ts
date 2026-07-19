import { PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { program, connection, walletKeypair } from "./index";
import { txLineClient } from "../txline/api";
import { logger } from "../utils/logger";
import { healthMonitor } from "../utils/health";
import { appConfig } from "../config";

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

/**
 * Controlled public reason code and message mapping to prevent credential leakage.
 */
export function sanitizeReasonString(rawReason?: string): string | undefined {
  if (!rawReason || typeof rawReason !== "string") return undefined;

  // Controlled public error codes mapping
  if (rawReason.includes("Invalid fixtureId") || rawReason.includes("Invalid sequence")) {
    return "Proof request parameter validation failed";
  }
  if (rawReason.includes("Unsupported") || rawReason.includes("Expected stats")) {
    return "Expected stats validation failed";
  }
  if (rawReason.includes("TxLINE API") || rawReason.includes("fetch proof")) {
    return "TxLINE proof request failed";
  }
  if (rawReason.includes("mismatch") || rawReason.includes("identity check")) {
    return "Proof response identity check failed";
  }
  if (rawReason.includes("predicate check failed") || rawReason.includes("returned false")) {
    return "On-chain simulation predicate check failed";
  }
  if (rawReason.includes("Low wallet balance")) {
    return "Low wallet balance fallback to simulation";
  }
  if (rawReason.includes("simulation execution failed") || rawReason.includes("Simulation error")) {
    return "On-chain simulation execution failed";
  }
  if (rawReason.includes("transaction submission failed") || rawReason.includes("Transaction error")) {
    return "Validation transaction submission failed";
  }

  // Fallback scrub of any credential patterns
  return rawReason
    .replace(/(bearer|jwt|token|secret|x-api-token|authorization)[=:\s]+[^\s;]+/gi, "$1: [REDACTED]")
    .replace(/https?:\/\/[^\s]+/gi, "[REDACTED_URL]")
    .replace(/(\/|\w+:)[^\s]*\.(json|key|pem|txt)/gi, "[REDACTED_PATH]")
    .replace(/walletPath[=:\s]+[^\s;]+/gi, "walletPath: [REDACTED]");
}

export class ReceiptStore {
  private receipts: SanitizedReceipt[] = [];

  public addReceipt(rawReceipt: any): void {
    if (!rawReceipt || typeof rawReceipt !== "object") return;

    // Strict non-coercive numeric validation for required public identity fields
    const fixtureId = rawReceipt.fixtureId;
    const seq = rawReceipt.seq;

    if (
      typeof fixtureId !== "number" ||
      !Number.isInteger(fixtureId) ||
      fixtureId <= 0 ||
      typeof seq !== "number" ||
      !Number.isInteger(seq) ||
      seq <= 0
    ) {
      // Reject malformed non-numeric or non-positive receipt identity fields
      return;
    }

    const proofTimestamp =
      typeof rawReceipt.proofTimestamp === "number" && Number.isFinite(rawReceipt.proofTimestamp)
        ? rawReceipt.proofTimestamp
        : 0;

    const expectedStats: ExpectedStat[] = Array.isArray(rawReceipt.expectedStats)
      ? rawReceipt.expectedStats.map((s: any) => ({
          key: Number(s.key),
          value: Number(s.value),
        }))
      : [];

    const provedStats: ProvedStat[] = Array.isArray(rawReceipt.provedStats)
      ? rawReceipt.provedStats.map((s: any) => ({
          key: Number(s.key),
          value: Number(s.value),
          period: Number(s.period ?? 0),
        }))
      : [];

    const status: "CONFIRMED" | "SIMULATED" | "REJECTED" | "FAILED" = rawReceipt.status;
    const mode: "TRANSACTION" | "SIMULATION" | "PRECHECK" = rawReceipt.mode;

    if (!["CONFIRMED", "SIMULATED", "REJECTED", "FAILED"].includes(status)) {
      return;
    }
    if (!["TRANSACTION", "SIMULATION", "PRECHECK"].includes(mode)) {
      return;
    }

    // Enforce strict valid status + mode shape invariants
    if (status === "CONFIRMED" && mode !== "TRANSACTION") return;
    if (status === "SIMULATED" && mode !== "SIMULATION") return;
    if (status === "REJECTED" && mode !== "PRECHECK") return;

    let signature: string | undefined = undefined;
    let explorerUrl: string | undefined = undefined;

    const network = typeof rawReceipt.network === "string" ? rawReceipt.network : appConfig.network;
    const programId = typeof rawReceipt.programId === "string" ? rawReceipt.programId : appConfig.programId.toBase58();
    const pda = typeof rawReceipt.pda === "string" ? rawReceipt.pda : undefined;
    const validatedAt = typeof rawReceipt.validatedAt === "string" ? rawReceipt.validatedAt : new Date().toISOString();
    const id = typeof rawReceipt.id === "string" ? rawReceipt.id : `rcpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (status === "CONFIRMED") {
      if (typeof rawReceipt.signature === "string" && rawReceipt.signature.trim().length > 0) {
        signature = rawReceipt.signature.trim();
        const cluster = network === "mainnet" ? "mainnet-beta" : network;
        explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
      } else {
        // CONFIRMED without signature violates store invariants
        return;
      }
    }

    const sanitizedReason = sanitizeReasonString(rawReceipt.reason);

    const sanitized: SanitizedReceipt = {
      id,
      fixtureId,
      seq,
      expectedStats,
      provedStats,
      proofTimestamp,
      pda,
      programId,
      network,
      status,
      mode,
      signature,
      explorerUrl,
      reason: sanitizedReason,
      validatedAt,
    };

    this.receipts.unshift(sanitized);
    if (this.receipts.length > 50) {
      this.receipts = this.receipts.slice(0, 50);
    }
  }

  public getReceipts(fixtureId?: number): SanitizedReceipt[] {
    let result = this.receipts;
    if (fixtureId !== undefined && fixtureId > 0) {
      result = this.receipts.filter((r) => r.fixtureId === fixtureId);
    }
    // Defensive copy to prevent callers from mutating internal store
    return JSON.parse(JSON.stringify(result));
  }

  public clear(): void {
    this.receipts = [];
  }
}

export const receiptStore = new ReceiptStore();

/**
 * Validates expected stats precheck before TxLINE or Solana operations.
 * Allows ONLY total-goal stat keys 1 and 2. Fails closed on non-integers, negative values,
 * unsupported keys, or duplicate keys.
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
      typeof stat.key !== "number" ||
      !Number.isInteger(stat.key) ||
      ![1, 2].includes(stat.key)
    ) {
      return {
        valid: false,
        reason: `Unsupported or non-integer stat key at index ${i}: ${stat.key}. Allowed keys are 1 (Participant 1 Goals) and 2 (Participant 2 Goals)`,
      };
    }

    if (
      stat.value === undefined ||
      stat.value === null ||
      typeof stat.value !== "number" ||
      !Number.isFinite(stat.value) ||
      stat.value < 0
    ) {
      return {
        valid: false,
        reason: `Invalid non-finite or negative stat value at index ${i}: ${stat.value}`,
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
 * Validates request parameters (fixture ID and sequence) before any TxLINE or Solana call.
 */
export function validateProofRequestParams(
  fixtureId: number,
  seq: number,
  expectedStats: ExpectedStat[]
): { valid: boolean; reason?: string } {
  if (
    fixtureId === undefined ||
    fixtureId === null ||
    typeof fixtureId !== "number" ||
    !Number.isInteger(fixtureId) ||
    fixtureId <= 0
  ) {
    return { valid: false, reason: `Invalid fixtureId: ${fixtureId}` };
  }

  if (
    seq === undefined ||
    seq === null ||
    typeof seq !== "number" ||
    !Number.isInteger(seq) ||
    seq <= 0
  ) {
    return { valid: false, reason: `Invalid sequence: ${seq}` };
  }

  return validateExpectedStatsPrecheck(expectedStats);
}

/**
 * Validates TxLINE proof response identity against expected parameters before Solana execution.
 * Enforces strict non-coercive numeric type checks.
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
  if (!summary || typeof summary !== "object") {
    return { valid: false, reason: "Proof summary is missing" };
  }

  const rawResponseFixtureId = summary.fixtureId ?? summary.FixtureId;
  if (typeof rawResponseFixtureId !== "number" || !Number.isInteger(rawResponseFixtureId)) {
    return {
      valid: false,
      reason: `Response fixture ID must be a finite integer, got: ${typeof rawResponseFixtureId}`,
    };
  }

  if (rawResponseFixtureId !== fixtureId) {
    return {
      valid: false,
      reason: `Fixture ID mismatch: expected ${fixtureId}, got ${rawResponseFixtureId}`,
    };
  }

  if (typeof seq !== "number" || !Number.isInteger(seq) || seq <= 0) {
    return { valid: false, reason: `Invalid requested sequence: ${seq}` };
  }

  const statsToProve = responseData.statsToProve ?? responseData.StatsToProve;
  const statProofs = responseData.statProofs ?? responseData.StatProofs;

  if (!Array.isArray(statsToProve) || statsToProve.length !== expectedStats.length) {
    return {
      valid: false,
      reason: `Stat count mismatch: expected ${expectedStats.length}, got ${Array.isArray(statsToProve) ? statsToProve.length : "non-array"}`,
    };
  }

  if (!Array.isArray(statProofs) || statProofs.length !== expectedStats.length) {
    return {
      valid: false,
      reason: `Stat proof count mismatch: expected ${expectedStats.length}, got ${Array.isArray(statProofs) ? statProofs.length : "non-array"}`,
    };
  }

  const updateStats = summary.updateStats ?? summary.UpdateStats;
  if (!updateStats || typeof updateStats !== "object") {
    return { valid: false, reason: "Missing updateStats in proof summary" };
  }

  const minTs = updateStats.minTimestamp ?? updateStats.MinTimestamp;
  if (typeof minTs !== "number" || !Number.isFinite(minTs) || minTs <= 0) {
    return { valid: false, reason: `Invalid proof timestamp: ${minTs}` };
  }

  for (let i = 0; i < expectedStats.length; i++) {
    const expected = expectedStats[i];
    const returnedStat = statsToProve[i];

    if (!returnedStat || typeof returnedStat !== "object") {
      return { valid: false, reason: `Missing or non-object returned stat at index ${i}` };
    }

    const rawKey = returnedStat.key ?? returnedStat.Key;
    const rawVal = returnedStat.value ?? returnedStat.Value;

    if (typeof rawKey !== "number" || !Number.isInteger(rawKey)) {
      return {
        valid: false,
        reason: `Returned stat key at index ${i} must be a number, got: ${typeof rawKey}`,
      };
    }

    if (typeof rawVal !== "number" || !Number.isFinite(rawVal)) {
      return {
        valid: false,
        reason: `Returned stat value at index ${i} must be a finite number, got: ${typeof rawVal}`,
      };
    }

    if (rawKey !== expected.key) {
      return {
        valid: false,
        reason: `Stat key mismatch at index ${i}: expected ${expected.key}, got ${rawKey}`,
      };
    }

    if (rawVal !== expected.value) {
      return {
        valid: false,
        reason: `Stat value mismatch for key ${expected.key}: expected ${expected.value}, got ${rawVal}`,
      };
    }

    if (!statProofs[i] || !Array.isArray(statProofs[i]) || statProofs[i].length === 0) {
      return { valid: false, reason: `Missing or empty stat proof nodes at index ${i}` };
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
    const programIdStr = appConfig.programId.toBase58();
    const networkStr = appConfig.network;
    const receiptId = `rcpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // STAGE 1: PRECHECK / FETCH
    let currentStage: "PRECHECK" | "SIMULATION" | "TRANSACTION" = "PRECHECK";

    const paramCheck = validateProofRequestParams(fixtureId, seq, expectedStats);
    if (!paramCheck.valid) {
      logger.error(`Proof request validation failed: ${paramCheck.reason}`);
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
        reason: paramCheck.reason,
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
        mode: "PRECHECK",
        reason: "TxLINE proof request failed",
        validatedAt: new Date().toISOString(),
      });
      return { success: false, provedStats: [] };
    }

    const identityCheck = validateProofIdentity(
      fixtureId,
      seq,
      expectedStats,
      validationData
    );
    if (!identityCheck.valid) {
      logger.error(`Proof response identity check failed: ${identityCheck.reason}`);
      const provedStats: ProvedStat[] = Array.isArray(validationData?.statsToProve)
        ? validationData.statsToProve.map((stat: any) => ({
            key: Number(stat.key ?? stat.Key ?? 0),
            value: Number(stat.value ?? stat.Value ?? 0),
            period: Number(stat.period ?? stat.Period ?? 0),
          }))
        : [];

      const minTs = Number(validationData?.summary?.updateStats?.minTimestamp ?? 0);

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

    const minTs = Number(validationData.summary.updateStats.minTimestamp);

    // STAGE 2: SIMULATION
    currentStage = "SIMULATION";
    try {
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

      const strategy = buildV2Strategy(expectedStats);

      const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 1_400_000,
      });

      logger.info("Executing on-chain simulation via .view()...");
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
          reason: "On-chain simulation predicate check failed",
          validatedAt: new Date().toISOString(),
        });
        return { success: false, provedStats };
      }
      logger.info(`✓ Validation simulation passed successfully!`);

      if (!submitReceipt) {
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

      // STAGE 3: TRANSACTION EXECUTION
      currentStage = "TRANSACTION";
      logger.info(
        "Submitting validation receipt transaction (skipPreflight: false)..."
      );
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
        validatedAt: new Date().toISOString(),
      });

      return { success: true, signature: txSig, provedStats };
    } catch (err: any) {
      logger.error("Post-fetch validation error:", err);
      healthMonitor.updateService("solanaRpc", "UNHEALTHY", err.message);

      receiptStore.addReceipt({
        id: receiptId,
        fixtureId,
        seq,
        expectedStats,
        provedStats: [],
        proofTimestamp: minTs,
        programId: programIdStr,
        network: networkStr,
        status: "FAILED",
        mode: currentStage, // Accurately reflects TRANSACTION if .rpc() failed!
        reason:
          currentStage === "TRANSACTION"
            ? "Validation transaction submission failed"
            : "On-chain simulation execution failed",
        validatedAt: new Date().toISOString(),
      });

      return { success: false, provedStats: [] };
    }
  }
}

export const solanaValidator = new SolanaValidator();
