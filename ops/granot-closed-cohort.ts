import { BSON, MongoClient, ObjectId, type Db } from "mongodb";
import dns from "node:dns";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import {
  archiveCatalog,
  readArchiveEntry,
} from "../src/services/granotHistory/archiveReads";
import {
  archiveJobKey,
  type ArchivedChain,
} from "../src/services/granotHistory/archiveCodec";
import { appendHistoryMonth } from "../src/services/granotHistory/monthArchive";
import {
  closedRuns,
  readClosedRun,
  type ClosedOperation,
} from "../src/services/granotHistory/closedAutomationRun";
import {
  archivalChain,
  routineAutomationChain,
  matchesClosedReplay,
} from "../src/services/granotHistory/retentionEligibility";
import { referencedChains } from "../src/services/granotHistory/retentionReferences";
import { supersededObservations } from "../src/services/granotHistory/supersededObservations";

async function loadSource(db: Db, values: ClosedOperation[]) {
  const opts = { maxTimeMS: 3000 };
  const ids = values.map((v) => new ObjectId(v.receipt));
  const receipts = await db
    .collection("granot_webhook_receipts")
    .find({ _id: { $in: ids } }, opts)
    .toArray();
  const observations = await db
    .collection("granot_observations")
    .find({ receipt_id: { $in: ids } }, opts)
    .toArray();
  const decisions = await db
    .collection("synchronization_decisions")
    .find({ observation_id: { $in: observations.map((o) => o._id) } }, opts)
    .toArray();
  const byReceipt = new Map(receipts.map((r) => [String(r._id), r]));
  const byObservation = new Map<string, typeof decisions>();
  for (const d of decisions) {
    const key = String(d.observation_id);
    const group = byObservation.get(key) ?? [];
    group.push(d);
    byObservation.set(key, group);
  }
  return new Map(
    observations.flatMap((o) => {
      const r = byReceipt.get(String(o.receipt_id));
      return r
        ? [
            [
              String(r._id),
              archivalChain({
                receipt: r,
                observation: o,
                decisions: byObservation.get(String(o._id)) ?? [],
              }),
            ] as const,
          ]
        : [];
    }),
  );
}

