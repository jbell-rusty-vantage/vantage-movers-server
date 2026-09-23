/** Read-only: print the Subject Story and prior page for one Contact Number. node --env-file=.env --import tsx scripts/dev_ops/inspect-story.ts <number_id|+1phone> */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { assembleSubjectStory, resolveStorySubject } from "../../src/services/salesIntelligence/story/assemble";
import { storyToReadContent } from "../../src/services/salesIntelligence/story/page";
import { selectPriorAnalyses } from "../../src/services/salesIntelligence/analysis/prior";
import { readCaptureCoverage } from "../../src/services/numberActivity/coverage";
async function main() {
  const arg = process.argv[2]; if (!arg) throw new Error("number id or phone required");
  await connectMongo();
  const lead = /^lead:(FormLead|CallLead):([a-f0-9]{24})$/.exec(arg);
  const subject = await resolveStorySubject(lead ? { lead: { model: lead[1] as "FormLead" | "CallLead", id: lead[2] } } : arg.startsWith("+") ? { phone: arg } : { contact_number_id: arg });
  if (!subject) throw new Error("no subject");
  const story = await assembleSubjectStory(subject);
  const coverage = await readCaptureCoverage();
  const page = storyToReadContent(story, coverage);
  const prior = await selectPriorAnalyses({ contact_number_id: subject.contact_number_id!, subject_key: `number:${subject.contact_number_id}`, outreach_record_id: null, exclude_conversation_id: null, as_of: new Date() }, coverage);
  console.log(JSON.stringify({ events: story.events.length, coverage: story.coverage, candidates: story.candidates.length, granot: story.granot, page_records: page.page.records.length,
    page_bytes: Buffer.byteLength(JSON.stringify(page)), prior_records: prior.page.records.map(r => `${r.record_type}:${r.fields.kind ?? ""}`).join(","), prior_bytes: Buffer.byteLength(JSON.stringify(prior)) }, null, 1));
  console.log("\n" + story.prose);
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => mongoose.disconnect());
