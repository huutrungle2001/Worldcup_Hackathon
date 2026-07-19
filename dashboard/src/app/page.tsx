"use client";

import React, { useEffect, useState, useCallback } from "react";

interface ServiceHealth {
  status: "HEALTHY" | "UNHEALTHY" | "DISCONNECTED" | "CONNECTING" | "UNKNOWN";
  lastHeartbeat?: string;
  errorCount: number;
  lastError?: string;
}

interface AppHealth {
  scoresSse: ServiceHealth;
  oddsSse: ServiceHealth;
  txlineHttp: ServiceHealth;
  solanaRpc: ServiceHealth;
  replayMode: boolean;
}

interface AuditEvent {
  timestamp: string;
  fromState: string;
  toState: string;
  reasonCode: string;
  triggerEventKey?: string;
  message: string;
}

interface VirtualMarket {
  fixtureId: number;
  state: string;
  scoreOne: number;
  scoreTwo: number;
  lastScoreSeq: number;
  lastScoreTs: number;
  lastOddsSeq: number;
  lastOddsTs: number;
  oddsOne: number;
  oddsDraw: number;
  oddsTwo: number;
  haltedAt?: string;
  reopenedAt?: string;
  settledAt?: string;
  settlementOutcome?: string;
  auditTrail: AuditEvent[];
}

interface ExpectedStat {
  key: number;
  value: number;
}

interface ProvedStat {
  key: number;
  value: number;
  period: number;
}

interface SanitizedReceipt {
  id: string;
  fixtureId: number;
  seq: number;
  expectedStats: ExpectedStat[];
  provedStats: ProvedStat[];
  proofTimestamp: number;
  pda?: string;
  programId: string;
  network: string;
  status: "CONFIRMED" | "SIMULATED" | "REJECTED" | "FAILED";
  mode: "TRANSACTION" | "SIMULATION" | "PRECHECK";
  signature?: string;
  explorerUrl?: string;
  reason?: string;
  validatedAt: string;
}

