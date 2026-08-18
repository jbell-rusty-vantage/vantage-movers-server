import {
  maskEmailForLog,
  maskPhoneForLog,
} from "../../utils/logging/sanitizeFormLeadForLog";

export type LeadContactDisplaySource = {
  ingestion_origin?: string;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  email?: string | null;
  granot_contact_snapshot?: {
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    phone_number?: string | null;
    email?: string | null;
    differs_from_ingested?: boolean;
    observation_id?: unknown;
    captured_at?: Date;
  } | null;
};

export type MaskedLeadContact = {
  name?: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  email?: string;
};

export type RoleSafeLeadContactProjection = {
  submitted_contact?: MaskedLeadContact;
  granot_contact?: MaskedLeadContact & {
    differs_from_ingested?: boolean;
    observation_id?: string;
    captured_at?: string;
  };
};

export function projectRoleSafeLeadContacts(
  lead: LeadContactDisplaySource,
): RoleSafeLeadContactProjection {
  const submitted = maskContact({
    name: lead.name,
    first_name: lead.first_name,
    last_name: lead.last_name,
    phone_number: lead.phone_number,
    email: lead.email,
  });
  const snapshot = lead.granot_contact_snapshot;
  const granot = snapshot
    ? {
        ...maskContact(snapshot),
        ...(snapshot.differs_from_ingested !== undefined
          ? { differs_from_ingested: snapshot.differs_from_ingested }
          : {}),
        ...(snapshot.observation_id
          ? { observation_id: String(snapshot.observation_id) }
          : {}),
        ...(snapshot.captured_at instanceof Date
          ? { captured_at: snapshot.captured_at.toISOString() }
          : {}),
      }
    : undefined;

  if (lead.ingestion_origin === "wordpress_form") {
    return {
      submitted_contact: submitted,
      ...(granot ? { granot_contact: granot } : {}),
    };
  }

  return {
    submitted_contact: submitted,
    ...(granot ? { granot_contact: granot } : {}),
  };
}

function maskContact(contact: {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  email?: string | null;
}): MaskedLeadContact {
  const masked: MaskedLeadContact = {};
  if (contact.name) masked.name = contact.name;
  if (contact.first_name) masked.first_name = contact.first_name;
  if (contact.last_name) masked.last_name = contact.last_name;
  if (contact.phone_number) masked.phone_number = maskPhoneForLog(contact.phone_number);
  if (contact.email) masked.email = maskEmailForLog(contact.email);
  return masked;
}
