import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import { appConfig } from "../config";
import txoracleIdl from "../../idl/txoracle.json";
import type { Txoracle } from "../../types/txoracle";

export const connection = new Connection(appConfig.rpcUrl, "confirmed");

const secretKey = JSON.parse(fs.readFileSync(appConfig.walletPath, "utf-8"));
export const walletKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));

export const wallet = new anchor.Wallet(walletKeypair);

export const provider = new anchor.AnchorProvider(connection, wallet, {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});

anchor.setProvider(provider);

export const program = new anchor.Program<Txoracle>(
  txoracleIdl as any,
  provider
);
