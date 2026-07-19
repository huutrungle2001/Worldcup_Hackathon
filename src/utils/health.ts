export interface ServiceHealth {
  status: "HEALTHY" | "UNHEALTHY" | "DISCONNECTED" | "CONNECTING" | "UNKNOWN";
  lastHeartbeat?: string;
  errorCount: number;
  lastError?: string;
}

export interface AppHealth {
  scoresSse: ServiceHealth;
  oddsSse: ServiceHealth;
  txlineHttp: ServiceHealth;
  solanaRpc: ServiceHealth;
  replayMode: boolean;
}

export class HealthMonitor {
  private health: AppHealth = {
    scoresSse: { status: "UNKNOWN", errorCount: 0 },
    oddsSse: { status: "UNKNOWN", errorCount: 0 },
    txlineHttp: { status: "UNKNOWN", errorCount: 0 },
    solanaRpc: { status: "UNKNOWN", errorCount: 0 },
    replayMode: false,
  };

  public getHealth(): AppHealth {
    return { ...this.health };
  }

  public updateService(
    service: keyof Omit<AppHealth, "replayMode">,
    status: ServiceHealth["status"],
    error?: string
  ) {
    const current = this.health[service];
    this.health[service] = {
      status,
      lastHeartbeat:
        status === "HEALTHY" ? new Date().toISOString() : current.lastHeartbeat,
      errorCount: error ? current.errorCount + 1 : current.errorCount,
      lastError: error || current.lastError,
    };
  }

  public setReplayMode(enabled: boolean) {
    this.health.replayMode = enabled;
  }
}

export const healthMonitor = new HealthMonitor();
