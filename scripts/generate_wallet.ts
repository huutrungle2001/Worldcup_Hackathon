import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const keysDir = path.join(__dirname, "../_keys");
if (!fs.existsSync(keysDir)) {
  fs.mkdirSync(keysDir, { recursive: true });
}

const walletPath = path.join(keysDir, "wallet.json");

if (fs.existsSync(walletPath)) {
  console.log(`Wallet already exists at: ${walletPath}`);
  const secretKey = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  console.log(`Address: ${keypair.publicKey.toBase58()}`);
  process.exit(0);
}

const keypair = Keypair.generate();
const secretKey = Array.from(keypair.secretKey);
fs.writeFileSync(walletPath, JSON.stringify(secretKey));

console.log(`New wallet generated successfully!`);
console.log(`Saved to: ${walletPath}`);
console.log(`Address: ${keypair.publicKey.toBase58()}`);
console.log(`\nTo get devnet SOL:`);
console.log(`Visit: https://faucet.solana.com/ and request SOL for the address above.`);
