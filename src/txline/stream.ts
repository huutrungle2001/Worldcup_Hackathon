import { txLineClient } from "./api";
import { logger } from "../utils/logger";
import { healthMonitor } from "../utils/health";
import { appConfig } from "../config";

export type SseMessage = {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
};

export function parseSseBlock(block: string): SseMessage | null {
  const message: SseMessage = { data: "" };

  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;

    const separatorIndex = rawLine.indexOf(":");
    const field =
      separatorIndex === -1 ? rawLine : rawLine.slice(0, separatorIndex);
    const value =
      separatorIndex === -1
        ? ""
        : rawLine.slice(separatorIndex + 1).replace(/^ /, "");

    if (field === "data") message.data += `${value}\n`;
    if (field === "event") message.event = value;
    if (field === "id") message.id = value;
    if (field === "retry") message.retry = Number(value);
  }

  message.data = message.data.replace(/\n$/, "");
  return message.data || message.event || message.id ? message : null;
}

export class TxLineStream {
  private activeControllers: Map<string, AbortController> = new Map();
  private reconnectIntervals: Map<string, number> = new Map();
  private lastEventIds: Map<string, string> = new Map();
  private stableTimeouts: Map<string, NodeJS.Timeout> = new Map();

  public async connectStream(
    streamType: "odds" | "scores",
    onMessage: (event: string, data: any) => void
  ) {
    const streamName = `${streamType}Sse` as const;
    const url = `${appConfig.apiOrigin}/api/${streamType}/stream`;

    if (this.activeControllers.has(streamType)) {
      logger.warn(
        `Stream ${streamType} is already active. Disconnecting old connection...`
      );
      this.disconnectStream(streamType);
    }

    const controller = new AbortController();
    this.activeControllers.set(streamType, controller);
    healthMonitor.updateService(streamName, "CONNECTING");

    logger.info(`Connecting to ${streamType} stream: ${url}...`);

    try {
      const jwt = await txLineClient.getJwt();
      const apiToken = appConfig.apiToken;

      const headers: Record<string, string> = {
        Authorization: `Bearer ${jwt}`,
        "X-Api-Token": apiToken!,
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      };

      const lastId = this.lastEventIds.get(streamType);
      if (lastId) {
        logger.info(
          `Preserving stream state. Attaching Last-Event-ID: ${lastId} to connection...`
        );
        headers["Last-Event-ID"] = lastId;
      }

      const response = await fetch(url, {
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          logger.warn(
            `Stream ${streamType} returned 401. Refreshing JWT and retrying...`
          );
          await txLineClient.refreshJwt();
          this.connectStream(streamType, onMessage);
          return;
        }
        throw new Error(`HTTP error ${response.status}`);
      }

      logger.info(`✓ Connected successfully to ${streamType} stream!`);
      healthMonitor.updateService(streamName, "HEALTHY");

      // Delay resetting backoff until connection has been stable for 5s (Finding 12)
      if (this.stableTimeouts.has(streamType)) {
        clearTimeout(this.stableTimeouts.get(streamType)!);
      }
      const stableTimeout = setTimeout(() => {
        logger.info(
          `Connection for ${streamType} stream stable. Resetting reconnect backoff.`
        );
        this.reconnectIntervals.set(streamType, 1000);
      }, 5000);
      this.stableTimeouts.set(streamType, stableTimeout);

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Stream response body is not readable");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let separator = buffer.match(/\r?\n\r?\n/);
        while (separator?.index !== undefined) {
          const block = buffer.slice(0, separator.index);
          buffer = buffer.slice(separator.index + separator[0].length);

          const sseMsg = parseSseBlock(block);
          if (sseMsg) {
            if (sseMsg.id) {
              this.lastEventIds.set(streamType, sseMsg.id);
            }
            let parsedData: any;
            try {
              parsedData = JSON.parse(sseMsg.data);
            } catch {
              parsedData = sseMsg.data;
            }
            onMessage(sseMsg.event || "message", parsedData);
          }

          separator = buffer.match(/\r?\n\r?\n/);
        }
      }

      logger.info(`Stream ${streamType} closed by server.`);
      this.handleReconnect(streamType, onMessage);
    } catch (err: any) {
      if (err.name === "AbortError" || controller.signal.aborted) {
        logger.info(`Stream ${streamType} connection aborted intentionally.`);
        healthMonitor.updateService(streamName, "DISCONNECTED");
        return;
      }

      logger.error(`Error in ${streamType} stream:`, err);
      healthMonitor.updateService(streamName, "UNHEALTHY", err.message);
      this.handleReconnect(streamType, onMessage);
    }
  }

  private handleReconnect(
    streamType: "odds" | "scores",
    onMessage: (event: string, data: any) => void
  ) {
    const currentDelay = this.reconnectIntervals.get(streamType) || 1000;
    const nextDelay = Math.min(currentDelay * 2, 30000);
    const jitter = Math.random() * 1000;
    const finalDelay = nextDelay + jitter;
    this.reconnectIntervals.set(streamType, nextDelay);

    logger.info(
      `Reconnecting ${streamType} stream in ${Math.round(finalDelay)}ms...`
    );
    setTimeout(() => {
      if (this.activeControllers.has(streamType)) {
        this.connectStream(streamType, onMessage);
      }
    }, finalDelay);
  }

  public disconnectStream(streamType: "odds" | "scores") {
    // Clear stable timeouts (Finding 12)
    if (this.stableTimeouts.has(streamType)) {
      clearTimeout(this.stableTimeouts.get(streamType)!);
      this.stableTimeouts.delete(streamType);
    }

    const controller = this.activeControllers.get(streamType);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(streamType);
      const streamName = `${streamType}Sse` as const;
      healthMonitor.updateService(streamName, "DISCONNECTED");
      logger.info(`Disconnected stream: ${streamType}`);
    }
  }

  public disconnectAll() {
    this.disconnectStream("odds");
    this.disconnectStream("scores");
  }
}

export const txLineStream = new TxLineStream();
