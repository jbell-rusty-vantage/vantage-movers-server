function createBookedLeadForm() {
  const form = FormApp.create("Create Booked Lead");

  form.setDescription(
    "Submit booked lead data to the Vercel API. " +
      "For Local, choose use_lead to use the pickup/delivery zip data already stored on the lead.",
  );

  form.setConfirmationMessage(
    "Booked lead submitted. Check MongoDB / synced sheet to confirm.",
  );

  const mongoIdValidation = FormApp.createTextValidation()
    .requireTextMatchesPattern("^[a-fA-F0-9]{24}$")
    .setHelpText("Enter a valid 24-character MongoDB ObjectId.")
    .build();

  const moneyValidation = FormApp.createTextValidation()
    .requireTextMatchesPattern("^\\d+(\\.\\d{1,2})?$")
    .setHelpText("Enter a valid number, e.g. 500 or 2500.50")
    .build();

  form
    .addTextItem()
    .setTitle("Agent")
    .setHelpText("Person who booked the lead. Example: John Smith")
    .setRequired(true);

  form
    .addDateItem()
    .setTitle("Book Date")
    .setHelpText("Date the lead was booked.")
    .setRequired(true);

  form
    .addTextItem()
    .setTitle("Job Number")
    .setHelpText("Internal job number.")
    .setRequired(true);

  form
    .addTextItem()
    .setTitle("Mongo Id")
    .setHelpText(
      "Lead ObjectId. This maps to lead_ref. Must be a 24-character MongoDB ObjectId.",
    )
    .setValidation(mongoIdValidation)
    .setRequired(true);

  form
    .addMultipleChoiceItem()
    .setTitle("Lead Model")
    .setHelpText("Select the collection/model where the original lead exists.")
    .setChoiceValues(["FormLead", "CallLead"])
    .setRequired(true);

  form
    .addTextItem()
    .setTitle("Binder Amount")
    .setHelpText("Number or decimal only. Example: 500 or 500.50")
    .setValidation(moneyValidation)
    .setRequired(true);

  form
    .addTextItem()
    .setTitle("Deposit Amount")
    .setHelpText("Number or decimal only. Example: 2500 or 2500.50")
    .setValidation(moneyValidation)
    .setRequired(true);

  form
    .addTextItem()
    .setTitle("Merchant")
    .setHelpText("Person or merchant name associated with the booking.")
    .setRequired(true);

  form
    .addMultipleChoiceItem()
    .setTitle("Lead Source")
    .setHelpText("Where this lead came from.")
    .setChoiceValues([
      "main_site",
      "top10_leads",
      "tbm_prime_leads",
      "best_relocation_leads",
      "not_provided",
    ])
    .setRequired(true);

  form
    .addListItem()
    .setTitle("Local")
    .setHelpText(
      "Choose use_lead to let the API use the pickup/delivery zip data already stored on the lead.",
    )
    .setChoiceValues(["use_lead", "local", "long_distance"])
    .setRequired(true);

  ScriptApp.newTrigger("onBookedLeadSubmit")
    .forForm(form)
    .onFormSubmit()
    .create();

  Logger.log("Edit URL: " + form.getEditUrl());
  Logger.log("Public URL: " + form.getPublishedUrl());
}

function onBookedLeadSubmit(e) {
  if (!e || !e.response) {
    throw new Error(
      "Missing Google Form response event. This function must run from a Form submit trigger.",
    );
  }

  const itemResponses = e.response.getItemResponses();

  const values = {};

  itemResponses.forEach((itemResponse) => {
    const title = itemResponse.getItem().getTitle();
    const answer = itemResponse.getResponse();
    values[title] = answer;
  });

  const payload = {
    agent: String(values["Agent"]).trim(),
    book_date: values["Book Date"],
    job_no: String(values["Job Number"]).trim(),
    lead_ref: String(values["Mongo Id"]).trim(),
    lead_model: values["Lead Model"],
    binder_amount: parseFloat(values["Binder Amount"]),
    deposit_amount: parseFloat(values["Deposit Amount"]),
    merchant: String(values["Merchant"]).trim(),
    source: values["Lead Source"],
  };

  const local = values["Local"] ? String(values["Local"]).trim() : "";

  if (local && local !== "use_lead") {
    payload.local = local;
  }

  const API_SECRET =
    PropertiesService.getScriptProperties().getProperty("API_SECRET");

  if (!API_SECRET) {
    throw new Error("Missing API_SECRET in Script Properties");
  }

  const response = UrlFetchApp.fetch(
    "https://vantage-movers-main-server.vercel.app/api/v1/booked-leads",
    {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      headers: {
        "x-api-secret": API_SECRET,
      },
      muteHttpExceptions: true,
    },
  );

  Logger.log("Values: " + JSON.stringify(values));
  Logger.log("Payload: " + JSON.stringify(payload));
  Logger.log("Status: " + response.getResponseCode());
  Logger.log("Response: " + response.getContentText());
}

function testBookedLeadSubmit() {
  onBookedLeadSubmit({
    namedValues: {
      Agent: ["Test Agent"],
      "Book Date": ["2026-05-15"],
      "Job Number": ["TEST-123"],
      "Mongo Id": ["6a06227b7ba7739beaba09fd"],
      "Lead Model": ["FormLead"],
      "Binder Amount": ["500"],
      "Deposit Amount": ["2500"],
      Merchant: ["Test Merchant"],
      "Lead Source": ["main_site"],
    },
  });
}

function deleteBookedLeadTriggers() {
  const triggers = ScriptApp.getProjectTriggers();

  triggers.forEach((trigger) => {
    if (trigger.getHandlerFunction() === "onBookedLeadSubmit") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  Logger.log("Deleted all onBookedLeadSubmit triggers.");
}
