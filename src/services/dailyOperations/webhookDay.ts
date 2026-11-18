import type { ClientSession } from "mongoose";
import { getDailyOperationsDayModel } from "../../models/DailyOperationsDay";
import type { GranotRouteEventClass } from "../granotLifecycle/types";
import { buildDayIncrements, buildDaySeed, easternDayKey, easternHour } from "./dayDocument";
import { classifyGranotBookingActionFromPayload, granotReceiptKind, granotReceiptMetricTouches } from "./recordGranotFacts";
import { dailyOperationsDayUpdatePipeline } from "./recordDailyOperationsFact";

type WebhookCapture = { captured_at: Date; route_event_class: GranotRouteEventClass; payload: unknown };

export function webhookIncrements(capture: WebhookCapture) {
  const action = capture.route_event_class === "booking_status_changed"
    ? classifyGranotBookingActionFromPayload(capture.payload)
    : null;
  const touches = granotReceiptMetricTouches(granotReceiptKind(capture.route_event_class, action), capture.route_event_class);
  return buildDayIncrements(touches, easternHour(capture.captured_at));
}

/** The capture transaction owns both the immutable ingress ID and its single aggregate contribution. */
export async function incrementWebhookDay(capture: WebhookCapture, session: ClientSession) {
  const day = easternDayKey(capture.captured_at);
  await getDailyOperationsDayModel().collection.updateOne({ day },
    dailyOperationsDayUpdatePipeline(buildDaySeed(day), webhookIncrements(capture), new Date()),
    { upsert: true, session });
}
