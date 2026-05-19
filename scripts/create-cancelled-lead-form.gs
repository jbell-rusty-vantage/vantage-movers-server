function createCancelledLeadForm() {
  const form = FormApp.create("Create Cancelled Lead");

  form.setDescription(
    "Submit a cancelled lead to the Vercel API. " +
      "This requires the original Lead MongoDB ObjectId. " +
      "The API will find the booked lead associated with that lead automatically."
  );

  form.setConfirmationMessage(
    "Cancelled lead submitted. Check MongoDB / synced sheet to confirm."
  );

  const mongoIdValidation = FormApp.createTextValidation()
    .requireTextMatchesPattern("^[a-fA-F0-9]{24}$")
    .setHelpText("Enter a valid 24-character MongoDB ObjectId.")
    .build();

  form
    .addTextItem()
    .setTitle("Lead Mongo Id")
    .setHelpText(
      "Required. This is the _id from form_leads or call_leads and maps to lead_id."
    )
    .setValidation(mongoIdValidation)
    .setRequired(true);

  form
    .addDateItem()
    .setTitle("Cancellation Date")
    .setHelpText("Optional. Leave blank to let the server default to now.")
    .setRequired(false);

  form
    .addTextItem()
    .setTitle("Cancelled By")
    .setHelpText("Optional. Person submitting or responsible for the cancellation.")
    .setRequired(false);

  form
    .addMultipleChoiceItem()
    .setTitle("Cancellation Reason")
    .setHelpText("Primary reason for cancellation.")
    .setChoiceValues([
      "customer_cancelled",
      "price_too_high",
      "booked_with_competitor",
      "duplicate_booking",
      "bad_lead",
      "not_serviceable",
      "other"
    ])
    .setRequired(true);

  form
    .addParagraphTextItem()
    .setTitle("Notes")
    .setHelpText("Optional context about why the lead was cancelled.")
    .setRequired(false);

  ScriptApp.newTrigger("onCancelledLeadSubmit").forForm(form).onFormSubmit().create();

  Logger.log("Edit URL: " + form.getEditUrl());
  Logger.log("Public URL: " + form.getPublishedUrl());
}

function onCancelledLeadSubmit(e) {
  Logger.log("onCancelledLeadSubmit fired");

  const values = parseCancelledLeadFormValues(e);
  Logger.log("Parsed Values: " + JSON.stringify(values));

  const leadId = values["Lead Mongo Id"];
  if (!leadId) {
    throw new Error("Missing Lead Mongo Id from form response.");
  }

  const payload = {
    lead_id: String(leadId).trim(),
  };

  addStringIfPresent(payload, "reason", values["Cancellation Reason"]);
  addDateIfPresent(payload, "timestamp", values["Cancellation Date"]);
  addStringIfPresent(payload, "cancelled_by", values["Cancelled By"]);
  addStringIfPresent(payload, "notes", values["Notes"]);

  Logger.log("About to POST payload: " + JSON.stringify(payload));

  const apiSecret = PropertiesService.getScriptProperties().getProperty("API_SECRET");
  if (!apiSecret) {
    throw new Error("Missing API_SECRET in Script Properties.");
  }

  const response = UrlFetchApp.fetch(
    "https://vantage-movers-servers.vercel.app/api/v1/cancelled-leads",
    {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      headers: {
        "x-api-secret": apiSecret
      },
      muteHttpExceptions: true
    }
  );

  const status = response.getResponseCode();
  const body = response.getContentText();
  Logger.log("Status: " + status);
  Logger.log("Response: " + body);

  if (status < 200 || status >= 300) {
    throw new Error("Cancelled lead API failed with status " + status + ": " + body);
  }
}

function parseCancelledLeadFormValues(e) {
  const values = {};

  if (e && e.response) {
    e.response.getItemResponses().forEach((itemResponse) => {
      const title = itemResponse.getItem().getTitle();
      values[title] = itemResponse.getResponse();
    });
    return values;
  }

  if (e && e.namedValues) {
    Object.keys(e.namedValues).forEach((key) => {
      values[key] = Array.isArray(e.namedValues[key]) ? e.namedValues[key][0] : e.namedValues[key];
    });
    return values;
  }

  throw new Error("Missing form submit event data.");
}

function addStringIfPresent(payload, key, value) {
  if (value === null || value === undefined) {
    return;
  }

  const trimmed = String(value).trim();
  if (trimmed) {
    payload[key] = trimmed;
  }
}

function addDateIfPresent(payload, key, value) {
  if (!value) {
    return;
  }

  payload[key] = value instanceof Date ? value.toISOString() : String(value).trim();
}

function deleteCancelledLeadTriggers() {
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (trigger.getHandlerFunction() === "onCancelledLeadSubmit") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  Logger.log("Deleted all onCancelledLeadSubmit triggers.");
}
