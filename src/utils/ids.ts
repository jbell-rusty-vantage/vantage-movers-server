import { Types } from "mongoose";

export function generateLeadId(): string {
  return `LID${new Types.ObjectId().toString().slice(0, 13)}`;
}
