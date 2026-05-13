import express from "express";
import mongoose from "mongoose";
import { MONGO_DATABASE_NAME } from "./config/domain";
import { connectMongo } from "./db";
import v1Routes from "./routes/v1.routes";

const app = express();

app.use(express.json());
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

export default app;