async function main() {
  const [mode, asOfText, dest] = process.argv.slice(2),
    asOf = new Date(asOfText);
  if (
    !["--archive", "--verify"].includes(mode) ||
    !dest ||
    !Number.isFinite(+asOf) ||
    +asOf > Date.now()
  )
    throw new Error(
      "Expected --archive|--verify, closed-run cutoff ISO time, new manifest path",
    );
  if (process.env.MONGO_DNS_SERVERS)
    dns.setServers(
      process.env.MONGO_DNS_SERVERS.split(",").map((s) => s.trim()),
    );
  const client = new MongoClient(process.env.MONGO_URI!, {
    maxPoolSize: 2,
    appName: "owner-granot-closed-cohort",
  });
  try {
    const db = client.db("vantagemovers"),
      now = new Date(),
      cutoff = new Date(+now - 7 * 86400000);
    const indexes = await closedRuns(db)
      .find({ closed_at: { $lte: asOf } })
      .sort({ _id: 1 })
      .limit(101)
      .toArray();
    if (indexes.length > 100)
      throw new Error("Narrow the cohort before continuing");
    const entries = new Map<
      string,
      {
        receipt: string;
        observation: string;
        decision: string;
        archive?: string;
        logicalBytes?: number;
        reasons: string[];
      }
    >();
    const eligible: ArchivedChain[] = [];
    for (const index of indexes) {
      const saved = await readClosedRun(db, index._id);
      if (!saved || !saved.length)
        throw new Error("Closed-run replay index unavailable");
      const liveRun = await db
        .collection("granot_automation_runs")
        .findOne({ _id: new ObjectId(index._id) }, { projection: { _id: 1 } });
      for (let offset = 0; offset < saved.length; offset += 256) {
        const items = saved.slice(offset, offset + 256),
          source = await loadSource(db, items);
        const routine = Array.from(source.values()).filter((c) =>
          routineAutomationChain(c, cutoff),
        );
        const holds = await referencedChains(db, routine),
          advanced = await supersededObservations(db, routine);
        for (const op of items) {
          const c = source.get(op.receipt),
            id = op.result.observation_id,
            reasons = [];
          if (liveRun) reasons.push("automation_run_present");
          if (!c) reasons.push("source_unavailable");
          else if (!routineAutomationChain(c, cutoff))
            reasons.push("outside_routine_scope");
          else {
            if (!advanced.has(id)) reasons.push("newer_winner_unproven");
            if (!matchesClosedReplay(c, op)) reasons.push("replay_mismatch");
            reasons.push(...(holds.get(id) ?? []));
          }
          entries.set(id, {
            receipt: op.receipt,
            observation: id,
            decision: op.result.decision_id,
            reasons,
          });
          if (c && !reasons.length) eligible.push(c);
        }
      }
    }
    const groups = new Map<string, ArchivedChain[]>();
    for (const c of eligible) {
      const k = JSON.stringify([
        c.observation.identity.normalized_job_no,
        c.observation.captured_at.toISOString().slice(0, 7),
      ]);
      const grouped = groups.get(k) ?? [];
      grouped.push(c);
      groups.set(k, grouped);
    }
    let done = 0;
    for (const [k, group] of groups) {
      const [job, month] = JSON.parse(k);
      let published = new Map<string, string>();
      if (mode === "--archive")
        published = await appendHistoryMonth(db, job, month, group);
      else {
        const wanted = new Map(
          group.map((c) => [String(c.observation._id), c]),
        );
        for await (const entry of archiveCatalog(db).find({
          job_key: archiveJobKey(job),
          job,
        })) {
          for (const c of await readArchiveEntry(db, entry)) {
            const id = String(c.observation._id);
            if (
              wanted.has(id) &&
              isDeepStrictEqual(archivalChain(c), wanted.get(id))
            )
              published.set(id, entry.hash ?? entry._id);
          }
        }
      }
      for (const c of group) {
        const id = String(c.observation._id),
          row = entries.get(id)!;
        row.archive = published.get(id);
        if (!row.archive) row.reasons.push("archive_parity_unproven");
        row.logicalBytes = [c.observation, c.receipt, ...c.decisions].reduce(
          (total, d) => total + BSON.calculateObjectSize(d),
          0,
        );
      }
      if (++done % 100 === 0)
        console.log(
          JSON.stringify({
            mode,
            groupsCompleted: done,
            totalGroups: groups.size,
          }),
        );
    }
    const stamp = await db
      .collection("sales_intelligence_sync_state")
      .findOne(
        { scope: "deployment" },
        { projection: { deployment_commit: 1, recorded_at: 1 } },
      );
    let deploymentVerified = false;
    if (
      /^[a-f0-9]{40}$/.test(stamp?.deployment_commit ?? "") &&
      stamp?.recorded_at instanceof Date &&
      Date.now() - +stamp.recorded_at < 900000
    ) {
      try {
        execFileSync(
          "git",
          ["merge-base", "--is-ancestor", "55def0d3", stamp.deployment_commit],
          { stdio: "ignore" },
        );
        deploymentVerified = true;
      } catch {}
    }
    const reasons: Record<string, number> = {};
    let prepared = 0,
      bytes = 0;
    for (const row of entries.values()) {
      if (!deploymentVerified) row.reasons.push("deployment_unverified");
      if (mode !== "--verify")
        row.reasons.push("requires_independent_verification");
      if (!row.reasons.length) {
        prepared++;
        bytes += row.logicalBytes ?? 0;
      }
      for (const reason of row.reasons)
        reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
    let avg = 0;
    for (const name of [
      "granot_observations",
      "synchronization_decisions",
      "granot_webhook_receipts",
    ]) {
      const s = await db.command({ collStats: name });
      avg += (s.storageSize + s.totalIndexSize) / Math.max(1, s.count);
    }
    const summary = {
      mode,
      closedRunCutoff: asOf,
      started: now,
      finished: new Date(),
      runCount: indexes.length,
      operations: entries.size,
      archiveGroups: groups.size,
      preparedChains: prepared,
      logicalBytes: bytes,
      estimatedAllocatedBytesRepresented: Math.round(avg * prepared),
      assumedFilesystemReclamation: 0,
      deployment: stamp?.deployment_commit,
      reasons,
    };
    await writeFile(
      dest,
      JSON.stringify({ summary, entries: [...entries.values()] }, null, 2),
      { flag: "wx" },
    );
    console.log(JSON.stringify(summary));
  } finally {
    await client.close();
  }
}
main().catch((e) => {
  console.error(e.name, e.code ?? e.message);
  process.exitCode = 1;
});
