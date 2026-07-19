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

type ReplayState =
  | "IDLE"
  | "LOADING"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED";

interface ReplayStatus {
  enabled: boolean;
  state: ReplayState;
  activeFixtureId: number | null;
  demoFixtureId: number | null;
  speed: number;
  currentStep: number;
  totalSteps: number;
  message: string;
  error: string | null;
  lastUpdated: string;
}

export default function Dashboard() {
  const [health, setHealth] = useState<AppHealth | null>(null);
  const [markets, setMarkets] = useState<VirtualMarket[]>([]);
  const [receipts, setReceipts] = useState<SanitizedReceipt[]>([]);
  const [replayStatus, setReplayStatus] = useState<ReplayStatus | null>(null);

  const [selectedFixtureId, setSelectedFixtureId] = useState<number | null>(null);
  const [replayFixtureInput, setReplayFixtureInput] = useState("");
  const [manualSpeed, setManualSpeed] = useState(5);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  // Error and UI notification states
  const [backendError, setBackendError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Input validation state
  const [validationError, setValidationError] = useState<string | null>(null);

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

  const translateState = (state: string) => {
    switch (state) {
      case "OPEN":
        return "Market accepting virtual trades";
      case "HALTED":
        return "Goal detected; market paused";
      case "PROOF_PENDING":
        return "Proof passed; waiting for newer odds";
      case "FINAL_PROOF_PENDING":
        return "Match ended; final proof pending";
      case "SETTLED":
        return "Final score verified; market settled";
      default:
        return state;
    }
  };

  const translateStatKey = (key: number) => {
    if (key === 1) return "Participant 1 goals";
    if (key === 2) return "Participant 2 goals";
    return `Stat key ${key}`;
  };

  const fetchStatus = useCallback(async () => {
    try {
      const healthRes = await fetch(`${API_BASE}/api/health`);
      if (!healthRes.ok) {
        throw new Error(`HTTP error ${healthRes.status}`);
      }
      const healthData = await healthRes.json();
      setHealth(healthData);

      const replayRes = await fetch(`${API_BASE}/api/replay/status`);
      if (!replayRes.ok) {
        throw new Error(`HTTP error ${replayRes.status}`);
      }
      const replayData = await replayRes.json();
      setReplayStatus(replayData);

      const marketsRes = await fetch(`${API_BASE}/api/markets`);
      if (!marketsRes.ok) {
        throw new Error(`HTTP error ${marketsRes.status}`);
      }
      const marketsData = await marketsRes.json();
      setMarkets(marketsData);

      const receiptsRes = await fetch(`${API_BASE}/api/receipts`);
      if (receiptsRes.ok) {
        const receiptsData = await receiptsRes.json();
        setReceipts(receiptsData);
      }

      setBackendError(null);

      // Auto-selection: if replay active and has active fixture, auto-select it if it exists in markets
      if (replayData?.activeFixtureId) {
        const exists = marketsData.some((m: VirtualMarket) => m.fixtureId === replayData.activeFixtureId);
        if (exists && selectedFixtureId !== replayData.activeFixtureId) {
          setSelectedFixtureId(replayData.activeFixtureId);
        }
      }
    } catch (err) {
      console.error("Failed to connect to backend Express server:", err);
      setBackendError("Disconnected from backend API server. Stale metrics are hidden.");
      setHealth(null);
      setReplayStatus(null);
    }
  }, [API_BASE, selectedFixtureId]);

  useEffect(() => {
    setTimeout(() => {
      fetchStatus();
    }, 0);
    const interval = setInterval(fetchStatus, 1000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Handle manual input change and validate
  const handleFixtureInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setReplayFixtureInput(val);
    if (!val) {
      setValidationError(null);
      return;
    }
    const num = Number(val);
    if (!Number.isInteger(num) || num <= 0) {
      setValidationError("Fixture ID must be a positive integer.");
    } else {
      setValidationError(null);
    }
  };

  const handleActionResponse = async (res: Response, successMsg: string) => {
    setActionError(null);
    setActionSuccess(null);
    if (!res.ok) {
      let errMsg = `Server returned status ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson.error) {
          errMsg = errJson.error;
        }
      } catch {
        // Ignore parse error
      }
      setActionError(errMsg);
    } else {
      setActionSuccess(successMsg);
      fetchStatus();
    }
  };

  const runHistoricalDemo = async () => {
    if (!replayStatus || !replayStatus.demoFixtureId) return;
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch(`${API_BASE}/api/replay/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fixtureId: replayStatus.demoFixtureId,
          speed: manualSpeed,
        }),
      });
      await handleActionResponse(res, `Historical demo started successfully.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`Network connection failed: ${msg}`);
    }
  };

  const startReplayManual = async () => {
    const num = Number(replayFixtureInput);
    if (!replayFixtureInput || isNaN(num) || num <= 0) {
      setValidationError("Please enter a valid positive integer Fixture ID.");
      return;
    }
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch(`${API_BASE}/api/replay/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fixtureId: num,
          speed: manualSpeed,
        }),
      });
      await handleActionResponse(res, `Manual replay started for fixture ${num}.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`Network connection failed: ${msg}`);
    }
  };

  const pauseReplay = async () => {
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch(`${API_BASE}/api/replay/pause`, {
        method: "POST",
      });
      await handleActionResponse(res, "Replay paused successfully.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`Network connection failed: ${msg}`);
    }
  };

  const resumeReplay = async () => {
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch(`${API_BASE}/api/replay/resume`, {
        method: "POST",
      });
      await handleActionResponse(res, "Replay resumed successfully.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`Network connection failed: ${msg}`);
    }
  };

  const stopReplay = async () => {
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch(`${API_BASE}/api/replay/stop`, {
        method: "POST",
      });
      await handleActionResponse(res, "Replay stopped.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`Network connection failed: ${msg}`);
    }
  };

  const updateSpeed = async (speed: number) => {
    setManualSpeed(speed);
    if (replayStatus && (replayStatus.state === "RUNNING" || replayStatus.state === "PAUSED")) {
      try {
        const res = await fetch(`${API_BASE}/api/replay/speed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ speed }),
        });
        await handleActionResponse(res, `Replay speed updated to ${speed}x.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setActionError(`Network connection failed: ${msg}`);
      }
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "HEALTHY":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-emerald-500/5";
      case "CONNECTING":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-amber-500/5 motion-safe:animate-pulse";
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
        return "bg-rose-500/10 text-rose-400 border-rose-500/20 motion-safe:animate-pulse";
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

  // Determine active receipt for selected fixture or fallback to first receipt
  const activeReceipt = selectedFixtureId
    ? receipts.find((r) => r.fixtureId === selectedFixtureId) || null
    : receipts[0] || null;

  const selectedMarket = markets.find((m) => m.fixtureId === selectedFixtureId);

  // Compute validation and button disabled enablers based on state machine
  const isDemoReplayEnabled = replayStatus?.enabled ?? false;
  const isDemoFixtureAvailable = !!replayStatus?.demoFixtureId;
  const isLoaded = !!replayStatus;

  const canStartDemo = isLoaded && isDemoReplayEnabled && isDemoFixtureAvailable && (replayStatus.state === "IDLE" || replayStatus.state === "COMPLETED" || replayStatus.state === "FAILED");
  const canStartManual = isLoaded && isDemoReplayEnabled && !validationError && (replayStatus.state === "IDLE" || replayStatus.state === "COMPLETED" || replayStatus.state === "FAILED");
  const canPause = isLoaded && replayStatus.state === "RUNNING";
  const canResume = isLoaded && replayStatus.state === "PAUSED";
  const canStop = isLoaded && (replayStatus.state === "RUNNING" || replayStatus.state === "PAUSED" || replayStatus.state === "LOADING");

  return (
    <div className="min-h-screen bg-[#080B11] text-slate-100 font-sans selection:bg-indigo-500 selection:text-white pb-12">
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
                aria-hidden="true"
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
              </>
            ) : (
              <div className="text-xs text-rose-400 font-mono" role="status">
                Offline
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Global Alerts Section */}
      <div className="max-w-7xl mx-auto px-4 mt-6">
        {backendError && (
          <div
            className="border border-rose-500/20 bg-rose-500/10 text-rose-300 p-4 rounded-xl flex items-center justify-between gap-4 text-sm font-mono"
            role="alert"
          >
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-rose-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{backendError}</span>
            </div>
            <button
              onClick={fetchStatus}
              className="px-3 py-1 rounded bg-rose-600/20 border border-rose-500/30 hover:bg-rose-600/30 font-semibold text-xs transition-colors focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:outline-none"
            >
              Retry Connection
            </button>
          </div>
        )}

        {actionError && (
          <div
            className="border border-rose-500/20 bg-rose-500/10 text-rose-300 p-4 rounded-xl flex items-center justify-between gap-4 text-sm font-mono mt-2"
            role="alert"
          >
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-rose-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>Error: {actionError}</span>
            </div>
            <button
              onClick={() => setActionError(null)}
              className="text-xs text-rose-400 hover:underline font-bold"
              aria-label="Dismiss alert"
            >
              Dismiss
            </button>
          </div>
        )}

        {actionSuccess && (
          <div
            className="border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 p-4 rounded-xl flex items-center justify-between gap-4 text-sm font-mono mt-2"
            role="status"
          >
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{actionSuccess}</span>
            </div>
            <button
              onClick={() => setActionSuccess(null)}
              className="text-xs text-emerald-400 hover:underline font-bold"
              aria-label="Dismiss notification"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      <main className="max-w-7xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left & Middle Column (2 span on desktop) */}
        <div className="lg:col-span-2 flex flex-col gap-8">

          {/* Above the Fold Product Explanation */}
          <section className="border border-slate-800/60 bg-[#0C101B]/40 rounded-2xl p-6 relative overflow-hidden">
            <h2 className="text-lg font-bold text-slate-100 mb-2">What is ProofGuard?</h2>
            <p className="text-sm text-slate-300 leading-relaxed mb-4">
              ProofGuard automatically halts a virtual market when a goal arrives, verifies the score using TxLINE&apos;s Solana proof, and reopens only after fresh odds arrive.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#141A29]/40 border border-slate-800/60 rounded-xl p-4 text-xs font-mono text-slate-400 mb-6">
              <div className="flex flex-col gap-1.5">
                <span className="text-slate-200 font-semibold">Demo Replay Mode:</span>
                <span>Run simulations with real historical TxLINE score updates and simulated odds.</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-slate-200 font-semibold">No Wallet Required:</span>
                <span>All verification runs securely using pre-configured public anchors without transaction cost to you.</span>
              </div>
            </div>

            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">ProofGuard Journey</h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-center text-xs font-mono">
              <div className="bg-[#141A29] border border-slate-800/60 p-2.5 rounded-lg flex items-center justify-center text-slate-300">
                1. Goal detected
              </div>
              <div className="bg-[#141A29] border border-slate-800/60 p-2.5 rounded-lg flex items-center justify-center text-slate-300">
                2. Market halted
              </div>
              <div className="bg-[#141A29] border border-slate-800/60 p-2.5 rounded-lg flex items-center justify-center text-slate-300">
                3. Solana proof checked
              </div>
              <div className="bg-[#141A29] border border-slate-800/60 p-2.5 rounded-lg flex items-center justify-center text-slate-300">
                4. Fresh odds reopen
              </div>
            </div>
          </section>

          {/* Replay Simulation Controller */}
          <section className="border border-slate-800/60 bg-[#0C101B]/50 backdrop-blur-md rounded-2xl p-6 relative">
            <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2 mb-4">
              <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Historical Demo Controller
            </h2>

            {/* Live Replay status sentence */}
            <div
              className="bg-[#141A29] border border-slate-800/60 rounded-xl p-4 mb-6 flex flex-col gap-4 font-mono text-xs"
              aria-live="polite"
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 w-full">
                <div className="flex flex-col gap-1">
                  <span className="text-slate-400 uppercase tracking-wider text-[10px]">Replay Engine Status</span>
                  <span className="text-slate-200 font-bold text-sm">
                    {replayStatus ? replayStatus.message : "Not Connected"}
                  </span>
                  {replayStatus?.error && (
                    <span className="text-rose-400 text-xs mt-1" role="alert">
                      Error: {replayStatus.error}
                    </span>
                  )}
                </div>
                {replayStatus && (
                  <div className="flex flex-wrap items-center gap-2.5">
                    <div className="px-2.5 py-1 rounded bg-[#0A0E17] border border-slate-800 text-slate-300">
                      State: <strong className="text-indigo-400">{replayStatus.state}</strong>
                    </div>
                    {replayStatus.activeFixtureId && (
                      <div className="px-2.5 py-1 rounded bg-[#0A0E17] border border-slate-800 text-slate-300">
                        Fixture: <strong className="text-slate-200">{replayStatus.activeFixtureId}</strong>
                      </div>
                    )}
                    {replayStatus.totalSteps > 0 && (
                      <div className="px-2.5 py-1 rounded bg-[#0A0E17] border border-slate-800 text-slate-300">
                        Progress: <strong className="text-slate-200">{replayStatus.currentStep} / {replayStatus.totalSteps}</strong>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Visual Progress Bar */}
              {replayStatus && replayStatus.totalSteps > 0 && (
                <div className="w-full flex flex-col gap-1.5 border-t border-slate-800/60 pt-3">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>Replay Progression</span>
                    <span>{Math.round((replayStatus.currentStep / replayStatus.totalSteps) * 100)}%</span>
                  </div>
                  <div className="w-full bg-[#0A0E17] h-2.5 rounded-full overflow-hidden border border-slate-800/60">
                    <div
                      className="bg-gradient-to-r from-indigo-500 to-violet-500 h-full rounded-full transition-all duration-300 ease-out shadow-sm shadow-indigo-500/20"
                      style={{ width: `${(replayStatus.currentStep / replayStatus.totalSteps) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Main Interactive Row */}
            <div className="flex flex-col gap-6">

              {/* Primary Demo Launch */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-400">Primary Demo Action</span>
                  {replayStatus && !isDemoReplayEnabled && (
                    <span className="text-rose-400 text-xs font-mono">Replay disabled on server.</span>
                  )}
                  {replayStatus && isDemoReplayEnabled && !isDemoFixtureAvailable && (
                    <span className="text-rose-400 text-xs font-mono">No demo fixture configured.</span>
                  )}
                </div>

                <button
                  onClick={runHistoricalDemo}
                  disabled={!canStartDemo}
                  className={`w-full py-3 rounded-xl font-semibold text-sm transition-all focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none flex items-center justify-center gap-2 ${
                    canStartDemo
                      ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/10 border border-indigo-400/20 cursor-pointer"
                      : "bg-[#141A29]/50 border border-slate-800 text-slate-500 cursor-not-allowed"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  </svg>
                  {replayStatus?.demoFixtureId
                    ? `Run historical demo (Fixture #${replayStatus.demoFixtureId})`
                    : "Run historical demo (No fixture configured)"}
                </button>
              </div>

              {/* Demo Speed Selection */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-mono text-slate-400">Replay Speed Select</span>
                <div className="flex gap-2" role="group" aria-label="Replay speed selection">
                  {[1, 10, 50, 100].map((speed) => (
                    <button
                      key={speed}
                      onClick={() => updateSpeed(speed)}
                      aria-pressed={manualSpeed === speed}
                      className={`flex-1 py-2 rounded-xl text-xs font-mono border transition-all focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${
                        manualSpeed === speed
                          ? "bg-indigo-600 text-white border-indigo-400/20 shadow-lg shadow-indigo-600/20"
                          : "bg-[#141A29] border-slate-700/60 text-slate-400 hover:border-slate-600"
                      }`}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              </div>

              {/* State control actions */}
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={pauseReplay}
                  disabled={!canPause}
                  className={`py-2.5 rounded-xl border text-xs font-semibold font-mono transition-all focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${
                    canPause
                      ? "bg-[#141A29] border-slate-700 hover:border-slate-600 text-slate-200"
                      : "bg-[#141A29]/30 border-slate-800 text-slate-600 cursor-not-allowed"
                  }`}
                >
                  Pause
                </button>
                <button
                  onClick={resumeReplay}
                  disabled={!canResume}
                  className={`py-2.5 rounded-xl border text-xs font-semibold font-mono transition-all focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${
                    canResume
                      ? "bg-[#141A29] border-slate-700 hover:border-slate-600 text-slate-200"
                      : "bg-[#141A29]/30 border-slate-800 text-slate-600 cursor-not-allowed"
                  }`}
                >
                  Resume
                </button>
                <button
                  onClick={stopReplay}
                  disabled={!canStop}
                  className={`py-2.5 rounded-xl border text-xs font-semibold font-mono transition-all focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${
                    canStop
                      ? "bg-rose-950/20 border-rose-800/30 hover:bg-rose-950/40 text-rose-400"
                      : "bg-[#141A29]/30 border-slate-800 text-slate-600 cursor-not-allowed"
                  }`}
                >
                  Stop
                </button>
              </div>

              {/* Advanced Controls Accordion */}
              <div className="border border-slate-800/60 rounded-xl overflow-hidden mt-2">
                <button
                  onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                  aria-expanded={isAdvancedOpen}
                  className="w-full bg-[#141A29]/40 hover:bg-[#141A29]/80 px-4 py-3 text-xs font-mono text-slate-400 flex items-center justify-between transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
                >
                  <span>Advanced Controls</span>
                  <svg
                    className={`w-4 h-4 transition-transform duration-200 ${isAdvancedOpen ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isAdvancedOpen && (
                  <div className="p-4 bg-[#0E1322] border-t border-slate-800/60 flex flex-col gap-4">
                    <div>
                      <label htmlFor="manual-fixture-id" className="block text-xs font-mono text-slate-400 mb-2">
                        Manual Fixture ID
                      </label>
                      <input
                        id="manual-fixture-id"
                        type="number"
                        min="1"
                        step="1"
                        placeholder="e.g. 18257739"
                        className="w-full bg-[#141A29] border border-slate-700/60 rounded-xl px-4 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-indigo-500 font-mono transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500"
                        value={replayFixtureInput}
                        onChange={handleFixtureInputChange}
                      />
                      {validationError && (
                        <p className="text-rose-400 text-xs font-mono mt-1" role="alert">
                          {validationError}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={startReplayManual}
                      disabled={!canStartManual || !replayFixtureInput}
                      className={`w-full py-2.5 rounded-xl font-semibold text-xs font-mono transition-all focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${
                        canStartManual && replayFixtureInput
                          ? "bg-slate-200 text-slate-900 hover:bg-white"
                          : "bg-slate-800 text-slate-500 cursor-not-allowed"
                      }`}
                    >
                      Start Manual Replay
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Virtual Markets */}
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              Active Virtual Markets
            </h2>

            {markets.length === 0 ? (
              <div className="border border-slate-800/60 bg-[#0C101B]/30 rounded-2xl p-8 text-center text-slate-500 font-mono text-sm">
                No active virtual markets monitored yet. Start a replay or let live streams ingest data.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {markets.map((market) => (
                  <button
                    key={market.fixtureId}
                    onClick={() => setSelectedFixtureId(market.fixtureId)}
                    aria-pressed={selectedFixtureId === market.fixtureId}
                    className={`border rounded-2xl p-5 text-left transition-all duration-300 w-full focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${
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
                        <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
                          Goals score
                        </span>
                        <span className="text-2xl font-bold tracking-tight text-slate-100 mt-1">
                          {market.scoreOne} - {market.scoreTwo}
                        </span>
                      </div>

                      <div className="flex flex-col text-right">
                        <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
                          1 / X / 2 Odds
                        </span>
                        <span className="text-xs font-semibold text-slate-300 font-mono mt-1.5">
                          {market.oddsOne ? (market.oddsOne / 1000).toFixed(2) : "-"} /{" "}
                          {market.oddsDraw ? (market.oddsDraw / 1000).toFixed(2) : "-"} /{" "}
                          {market.oddsTwo ? (market.oddsTwo / 1000).toFixed(2) : "-"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 text-[10px] font-mono text-slate-500 border-t border-slate-800/60 pt-3">
                      <span>Score Seq: {market.lastScoreSeq}</span>
                      <span>Odds Seq: {market.lastOddsSeq}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: details and Solana receipt */}
        <div className="flex flex-col gap-8">

          {/* Virtual Market details & logs */}
          <section className="border border-slate-800/60 bg-[#0C101B]/50 backdrop-blur-md rounded-2xl p-6 flex flex-col min-h-[400px]">
            <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2 mb-4 pb-4 border-b border-slate-800/60">
              <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              Market Details & Audit logs
            </h2>

            {selectedMarket ? (
              <div className="flex flex-col flex-1 gap-6">
                <div>
                  <h3 className="text-xs font-mono text-slate-400 mb-2">
                    Market State Summary
                  </h3>
                  <div className="bg-[#141A29]/60 border border-slate-800/60 rounded-xl p-4 flex flex-col gap-3 font-mono text-xs text-slate-300">
                    <div className="flex justify-between">
                      <span>Fixture ID:</span>
                      <span className="text-slate-100 font-bold">
                        {selectedMarket.fixtureId}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span>Friendly State:</span>
                      <span className="text-indigo-400 font-bold">
                        {translateState(selectedMarket.state)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Goals score:</span>
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
                    Transition History
                  </h3>
                  <div className="flex-1 overflow-y-auto space-y-4 max-h-[300px] pr-1">
                    {selectedMarket.auditTrail.length === 0 ? (
                      <p className="text-slate-500 text-xs italic">No transitions logged.</p>
                    ) : (
                      selectedMarket.auditTrail.map((log, index) => (
                        <div
                          key={index}
                          className="relative pl-6 border-l border-slate-800/80 last:border-0 pb-4"
                        >
                          <div className="absolute left-[-4.5px] top-1 w-2.5 h-2.5 rounded-full bg-indigo-500/80 border border-indigo-400/20" />
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
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center text-slate-500 font-mono text-sm py-12">
                Click on an active market card to view its live status and audit logs.
              </div>
            )}
          </section>

          {/* Solana Proof Verification Receipt Panel */}
          <section className="border border-slate-800/60 bg-[#0C101B]/50 backdrop-blur-md rounded-2xl p-6 flex flex-col">
            <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2 mb-4 pb-4 border-b border-slate-800/60">
              <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Solana Verification Receipt
            </h2>

            {activeReceipt ? (
              <div className="bg-[#141A29]/60 border border-slate-800/60 rounded-xl p-4 flex flex-col gap-3 font-mono text-xs text-slate-300">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Result Status:</span>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                      activeReceipt.status === "CONFIRMED"
                        ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                        : activeReceipt.status === "SIMULATED"
                        ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                        : activeReceipt.status === "REJECTED"
                        ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                        : "bg-rose-500/20 text-rose-400 border-rose-500/30"
                    }`}
                  >
                    {activeReceipt.status === "CONFIRMED"
                      ? "Confirmed on Solana"
                      : activeReceipt.status === "SIMULATED"
                      ? "Simulation passed"
                      : activeReceipt.status === "REJECTED"
                      ? "Proof rejected"
                      : "Validation failed"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Mode:</span>
                  <span className="text-slate-200 font-bold">{activeReceipt.mode}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Fixture / Seq:</span>
                  <span className="text-slate-200 font-bold">
                    {activeReceipt.fixtureId} (seq {activeReceipt.seq})
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 border-t border-slate-800/60 pt-2">
                  <span className="text-slate-400">Expected Stats:</span>
                  <span className="text-slate-200">
                    {activeReceipt.expectedStats.length > 0
                      ? activeReceipt.expectedStats
                          .map((s) => `${translateStatKey(s.key)}: ${s.value}`)
                          .join(", ")
                      : "None"}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-slate-400">Proved Stats:</span>
                  <span className="text-slate-200 text-xs">
                    {activeReceipt.provedStats.length > 0
                      ? activeReceipt.provedStats
                          .map((s) => `${translateStatKey(s.key)}: ${s.value} (period ${s.period})`)
                          .join(", ")
                      : "None"}
                  </span>
                </div>
                {activeReceipt.pda && (
                  <div className="flex flex-col gap-1">
                    <span className="text-slate-400 font-bold">Roots PDA:</span>
                    <span className="text-slate-300 truncate" title={activeReceipt.pda}>
                      {activeReceipt.pda}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold">Network:</span>
                  <span className="text-slate-300">{activeReceipt.network}</span>
                </div>
                {activeReceipt.reason && (
                  <div className="flex flex-col gap-1.5 text-amber-400 border-t border-slate-800/60 pt-2">
                    <span className="font-bold">Reason:</span>
                    <span className="leading-relaxed">{activeReceipt.reason}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-[10px] text-slate-500 pt-2 border-t border-slate-800/60 mt-2">
                  <span>
                    Validated: {new Date(activeReceipt.validatedAt).toLocaleTimeString()}
                  </span>
                  {activeReceipt.status === "CONFIRMED" &&
                    activeReceipt.signature &&
                    activeReceipt.explorerUrl && (
                      <a
                        href={activeReceipt.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-400 underline hover:text-emerald-300 font-bold text-[11px] focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none"
                      >
                        Solana Explorer ↗
                      </a>
                    )}
                </div>
              </div>
            ) : (
              <div className="text-center text-slate-500 font-mono text-xs py-8">
                No verification receipts recorded yet. Run a live or replay flow to generate proof receipts.
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
