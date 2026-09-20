import { csiBackfillDays, csiFlag } from "../../../config/domain/salesIntelligence";
import { getSalesIntelligenceSyncWindowModel } from "../../../models/SalesIntelligenceSyncWindow";
import { csiBackfillCommandSchema } from "../../../validation/v1/salesIntelligence";
import { CsiError, type CsiActor } from "../auth";
import { appendCsiAudit, executeCsiCommand } from "../transactions";
import { planDailyWindows } from "./windows";

export type BackfillPlanResponse = {
  available: boolean;
  days: number;
  windows_planned: number;
  from: string;
  to: string;
  window_from: string | null;
  window_to: string | null;
};

export async function commandPlanBackfill(input: {
  actor: CsiActor;
  idempotency_key: string;
  command: unknown;
}) {
  if (!csiFlag("ENABLED")) throw new CsiError("FEATURE_DISABLED");
  const body = csiBackfillCommandSchema.parse(input.command);
  const days = csiBackfillDays();
  if (days <= 0) {
    return executeCsiCommand<BackfillPlanResponse>({
      actor: input.actor,
      command: "plan_backfill",
      idempotency_key: input.idempotency_key,
      payload: body,
      operation: async () => ({
        available: false,
        days,
        windows_planned: 0,
        from: body.from,
        to: body.to,
        window_from: null,
        window_to: null,
      }),
    });
  }
  const requestedTo = new Date(body.to);
  if (requestedTo.getTime() > Date.now()) throw new CsiError("INVALID_INPUT");
  return executeCsiCommand<BackfillPlanResponse>({
    actor: input.actor,
    command: "plan_backfill",
    idempotency_key: input.idempotency_key,
    payload: body,
    operation: async (context) => {
      const windows = planDailyWindows(new Date(body.from), requestedTo, days);
      const Window = getSalesIntelligenceSyncWindowModel();
      for (const window of windows) {
        const existing = await Window.findOne({
          stream: window.stream,
          window_from: window.window_from,
        })
          .session(context.session)
          .lean();
        if (
          existing &&
          existing.window_to.getTime() !== window.window_to.getTime()
        ) {
          throw new CsiError("IDEMPOTENCY_CONFLICT");
        }
        // A new Owner command may retry a denied/exhausted window at its saved page.
        if (existing && (existing.status === "failed" || existing.permission_paused)) {
          await Window.updateOne({ _id: existing._id }, { $set: { status: "partial", permission_paused: false,
            attempts: 0, retry_after_until: null, last_error_code: null } }, { session: context.session });
        }
        await Window.findOneAndUpdate(
          { stream: window.stream, window_from: window.window_from },
          {
            $setOnInsert: {
              stream: window.stream,
              window_from: window.window_from,
              window_to: window.window_to,
              status: "planned",
              pages_done: 0,
              records: 0,
              checkpoint_page: 0,
              attempts: 0,
              last_error_code: null,
              completed_at: null,
              work_lease_owner: null,
              work_lease_epoch: 0,
              work_leased_until: null,
              retry_after_until: null,
              activation_status: null,
              activation_contact_cursor: null,
            },
          },
          { session: context.session, upsert: true, returnDocument: "after", runValidators: true },
        );
      }
      const first = windows[0] ?? null;
      const last = windows[windows.length - 1] ?? null;
      const response: BackfillPlanResponse = {
        available: true,
        days,
        windows_planned: windows.length,
        from: body.from,
        to: body.to,
        window_from: first?.window_from.toISOString() ?? null,
        window_to: last?.window_to.toISOString() ?? null,
      };
      await appendCsiAudit(context, {
        subject_key: "coverage:backfill",
        event_kind: "backfill.planned",
        prior: { windows: 0 },
        current: { windows: windows.length, days },
        target_id: String(context.command_id),
        revision: 1,
        kind: "job",
      });
      return response;
    },
  });
}
