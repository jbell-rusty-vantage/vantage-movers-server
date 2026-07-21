import twilio from "twilio";
import { getTwilioVoiceConfig } from "../../config/domain/leadMessaging";

export function buildTwilioVoiceForwardResponse(): string {
  const config = getTwilioVoiceConfig();
  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial({
    action: config.completedCallbackUrl,
    answerOnBridge: true,
    method: "POST",
    timeout: 30,
  });
  dial.number(
    {
      statusCallback: config.statusCallbackUrl,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
    },
    config.forwardTo,
  );
  return response.toString();
}

export function buildTwilioVoiceCompletedResponse(): string {
  const response = new twilio.twiml.VoiceResponse();
  response.hangup();
  return response.toString();
}

export function isExpectedTwilioVoiceDestination(value: string | undefined): boolean {
  if (!value) return false;
  return digits(value) === digits(getTwilioVoiceConfig().fromNumber);
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}
