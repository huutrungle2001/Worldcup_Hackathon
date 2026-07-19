import axios from "axios";
import * as nacl from "tweetnacl";
import * as fs from "fs";
import * as path from "path";
import { walletKeypair } from "../src/solana";
import { appConfig } from "../src/config";
import { logger } from "../src/utils/logger";

async function activate() {
  const txSig = process.argv[2] || process.env.TXLINE_TXSIG;

  if (!txSig) {
    logger.error("No subscription signature provided! Please pass the transaction signature as an argument:");
    console.log("Example: yarn ts-node scripts/activate.ts <TX_SIGNATURE>");
    process.exit(1);
  }

  logger.info(`Starting API activation on network: ${appConfig.network}`);
  logger.info(`Subscription Signature: ${txSig}`);
  logger.info(`Wallet: ${walletKeypair.publicKey.toBase58()}`);

  const apiOrigin = appConfig.apiOrigin;
  const apiBaseUrl = `${apiOrigin}/api`;
  const SELECTED_LEAGUES: number[] = [];

  logger.info(`Requesting guest authentication token from: ${apiOrigin}/auth/guest/start`);
  let jwt: string;
  try {
    const authResponse = await axios.post(`${apiOrigin}/auth/guest/start`);
    jwt = authResponse.data.token;
    logger.info(`✓ Retrieved guest JWT!`);
  } catch (err: any) {
    logger.error(`Failed to get guest JWT:`, err);
    return;
  }

  const messageString = `${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}`;
  logger.info(`Constructed message string for signing: "${messageString}"`);
  const message = new TextEncoder().encode(messageString);

  logger.info("Signing activation message...");
  const signatureBytes = nacl.sign.detached(message, walletKeypair.secretKey);
  const walletSignature = Buffer.from(signatureBytes).toString("base64");
  logger.info("✓ Message signed successfully.");

  logger.info(`Sending activation request to: ${apiBaseUrl}/token/activate`);
  try {
    const activationResponse = await axios.post(
      `${apiBaseUrl}/token/activate`,
      {
        txSig,
        walletSignature,
        leagues: SELECTED_LEAGUES,
      },
      {
        headers: { Authorization: `Bearer ${jwt}` },
      }
    );

    const apiToken = activationResponse.data.token || activationResponse.data;
    logger.info("✓ API Token activated successfully!");
    
    const envPath = path.join(__dirname, "../.env");
    let envContent = "";
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, "utf-8");
    }

    if (envContent.includes("X_API_TOKEN=")) {
      envContent = envContent.replace(/X_API_TOKEN=.*/, `X_API_TOKEN=${apiToken}`);
    } else {
      envContent += `\nX_API_TOKEN=${apiToken}`;
    }

    fs.writeFileSync(envPath, envContent);
    logger.info("✓ Saved X_API_TOKEN to .env file!");

    console.log(`\n======================================================`);
    console.log(`API Token: ${apiToken}`);
    console.log(`======================================================\n`);
  } catch (err: any) {
    logger.error("Activation failed!", err.response?.data || err.message);
  }
}

activate();
