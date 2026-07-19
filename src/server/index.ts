import express from "express";
import cors from "cors";
import { marketManager } from "../agent/market";
import { healthMonitor } from "../utils/health";
import { logger } from "../utils/logger";
import { replayEngine } from "../replay";

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
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  })
);
app.use(express.json());

// Simple authorization middleware to prevent unauthorized replay usage (Finding 7)
const adminAuth = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const token = req.headers["x-admin-token"] || req.query.adminToken;
  const adminSecret = process.env.ADMIN_SECRET || "proofguard-secret-key-123";
  if (token !== adminSecret) {
    logger.warn(`Unauthenticated attempt to access replay control endpoints.`);
    return res
      .status(401)
      .json({ error: "Unauthorized access to replay controls." });
  }
  next();
};

app.get("/api/health", (req, res) => {
  res.json(healthMonitor.getHealth());
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
    timestamp: new Date().toISOString(),
  });
});

app.post("/api/replay/start", adminAuth, (req, res) => {
  const { fixtureId, speed } = req.body;
  const numId = Number(fixtureId);
  const numSpeed = Number(speed || 1);

  if (isNaN(numId) || numId <= 0) {
    return res
      .status(400)
      .json({ error: "Invalid or missing fixtureId in request body." });
  }
  if (isNaN(numSpeed) || numSpeed < 1 || numSpeed > 50) {
    return res
      .status(400)
      .json({ error: "Replay speed must be between 1 and 50." });
  }

  replayEngine.startReplay(numId, numSpeed);
  res.json({
    success: true,
    message: `Replay started for fixture ${numId} at speed ${numSpeed}x`,
  });
});

app.post("/api/replay/pause", adminAuth, (req, res) => {
  replayEngine.pause();
  res.json({ success: true, message: "Replay paused" });
});

app.post("/api/replay/resume", adminAuth, (req, res) => {
  replayEngine.resume();
  res.json({ success: true, message: "Replay resumed" });
});

app.post("/api/replay/stop", adminAuth, (req, res) => {
  replayEngine.stopReplay();
  res.json({ success: true, message: "Replay stopped" });
});

app.post("/api/replay/speed", adminAuth, (req, res) => {
  const { speed } = req.body;
  const numSpeed = Number(speed);

  if (isNaN(numSpeed) || numSpeed < 1 || numSpeed > 50) {
    return res
      .status(400)
      .json({ error: "Replay speed must be between 1 and 50." });
  }

  replayEngine.setSpeed(numSpeed);
  res.json({ success: true, message: `Replay speed set to ${numSpeed}x` });
});

export function startServer() {
  app.listen(PORT, () => {
    logger.info(`Express server running on port ${PORT}`);
  });
}
