import express from "express";
import cors from "cors";
import { marketManager } from "../agent/market";
import { healthMonitor } from "../utils/health";
import { logger } from "../utils/logger";
import { replayEngine } from "../replay";
import { receiptStore } from "../solana/validation";

const app = express();
const PORT = process.env.PORT || 8080;

const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  process.env.FRONTEND_ORIGIN,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin as string)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  })
);
app.use(express.json());

// In-memory rate limiting map for replay controls (max 30 requests per minute per IP)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const demoReplayGate = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  if (!replayEngine.isEnabled()) {
    logger.warn(`Attempted to access replay endpoint while DEMO_REPLAY_ENABLED is false.`);
    return res.status(403).json({
      error: "Public demo replay is disabled on this server. Set DEMO_REPLAY_ENABLED=true in server configuration.",
      code: "DEMO_REPLAY_DISABLED",
    });
  }

  const clientIp = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const limitWindow = 60 * 1000;
  const maxRequests = 30;

  const current = rateLimitMap.get(clientIp);
  if (!current || now > current.resetAt) {
    rateLimitMap.set(clientIp, { count: 1, resetAt: now + limitWindow });
  } else {
    current.count++;
    if (current.count > maxRequests) {
      logger.warn(`Rate limit exceeded for client IP: ${clientIp}`);
      return res.status(429).json({
        error: "Too many replay requests. Please wait a moment before trying again.",
        code: "RATE_LIMITED",
      });
    }
  }

  next();
};

app.get("/api/health", (req, res) => {
  res.json(healthMonitor.getHealth());
});

app.get("/api/receipts", (req, res) => {
  const rawFixtureId = req.query.fixtureId;
  let fixtureId: number | undefined;

  if (rawFixtureId !== undefined) {
    if (
      typeof rawFixtureId !== "string" ||
      rawFixtureId.trim() === "" ||
      isNaN(Number(rawFixtureId)) ||
      !Number.isInteger(Number(rawFixtureId)) ||
      Number(rawFixtureId) <= 0
    ) {
      return res
        .status(400)
        .json({ error: "Invalid fixtureId filter. Must be a positive integer." });
    }
    fixtureId = Number(rawFixtureId);
  }

  const receipts = receiptStore.getReceipts(fixtureId);
  res.json(receipts);
});

app.get("/api/markets", (req, res) => {
  res.json(marketManager.getAllMarkets());
});

app.get("/api/markets/:fixtureId/audit", (req, res) => {
  const fixtureId = Number(req.params.fixtureId);
  if (isNaN(fixtureId) || fixtureId <= 0) {
    return res.status(400).json({ error: "Invalid fixtureId." });
  }
  const market = marketManager.getMarket(fixtureId);
  if (!market) {
    return res
      .status(404)
      .json({ error: `Market for fixture ${fixtureId} not found.` });
  }
  res.json(market.auditTrail);
});

app.get("/api/diagnostics", (req, res) => {
  res.json({
    health: healthMonitor.getHealth(),
    replayStatus: replayEngine.getStatus(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/replay/status", (req, res) => {
  res.json(replayEngine.getStatus());
});

app.post("/api/replay/start", demoReplayGate, async (req, res) => {
  const { fixtureId, speed } = req.body;
  const numId = Number(fixtureId);
  const numSpeed = speed !== undefined ? Number(speed) : 1;

  if (isNaN(numId) || !Number.isInteger(numId) || numId <= 0) {
    return res.status(400).json({
      error: "Invalid or missing fixtureId. Must be a positive integer.",
      status: replayEngine.getStatus(),
    });
  }
  if (isNaN(numSpeed) || numSpeed < 1 || numSpeed > 100) {
    return res.status(400).json({
      error: "Replay speed must be a number between 1 and 100.",
      status: replayEngine.getStatus(),
    });
  }

  const result = await replayEngine.startReplay(numId, numSpeed);
  if (!result.success) {
    return res.status(result.statusCode || 400).json({
      error: result.error || "Failed to start replay.",
      status: result.status,
    });
  }

  res.json({
    success: true,
    status: result.status,
  });
});

app.post("/api/replay/pause", demoReplayGate, (req, res) => {
  const result = replayEngine.pause();
  if (!result.success) {
    return res.status(result.statusCode || 409).json({
      error: result.error,
      status: result.status,
    });
  }
  res.json({ success: true, status: result.status });
});

app.post("/api/replay/resume", demoReplayGate, (req, res) => {
  const result = replayEngine.resume();
  if (!result.success) {
    return res.status(result.statusCode || 409).json({
      error: result.error,
      status: result.status,
    });
  }
  res.json({ success: true, status: result.status });
});

app.post("/api/replay/stop", demoReplayGate, (req, res) => {
  const result = replayEngine.stopReplay();
  res.json({ success: true, status: result.status });
});

app.post("/api/replay/speed", demoReplayGate, (req, res) => {
  const { speed } = req.body;
  const numSpeed = Number(speed);

  if (isNaN(numSpeed) || numSpeed < 1 || numSpeed > 100) {
    return res.status(400).json({
      error: "Replay speed must be a number between 1 and 100.",
      status: replayEngine.getStatus(),
    });
  }

  const result = replayEngine.setSpeed(numSpeed);
  if (!result.success) {
    return res.status(result.statusCode || 400).json({
      error: result.error,
      status: result.status,
    });
  }

  res.json({ success: true, status: result.status });
});

export function startServer() {
  const numericPort = Number(PORT);
  app.listen(numericPort, "0.0.0.0", () => {
    logger.info(`Express server running on port ${numericPort} on host 0.0.0.0`);
  });
}
