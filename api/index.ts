import express from "express";

const app = express();

app.use(express.json());

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

export default app;
