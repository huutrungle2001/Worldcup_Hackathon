import axios, { AxiosRequestConfig } from "axios";
import { appConfig } from "../config";
import { logger } from "../utils/logger";
import { healthMonitor } from "../utils/health";

export class TxLineClient {
  private jwt: string | null = null;
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly origin: string;

  constructor() {
    this.origin = appConfig.apiOrigin;
    this.baseUrl = `${this.origin}/api`;
    if (!appConfig.apiToken) {
      throw new Error(
        "X_API_TOKEN is missing from config. Please run subscription and activation first."
      );
    }
    this.apiToken = appConfig.apiToken;
  }

  public async refreshJwt(): Promise<string> {
    logger.info(`Refreshing guest JWT from: ${this.origin}/auth/guest/start`);
    try {
      const response = await axios.post(`${this.origin}/auth/guest/start`);
      this.jwt = response.data.token;
      logger.info(`✓ Guest JWT refreshed successfully.`);
      healthMonitor.updateService("txlineHttp", "HEALTHY");
      return this.jwt!;
    } catch (err: any) {
      logger.error(`Failed to refresh guest JWT:`, err);
      healthMonitor.updateService("txlineHttp", "UNHEALTHY", err.message);
      throw err;
    }
  }

  public async getJwt(): Promise<string> {
    if (!this.jwt) {
      return await this.refreshJwt();
    }
    return this.jwt;
  }

  public async request<T>(
    config: AxiosRequestConfig,
    retries = 3,
    delayMs = 1000
  ): Promise<T> {
    const jwt = await this.getJwt();

    const headers = {
      ...config.headers,
      Authorization: `Bearer ${jwt}`,
      "X-Api-Token": this.apiToken,
    };

    try {
      healthMonitor.updateService("txlineHttp", "HEALTHY");
      const response = await axios.request<T>({
        timeout: 10000, // 10 seconds timeout (Finding 12)
        ...config,
        baseURL: this.baseUrl,
        headers,
      });
      return response.data;
    } catch (err: any) {
      const status = err.response?.status;

      // Fetch a new guest JWT on 401 Unauthorized or 403 Forbidden (Finding 12 / AGENTS.md)
      if ((status === 401 || status === 403) && retries > 0) {
        logger.warn(
          `API request returned ${status}. Retrying with a refreshed JWT...`
        );
        await this.refreshJwt();
        return this.request<T>(config, retries - 1, delayMs);
      }

      if ((status === 429 || (status >= 500 && status < 600)) && retries > 0) {
        const jitter = Math.random() * 200 + 50; // Random jitter between 50ms and 250ms (Finding 12)
        const totalDelay = delayMs + jitter;
        logger.warn(
          `API request failed with status ${status}. Retrying in ${Math.round(
            totalDelay
          )}ms... (Retries left: ${retries})`
        );
        await new Promise((resolve) => setTimeout(resolve, totalDelay));
        return this.request<T>(config, retries - 1, delayMs * 2);
      }

      if (status === 403) {
        logger.error(
          `API request returned 403 Forbidden. This indicates a subscription configuration or network mismatch.`,
          err.response?.data || err.message
        );
        healthMonitor.updateService("txlineHttp", "UNHEALTHY", "403 Forbidden");
      } else {
        healthMonitor.updateService("txlineHttp", "UNHEALTHY", err.message);
      }

      throw err;
    }
  }

  public async getFixtures(): Promise<any> {
    return this.request<any>({ url: "/fixtures/snapshot" });
  }

  public async getOddsSnapshot(fixtureId: number | string): Promise<any> {
    return this.request<any>({ url: `/odds/snapshot/${fixtureId}` });
  }

  public async getScoresSnapshot(fixtureId: number | string): Promise<any> {
    return this.request<any>({ url: `/scores/snapshot/${fixtureId}` });
  }

  public async getScoreProof(
    fixtureId: number | string,
    seq: number,
    statKeys: string
  ): Promise<any> {
    return this.request<any>({
      url: "/scores/stat-validation",
      params: {
        fixtureId,
        seq,
        statKeys,
      },
    });
  }
}

export const txLineClient = new TxLineClient();
