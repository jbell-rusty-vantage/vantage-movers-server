import cors from "cors";
import express, { type Request, type Response } from "express";
import mongoose from "mongoose";
import type { Logger } from "pino";
import { MONGO_DATABASE_NAME } from "./config/domain";
import { connectMongo } from "./db";
import { logger } from "./logger";
import { httpLogger } from "./middleware/httpLogger";
import { recordOperationalEvent } from "./services/observability";
import notificationCronRoutes from "./routes/notification-cron.routes";
import bookingReconciliationCronRoutes from "./routes/booking-reconciliation-cron.routes";
import ringCentralCronRoutes from "./routes/ringcentral-cron.routes";
import ringCentralWebhookLocalRoutes from "./routes/ringcentral-webhook-local.routes";
import ringCentralWebhookRoutes from "./routes/ringcentral-webhook.routes";
import sheetSyncCronRoutes from "./routes/sheet-sync-cron.routes";
import leadMessagingCronRoutes from "./routes/lead-messaging-cron.routes";
import cplCorrectionCronRoutes from "./routes/cpl-correction-cron.routes";
import twilioMessageStatusRoutes from "./routes/twilio-message-status.routes";
import twilioVoiceRoutes from "./routes/twilio-voice.routes";
import v1Routes from "./routes/v1.routes";
import ingestionRoutes from "./routes/ingestion.routes";
import bestRelocationIngestionCronRoutes from "./routes/best-relocation-ingestion-cron.routes";
import reportingRoutes from "./routes/reporting.routes";

const app = express();

const corsOptions: cors.CorsOptions = {
  origin: ["https://vantagequotes.com", "https://www.vantagequotes.com"],
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "x-api-secret"],
  maxAge: 86400,
  optionsSuccessStatus: 204,
};

type ErrorNext = (err?: unknown) => void;

type RequestWithLogger = Request & {
  log?: Logger;
};

app.use(httpLogger);
app.use(cors(corsOptions));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(ringCentralWebhookRoutes);
app.use(ringCentralWebhookLocalRoutes);
app.use(ringCentralCronRoutes);
app.use(bookingReconciliationCronRoutes);
app.use(sheetSyncCronRoutes);
app.use(leadMessagingCronRoutes);
app.use(cplCorrectionCronRoutes);
app.use(notificationCronRoutes);
app.use(twilioMessageStatusRoutes);
app.use(twilioVoiceRoutes);
app.use(bestRelocationIngestionCronRoutes);
app.use(v1Routes);
app.use(ingestionRoutes);
app.use(reportingRoutes);

app.get("/", (_req: Request, res: Response) => {
  res.json({
    service: "vantage-movers-server",
    status: "ok",
    apiVersion: "v1",
  });
});

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).send("ok");
});

app.get("/db", async (_req: Request, res: Response) => {
  try {
    await connectMongo();
    const ready = mongoose.connection.readyState === 1;
    res.json({
      ok: ready,
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host || null,
      name: mongoose.connection.name || null,
      expectedName: MONGO_DATABASE_NAME,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(503).json({ ok: false, error: message });
  }
});

function isMalformedBodyParseError(err: unknown): boolean {
  if (err instanceof SyntaxError) {
    return "body" in err;
  }
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const status =
    "status" in err ? (err as { status: unknown }).status : undefined;
  const type = "type" in err ? (err as { type: unknown }).type : undefined;
  return status === 400 && type === "entity.parse.failed";
}

app.use((err: unknown, req: Request, res: Response, next: ErrorNext) => {
  if (!isMalformedBodyParseError(err)) {
    return next(err);
  }
  const log = (req as RequestWithLogger).log ?? logger;
  log.warn({ err, msg: "http.body.parse_failed" });
  void recordOperationalEvent({
    level: "warn",
    eventKey: "http.body.parse_failed",
    category: "http",
    workflow: "http_request",
    summary: "Malformed request body could not be parsed.",
    request: req,
    statusCode: 400,
    details: {
      contentType: req.headers["content-type"] ?? null,
      causeMessage: err instanceof Error ? err.message : String(err),
    },
    notificationCandidate: false,
    reportable: false,
  });
  if (res.headersSent) {
    return;
  }
  return res.status(400).json({
    ok: false,
    error: "Malformed request body",
  });
});

export default app;
