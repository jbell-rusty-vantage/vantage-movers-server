function createBookedLeadRequiredForm() {
  const form = FormApp.create("Create Booked Lead - Required Contact");

  form.setDescription(
    "Submit booked lead data to the Vercel API. " +
      "Job Number is always required for service rep safety. " +
      "Phone Number is required when Mongo Id is blank. " +
      "Mongo Id is optional and can attach this booking to an existing form lead. " +
      "Source Label can correct or provide the booking source.",
  );

  form.setConfirmationMessage(
    "Booked lead submitted. Check MongoDB / synced sheet to confirm.",
  );

  const moneyValidation = FormApp.createTextValidation()
    .requireTextMatchesPattern("^\\d+(\\.\\d{1,2})?$")
    .setHelpText("Enter a valid number, e.g. 500 or 2500.50")
    .build();
  const optionalPhoneValidation = FormApp.createTextValidation()
    .requireTextMatchesPattern("^$|.*\\d{10,}.*")
    .setHelpText("Required when Mongo Id is blank. Enter at least 10 digits.")
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
    .setHelpText("Required for service rep safety.")
    .setRequired(true);

  form
    .addTextItem()
    .setTitle("Phone Number")
    .setHelpText(
      "Required when Mongo Id is blank. In some route cases this may not be used.",
    )
    .setValidation(optionalPhoneValidation)
    .setRequired(false);

  form
    .addTextItem()
    .setTitle("Mongo Id")
    .setHelpText(
      "Optional. Enter a form lead ObjectId to attach this booking to an existing form lead.",
    )
    .setValidation(
      FormApp.createTextValidation()
        .requireTextMatchesPattern("^$|^[a-fA-F0-9]{24}$")
        .setHelpText(
          "Leave blank to create an incomplete call lead booking or enter a valid 24-character MongoDB ObjectId.",
        )
        .build(),
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

  ScriptApp.newTrigger("onBookedLeadRequiredSubmit")
    .forForm(form)
    .onFormSubmit()
    .create();

  Logger.log("Edit URL: " + form.getEditUrl());
  Logger.log("Public URL: " + form.getPublishedUrl());
}

function onBookedLeadRequiredSubmit(e) {
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

  const binderAmount = parseBookedLeadRequiredNumber(
    values["Binder Amount"],
    "Binder Amount",
  );
  const sourceLabel = optionalBookedLeadRequiredText(values["Source Label"]);
  const jobNumber = requiredBookedLeadText(values["Job Number"], "Job Number");
  const submissionId = e.response.getId
    ? e.response.getId()
    : "google-form-" + new Date().toISOString();
  const mongoId = optionalBookedLeadRequiredText(values["Mongo Id"]);
  const phoneNumber = optionalBookedLeadRequiredText(values["Phone Number"]);
  if (!mongoId && !phoneNumber) {
    throw new Error("Phone Number is required when Mongo Id is blank.");
  }
  const basePayload = {
    book_date: values["Book Date"],
    agent: requiredBookedLeadText(values["Agent"], "Agent"),
    binder_amount: binderAmount,
    deposit_amount: parseBookedLeadRequiredNumber(
      values["Deposit Amount"],
      "Deposit Amount",
    ),
    merchant: requiredBookedLeadText(values["Merchant"], "Merchant"),
    submission_id: submissionId,
  };

  const splitAgent = optionalBookedLeadRequiredText(values["SplitAgent"]);
  if (splitAgent) {
    basePayload.split_agent = splitAgent;
  }

  const request = buildBookedLeadRequiredRequest({
    jobNumber: jobNumber,
    phoneNumber: phoneNumber,
    mongoId: mongoId,
    sourceLabel: sourceLabel,
    basePayload: basePayload,
  });

  const API_SECRET =
    PropertiesService.getScriptProperties().getProperty("API_SECRET");

  if (!API_SECRET) {
    throw new Error("Missing API_SECRET in Script Properties");
  }

  const response = UrlFetchApp.fetch(request.url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(request.payload),
    headers: {
      "x-api-secret": API_SECRET,
    },
    muteHttpExceptions: true,
  });

  Logger.log("Values: " + JSON.stringify(values));
  Logger.log("Endpoint: " + request.url);
  Logger.log("Payload: " + JSON.stringify(request.payload));
  Logger.log("Status: " + response.getResponseCode());
  Logger.log("Response: " + response.getContentText());
}

