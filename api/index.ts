import express from "express";
import mongoose from "mongoose";
import { connectMongo } from "./db";
import leadRoutes from "./routes/lead.routes";

const app = express();

app.use(express.json());
app.use(leadRoutes);

app.get("/", (_req, res) => {
  res.json({
    service: "vantage-movers-servers",
    status: "ok",
    message: "Toy Express on Vercel",
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
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(503).json({ ok: false, error: message });
  }
});

export default app;
