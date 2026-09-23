/**
 * Trusted company identity supplied by the server to every Sales Intelligence model
 * step (summary, findings, legacy envelope runs, Move assessment) and, through the
 * remote MCP server, to the intelligence agent. Evidence never establishes who the
 * rep works for; this block does. Keep it byte-stable: every prompt digest pins it.
 */
export const VANTAGE_COMPANY_NAME = "Vantage Movers LLC";
export const VANTAGE_COMPANY_CONTEXT = `Company context (trusted, supplied by the server, not evidence): the business on these calls is ${VANTAGE_COMPANY_NAME} (referred to as Vantage or Vantage Movers), a licensed moving broker headquartered in Boynton Beach, Florida. Vantage helps people move: its sales reps talk with the customer, take the household inventory, price the move and set the move up (book it) with a carrier that performs the move. On every call the rep speaks for Vantage Movers and the customer is the person moving. Refer to the company only as Vantage Movers; never attribute the rep, the quote or the call to any other company. A carrier, another mover or a competitor named on a call is not Vantage; any other company name in the evidence describes the customer's situation, never the rep's employer.`;

/**
 * How Vantage's records come to exist, so the findings model reads the story and the Granot
 * state the server assembles as a system it understands rather than as loose JSON. Owner-confirmed
 * Priority meanings come from `outreach/leadProgress.ts`; nothing here is a fact about a customer.
 * Byte-stable: the findings prompt digest pins it (context provenance specification §5.5).
 */
export const VANTAGE_DOMAIN_CONTEXT = `How Vantage's records are produced (trusted, supplied by the server, not evidence):
- A Form Lead is created when a customer submits a WordPress quote form on one of Vantage's partner landing pages or the main site; the Lead carries the customer's name, phone, pickup and delivery, move size and move date as submitted, and the source company label names the site. Vantage immediately sends the customer a quote request confirmation text (a Lead Message, via Twilio); a delivered text means the customer received Vantage's number.
- A Call Lead is created when a customer calls one of Vantage's RingCentral numbers and the call qualifies (a real inbound sales call, not spam or an internal call). Every call, inbound or outbound, on any Vantage RingCentral line is captured from RingCentral webhooks and call logs as a Call Interaction on the customer's Contact Number: direction, result (connected, voicemail, missed, no answer), duration and recordings. A recorded call becomes a Lead Conversation whose transcript was summarized by an earlier model step; those summaries are the calls you are given.
- Granot is the CRM where reps work every Lead. Vantage posts new Leads to Granot and observes Granot's changes back (webhooks and CRM captures): the Job number, the assigned rep, the Priority, whether the Lead was Quoted, the estimate, the payment received and the balance as Granot displays them, and booking actions (booked, release). Owner-confirmed Priority meanings: 0 = Fresh (untouched), 1 = Quoted (a price was given), 3 = Rep discretion (the rep is deciding how to work it), 7 = CRM bad/unusable (Granot closed it as bad or unusable), 8 = CRM dead opportunity (Granot closed it as dead). Any other code, including 5, has no confirmed meaning; treat it as unknown. A Quoted flag means Granot recorded a quote; a Vantage Booking record (job number, binder amount, deposit) is the official booking; a Cancellation record is the official cancellation.
- A Contact Number is attached to a Lead by Vantage's attachment logic (phone match, Exact/Likely/Unsure) or by the Owner; an unattached number may have candidate Leads listed for it. Outreach work is Vantage's record of what still has to happen for a Lead or number: follow-ups (rep promises, customer requests, waits), assignment, Owner notes, reviews and closure. The Owner is the business owner reviewing this work; Owner instructions and corrections outrank any model finding.
- The story block is Vantage's chronology of all of this for the number and its Leads, oldest first, assembled by the server from the records above; the granot_state records are each Lead's current Granot state; prior_summary, prior_finding and prior_assessment records are what earlier model runs concluded.`;

/** Prepends the company context to a step prompt with one blank line. */
export const withCompanyContext = (prompt: string) => `${VANTAGE_COMPANY_CONTEXT}\n\n${prompt}`;
/** Company identity plus the record-production picture, for the findings step. */
export const withDomainContext = (prompt: string) => `${VANTAGE_COMPANY_CONTEXT}\n\n${VANTAGE_DOMAIN_CONTEXT}\n\n${prompt}`;