function buildBookedLeadRequiredRequest(options) {
  const baseUrl = "https://vantage-movers-main-server.vercel.app/api/v1";
  const payload = Object.assign({}, options.basePayload);

  if (options.mongoId) {
    delete payload.agent;
    delete payload.split_agent;
    delete payload.binder_amount;

    if (options.jobNumber) {
      payload.job_no = options.jobNumber;
    }
    payload.lead_ref = options.mongoId;
    payload.lead_model = "FormLead";
    payload.agent_allocations = buildBookedLeadRequiredAgentAllocations(
      options.basePayload.agent,
      options.basePayload.split_agent,
      options.basePayload.binder_amount,
    );
    payload.total_binder_amount = options.basePayload.binder_amount;
    payload.source = resolveBookedLeadRequiredSource(
      options.sourceLabel,
      options.mongoId,
    );

    return {
      url: baseUrl + "/booked-leads",
      payload: payload,
    };
  }

  payload.lead_type = "CallLead";
  if (options.jobNumber) {
    payload.call_job_no = options.jobNumber;
  }
  if (options.phoneNumber) {
    payload.call_phone_number = options.phoneNumber;
  }
  if (options.sourceLabel) {
    payload.source_company = options.sourceLabel;
  }

  return {
    url: baseUrl + "/booked-leads/from-source",
    payload: payload,
  };
}

function buildBookedLeadRequiredAgentAllocations(agent, splitAgent, binderAmount) {
  const agentName = requiredBookedLeadText(agent, "Agent");
  const splitAgentName = optionalBookedLeadRequiredText(splitAgent);

  if (!splitAgentName) {
    return [
      {
        agent_name: agentName,
        binder_amount: binderAmount,
      },
    ];
  }

  const splitBinderAmount = binderAmount / 2;
  return [
    {
      agent_name: agentName,
      binder_amount: splitBinderAmount,
    },
    {
      agent_name: splitAgentName,
      binder_amount: splitBinderAmount,
    },
  ];
}

function resolveBookedLeadRequiredSource(sourceLabel, mongoId) {
  const sourceFromLabel = bookedLeadRequiredSourceLabelToCompany(sourceLabel);
  if (sourceFromLabel) {
    return sourceFromLabel;
  }

  const sourceFromLead = fetchFormLeadRequiredSourceCompany(mongoId);
  if (sourceFromLead) {
    return bookedLeadRequiredSourceLabelToCompany(sourceFromLead) || sourceFromLead;
  }

  throw new Error(
    "Source Label is required when the linked FormLead does not have source_company.",
  );
}

function fetchFormLeadRequiredSourceCompany(mongoId) {
  const API_SECRET =
    PropertiesService.getScriptProperties().getProperty("API_SECRET");

  if (!API_SECRET) {
    throw new Error("Missing API_SECRET in Script Properties");
  }

  const response = UrlFetchApp.fetch(
    "https://vantage-movers-main-server.vercel.app/api/v1/form-leads/" +
      encodeURIComponent(mongoId),
    {
      method: "get",
      headers: {
        "x-api-secret": API_SECRET,
      },
      muteHttpExceptions: true,
    },
  );

  if (response.getResponseCode() !== 200) {
    throw new Error(
      "Unable to fetch linked FormLead source_company. Status: " +
        response.getResponseCode() +
        " Response: " +
        response.getContentText(),
    );
  }

  const body = JSON.parse(response.getContentText());
  return optionalBookedLeadRequiredText(
    body && body.data && body.data.source_company,
  );
}

function bookedLeadRequiredSourceLabelToCompany(sourceLabel) {
  const sourceMap = {
    "Main Site Forms": "main_site",
    "Main Site Inbounds": "main_site",
    "Get Movers": "main_site",
    "TBM Forms Prime": "tbm_prime_leads",
    "TBM Forms": "tbm_leads",
    "TBM Prime Forms": "tbm_prime_leads",
    "TBM Prime Inbounds": "tbm_prime_leads",
    "Top10 Forms": "top10_leads",
    "Top10 Inbounds": "top10_leads",
    "10best Inbounds": "top10_leads",
    "Best Relocation Forms": "best_relocation_leads",
    "Best Relocation Locals": "best_relocation_leads",
    "Best Relocation Inbounds": "best_relocation_leads",
  };

  return sourceMap[optionalBookedLeadRequiredText(sourceLabel)] || "";
}

function requiredBookedLeadText(value, fieldName) {
  const text = optionalBookedLeadRequiredText(value);
  if (!text) {
    throw new Error(fieldName + " is required.");
  }
  return text;
}

function optionalBookedLeadRequiredText(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function parseBookedLeadRequiredNumber(value, fieldName) {
  const text = requiredBookedLeadText(value, fieldName);
  const parsed = parseFloat(text);
  if (!isFinite(parsed)) {
    throw new Error(fieldName + " must be a valid number.");
  }
  return parsed;
}

function testBookedLeadRequiredSubmit() {
  onBookedLeadRequiredSubmit({
    response: {
      getId: function () {
        return "test-booked-lead-required-submit";
      },
      getItemResponses: function () {
        const answers = {
          Agent: "Austin",
          SplitAgent: "Brian",
          "Binder Amount": "500",
          "Book Date": "2026-05-15",
          "Job Number": "TEST-123",
          "Phone Number": "5555551212",
          "Mongo Id": "",
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

function deleteBookedLeadRequiredTriggers() {
  const triggers = ScriptApp.getProjectTriggers();

  triggers.forEach((trigger) => {
    if (trigger.getHandlerFunction() === "onBookedLeadRequiredSubmit") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  Logger.log("Deleted all onBookedLeadRequiredSubmit triggers.");
}
