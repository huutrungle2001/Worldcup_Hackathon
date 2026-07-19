import express from "express";
import cors from "cors";
import { marketManager } from "../agent/market";
import { healthMonitor } from "../utils/health";
import { logger } from "../utils/logger";
import { replayEngine } from "../replay";

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json(healthMonitor.getHealth());
});

app.get("/api/markets", (req, res) => {
  res.json(marketManager.getAllMarkets());
});

app.get("/api/markets/:fixtureId/audit", (req, res) => {
  const fixtureId = Number(req.params.fixtureId);
  const market = marketManager.getMarket(fixtureId);
  if (!market) {
    return res.status(404).json({ error: `Market for fixture ${fixtureId} not found.` });
  }
  res.json(market.auditTrail);
});

app.get("/api/diagnostics", (req, res) => {
  res.json({
    health: healthMonitor.getHealth(),
    timestamp: new Date().toISOString(),
  });
});

app.post("/api/replay/start", (req, res) => {
  const { fixtureId, speed } = req.body;
  if (!fixtureId) {
    return res.status(400).json({ error: "Missing fixtureId in request body." });
  }
  replayEngine.startReplay(Number(fixtureId), Number(speed || 1));
  res.json({ success: true, message: `Replay started for fixture ${fixtureId}` });
});

app.post("/api/replay/pause", (req, res) => {
  replayEngine.pause();
  res.json({ success: true, message: "Replay paused" });
});

app.post("/api/replay/resume", (req, res) => {
  replayEngine.resume();
  res.json({ success: true, message: "Replay resumed" });
});

app.post("/api/replay/stop", (req, res) => {
  replayEngine.stopReplay();
  res.json({ success: true, message: "Replay stopped" });
});

app.post("/api/replay/speed", (req, res) => {
  const { speed } = req.body;
  if (!speed) {
    return res.status(400).json({ error: "Missing speed in request body." });
  }
  replayEngine.setSpeed(Number(speed));
  res.json({ success: true, message: `Replay speed set to ${speed}x` });
});

export function startServer() {
  app.listen(PORT, () => {
    logger.info(`Express server running on port ${PORT}`);
  });
}
