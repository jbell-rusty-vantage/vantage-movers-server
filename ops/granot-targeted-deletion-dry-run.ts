import { supersededObservations } from "../src/services/granotHistory/supersededObservations";
import {
  routineAutomationChain,
  matchesClosedReplay,
  archivalChain,
} from "../src/services/granotHistory/retentionEligibility";
import { execFileSync } from "node:child_process";
import dns from "node:dns";
import { isDeepStrictEqual } from "node:util";
import { BSON, MongoClient, ObjectId } from "mongodb";
import { writeFile } from "node:fs/promises";
import { archiveCatalog } from "../src/services/granotHistory/archiveReads";
import {
  decodeChains,
  type ArchivedChain,
} from "../src/services/granotHistory/archiveCodec";
import { readArchiveObject } from "../src/services/granotHistory/archiveObjects";
import {
  automationRunId,
  readClosedRun,
  type ClosedOperation,
} from "../src/services/granotHistory/closedAutomationRun";
import { referencedChains } from "../src/services/granotHistory/retentionReferences";

async function main() {
  const output = process.argv[2];
  if (!output) throw new Error("Supply a local manifest destination");
  if (process.env.MONGO_DNS_SERVERS)
    dns.setServers(
      process.env.MONGO_DNS_SERVERS.split(",").map((x) => x.trim()),
    );
  const client = new MongoClient(process.env.MONGO_URI!, {
    maxPoolSize: 1,
    appName: "granot-retention-dry-run",
  });
  try {
    const db = client.db("vantagemovers"),
      asOf = new Date(),
      cutoff = new Date(+asOf - 7 * 86400000);
    const stamp = await db
      .collection("sales_intelligence_sync_state")
      .findOne(
        { scope: "deployment" },
        { projection: { deployment_commit: 1, recorded_at: 1 } },
      );
    let deployed = false;
    if (
      /^[0-9a-f]{40}$/.test(stamp?.deployment_commit ?? "") &&
      stamp?.recorded_at instanceof Date &&
      +asOf - +stamp.recorded_at < 15 * 60000
    ) {
      try {
        execFileSync(
          "git",
          ["merge-base", "--is-ancestor", "75905c2f", stamp.deployment_commit],
          { stdio: "ignore" },
        );
        deployed = true;
      } catch {}
    }
    const chains = new Map<string, { c: ArchivedChain; hash: string }>();
    for (const entry of await archiveCatalog(db)
      .find({})
      .sort({ _id: 1 })
      .limit(32)
      .toArray()) {
      const batch = decodeChains(
        await readArchiveObject(db.databaseName, entry.hash ?? entry._id),
        entry.hash ?? entry._id,
        entry.job,
      );
      for (const c of batch)
        chains.set(String(c.observation._id), {
          c,
          hash: entry.hash ?? entry._id,
        });
    }
    const all = [...chains.values()].map((x) => x.c);
    const refs = await referencedChains(db, all);
    const superseded = await supersededObservations(db, all);
    const originals = async (name: string, ids: ObjectId[]) =>
      new Map(
        (
          await db
            .collection(name)
            .find({ _id: { $in: ids } }, { maxTimeMS: 3000 })
            .toArray()
        ).map((x) => [String(x._id), x]),
      );
    const obs = await originals(
      "granot_observations",
      all.map((c) => c.observation._id),
    );
    const receipts = await originals(
      "granot_webhook_receipts",
      all.map((c) => c.receipt._id),
    );
    const decisionDocs = await db
      .collection("synchronization_decisions")
      .find(
        { observation_id: { $in: all.map((c) => c.observation._id) } },
        { maxTimeMS: 3000 },
      )
      .toArray();
    const runIds = all.flatMap((c) => {
      const id = automationRunId(c.receipt.channel_operation_id ?? "");
      return id ? [new ObjectId(id)] : [];
    });
    const openRuns = new Set(
      (
        await db
          .collection("granot_automation_runs")
          .find(
            { _id: { $in: runIds } },
            { projection: { _id: 1 }, maxTimeMS: 3000 },
          )
          .toArray()
      ).map((r) => String(r._id)),
    );
    const runs = new Map<string, ClosedOperation[] | null>(),
      entries = [],
      excluded: Record<string, number> = {};
    let candidateBytes = 0,
      prepared = 0;
    for (const [id, { c, hash }] of chains) {
      const reasons = [...(refs.get(id) ?? [])],
        r = c.receipt,
        o = c.observation,
        d = c.decisions[0];
      if (!superseded.has(id)) reasons.push("newer_accepted_winner_unproven");
      if (!routineAutomationChain(c, cutoff))
        reasons.push("outside_routine_scope");
      const liveDecisions = decisionDocs.filter(
        (x) => String(x.observation_id) === id,
      );
      const liveObservation = obs.get(id),
        liveReceipt = receipts.get(String(r._id));
      if (
        !liveObservation ||
        !liveReceipt ||
        !isDeepStrictEqual(
          archivalChain({
            observation: liveObservation,
            receipt: liveReceipt,
            decisions: liveDecisions,
          }),
          archivalChain(c),
        )
      )
        reasons.push("source_changed");
      const run = automationRunId(r.channel_operation_id ?? "");
      if (run && openRuns.has(run)) reasons.push("automation_run_present");
      if (run && !runs.has(run)) runs.set(run, await readClosedRun(db, run));
      const result = run
        ? runs.get(run)?.find((x) => x.operation === r.channel_operation_id)
        : null;
      if (!matchesClosedReplay(c, result)) reasons.push("replay_unproven");
      if (!deployed) reasons.push("deployment_unverified");
      const bytes = [r, o, ...c.decisions].reduce(
        (n, x) => n + BSON.calculateObjectSize(x),
        0,
      );
      if (!reasons.length) {
        prepared++;
        candidateBytes += bytes;
      }
      for (const reason of reasons)
        excluded[reason] = (excluded[reason] ?? 0) + 1;
      entries.push({
        observation: id,
        receipt: String(r._id),
        decision: String(d._id),
        archive: hash,
        logicalBytes: bytes,
        reasons,
      });
    }
    let averageAllocatedBytesPerChain = 0;
    for (const collection of [
      "granot_webhook_receipts",
      "granot_observations",
      "synchronization_decisions",
    ]) {
      const stats = await db.command({ collStats: collection });
      if (stats.count)
        averageAllocatedBytesPerChain +=
          (stats.storageSize + stats.totalIndexSize) / stats.count;
    }
    const summary = {
      asOf,
      cutoff,
      deployment: stamp?.deployment_commit,
      deployed,
      examined: chains.size,
      prepared,
      logicalBytes: candidateBytes,
      estimatedAllocatedBytesRepresented: Math.round(
        prepared * averageAllocatedBytesPerChain,
      ),
      physicalDiskReclamationAssumed: 0,
      excluded,
    };
    await writeFile(output, JSON.stringify({ summary, entries }, null, 2), {
      flag: "wx",
    });
    console.log(JSON.stringify(summary));
  } finally {
    await client.close();
  }
}
main().catch((e) => {
  console.error(e.name, e.code ?? "dry_run_failed");
  process.exitCode = 1;
});
