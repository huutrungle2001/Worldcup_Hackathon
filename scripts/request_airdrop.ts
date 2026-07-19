import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const address = new PublicKey("DgnqUG3kfKEqMPCZuSj73ksLvdgNhu7JvcHBjaTRaRsn");

async function run() {
  console.log(`Requesting 1 SOL airdrop for ${address.toBase58()}...`);
  try {
    const signature = await connection.requestAirdrop(address, 1e9);
    console.log(`Airdrop signature: ${signature}`);
    console.log("Waiting for confirmation...");
    await connection.confirmTransaction(signature, "confirmed");
    const balance = await connection.getBalance(address);
    console.log(`Success! New balance: ${balance / 1e9} SOL`);
  } catch (error: any) {
    console.error(`Failed to request airdrop via RPC:`, error.message);
    console.log(`Please visit https://faucet.solana.com/ to request devnet SOL manually.`);
  }
}

run();
