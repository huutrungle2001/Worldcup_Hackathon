import { PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

dotenv.config();

export type Network = "mainnet" | "devnet";

export interface NetworkConfig {
  rpcUrl: string;
  apiOrigin: string;
  programId: PublicKey;
  txlTokenMint: PublicKey;
  serviceLevelId: number;
}

export const CONFIGS: Record<Network, NetworkConfig> = {
  mainnet: {
    rpcUrl: "https://api.mainnet-beta.solana.com",
    apiOrigin: "https://txline.txodds.com",
    programId: new PublicKey("9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA"),
    txlTokenMint: new PublicKey("Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL"),
    serviceLevelId: 12, // Real-time World Cup
  },
  devnet: {
    rpcUrl: "https://api.devnet.solana.com",
    apiOrigin: "https://txline-dev.txodds.com",
    programId: new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"),
    txlTokenMint: new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG"),
    serviceLevelId: 1, // Devnet free level (samplingIntervalSec = 0)
  },
};

export class AppConfig {
  public readonly network: Network;
  public readonly rpcUrl: string;
  public readonly apiOrigin: string;
  public readonly programId: PublicKey;
  public readonly txlTokenMint: PublicKey;
  public readonly serviceLevelId: number;
  public readonly walletPath: string;
  public readonly apiToken: string | null;

  constructor() {
    const rpcUrlEnv = process.env.ANCHOR_PROVIDER_URL;
    if (!rpcUrlEnv) {
      throw new Error("ANCHOR_PROVIDER_URL environment variable is missing.");
    }

    if (rpcUrlEnv.includes("devnet")) {
      this.network = "devnet";
    } else if (
      rpcUrlEnv.includes("mainnet") ||
      rpcUrlEnv.includes("api.mainnet")
    ) {
      this.network = "mainnet";
    } else {
      this.network = "devnet";
    }

    const netConfig = CONFIGS[this.network];
    this.rpcUrl = rpcUrlEnv;
    this.apiOrigin = netConfig.apiOrigin;
    this.programId = netConfig.programId;
    this.txlTokenMint = netConfig.txlTokenMint;
    this.serviceLevelId = netConfig.serviceLevelId;

    const walletEnv = process.env.ANCHOR_WALLET;
    if (!walletEnv) {
      throw new Error("ANCHOR_WALLET environment variable is missing.");
    }
    this.walletPath = path.resolve(walletEnv);
    if (!fs.existsSync(this.walletPath)) {
      throw new Error(`Wallet file does not exist at: ${this.walletPath}`);
    }

    this.apiToken = process.env.X_API_TOKEN || null;
  }
}

export const appConfig = new AppConfig();
export const networkConfig = CONFIGS[appConfig.network];
