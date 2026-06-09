import {
  createTwilioClient,
  formatTwilioError,
  resolveCredentials,
  resolveSmsSender,
  toE164UsPhoneNumber,
} from "./twilio-client";

function parseArgs(): { to: string; body: string } {
  const args = process.argv.slice(2);
  let to = "9545441305";
  let body = "hey it's vantage movers";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--to" && args[index + 1]) {
      to = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--body" && args[index + 1]) {
      body = args[index + 1];
      index += 1;
    }
  }

  return { to, body };
}

async function main(): Promise<void> {
  const { to, body } = parseArgs();
  const toNumber = toE164UsPhoneNumber(to);

  const credentials = resolveCredentials();
  const client = createTwilioClient(credentials);
  const sender = await resolveSmsSender(client);

  console.log(`Sending SMS to ${toNumber}`);
  console.log(
    `Sender: ${
      sender.kind === "from"
        ? sender.value
        : `Messaging Service ${sender.value}`
    }`,
  );
  console.log(`Body: ${body}`);

  try {
    const message = await client.messages.create({
      to: toNumber,
      body,
      ...(sender.kind === "from"
        ? { from: sender.value }
        : { messagingServiceSid: sender.value }),
    });

    console.log("");
    console.log("SMS queued successfully");
    console.log(`Message SID: ${message.sid}`);
    console.log(`Status: ${message.status}`);
    console.log(`Date created: ${message.dateCreated?.toISOString() ?? "n/a"}`);
  } catch (error) {
    console.error(`SMS send failed: ${formatTwilioError(error)}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
