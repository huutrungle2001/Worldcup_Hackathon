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

export function toProofNodes(nodes: Array<{ hash: string | number[] | Uint8Array; isRightSibling: boolean }>) {
  return nodes.map((node) => ({
    hash: toBytes32(node.hash),
    isRightSibling: node.isRightSibling,
  }));
}

export interface ValidationReceipt {
  signature: string;
  pda: string;
  fixtureId: number;
  seq: number;
  statKeys: string;
  timestamp: string;
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
    statKeys: string[],
    submitReceipt = true
  ): Promise<string | boolean> {
    logger.info(`Requesting stat proof from TxLINE for fixture ${fixtureId}, seq ${seq}, statKeys ${statKeys.join(",")}`);

    let validationData: any;
    try {
      validationData = await txLineClient.getScoreProof(fixtureId, seq, statKeys.join(","));
      logger.info(`✓ Fetched proof successfully.`);
    } catch (err: any) {
      logger.error(`Failed to fetch validation proof:`, err);
      throw err;
    }

    const minTs = validationData.summary.updateStats.minTimestamp;
    const dailyScoresPda = this.deriveDailyScoresPda(minTs);
    logger.info(`Derived daily_scores_roots PDA: ${dailyScoresPda.toBase58()}`);

    const payload = {
      ts: new BN(minTs),
      fixtureSummary: {
        fixtureId: new BN(validationData.summary.fixtureId),
        updateStats: {
          updateCount: validationData.summary.updateStats.updateCount,
          minTimestamp: new BN(validationData.summary.updateStats.minTimestamp),
          maxTimestamp: new BN(validationData.summary.updateStats.maxTimestamp),
        },
        eventsSubTreeRoot: toBytes32(validationData.summary.eventStatsSubTreeRoot),
      },
      fixtureProof: toProofNodes(validationData.subTreeProof),
      mainTreeProof: toProofNodes(validationData.mainTreeProof),
      eventStatRoot: toBytes32(validationData.eventStatRoot),
      stats: validationData.statsToProve.map((stat: any, index: number) => ({
        stat,
        statProof: toProofNodes(validationData.statProofs[index]),
      })),
    };

    let strategy: any;
    if (statKeys.length === 1) {
      const val = validationData.statsToProve[0].value ?? validationData.statsToProve[0].Value ?? 0;
      strategy = {
        geometricTargets: [],
        distancePredicate: null,
        discretePredicates: [
          {
            single: {
              index: 0,
              predicate: {
                threshold: val,
                comparison: { equalTo: {} },
              },
            },
          },
        ],
      };
    } else {
      const val0 = validationData.statsToProve[0].value ?? validationData.statsToProve[0].Value ?? 0;
      const val1 = validationData.statsToProve[1].value ?? validationData.statsToProve[1].Value ?? 0;
      const diff = val0 - val1;
      strategy = {
        geometricTargets: [],
        distancePredicate: null,
        discretePredicates: [
          {
            binary: {
              indexA: 0,
              indexB: 1,
              op: { subtract: {} },
              predicate: {
                threshold: diff,
                comparison: { equalTo: {} },
              },
            },
          },
        ],
      };
    }

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
        logger.error(`Validation simulation returned false. Predicate check failed.`);
        return false;
      }
      logger.info(`✓ Validation simulation passed successfully!`);

      if (!submitReceipt) {
        return true;
      }
    } catch (err: any) {
      logger.error(`On-chain simulation error:`, err);
      healthMonitor.updateService("solanaRpc", "UNHEALTHY", err.message);
      return false;
    }

    const walletBalance = await connection.getBalance(walletKeypair.publicKey);
    logger.info(`Current wallet balance before validation receipt: ${walletBalance / 1e9} SOL`);

    if (walletBalance < 10000000) {
      logger.warn(`Wallet balance is too low for receipt transaction. Falling back to view simulation.`);
      return true;
    }

    logger.info("Submitting validation receipt transaction (skipPreflight: false)...");
    try {
      const txSig = await program.methods
        .validateStatV2(payload, strategy)
        .accounts({
          dailyScoresMerkleRoots: dailyScoresPda,
        })
        .preInstructions([computeBudgetIx])
        .rpc();

      logger.info(`✓ Validation receipt transaction successful! Signature: ${txSig}`);
      healthMonitor.updateService("solanaRpc", "HEALTHY");
      return txSig;
    } catch (err: any) {
      logger.error("Transaction submission failed:", err);
      healthMonitor.updateService("solanaRpc", "UNHEALTHY", err.message);
      throw err;
    }
  }
}

export const solanaValidator = new SolanaValidator();
