function createBookedLeadForm() {
  const form = FormApp.create("Create Booked Lead");

  form.setDescription(
    "Submit booked lead data to the Vercel API. " +
      "Choose FormLead to book by Mongo Id, or CallLead to book by Job Number. " +
      "Leave Source Label blank to use the source company already stored on the lead.",
  );

  form.setConfirmationMessage(
    "Booked lead submitted. Check MongoDB / synced sheet to confirm.",
  );

  const moneyValidation = FormApp.createTextValidation()
    .requireTextMatchesPattern("^\\d+(\\.\\d{1,2})?$")
    .setHelpText("Enter a valid number, e.g. 500 or 2500.50")
    .build();

  const sourceLabelChoices = [
    "TBM Forms",
    "10best Inbounds",
    "TBM Prime Forms",
    "TBM Prime Inbounds",
    "Top10 Forms",
    "Top10 Inbounds",
    "Best Relocation Forms",
    "Best Relocation Locals",
    "Best Relocation Inbounds",
    "Main Site Forms",
    "Main Site Inbounds",
  ];

  const agentChoices = [
    "Austin",
    "Brian",
    "Dylan",
    "Jacob",
    "Josh",
    "Jason",
    "Mike",
    "Patrick",
    "Sil",
    "Roys",
    "House",
  ];

  const merchantChoices = [
    "Elavon",
    "Maverick",
    "Cardpointe",
    "EMS",
    "Paper Check",
    "Seamless",
    "Wire Transfer ACH",
  ];

  form
    .addMultipleChoiceItem()
    .setTitle("Lead Type")
    .setHelpText(
      "FormLead books by Mongo Id. CallLead books by Job Number.",
    )
    .setChoiceValues(["FormLead", "CallLead"])
    .setRequired(true);

  form
    .addListItem()
    .setTitle("Agent")
    .setHelpText("Primary agent for the booked lead. Example: John Smith")
    .setChoiceValues(agentChoices)
    .setRequired(true);

  form
    .addListItem()
    .setTitle("SplitAgent")
    .setHelpText(
      "Optional second agent. If provided, the binder amount is split 50/50.",
    )
    .setChoiceValues(agentChoices)
    .setRequired(false);

  form
    .addTextItem()
    .setTitle("Binder Amount")
    .setHelpText(
      "Full deal binder amount. The API splits this 50/50 when SplitAgent is provided.",
    )
    .setValidation(moneyValidation)
    .setRequired(true);

  form
    .addDateItem()
    .setTitle("Book Date")
    .setHelpText("Date the lead was booked.")
    .setRequired(true);

  form
    .addTextItem()
    .setTitle("Job Number")
    .setHelpText(
      "Required for both lead types. For CallLead, this is also used to find the call lead.",
    )
    .setRequired(true);

  form
    .addTextItem()
    .setTitle("Mongo Id")
    .setHelpText(
      "Required for FormLead only. Lead ObjectId. Must be a 24-character MongoDB ObjectId.",
    )
    .setValidation(
      FormApp.createTextValidation()
        .requireTextMatchesPattern("^$|^[a-fA-F0-9]{24}$")
        .setHelpText(
          "Leave blank for CallLead or enter a valid 24-character MongoDB ObjectId.",
        )
        .build(),
    )
    .setRequired(false);

  form
    .addTextItem()
    .setTitle("Phone Number")
    .setHelpText(
      "Optional for CallLead. If omitted, the API creates or reuses a CallLead by Job Number.",
    )
    .setRequired(false);

  form
    .addTextItem()
    .setTitle("Deposit Amount")
    .setHelpText("Number or decimal only. Example: 2500 or 2500.50")
    .setValidation(moneyValidation)
    .setRequired(true);

  form
    .addListItem()
    .setTitle("Merchant")
    .setHelpText("Person or merchant name associated with the booking.")
    .setChoiceValues(merchantChoices)
    .setRequired(true);

  form
    .addListItem()
    .setTitle("Source Label")
    .setHelpText("Optional. Leave blank to use the linked lead source_company.")
    .setChoiceValues(sourceLabelChoices)
    .setRequired(false);

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
    lead_type: requiredText(values["Lead Type"], "Lead Type"),
    book_date: values["Book Date"],
    agent: requiredText(values["Agent"], "Agent"),
    binder_amount: parseRequiredNumber(
      values["Binder Amount"],
      "Binder Amount",
    ),
    deposit_amount: parseRequiredNumber(
      values["Deposit Amount"],
      "Deposit Amount",
    ),
    merchant: requiredText(values["Merchant"], "Merchant"),
    submission_id: e.response.getId
      ? e.response.getId()
      : "google-form-" + new Date().toISOString(),
  };

  const splitAgent = optionalText(values["SplitAgent"]);
  if (splitAgent) {
    payload.split_agent = splitAgent;
  }

  const sourceLabel = optionalText(values["Source Label"]);
  if (sourceLabel) {
    payload.source_company = sourceLabel;
  }

  const jobNumber = requiredText(values["Job Number"], "Job Number");
  if (payload.lead_type === "FormLead") {
    payload.form_lead_id = requiredText(values["Mongo Id"], "Mongo Id");
    payload.job_no = jobNumber;
  } else if (payload.lead_type === "CallLead") {
    payload.call_job_no = jobNumber;
    const phoneNumber = optionalText(values["Phone Number"]);
    if (phoneNumber) {
      payload.call_phone_number = phoneNumber;
    }
  } else {
    throw new Error("Unsupported Lead Type: " + payload.lead_type);
  }

  const API_SECRET =
    PropertiesService.getScriptProperties().getProperty("API_SECRET");

  if (!API_SECRET) {
    throw new Error("Missing API_SECRET in Script Properties");
  }

  const response = UrlFetchApp.fetch(
    "https://vantage-movers-main-server.vercel.app/api/v1/booked-leads/from-source",
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

function requiredText(value, fieldName) {
  const text = optionalText(value);
  if (!text) {
    throw new Error(fieldName + " is required.");
  }
  return text;
}

function optionalText(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function parseRequiredNumber(value, fieldName) {
  const text = requiredText(value, fieldName);
  const parsed = parseFloat(text);
  if (!isFinite(parsed)) {
    throw new Error(fieldName + " must be a valid number.");
  }
  return parsed;
}

function testBookedLeadSubmit() {
  onBookedLeadSubmit({
    response: {
      getId: function () {
        return "test-booked-lead-submit";
      },
      getItemResponses: function () {
        const answers = {
          "Lead Type": "CallLead",
          Agent: "Austin",
          SplitAgent: "Brian",
          "Binder Amount": "500",
          "Book Date": "2026-05-15",
          "Job Number": "TEST-123",
          "Mongo Id": "",
          "Phone Number": "",
          "Deposit Amount": "2500",
          Merchant: "Elavon",
          "Source Label": "Main Site Forms",
        };
        return Object.keys(answers).map(function (title) {
          return {
            getItem: function () {
              return {
                getTitle: function () {
                  return title;
                },
              };
            },
            getResponse: function () {
              return answers[title];
            },
          };
        });
      },
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
