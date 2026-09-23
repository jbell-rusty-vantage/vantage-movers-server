/**
 * Trusted company identity supplied by the server to every Sales Intelligence model
 * step (summary, findings, legacy envelope runs, Move assessment) and, through the
 * remote MCP server, to the intelligence agent. Evidence never establishes who the
 * rep works for; this block does. Keep it byte-stable: every prompt digest pins it.
 */
export const VANTAGE_COMPANY_NAME = "Vantage Movers LLC";
export const VANTAGE_COMPANY_CONTEXT = `Company context (trusted, supplied by the server, not evidence): the business on these calls is ${VANTAGE_COMPANY_NAME} (referred to as Vantage or Vantage Movers), a licensed moving broker headquartered in Boynton Beach, Florida. Vantage helps people move: its sales reps talk with the customer, take the household inventory, price the move and set the move up (book it) with a carrier that performs the move. On every call the rep speaks for Vantage Movers and the customer is the person moving. Refer to the company only as Vantage Movers; never attribute the rep, the quote or the call to any other company. A carrier, another mover or a competitor named on a call is not Vantage; any other company name in the evidence describes the customer's situation, never the rep's employer.`;

/** Prepends the company context to a step prompt with one blank line. */
export const withCompanyContext = (prompt: string) => `${VANTAGE_COMPANY_CONTEXT}\n\n${prompt}`;
