import pino from "pino";

const level = process.env.LOG_LEVEL?.trim();
const isProd = process.env.NODE_ENV === "production";

export const logger = pino({
  level: level && level.length > 0 ? level : isProd ? "info" : "debug",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-api-secret"]',
      "headers.authorization",
      "headers.cookie",
      'headers["x-api-secret"]',
    ],
    remove: true,
  },
});
