import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { program, provider, walletKeypair, connection } from "../src/solana";
import { appConfig } from "../src/config";
import { logger } from "../src/utils/logger";

async function subscribe() {
  logger.info(`Starting subscription process on network: ${appConfig.network}`);
  logger.info(`Wallet: ${walletKeypair.publicKey.toBase58()}`);

  const balance = await connection.getBalance(walletKeypair.publicKey);
  logger.info(`Wallet Balance: ${balance / 1e9} SOL`);

  if (balance === 0) {
    logger.warn(
      "Wallet has 0 SOL. Please request devnet SOL manually from https://faucet.solana.com/"
    );
    return;
  }

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    program.programId
  );
  logger.info(`Derived tokenTreasuryPda: ${tokenTreasuryPda.toBase58()}`);

  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    appConfig.txlTokenMint,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  logger.info(`Derived tokenTreasuryVault: ${tokenTreasuryVault.toBase58()}`);

  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    program.programId
  );
  logger.info(`Derived pricingMatrixPda: ${pricingMatrixPda.toBase58()}`);

  const userTokenAccount = getAssociatedTokenAddressSync(
    appConfig.txlTokenMint,
    walletKeypair.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  logger.info(`Derived userTokenAccount: ${userTokenAccount.toBase58()}`);

  const userTokenAccountInfo = await connection.getAccountInfo(
    userTokenAccount
  );
  if (!userTokenAccountInfo) {
    logger.info("User TxL token account is not initialized. Creating it...");
    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        walletKeypair.publicKey,
        userTokenAccount,
        walletKeypair.publicKey,
        appConfig.txlTokenMint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    const signature = await connection.sendTransaction(createAtaTx, [
      walletKeypair,
    ]);
    logger.info(`ATA creation transaction sent: ${signature}`);
    await connection.confirmTransaction(signature, "confirmed");
    logger.info("✓ Associated Token Account created successfully!");
  }

  const serviceLevelId = appConfig.serviceLevelId;
  const durationWeeks = 4;

  logger.info(
    `Subscribing to Service Level: ${serviceLevelId} for ${durationWeeks} weeks...`
  );

  const methodBuilder = program.methods
    .subscribe(serviceLevelId, durationWeeks)
    .accounts({
      user: walletKeypair.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: appConfig.txlTokenMint,
      userTokenAccount,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    });

  logger.info("Simulating subscription transaction...");
  try {
    const simulation = await methodBuilder.simulate();
    logger.info("Simulation succeeded!");
  } catch (err: any) {
    logger.error(
      "Simulation failed! Check if matrix account or token account is initialized.",
      err
    );
    console.log("Simulation error details:", err);
    return;
  }

  logger.info("Broadcasting transaction (skipPreflight: false)...");
  try {
    const txSig = await methodBuilder.rpc();
    logger.info(`✓ Subscription transaction successful! Signature: ${txSig}`);
    console.log(`\n======================================================`);
    console.log(
      `Save this signature. You will need it to activate API access:`
    );
    console.log(`Signature: ${txSig}`);
    console.log(`======================================================\n`);
  } catch (err: any) {
    logger.error("Transaction failed to confirm or execute:", err);
  }
}

subscribe();
