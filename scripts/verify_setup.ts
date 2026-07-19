import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

const CONFIG = {
  devnet: {
    apiOrigin: "https://txline-dev.txodds.com",
    programId: new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"),
    txlTokenMint: new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG"),
  },
} as const;

async function verify() {
  console.log("=== ProofGuard Setup Verification ===\n");

  // 1. Check IDL
  const idlPath = path.join(__dirname, "../idl/txoracle.json");
  if (!fs.existsSync(idlPath)) {
    console.error("❌ IDL file not found at: idl/txoracle.json");
    process.exit(1);
  }
  console.log("✓ Found idl/txoracle.json");

  let idl: any;
  try {
    idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  } catch (err: any) {
    console.error("❌ Failed to parse IDL JSON:", err.message);
    process.exit(1);
  }

  const idlAddress = idl.address;
  const configProgramId = CONFIG.devnet.programId.toBase58();
  if (idlAddress !== configProgramId) {
    console.error(
      `❌ IDL address mismatch! Found ${idlAddress}, expected ${configProgramId}`
    );
    process.exit(1);
  }
  console.log(`✓ IDL program ID verified: ${idlAddress}`);

  // 2. Check types
  const typesPath = path.join(__dirname, "../types/txoracle.ts");
  if (!fs.existsSync(typesPath)) {
    console.error("❌ Type definition file not found at: types/txoracle.ts");
    process.exit(1);
  }
  console.log("✓ Found types/txoracle.ts");

  // 3. Check env variables
  const walletEnv = process.env.ANCHOR_WALLET;
  const rpcEnv = process.env.ANCHOR_PROVIDER_URL;

  if (!walletEnv) {
    console.error("❌ ANCHOR_WALLET is not defined in .env");
    process.exit(1);
  }
  console.log(`✓ ANCHOR_WALLET env variable found: ${walletEnv}`);

  if (!rpcEnv) {
    console.error("❌ ANCHOR_PROVIDER_URL is not defined in .env");
    process.exit(1);
  }
  console.log(`✓ ANCHOR_PROVIDER_URL env variable found: ${rpcEnv}`);

  // 4. Check wallet file
  const walletPath = path.resolve(walletEnv);
  if (!fs.existsSync(walletPath)) {
    console.error(`❌ Wallet file not found at path: ${walletPath}`);
    process.exit(1);
  }
  console.log("✓ Found wallet keyfile");

  let walletKeypair: Keypair;
  try {
    const secretKeyArray = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
    walletKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKeyArray));
    console.log(
      `✓ Loaded wallet successfully. Public Key: ${walletKeypair.publicKey.toBase58()}`
    );
  } catch (err: any) {
    console.error("❌ Failed to load wallet keypair from file:", err.message);
    process.exit(1);
  }

  // 5. Connect to Solana RPC
  console.log(`\nConnecting to RPC node: ${rpcEnv}...`);
  const connection = new Connection(rpcEnv, "confirmed");
  try {
    const version = await connection.getVersion();
    console.log(`✓ Connected to Solana Node! version:`, version["solana-core"]);
  } catch (err: any) {
    console.error("❌ Connection failed:", err.message);
    process.exit(1);
  }

  // 6. Check wallet balance
  try {
    const balance = await connection.getBalance(walletKeypair.publicKey);
    const balanceSol = balance / 1e9;
    console.log(`✓ Wallet Balance: ${balanceSol} SOL`);
    if (balanceSol === 0) {
      console.warn(
        "\n⚠️ WARNING: Wallet has 0 SOL! You must fund this wallet on Solana Devnet to run transaction tests."
      );
      console.warn(
        "  Please visit: https://faucet.solana.com/ and request devnet SOL."
      );
    } else {
      console.log("✓ Wallet is funded! Ready to execute transactions.");
    }
  } catch (err: any) {
    console.error("❌ Failed to check wallet balance:", err.message);
  }

  console.log("\n======================================");
  console.log(
    "🎉 Verification complete. Your scaffolding and network setup is fully valid!"
  );
}

verify();
