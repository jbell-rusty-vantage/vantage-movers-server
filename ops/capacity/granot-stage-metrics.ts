import { AsyncLocalStorage } from "node:async_hooks";
import { BSON, type CommandStartedEvent, type CommandSucceededEvent, type Document, type MongoClient } from "mongodb";

const size = (document: Document) => BSON.calculateObjectSize(document);
type Counts = { commands: number; returnedDocuments: number; returnedBson: number; updateBson: number; insertBson: number; failed: number; commandNames: Record<string, number> };
const empty = (): Counts => ({ commands: 0, returnedDocuments: 0, returnedBson: 0, updateBson: 0, insertBson: 0, failed: 0, commandNames: {} });

/** Count materialized documents and submitted write expressions. Never retain their contents. */
export class GranotStageMetrics {
  private readonly context = new AsyncLocalStorage<{ workload: string; stage: string }>();
  private readonly pending = new Map<number, Counts>();
  readonly rows: Record<string, Record<string, Counts>> = {};

  workload<T>(workload: string, stage: string, run: () => Promise<T>) {
    return this.context.run({ workload, stage }, run);
  }

  stage<T>(stage: string, run: () => Promise<T>) {
    const context = this.context.getStore();
    if (!context) throw new Error("Missing measurement workload");
    return this.workload(context.workload, stage, run);
  }

  attach(client: MongoClient) {
    client.on("commandStarted", (event: CommandStartedEvent) => {
      const scope = this.context.getStore();
      if (!scope) return;
      const command = event.command;
      let stage = scope.stage;
      if (command.findAndModify === "granot_automation_runs" && command.update?.$inc?.attempt_count === 1) {
        stage = "run claim (" + stage + ")";
      } else if (stage === "process" && command.autocommit === false) {
        stage = "decision and Lead transaction";
      }
      const row = (this.rows[scope.workload] ??= {})[stage] ??= empty();
      this.pending.set(event.requestId, row);
      row.commands++;
      row.commandNames[event.commandName] = (row.commandNames[event.commandName] ?? 0) + 1;
      if (event.commandName === "insert") for (const value of command.documents) row.insertBson += size(value);
      if (event.commandName === "update") for (const update of command.updates) row.updateBson += size(update.u);
      if (event.commandName === "findAndModify" && command.update) row.updateBson += size(command.update);
    });
    client.on("commandSucceeded", (event: CommandSucceededEvent) => {
      const row = this.pending.get(event.requestId);
      this.pending.delete(event.requestId);
      if (!row) return;
      const reply = event.reply as Document;
      const returned = reply.cursor?.firstBatch ?? reply.cursor?.nextBatch ?? (reply.value ? [reply.value] : []);
      for (const value of returned) {
        row.returnedDocuments++;
        row.returnedBson += size(value);
      }
    });
    client.on("commandFailed", (event) => {
      const row = this.pending.get(event.requestId);
      if (row) row.failed++;
      this.pending.delete(event.requestId);
    });
  }
}
