import { randomBytes } from "node:crypto";

export function generateLeadId(): string {
  return `LID${randomBytes(7).toString("hex").slice(0, 13)}`;
}
