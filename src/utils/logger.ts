export interface LogContext {
  fixtureId?: number | string;
  seq?: number;
  eventType?: string;
  marketState?: string;
  correlationId?: string;
  [key: string]: any;
}

export class Logger {
  private redact(msg: any): any {
    if (typeof msg === "string") {
      let redacted = msg.replace(
        /\bey[a-zA-Z0-9-_=]+\.[a-zA-Z0-9-_=]+\.?[a-zA-Z0-9-_=]*\b/g,
        "[REDACTED JWT]"
      );
      redacted = redacted.replace(
        /X-Api-Token:\s*[a-zA-Z0-9-_]+/gi,
        "X-Api-Token: [REDACTED]"
      );
      return redacted;
    }
    if (typeof msg === "object" && msg !== null) {
      if (Array.isArray(msg)) {
        return msg.map((item) => this.redact(item));
      }
      const newObj: any = {};
      for (const key of Object.keys(msg)) {
        if (
          key.toLowerCase().includes("token") ||
          key.toLowerCase().includes("jwt") ||
          key.toLowerCase().includes("secret") ||
          key.toLowerCase().includes("private")
        ) {
          newObj[key] = "[REDACTED]";
        } else {
          newObj[key] = this.redact(msg[key]);
        }
      }
      return newObj;
    }
    return msg;
  }

  private formatContext(ctx?: LogContext): string {
    if (!ctx) return "";
    const redactedCtx = this.redact(ctx);
    return ` | Context: ${JSON.stringify(redactedCtx)}`;
  }

  public info(message: string, ctx?: LogContext) {
    console.log(
      `[INFO] [${new Date().toISOString()}] ${this.redact(
        message
      )}${this.formatContext(ctx)}`
    );
  }

  public warn(message: string, ctx?: LogContext) {
    console.warn(
      `[WARN] [${new Date().toISOString()}] ${this.redact(
        message
      )}${this.formatContext(ctx)}`
    );
  }

  public error(message: string, error?: any, ctx?: LogContext) {
    const errMessage = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? `\nStack: ${error.stack}` : "";
    console.error(
      `[ERROR] [${new Date().toISOString()}] ${this.redact(
        message
      )} | Error: ${this.redact(errMessage)}${stack}${this.formatContext(ctx)}`
    );
  }

  public debug(message: string, ctx?: LogContext) {
    if (process.env.DEBUG === "true") {
      console.log(
        `[DEBUG] [${new Date().toISOString()}] ${this.redact(
          message
        )}${this.formatContext(ctx)}`
      );
    }
  }
}

export const logger = new Logger();
