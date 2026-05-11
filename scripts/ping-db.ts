import mongoose from "mongoose";
import { connectMongo } from "../api/db";

async function main(): Promise<void> {
  await connectMongo();
  console.log("readyState", mongoose.connection.readyState);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
