import cors from "cors";
import express, { type Request, type Response } from "express";
import mongoose from "mongoose";
import type { Logger } from "pino";
import { MONGO_DATABASE_NAME } from "./config/domain";
import { connectMongo } from "./db";
import { logger } from "./logger";
import { httpLogger } from "./middleware/httpLogger";
import v1Routes from "./routes/v1.routes";

const app = express();

const corsOptions: cors.CorsOptions = {
  origin: ["https://vantagequotes.com", "https://www.vantagequotes.com"],
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-secret"],
  maxAge: 86400,
  optionsSuccessStatus: 204,
};

type ErrorNext = (err?: unknown) => void;

type RequestWithLogger = Request & {
  log?: Logger;
};

type BodyParseErrorResponse = Response & {
  headersSent: boolean;
  status(code: number): Response;
};

app.use(httpLogger);
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(v1Routes);

app.get("/", (_req, res) => {
  res.json({
    service: "vantage-movers-server",
    status: "ok",
    apiVersion: "v1",
  });
});

app.get("/health", (_req, res) => {
  res.status(200).send("ok");
});

app.get("/db", async (_req, res) => {
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
  const status = "status" in err ? (err as { status: unknown }).status : undefined;
  const type = "type" in err ? (err as { type: unknown }).type : undefined;
  return status === 400 && type === "entity.parse.failed";
}

app.use((err: unknown, req: Request, res: Response, next: ErrorNext) => {
  if (!isMalformedBodyParseError(err)) {
    return next(err);
  }
  const log = (req as RequestWithLogger).log ?? logger;
  const bodyParseResponse = res as BodyParseErrorResponse;
  log.warn({ err, msg: "http.body.parse_failed" });
  if (bodyParseResponse.headersSent) {
    return;
  }
  return bodyParseResponse.status(400).json({
    ok: false,
    error: "Malformed request body",
  });
});

export default app;
