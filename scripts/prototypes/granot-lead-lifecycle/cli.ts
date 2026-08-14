import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { advanceLeadLifecycle, type LifecycleWorld } from "./domain";
import {
  PROTOTYPE_CATALOG,
  bestRelocationBookingStatusReceipt,
  bestRelocationPriorityFiveReceipt,
  worldWithBestRelocationBookingCandidates,
} from "./fixtures";
import { runPrototypeScenarios } from "./scenarios";

void main();

async function main(): Promise<void> {
  if (process.argv.includes("--scenarios")) {
    const reports = runPrototypeScenarios();
    for (const report of reports) {
      console.log(`PASS  ${report.name}  [${report.outcomes.join(" → ")}]`);
    }
    console.log(`\n${reports.length} prototype scenarios passed.`);
    return;
  }
  await runInteractivePrototype();
}

async function runInteractivePrototype(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  let world = worldWithBestRelocationBookingCandidates();
  let lastDecision =
    "Pre-booking synchronization is automatic and hidden from the owner.";
  try {
    while (true) {
      console.clear();
      render(world, lastDecision);
      const answer = (await rl.question("\nAction: ")).trim().toLowerCase();
      if (answer === "q") break;
      if (answer === "r") {
        world = worldWithBestRelocationBookingCandidates();
        lastDecision = "Prototype reset.";
        continue;
      }
      if (answer === "p") {
        const processed = advanceLeadLifecycle(
          world,
          {
            kind: "observe_granot",
            observation_channel: "granot_webhook",
            actor: {
              actor_type: "system",
              actor_id: "granot-webhook-processor",
            },
            receipt: bestRelocationPriorityFiveReceipt(
              "receipt-interactive-priority-5",
            ),
          },
          PROTOTYPE_CATALOG,
        );
        world = processed.world;
        lastDecision = `${processed.decision.outcome}: ${processed.decision.reason}`;
        continue;
      }
      if (answer === "b") {
        const intake = world.granot_booking_intake_cases.find(
          (candidate) => candidate.state === "open",
        );
        if (!intake) {
          lastDecision =
            "No open Granot Booking Intake Case. Receive Priority 5 first.";
          continue;
        }
        const choice = (
          await rl.question(
            "Use [s]uggested Lead or [a]lternative Lead? [s]: ",
          )
        )
          .trim()
          .toLowerCase();
        const binder = numberOrDefault(
          await rl.question("Official binder amount [625]: "),
          625,
        );
        const deposit = numberOrDefault(
          await rl.question("Official deposit amount [800]: "),
          800,
        );
        const merchant =
          (await rl.question("Official merchant [Cardpointe]: ")).trim() ||
          "Cardpointe";
        const selectedLead =
          choice === "a"
            ? {
                lead_ref: "call-lead-best-relocation-alternative",
                lead_model: "CallLead" as const,
              }
            : {
                lead_ref: intake.suggested_booking_lead.lead_ref,
                lead_model: intake.suggested_booking_lead.lead_model,
              };
        const confirmed = advanceLeadLifecycle(
          world,
          {
            kind: "confirm_granot_booking",
            command_id: "confirm-granot-booking-interactive",
            actor_id: "owner-prototype",
            booking_intake_case_id: intake.case_id,
            expected_case_revision: intake.revision,
            selected_booking_lead: selectedLead,
            official_booking_details: {
              booking_id: "booking-best-relocation-interactive",
              book_date: "2026-08-13",
              agent_allocations: [
                {
                  agent: intake.suggested_agent?.agent_id ?? "agent-roys",
                  agent_name_snapshot:
                    intake.suggested_agent?.agent_name ?? "Roys",
                  binder_amount: binder,
                },
              ],
              total_binder_amount: binder,
              deposit_amount: deposit,
              merchant,
            },
          },
          PROTOTYPE_CATALOG,
        );
        world = confirmed.world;
        lastDecision = `${confirmed.decision.outcome}: ${confirmed.decision.reason}`;
        continue;
      }
      if (answer === "c") {
        const processed = advanceLeadLifecycle(
          world,
          {
            kind: "observe_granot",
            observation_channel: "granot_webhook",
            actor: {
              actor_type: "system",
              actor_id: "granot-webhook-processor",
            },
            receipt: bestRelocationBookingStatusReceipt({
              receipt_id: "receipt-interactive-releas",
              event_type: "Releas",
            }),
          },
          PROTOTYPE_CATALOG,
        );
        world = processed.world;
        lastDecision = `${processed.decision.outcome}: ${processed.decision.reason}`;
        continue;
      }
      if (answer === "u") {
        const intake = world.granot_cancellation_intake_cases.find(
          (candidate) => candidate.state === "open",
        );
        if (!intake) {
          lastDecision =
            "No open Granot Cancellation Intake Case. Confirm a Booking, then receive Release.";
          continue;
        }
        const binder = numberOrDefault(
          await rl.question("Official binder amount [700]: "),
          700,
        );
        const deposit = numberOrDefault(
          await rl.question("Official deposit amount [900]: "),
          900,
        );
        const updated = advanceLeadLifecycle(
          world,
          {
            kind: "update_granot_booking",
            command_id: "update-granot-booking-interactive",
            actor_id: "owner-prototype",
            cancellation_intake_case_id: intake.case_id,
            expected_case_revision: intake.revision,
            official_booking_details: {
              book_date: "2026-08-20",
              agent_allocations: [
                {
                  agent: "agent-roys",
                  agent_name_snapshot: "Roys",
                  binder_amount: binder,
                },
              ],
              total_binder_amount: binder,
              deposit_amount: deposit,
              merchant: intake.linked_cancellation_booking.merchant || "Cardpointe",
            },
          },
          PROTOTYPE_CATALOG,
        );
        world = updated.world;
        lastDecision = `${updated.decision.outcome}: ${updated.decision.reason}`;
        continue;
      }
      if (answer === "d") {
        const intake = world.granot_cancellation_intake_cases.find(
          (candidate) => candidate.state === "open",
        );
        if (!intake) {
          lastDecision =
            "No open Granot Cancellation Intake Case. Confirm a Booking, then receive Release.";
          continue;
        }
        const dismissed = advanceLeadLifecycle(
          world,
          {
            kind: "dismiss_granot_cancellation_intake",
            command_id: "dismiss-granot-cancellation-interactive",
            actor_id: "owner-prototype",
            cancellation_intake_case_id: intake.case_id,
            expected_case_revision: intake.revision,
            reason: "Owner chose not to change Vantage",
          },
          PROTOTYPE_CATALOG,
        );
        world = dismissed.world;
        lastDecision = `${dismissed.decision.outcome}: ${dismissed.decision.reason}`;
        continue;
      }
      if (answer === "x") {
        const intake = world.granot_cancellation_intake_cases.find(
          (candidate) => candidate.state === "open",
        );
        if (!intake) {
          lastDecision =
            "No open Granot Cancellation Intake Case. Confirm a Booking, then receive Release.";
          continue;
        }
        const refund = numberOrDefault(
          await rl.question(
            `Official refund amount (Granot payment ${intake.observed.payment ?? "n/a"} is context only): `,
          ),
          Number.NaN,
        );
        const cancelDate =
          (await rl.question("Official cancel date [2026-08-15]: ")).trim() ||
          "2026-08-15";
        const reason =
          (await rl.question("Optional reason: ")).trim() || undefined;
        const confirmed = advanceLeadLifecycle(
          world,
          {
            kind: "confirm_granot_cancellation",
            command_id: "confirm-granot-cancellation-interactive",
            actor_id: "owner-prototype",
            cancellation_intake_case_id: intake.case_id,
            expected_case_revision: intake.revision,
            official_cancellation_details: {
              cancellation_id: "cancellation-best-relocation-interactive",
              cancel_date: cancelDate,
              refund_amount: refund,
              reason,
              cancelled_by: "owner-prototype",
            },
          },
          PROTOTYPE_CATALOG,
        );
        world = confirmed.world;
        lastDecision = `${confirmed.decision.outcome}: ${confirmed.decision.reason}`;
        continue;
      }
      lastDecision = "Unknown action.";
    }
  } finally {
    rl.close();
  }
}