export default function Dashboard() {
  const [health, setHealth] = useState<AppHealth | null>(null);
  const [markets, setMarkets] = useState<VirtualMarket[]>([]);
  const [receipts, setReceipts] = useState<SanitizedReceipt[]>([]);
  const [selectedFixtureId, setSelectedFixtureId] = useState<number | null>(
    null
  );
  const [replayFixtureInput, setReplayFixtureInput] = useState("");
  const [replaySpeed, setReplaySpeed] = useState(5);

  const getApiBaseUrl = () => {
    if (typeof window !== "undefined") {
      const envUrl = process.env.NEXT_PUBLIC_API_URL;
      if (envUrl) return envUrl;

      if (
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1"
      ) {
        return "http://localhost:8080";
      }
      return window.location.origin;
    }
    return "http://localhost:8080";
  };

  const API_BASE = getApiBaseUrl();
  const getAdminToken = () => {
    return process.env.NEXT_PUBLIC_ADMIN_TOKEN || "proofguard-secret-key-123";
  };

  const fetchStatus = useCallback(async () => {
    try {
      const healthRes = await fetch(`${API_BASE}/api/health`);
      const healthData = await healthRes.json();
      setHealth(healthData);

      const marketsRes = await fetch(`${API_BASE}/api/markets`);
      const marketsData = await marketsRes.json();
      setMarkets(marketsData);

      const receiptsRes = await fetch(`${API_BASE}/api/receipts`);
      if (receiptsRes.ok) {
        const receiptsData = await receiptsRes.json();
        setReceipts(receiptsData);
      }
    } catch (err) {
      console.error("Failed to connect to backend Express server:", err);
    }
  }, [API_BASE]);

  useEffect(() => {
    // Schedule fetchStatus asynchronously to avoid cascading synchronous render checks in ESLint
    setTimeout(() => {
      fetchStatus();
    }, 0);
    const interval = setInterval(fetchStatus, 1000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const startReplay = async () => {
    if (!replayFixtureInput) return;
    try {
      await fetch(`${API_BASE}/api/replay/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Token": getAdminToken(),
        },
        body: JSON.stringify({
          fixtureId: Number(replayFixtureInput),
          speed: replaySpeed,
        }),
      });
      fetchStatus();
    } catch (err) {
      console.error(err);
    }
  };

  const pauseReplay = async () => {
    try {
      await fetch(`${API_BASE}/api/replay/pause`, {
        method: "POST",
        headers: {
          "X-Admin-Token": getAdminToken(),
        },
      });
    } catch (err) {
      console.error(err);
    }
  };

  const resumeReplay = async () => {
    try {
      await fetch(`${API_BASE}/api/replay/resume`, {
        method: "POST",
        headers: {
          "X-Admin-Token": getAdminToken(),
        },
      });
    } catch (err) {
      console.error(err);
    }
  };

  const stopReplay = async () => {
    try {
      await fetch(`${API_BASE}/api/replay/stop`, {
        method: "POST",
        headers: {
          "X-Admin-Token": getAdminToken(),
        },
      });
    } catch (err) {
      console.error(err);
    }
  };

  const updateSpeed = async (speed: number) => {
    setReplaySpeed(speed);
    try {
      await fetch(`${API_BASE}/api/replay/speed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Token": getAdminToken(),
        },
        body: JSON.stringify({ speed }),
      });
    } catch (err) {
      console.error(err);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "HEALTHY":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-emerald-500/5";
      case "CONNECTING":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-amber-500/5 animate-pulse";
      case "UNHEALTHY":
        return "bg-rose-500/10 text-rose-400 border-rose-500/20 shadow-rose-500/5";
      default:
        return "bg-slate-500/10 text-slate-400 border-slate-500/20 shadow-slate-500/5";
    }
  };

  const getMarketStateColor = (state: string) => {
    switch (state) {
      case "OPEN":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      case "HALTED":
        return "bg-rose-500/10 text-rose-400 border-rose-500/20 animate-pulse";
      case "PROOF_PENDING":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      case "FINAL_PROOF_PENDING":
        return "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";
      case "SETTLED":
        return "bg-sky-500/10 text-sky-400 border-sky-500/20";
      default:
        return "bg-slate-500/10 text-slate-400 border-slate-500/20";
    }
  };

  const selectedMarket = markets.find((m) => m.fixtureId === selectedFixtureId);

  return (
    <div className="min-h-screen bg-[#080B11] text-slate-100 font-sans selection:bg-indigo-500 selection:text-white">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-[500px] bg-radial from-indigo-500/5 via-[#080B11]/0 to-[#080B11]/0 pointer-events-none" />

      <header className="border-b border-slate-800/60 bg-[#0C101B]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 border border-indigo-400/20">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-slate-50 to-slate-200 bg-clip-text text-transparent">
                ProofGuard Dashboard
              </h1>
              <p className="text-xs text-slate-400 font-mono">
                Solana Risk Circuit Breaker Agent
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {health ? (
              <>
                <div
                  className={`px-3 py-1.5 rounded-full border text-xs font-mono flex items-center gap-1.5 ${getStatusColor(
                    health.scoresSse.status
                  )}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  Scores SSE
                </div>
                <div
                  className={`px-3 py-1.5 rounded-full border text-xs font-mono flex items-center gap-1.5 ${getStatusColor(
                    health.oddsSse.status
                  )}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  Odds SSE
                </div>
                <div
                  className={`px-3 py-1.5 rounded-full border text-xs font-mono flex items-center gap-1.5 ${getStatusColor(
                    health.txlineHttp.status
                  )}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  TxLINE API
                </div>
                <div
                  className={`px-3 py-1.5 rounded-full border text-xs font-mono flex items-center gap-1.5 ${getStatusColor(
                    health.solanaRpc.status
                  )}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  Solana RPC
                </div>
                {health.replayMode && (
                  <div className="px-3 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 text-xs font-mono flex items-center gap-1.5 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    Replay Mode
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-rose-400 font-mono animate-pulse">
                Disconnected from Backend Express API Server (port 8080)
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Cols: Replay Control & Markets */}
        <div className="lg:col-span-2 flex flex-col gap-8">
          {/* Replay Simulation Controller */}
          <section className="border border-slate-800/60 bg-[#0C101B]/50 backdrop-blur-md rounded-2xl p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-bl from-indigo-500/5 to-transparent rounded-full pointer-events-none" />
            <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2 mb-4">
              <svg
                className="w-5 h-5 text-indigo-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Replay & Simulation Controller
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-2">
                  Fixture ID (e.g., 18257739 or 18175981)
                </label>
                <input
                  type="text"
                  placeholder="Enter Fixture ID"
                  className="w-full bg-[#141A29] border border-slate-700/60 rounded-xl px-4 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-indigo-500 font-mono transition-colors"
                  value={replayFixtureInput}
                  onChange={(e) => setReplayFixtureInput(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-xs font-mono text-slate-400">
                  Replay Speed ({replaySpeed}x)
                </span>
                <div className="flex gap-2">
                  {[1, 5, 10, 20].map((speed) => (
                    <button
                      key={speed}
                      onClick={() => updateSpeed(speed)}
                      className={`flex-1 py-2 rounded-xl text-xs font-mono border transition-all ${
                        replaySpeed === speed
                          ? "bg-indigo-600 text-white border-indigo-400/20 shadow-lg shadow-indigo-600/20"
                          : "bg-[#141A29] border-slate-700/60 text-slate-400 hover:border-slate-600"
                      }`}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 mt-6 pt-6 border-t border-slate-800/60">
              <div className="flex gap-3">
                <button
                  onClick={startReplay}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/20 transition-all border border-indigo-400/20"
                >
                  Start Replay
                </button>
                <button
                  onClick={pauseReplay}
                  className="px-4 py-2.5 rounded-xl bg-[#141A29] border border-slate-700/60 hover:border-slate-600 text-slate-300 font-semibold text-sm transition-all"
                >
                  Pause
                </button>
                <button
                  onClick={resumeReplay}
                  className="px-4 py-2.5 rounded-xl bg-[#141A29] border border-slate-700/60 hover:border-slate-600 text-slate-300 font-semibold text-sm transition-all"
                >
                  Resume
                </button>
              </div>

              <button
                onClick={stopReplay}
                className="px-5 py-2.5 rounded-xl bg-rose-600/10 border border-rose-500/20 text-rose-400 hover:bg-rose-600/20 font-semibold text-sm transition-all"
              >
                Stop Replay
              </button>
            </div>
          </section>

          {/* Virtual Markets */}
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              <svg
                className="w-5 h-5 text-indigo-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
              Active Virtual Markets
            </h2>

            {markets.length === 0 ? (
              <div className="border border-slate-800/60 bg-[#0C101B]/30 rounded-2xl p-8 text-center text-slate-500 font-mono text-sm">
                No active virtual markets monitored yet. Start a replay or let
                live streams ingest data.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {markets.map((market) => (
                  <div
                    key={market.fixtureId}
                    onClick={() => setSelectedFixtureId(market.fixtureId)}
                    className={`border rounded-2xl p-5 cursor-pointer transition-all duration-300 ${
                      selectedFixtureId === market.fixtureId
                        ? "bg-[#101626] border-indigo-500 shadow-xl shadow-indigo-950/20"
                        : "bg-[#0C101B]/50 border-slate-800/60 hover:bg-[#101524] hover:border-slate-700/60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4 mb-4">
                      <span className="text-xs font-mono text-slate-400">
                        Fixture #{market.fixtureId}
                      </span>
                      <div
                        className={`px-2.5 py-0.5 rounded-full border text-[10px] font-semibold tracking-wider ${getMarketStateColor(
                          market.state
                        )}`}
                      >
                        {market.state}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 mb-6">
                      <div className="flex flex-col">
                        <span className="text-xs text-slate-500 font-mono">
                          Goals
                        </span>
                        <span className="text-2xl font-bold tracking-tight text-slate-100">
                          {market.scoreOne} - {market.scoreTwo}
                        </span>
                      </div>

                      <div className="flex flex-col text-right">
                        <span className="text-xs text-slate-500 font-mono">
                          1 / X / 2 Odds
                        </span>
                        <span className="text-sm font-semibold text-slate-300 font-mono">
                          {market.oddsOne
                            ? (market.oddsOne / 1000).toFixed(2)
                            : "-"}{" "}
                          /{" "}
                          {market.oddsDraw
                            ? (market.oddsDraw / 1000).toFixed(2)
                            : "-"}{" "}
                          /{" "}
                          {market.oddsTwo
                            ? (market.oddsTwo / 1000).toFixed(2)
                            : "-"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 text-[10px] font-mono text-slate-500 border-t border-slate-800/60 pt-3">
                      <span>Score Seq: {market.lastScoreSeq}</span>
                      <span>Odds Seq: {market.lastOddsSeq}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Col: Details / Audit Trail logs */}
        <div className="flex flex-col gap-8">
          <section className="border border-slate-800/60 bg-[#0C101B]/50 backdrop-blur-md rounded-2xl p-6 h-full flex flex-col min-h-[500px]">
            <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2 mb-4 pb-4 border-b border-slate-800/60">
              <svg
                className="w-5 h-5 text-indigo-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                />
              </svg>
              Virtual Market Details & Audit Logs
            </h2>

            {selectedMarket ? (
              <div className="flex flex-col flex-1 gap-6">
                <div>
                  <h3 className="text-xs font-mono text-slate-400 mb-2">
                    Selected Market Summary
                  </h3>
                  <div className="bg-[#141A29]/60 border border-slate-800/60 rounded-xl p-4 flex flex-col gap-3 font-mono text-xs text-slate-300">
                    <div className="flex justify-between">
                      <span>Fixture ID:</span>
                      <span className="text-slate-100 font-bold">
                        {selectedMarket.fixtureId}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Current State:</span>
                      <span className="text-slate-100 font-bold">
                        {selectedMarket.state}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Live score:</span>
                      <span className="text-slate-100 font-bold">
                        {selectedMarket.scoreOne} - {selectedMarket.scoreTwo}
                      </span>
                    </div>
                    {selectedMarket.settlementOutcome && (
                      <div className="flex justify-between">
                        <span>Outcome:</span>
                        <span className="text-indigo-400 font-bold">
                          {selectedMarket.settlementOutcome}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 flex flex-col">
                  <h3 className="text-xs font-mono text-slate-400 mb-3">
                    Transition History Logs
                  </h3>
                  <div className="flex-1 overflow-y-auto space-y-4 max-h-[400px] pr-1">
                    {selectedMarket.auditTrail.map((log, index) => (
                      <div
                        key={index}
                        className="relative pl-6 border-l border-slate-800/80 last:border-0 pb-4"
                      >
                        <div className="absolute left-[-4.5px] top-1 w-2.5 h-2.5 rounded-full bg-indigo-500/80 shadow-[0_0_8px_rgba(99,102,241,0.5)] border border-indigo-400/20" />
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between gap-4 text-[10px] font-mono">
                            <span className="text-slate-400">
                              {log.fromState} → {log.toState}
                            </span>
                            <span className="text-slate-500">
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          <div className="text-xs text-slate-200 bg-[#141A29]/30 rounded-xl p-3 border border-slate-800/40">
                            <p className="font-semibold text-slate-100 mb-1">
                              {log.reasonCode}
                            </p>
                            <p className="text-slate-400 text-[11px] leading-relaxed">
                              {log.message}
                            </p>
                            {log.triggerEventKey && (
                              <p className="mt-2 text-[9px] text-slate-500 font-mono truncate">
                                Event Key: {log.triggerEventKey}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center text-slate-500 font-mono text-sm">
                Click on any virtual market card to view its live details and
                historical transition audit logs.
              </div>
            )}
          </section>

          {/* Verification Receipt Panel (Judge-Visible) */}
          <section className="border border-slate-800/60 bg-[#0C101B]/50 backdrop-blur-md rounded-2xl p-6 flex flex-col">
            <h2 className="text-lg font-semibold text-slate-100 flex items-center justify-between mb-4 pb-4 border-b border-slate-800/60">
              <span className="flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-emerald-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Solana Proof Verification Receipt
              </span>
            </h2>

            {(() => {
              const activeReceipt = selectedFixtureId
                ? receipts.find((r) => r.fixtureId === selectedFixtureId) || null
                : receipts[0] || null;

              if (!activeReceipt) {
                return (
                  <div className="text-center text-slate-500 font-mono text-xs py-8">
                    No verification receipts recorded yet. Run a live or replay flow to generate proof receipts.
                  </div>
                );
              }

              const badge = (() => {
                switch (activeReceipt.status) {
                  case "CONFIRMED":
                    return {
                      label: "Confirmed on Solana",
                      color:
                        "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
                    };
                  case "SIMULATED":
                    return {
                      label: "Simulation passed",
                      color:
                        "bg-blue-500/20 text-blue-400 border-blue-500/30",
                    };
                  case "REJECTED":
                    return {
                      label: "Proof rejected",
                      color:
                        "bg-amber-500/20 text-amber-400 border-amber-500/30",
                    };
                  case "FAILED":
                  default:
                    return {
                      label: "Validation failed",
                      color:
                        "bg-rose-500/20 text-rose-400 border-rose-500/30",
                    };
                }
              })();

              return (
                <div className="bg-[#141A29]/60 border border-slate-800/60 rounded-xl p-4 flex flex-col gap-3 font-mono text-xs text-slate-300">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Result Status:</span>
                    <span
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${badge.color}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Mode:</span>
                    <span className="text-slate-200 font-bold">
                      {activeReceipt.mode}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Fixture ID / Seq:</span>
                    <span className="text-slate-200 font-bold">
                      {activeReceipt.fixtureId} (seq {activeReceipt.seq})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Expected Stats:</span>
                    <span className="text-slate-200">
                      {activeReceipt.expectedStats
                        .map((s) => `key ${s.key}:${s.value}`)
                        .join(", ")}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Proved Stats:</span>
                    <span className="text-slate-200">
                      {activeReceipt.provedStats.length > 0
                        ? activeReceipt.provedStats
                            .map((s) => `key ${s.key}:${s.value}`)
                            .join(", ")
                        : "None"}
                    </span>
                  </div>
                  {activeReceipt.pda && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Roots PDA:</span>
                      <span
                        className="text-slate-300 truncate max-w-[180px]"
                        title={activeReceipt.pda}
                      >
                        {activeReceipt.pda}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-400">Program / Network:</span>
                    <span className="text-slate-300 truncate max-w-[180px]">
                      {activeReceipt.programId} ({activeReceipt.network})
                    </span>
                  </div>
                  {activeReceipt.reason && (
                    <div className="flex justify-between text-amber-400">
                      <span>Reason:</span>
                      <span
                        className="truncate max-w-[220px]"
                        title={activeReceipt.reason}
                      >
                        {activeReceipt.reason}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-2 border-t border-slate-800/60">
                    <span>
                      Validated:{" "}
                      {new Date(activeReceipt.validatedAt).toLocaleTimeString()}
                    </span>
                    {activeReceipt.status === "CONFIRMED" &&
                      activeReceipt.explorerUrl && (
                        <a
                          href={activeReceipt.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-400 underline hover:text-emerald-300 font-bold text-[11px]"
                        >
                          Solana Explorer ↗
                        </a>
                      )}
                  </div>
                </div>
              );
            })()}
          </section>
        </div>
      </main>
    </div>
  );
}