function render(world: LifecycleWorld, lastDecision: string): void {
  const openBookingIntake = world.granot_booking_intake_cases.find(
    (candidate) => candidate.state === "open",
  );
  const openCancellationIntake = world.granot_cancellation_intake_cases.find(
    (candidate) => candidate.state === "open",
  );
  console.log("\x1b[1mPROTOTYPE — Granot Booking and Cancellation Intake\x1b[0m");
  console.log(
    "\x1b[2mNo live systems, persistence, HTTP, queues, or Sheets.\x1b[0m\n",
  );
  console.log(
    "\x1b[2mRoutine Lead synchronization is hidden. Owner work is booking intake or optional Release intake.\x1b[0m",
  );
  console.log(
    "\n\x1b[1mOpen Granot Booking Intake\x1b[0m",
    JSON.stringify(openBookingIntake ?? null, null, 2),
  );
  console.log(
    "\n\x1b[1mBooking Intake Notifications\x1b[0m",
    JSON.stringify(world.booking_intake_notifications, null, 2),
  );
  console.log(
    "\n\x1b[1mConfirmed Bookings\x1b[0m",
    JSON.stringify(world.bookings, null, 2),
  );
  console.log(
    "\n\x1b[1mOpen Granot Cancellation Intake\x1b[0m",
    JSON.stringify(openCancellationIntake ?? null, null, 2),
  );
  console.log(
    "\n\x1b[1mCancellation Intake Notifications\x1b[0m",
    JSON.stringify(world.cancellation_intake_notifications, null, 2),
  );
  console.log(
    "\n\x1b[1mConfirmed Cancellations\x1b[0m",
    JSON.stringify(world.cancellations, null, 2),
  );
  console.log(`\n\x1b[1mLast decision\x1b[0m ${lastDecision}`);
  console.log(
    "\n[p] Priority 5  [b] confirm Booking  [c] receive Release  [u] update Booking  [x] confirm Cancellation  [d] dismiss Release  [r] reset  [q] quit",
  );
}

function numberOrDefault(value: string, fallback: number): number {
  const cleaned = value.trim();
  if (!cleaned) return fallback;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
