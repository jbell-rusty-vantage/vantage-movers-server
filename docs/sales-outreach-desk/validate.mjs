import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root=dirname(fileURLToPath(import.meta.url));
let failures=[];
const assert=(ok,msg)=>{if(!ok) failures.push(msg);};
const manifest=JSON.parse(readFileSync(resolve(root,'PACKET-MANIFEST.json'),'utf8'));
for(const [path,hash] of Object.entries(manifest.files)) {
 const full=resolve(root,path);
 assert(existsSync(full),`Missing release file: ${path}`);
 if(existsSync(full)) assert(createHash('sha256').update(readFileSync(full)).digest('hex')===hash,`Hash differs: ${path}; regenerate shared release through Team A`);
}
function walk(dir){return readdirSync(dir).flatMap(n=>{const p=resolve(dir,n);return statSync(p).isDirectory()?walk(p):[p];});}
let linkCount=0;
for(const file of walk(root).filter(f=>f.endsWith('.md')&&!relative(root,f).startsWith('sources'+sep))){
 const md=readFileSync(file,'utf8');
 for(const m of md.matchAll(/\]\(([^)]+)\)/g)) {
  const url=m[1].split('#')[0]; if(!url||/^[a-z]+:/i.test(url)) continue;
  const target=resolve(dirname(file),url); const rel=relative(root,target);
  assert(!rel.startsWith('..')&&!rel.startsWith(sep),`Nonportable link: ${relative(root,file)} -> ${url}`);
  assert(existsSync(target),`Broken link: ${relative(root,file)} -> ${url}`);linkCount++;
 }
}
const config=JSON.parse(readFileSync(resolve(root,'contracts/configuration-defaults.json'),'utf8'));
assert(Object.values(config.value.controls).every(v=>v===false),'Unapproved new controls must default off');
assert(config.value.migration.paused===true,'Migration must default paused');
assert(config.value.cadence.approval_ref===null,'Default fixture cannot claim Owner approval');
assert(config.value.cadence.timezone==='America/New_York','Timezone contract drift');
const fixtures=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/synthetic.json'),'utf8'));
const spec=readFileSync(resolve(root,'SPECIFICATION.md'),'utf8');
for(let i=1;i<=23;i++)assert(new RegExp('^## '+i+'\\. ','m').test(spec),`Specification section ${i} missing`);
assert(fixtures.synthetic===true&&fixtures.contract_version==='sod-v1','Fixture contract mismatch');
const goal=fixtures.cases.find(x=>x.id==='above_goal');
assert(goal.remaining===Math.max(0,goal.goal-goal.actual)&&goal.progress===Math.min(1,goal.actual/goal.goal),'Goal arithmetic drift');
assert(fixtures.cases.find(x=>x.id==='sms_unknown').sms_verified_completed===null,'Unknown SMS cannot be zero');
assert(fixtures.cases.find(x=>x.id==='foreign_rep').expected_status===404,'Foreign Rep must not leak existence');
const p01=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p01-call-count.json'),'utf8'));
assert(p01.synthetic===true&&p01.decision_revision==='P01-v1'&&p01.approval_ref==='owner-session-2026-10-02-P01','P01 approval provenance drift');
assert(p01.complete_policy_approved===false&&p01.cadence_enforcement_enabled===false&&p01.timing_approved===false&&p01.evidence_eligibility_approved===false,'Partial P01 approval cannot authorize enforcement/timing/eligibility');
for(const row of p01.cases){
 assert(row.schedule_day>=1&&row.schedule_day<=3&&row.required_calls===2,`P01 required count drift: ${row.id}`);
 assert(row.remaining_required_calls===Math.max(0,2-row.verified_calls),`P01 remaining count drift: ${row.id}`);
 assert(row.optional_additional_calls===Math.max(0,row.verified_calls-2),`P01 optional count drift: ${row.id}`);
}
const p01Sms=p01.cases.find(x=>x.id==='day_2_calls_without_sms');
assert(p01Sms?.remaining_required_calls===0&&p01Sms?.remaining_required_sms===1,'P01 calls must not satisfy SMS');
const p02a=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p02a-calendar-age.json'),'utf8'));
assert(p02a.synthetic===true&&p02a.decision_revision==='P02a-v1'&&p02a.approval_ref==='owner-session-2026-10-02-P02a'&&p02a.timezone==='America/New_York','P02a approval provenance drift');
assert(p02a.complete_policy_approved===false&&p02a.cadence_enforcement_enabled===false&&p02a.working_calendar_approved===false&&p02a.deadlines_approved===false,'P02a age approval cannot authorize working calendar/deadlines/enforcement');
const nyDate=iso=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
for(const row of p02a.cases){
 assert(nyDate(row.received_at)===row.received_date&&nyDate(row.as_of)===row.business_date,`P02a New York date drift: ${row.id}`);
 assert(row.schedule_day===1+(Date.parse(row.business_date)-Date.parse(row.received_date))/86400000,`P02a calendar age drift: ${row.id}`);
 if(row.elapsed_hours!==undefined)assert((Date.parse(row.as_of)-Date.parse(row.received_at))/3600000===row.elapsed_hours,`P02a DST fixture drift: ${row.id}`);
}
const p02b=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p02b-working-week.json'),'utf8'));
assert(p02b.synthetic===true&&p02b.decision_revision==='P02b-v1'&&p02b.approval_ref==='owner-session-2026-10-02-P02b','P02b approval provenance drift');
assert(p02b.working_weekdays.join(',')==='monday,tuesday,wednesday,thursday,friday,saturday,sunday','P02b requires all seven working weekdays');
assert(p02b.complete_policy_approved===false&&p02b.cadence_enforcement_enabled===false&&p02b.hours_approved===false&&p02b.holidays_approved===false&&p02b.deadlines_approved===false,'P02b weekdays cannot authorize hours/holidays/deadlines/enforcement');
for(const row of p02b.cases){
 assert(row.working_day===true&&row.automatic_sunday_exemption===false&&row.required_calls===2&&row.required_sms===1,`P02b Sunday cadence drift: ${row.id}`);
 assert(new Date(row.business_date+'T12:00:00Z').getUTCDay()===0&&row.schedule_day===1+(Date.parse(row.business_date)-Date.parse(row.received_date))/86400000,`P02b Sunday timeline drift: ${row.id}`);
}
const p02c=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p02c-working-hours.json'),'utf8'));
assert(p02c.synthetic===true&&p02c.decision_revision==='P02c-v1'&&p02c.approval_ref==='owner-session-2026-10-02-P02c'&&p02c.timezone==='America/New_York','P02c approval provenance drift');
assert(p02c.opening_minute===480&&p02c.closing_minute===1200,'P02c hours drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','first_deadline_approved','partial_day_quota_approved','holidays_approved','outside_window_credit_approved'].every(k=>p02c[k]===false),'P02c hours approval cannot authorize remaining gates');
for(const row of p02c.cases){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:p02c.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(row.instant));
 const minute=Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);
 assert(minute===row.local_minute&&row.inside_window===(minute>=480&&minute<1200),`P02c local window drift: ${row.id}`);
}
assert(p02c.arrival_examples.every(row=>row.first_call_due_at===null&&row.required_first_window_calls===null),'P02c arrival examples cannot invent deadlines/quotas');
const p02d=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p02d-first-call-deadline.json'),'utf8'));
assert(p02d.synthetic===true&&p02d.decision_revision==='P02d-v1'&&p02d.approval_ref==='owner-session-2026-10-02-P02d','P02d approval provenance drift');
assert(p02d.first_call_working_minutes===30&&p02d.carry_unused_minutes_across_closing===true,'P02d working-minute duration/carry drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','daily_quota_timing_approved','sms_deadline_approved'].every(k=>p02d[k]===false),'P02d first-call approval cannot authorize quota/SMS/enforcement');
const nyMinute=at=>{const p=new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at));return Number(p.find(x=>x.type==='hour').value)*60+Number(p.find(x=>x.type==='minute').value);};
for(const row of p02d.cases){
 let workingMinutes=0;const from=Date.parse(row.received_at),to=Date.parse(row.first_call_due_at);
 assert(to>from&&to-from<48*3600000,`P02d bounded fixture drift: ${row.id}`);
 if(to>from&&to-from<48*3600000)for(let at=from;at<to;at+=60000){const minute=nyMinute(at);if(minute>=480&&minute<1200)workingMinutes++;}
 assert(workingMinutes===30,`P02d expected working minutes drift: ${row.id}`);
}
const p02e=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p02e-call-spacing.json'),'utf8'));
assert(p02e.synthetic===true&&p02e.decision_revision==='P02e-v1'&&p02e.approval_ref==='owner-session-2026-10-02-P02e'&&p02e.initial_spacing_minutes===60,'P02e approval/value drift');
assert(p02e.configuration_field==='cadence.new_call_min_spacing_minutes'&&config.value.cadence.new_call_min_spacing_minutes===null,'P02e configurable bootstrap drift');
assert(p02e.configuration_authority==='persisted reloadable configuration'&&p02e.deployment_required_for_edit===false&&p02e.environment_fallback===false,'P02e persisted reload authority drift');
assert(p02e.complete_policy_approved===false&&p02e.cadence_enforcement_enabled===false&&p02e.goal_eligibility_approved===false,'P02e spacing cannot activate policy/approve goals');
assert(JSON.stringify(p02e.cases.find(x=>x.id==='at_sixty_minutes')?.expected_cadence_credit_indices)==='[0,1]'&&JSON.stringify(p02e.cases.find(x=>x.id==='at_fifty_nine_minutes')?.expected_cadence_credit_indices)==='[0]'&&JSON.stringify(p02e.cases.find(x=>x.id==='retry_does_not_reset')?.expected_cadence_credit_indices)==='[0,2]','P02e boundary/retry expected outputs drift');
assert(p02e.config_edit_example.synthetic_only===true&&p02e.config_edit_example.owner_policy_approved===false&&p02e.config_edit_example.historic_periods_rewritten===false,'P02e edit demonstration cannot approve a new value/rewrite history');
const p02f=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p02f-new-daily-deadlines.json'),'utf8'));
assert(p02f.synthetic===true&&p02f.decision_revision==='P02f-v1'&&p02f.approval_ref==='owner-session-2026-10-02-P02f','P02f approval provenance drift');
assert(JSON.stringify(p02f.two_call_deadline_minutes)==='[720,1200]'&&p02f.one_call_deadline_minute===1200&&p02f.minimum_spacing_minutes===60&&p02f.configurable===true,'P02f configurable deadline values drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','arrival_day_allowance_approved','sms_deadline_approved','quoted_deadline_approved'].every(k=>p02f[k]===false),'P02f full-day defaults cannot approve other policies');
for(const row of p02f.cases){
 assert(row.required_calls===(row.schedule_day<=5?2:1)&&row.verified_completed===row.call_start_minutes.length&&row.remaining===Math.max(0,row.required_calls-row.verified_completed),`P02f count expectation drift: ${row.id}`);
 assert(row.call_start_minutes.every((m,i,all)=>m>=480&&m<1200&&m<=row.as_of_minute&&(i===0||m-all[i-1]>=60)),`P02f call timing fixture drift: ${row.id}`);
}
assert(p02f.cases.find(x=>x.id==='both_calls_after_noon')?.first_deadline_missed===true&&p02f.cases.find(x=>x.id==='both_calls_after_noon')?.remaining===0,'P02f completion must retain historical miss');
const p02g=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p02g-arrival-day-calls.json'),'utf8'));
assert(p02g.synthetic===true&&p02g.decision_revision==='P02g-v1'&&p02g.approval_ref==='owner-session-2026-10-02-P02g'&&p02g.two_calls_before_minute===1080&&p02g.one_call_through_minute_inclusive===1170&&p02g.configurable===true,'P02g approval/threshold drift');
assert(p02g.complete_policy_approved===false&&p02g.cadence_enforcement_enabled===false&&p02g.sms_allowance_approved===false,'P02g calls cannot approve SMS/enforcement');
for(const row of p02g.cases){
 assert(row.arrival_date_required_calls===(row.arrival_minute<1080?2:row.arrival_minute<=1170?1:0)&&row.past_noon_deadline===false,`P02g arrival quota drift: ${row.id}`);
 if(row.arrival_date_required_calls===0)assert(row.arrival_quota_waived_not_missed===true&&row.first_due_day_offset===1,`P02g waiver/carry drift: ${row.id}`);
}
assert(p02g.next_day_example.required_calls===2&&p02g.next_day_example.remaining_required_calls===1&&p02g.next_day_example.extra_third_obligation===false,'P02g carryover must not duplicate daily quota');
const p03=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p03-fixed-sms.json'),'utf8'));
assert(p03.synthetic===true&&p03.decision_revision==='P03-v1'&&p03.approval_ref==='owner-session-2026-10-02-P03'&&p03.configurable===true,'P03 approval provenance drift');
assert(JSON.stringify(p03.initial_days)==='[1,2,3]'&&p03.later_first_day===6&&p03.later_interval_days===3&&JSON.stringify(p03.required_days_through_13)==='[1,2,3,6,9,12]','P03 fixed sequence drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','sms_deadline_approved','arrival_allowance_approved'].every(k=>p03[k]===false),'P03 schedule cannot approve deadlines/allowance/enforcement');
for(let i=0;i<p03.required_days_through_13.length;i++)assert(p03.required_dates[i]===new Date(Date.UTC(2026,9,2)+86400000*(p03.required_days_through_13[i]-1)).toISOString().slice(0,10),'P03 date fixture drift');
assert(p03.cases.find(x=>x.id==='extra_day_seven')?.next_required_day===9&&p03.cases.find(x=>x.id==='extra_day_seven')?.future_schedule_shifted===false&&p03.cases.find(x=>x.id==='missed_day_three')?.next_required_day===6&&p03.cases.find(x=>x.id==='late_day_three_capture')?.evaluation_schedule_day===3,'P03 extra/miss/late-evidence expectations drift');
const p02h=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p02h-sms-deadline-allowance.json'),'utf8'));
assert(p02h.synthetic===true&&p02h.decision_revision==='P02h-v1'&&p02h.approval_ref==='owner-session-2026-10-02-P02h'&&p02h.sms_cutoff_minute===1200&&p02h.arrival_threshold_minute_inclusive===1170&&p02h.configurable===true,'P02h approval/configurable defaults drift');
assert(p02h.complete_policy_approved===false&&p02h.cadence_enforcement_enabled===false&&p02h.provider_eligibility_approved===false,'P02h timing cannot approve provider/enforcement');
for(const row of p02h.cases)assert(row.arrival_date_required_sms===(row.arrival_minute<=1170?1:0)&&row.due_minute===(row.arrival_minute<=1170?1200:null)&&row.waived_not_missed===(row.arrival_minute>1170),`P02h boundary/waiver drift: ${row.id}`);
assert(p02h.next_day_example.required_sms===1&&p02h.next_day_example.extra_sms_debt===false&&p02h.independence_example.calls_remaining===0&&p02h.independence_example.sms_remaining===1&&p02h.fixed_sequence_example.extra_day_7_shifts_day_9===false,'P02h next-day/independence/sequence drift');
const p02i=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p02i-closures.json'),'utf8'));
assert(p02i.synthetic===true&&p02i.decision_revision==='P02i-v1'&&p02i.approval_ref==='owner-session-2026-10-02-P02i'&&p02i.automatic_holiday_exclusions===false&&p02i.initial_closed_dates.length===0&&p02i.owner_editable_future_closures===true&&p02i.prospective_edits_only===true,'P02i closure authority drift');
assert(p02i.complete_policy_approved===false&&p02i.cadence_enforcement_enabled===false,'P02i closures cannot activate complete policy');
const closedSms=p02i.cases.find(x=>x.id==='closed_day_six_sms');
assert(closedSms.routine_calls_required===0&&closedSms.routine_sms_required===0&&closedSms.waived_not_missed===true&&closedSms.next_fixed_sms_day===9&&closedSms.historical_misses_erased===false,'P02i closure quota/sequence/history drift');
assert(p02i.cases.find(x=>x.id==='first_call_skips_monday')?.first_call_due_at==='2026-10-06T12:15:00Z'&&p02i.cases.find(x=>x.id==='first_call_skips_monday')?.schedule_day_at_due===3&&p02i.cases.find(x=>x.id==='unlisted_public_holiday')?.working_date===true&&p02i.cases.find(x=>x.id==='rep_absent_company_open')?.company_calendar_closed===false,'P02i carry/age/holiday/absence expectation drift');
const p04a=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p04a-quoted-deferral.json'),'utf8'));
assert(p04a.synthetic===true&&p04a.decision_revision==='P04a-v1'&&p04a.approval_ref==='owner-session-2026-10-02-P04a'&&p04a.quoted_due_minute===1200&&p04a.configurable===true,'P04a approval/configurable deadline drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','permissions_approved','closed_date_selection_approved'].every(k=>p04a[k]===false),'P04a date interpretation cannot approve remaining gates');
assert(nyDate(p04a.activation_at)===p04a.selected_date&&nyMinute(Date.parse(p04a.activation_at))===480&&nyDate(p04a.due_at)===p04a.selected_date&&nyMinute(Date.parse(p04a.due_at))===1200,'P04a selected-date opening/due drift');
assert(p04a.cases.find(x=>x.id==='early_extra_call')?.selected_date_verified_completed===0&&p04a.cases.find(x=>x.id==='missed_selected_date')?.next_date_ordinary_required_calls===1&&p04a.cases.find(x=>x.id==='before_selected_date')?.actionable_countdown_active===false,'P04a early-call/daily/countdown expectation drift');
const p04b=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p04b-quoted-permissions.json'),'utf8'));
assert(p04b.synthetic===true&&p04b.decision_revision==='P04b-v1'&&p04b.approval_ref==='owner-session-2026-10-02-P04b','P04b permission approval drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','date_validation_approved'].every(k=>p04b[k]===false),'P04b permission cannot approve dates/enforcement');
const perm=id=>p04b.cases.find(x=>x.id===id);
assert(perm('current_rep')?.permitted===true&&perm('owner')?.permitted===true&&perm('former_rep')?.expected_status===404&&perm('reassignment_during_open_page')?.permitted===false&&perm('generic_admin')?.expected_status===403&&perm('concurrent_revision')?.expected_status===409,'P04b actor/revision expected matrix drift');
assert(perm('post_miss_reschedule')?.old_miss_retained===true&&perm('post_miss_reschedule')?.separate_owner_approval_required===false&&perm('post_miss_reschedule')?.post_miss_deferral_visible_to_owner===true&&perm('post_miss_reschedule')?.contact_credit_created===false&&p04b.reassignment_preserves_schedule===true,'P04b reschedule/history expectation drift');
const p04c=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p04c-quoted-allowed-dates.json'),'utf8'));
assert(p04c.synthetic===true&&p04c.decision_revision==='P04c-v1'&&p04c.approval_ref==='owner-session-2026-10-02-P04c'&&p04c.quoted_same_day_cutoff_minute===1170&&p04c.configurable===true&&config.value.cadence.quoted_same_day_cutoff_minute===null,'P04c approval/configuration drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','no_date_default_approved'].every(k=>p04c[k]===false),'P04c allowed dates cannot approve no-date default/enforcement');
const qdate=id=>p04c.cases.find(x=>x.id===id);
assert(qdate('today_1930')?.allowed===true&&qdate('today_1931')?.allowed===false&&qdate('future_working_date')?.allowed===true&&qdate('future_closed_date')?.allowed===false&&qdate('past_date')?.allowed===false,'P04c date eligibility matrix drift');
assert(qdate('today_1400')?.activation_minute===840&&qdate('today_before_open')?.activation_minute===480&&qdate('today_1400')?.retrospective_miss_created===false&&qdate('selected_date_later_closed')?.selected_date_preserved===true&&qdate('selected_date_later_closed')?.quota_waived===true&&qdate('early_call_then_select_today')?.retroactive_credit_created===false,'P04c effective-time/closure/history drift');
const p04d=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p04d-quoted-no-date.json'),'utf8'));
assert(p04d.synthetic===true&&p04d.decision_revision==='P04d-v1'&&p04d.approval_ref==='owner-session-2026-10-03-P04d'&&p04d.no_date_default==='next_working_date','P04d approval/default drift');
assert(p04d.opening_minute===480&&p04d.quoted_due_minute===1200&&p04d.complete_policy_approved===false&&p04d.cadence_enforcement_enabled===false&&p04d.evidence_eligibility_approved===false,'P04d timing/scope drift');
for(const row of p04d.cases){let next=nyDate(row.entry_at);do{next=new Date(Date.parse(next+'T12:00:00Z')+86400000).toISOString().slice(0,10);}while(row.closed_dates.includes(next));assert(row.first_required_date===next&&row.entry_date_required_quoted_calls===0,'P04d next working date drift: '+row.id);}
assert(p04d.cases.find(x=>x.id==='already_called_today')?.future_requirement_fulfilled===false&&p04d.repeated_priority.schedule_restarted===false&&p04d.repeated_priority.first_required_date_preserved===true&&p04d.explicit_date.default_overrides_selected_date===false&&p04d.ordinary_continuation_calls_per_working_date===1,'P04d early-credit/repeated-priority/explicit-date drift');
const p05a=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p05a-return-to-new-age.json'),'utf8'));
assert(p05a.synthetic===true&&p05a.decision_revision==='P05a-v1'&&p05a.approval_ref==='owner-session-2026-10-03-P05a'&&p05a.age_basis==='original_received_date'&&p05a.configuration_field==='cadence.return_to_new_mode'&&config.value.cadence.return_to_new_mode===null,'P05a provenance/configuration drift');
assert(['age_pauses_while_quoted','age_restarts_on_return','complete_policy_approved','cadence_enforcement_enabled','transition_date_allowance_approved','earlier_call_credit_approved','initial_response_treatment_approved'].every(k=>p05a[k]===false),'P05a age rule cannot approve timing/credit/enforcement');
for(const row of p05a.cases)assert(row.expected_schedule_day===1+(Date.parse(nyDate(row.returned_at))-Date.parse(nyDate(row.received_at)))/86400000,'P05a original New York age drift: '+row.id);
for(const row of p05a.subsequent_full_working_dates){assert(row.schedule_day===1+(Date.parse(row.date)-Date.parse('2026-10-02'))/86400000&&row.required_calls===(row.schedule_day<=5?2:1)&&row.required_sms===(row.schedule_day<=3||(row.schedule_day>=6&&(row.schedule_day-6)%3===0)?1:0),'P05a subsequent full-day schedule drift: '+row.date);}
assert(p05a.repeated_cycles.original_received_date_preserved===true&&p05a.repeated_cycles.restarted_day_one===false&&p05a.missing_anchor.guessed===false&&p05a.missing_anchor.policy_available===false,'P05a anchor/history safeguards drift');
const p05b=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p05b-priority-three.json'),'utf8'));
assert(p05b.synthetic===true&&p05b.decision_revision==='P05b-v1'&&p05b.approval_ref==='owner-session-2026-10-03-P05b'&&p05b.priority==='3'&&p05b.meaning==='Rep discretion'&&p05b.routine_calls_required===0&&p05b.routine_sms_required===0&&p05b.display_label==='No routine cadence','P05b provenance/cadence drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','callback_policy_approved','goal_credit_approved','unknown_priority_policy_approved','reentry_policy_approved'].every(k=>p05b[k]===false),'P05b approval cannot authorize remaining policy/enforcement');
for(const id of ['new_to_three','quoted_to_three']){const row=p05b.cases.find(x=>x.id===id);assert(row?.accepted_priority===true&&row.prior_cadence_ended===true&&row.outstanding_routine_requirements==='superseded'&&row.fulfillment_created===false&&row.historical_miss_retained===true&&row.contact_history_retained===true&&row.lead_remains_open===true&&row.visible===true,'P05b supersession/history/visibility drift: '+id);}
const three=id=>p05b.cases.find(x=>x.id===id);
assert(three('already_three')?.new_routine_requirements_created===0&&three('already_three')?.visible===true&&three('closed_to_three')?.implicit_reopen===false&&three('closed_to_three')?.lead_remains_closed===true&&three('unvouched_three')?.transition_authorized===false&&three('unvouched_three')?.previous_requirements_superseded===false,'P05b closure/provenance protection drift');
const p05c=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p05c-unmapped-priority.json'),'utf8'));
assert(p05c.synthetic===true&&p05c.decision_revision==='P05c-v1'&&p05c.approval_ref==='owner-session-2026-10-03-P05c'&&p05c.meaning_inferred===false&&p05c.display_raw_code===true&&p05c.display_label==='No policy configured'&&p05c.routine_calls_required===0&&p05c.routine_sms_required===0,'P05c provenance/meaning/cadence drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','missing_or_uncertain_evidence_policy_approved','reentry_policy_approved','goal_credit_approved'].every(k=>p05c[k]===false),'P05c cannot approve missing evidence/remaining policies/enforcement');
for(const id of ['new_to_unmapped','quoted_to_unmapped']){const row=p05c.cases.find(x=>x.id===id);assert(row?.accepted_priority===true&&row.prior_routine_requirements_superseded===true&&row.fulfillment_created===false&&row.historical_misses_retained===true&&row.contact_history_retained===true&&row.lead_remains_open===true&&row.visible===true&&row.owner_review_visible===true,'P05c supersession/history/visibility drift: '+id);}
const unmapped=id=>p05c.cases.find(x=>x.id===id);
assert(unmapped('initial_unmapped')?.routine_requirements_created===0&&unmapped('initial_unmapped')?.owner_review_visible===true&&unmapped('closed_to_unmapped')?.implicit_reopen===false&&unmapped('closed_to_unmapped')?.lead_remains_closed===true&&unmapped('unvouched_unmapped')?.transition_authorized===false&&unmapped('unvouched_unmapped')?.prior_routine_requirements_superseded===false,'P05c initial/closure/provenance guards drift');
const priorityMap=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p05d-priority-map-manager-read.json'),'utf8'));
assert(priorityMap.synthetic===true&&priorityMap.decision_revision==='P05d-v1+P09a-v1'&&JSON.stringify(Object.keys(priorityMap.known_priority_map))==='["0","1","3","5","7","8"]','Known priority map completeness drift');
assert(priorityMap.known_priority_map['5']==='booked_in_granot_stop_cadence'&&priorityMap.known_priority_map['7']==='crm_bad_unusable_stop_cadence'&&priorityMap.known_priority_map['8']==='crm_dead_opportunity_stop_cadence','Known status meanings drift');
assert(priorityMap.accepted_sources.length===3&&priorityMap.source_specific_cadence_rules===false&&priorityMap.raw_payload_is_transition_authority===false&&priorityMap.priority_five.routine_cadence_stopped===true&&priorityMap.official_booking.routine_cadence_stopped===true&&priorityMap.priority_five.official_booking_created===false&&priorityMap.priority_five.official_booked_flag_inferred===false&&Object.values(priorityMap.seven_eight).every(x=>x===false),'Priority source/status authority drift');
assert(priorityMap.transition.historical_misses_preserved===true&&priorityMap.transition.cancellation_is_fulfillment===false&&priorityMap.transition.implicit_reopen===false&&priorityMap.manager.team_reads===true&&priorityMap.manager.individual_rep_filter===true&&priorityMap.manager.trusted_capability_required===true&&priorityMap.rep.current_assignment_only===true,'Priority history/Manager scope drift');
assert(['policy_edit_approved','reassignment_approved','date_command_approved','unassigned_scope_approved','daily_operations_approved'].every(k=>priorityMap.manager[k]===false)&&priorityMap.complete_policy_approved===false&&priorityMap.cadence_enforcement_enabled===false&&priorityMap.last_verified_policy_retention_approved===false,'Priority mapping/Manager reads cannot approve other gates');
const p06a=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p06a-bounded-catchup.json'),'utf8'));
assert(p06a.synthetic===true&&p06a.decision_revision==='P06a-v1'&&p06a.approval_ref==='owner-session-2026-10-03-P06a'&&p06a.catchup_per_channel_maximum===1&&p06a.oldest_deadline_preserved_until_cleared===true&&p06a.historical_misses_erased===false,'P06a provenance/bounded-history drift');
assert(p06a.complete_policy_approved===false&&p06a.cadence_enforcement_enabled===false&&p06a.qualifying_activity_rule_approved===false,'P06a recovery cannot approve evidence/enforcement');
const recovery=id=>p06a.cases.find(x=>x.id===id),catchup=recovery('four_old_two_today');
assert(catchup.call_catchup_before===1&&catchup.call_catchup_after===0&&catchup.ordinary_calls_remaining===catchup.ordinary_calls_today-catchup.qualifying_current_calls&&catchup.historical_missed_calls_after===catchup.historical_missed_calls&&catchup.goal_credit_from_clearing_marker===0&&recovery('call_cannot_clear_sms').sms_catchup_after===1,'P06a quota/history/channel independence drift');
for(const id of ['scheduled_sms_day','unscheduled_sms_day'])assert(recovery(id).sms_catchup_after===0&&recovery(id).next_fixed_sms_day===9&&recovery(id).sequence_shifted===false,'P06a fixed SMS sequence drift');
const p07a=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p07a-call-credit.json'),'utf8'));
assert(p07a.synthetic===true&&p07a.decision_revision==='P07a-v1'&&p07a.approval_ref==='owner-session-2026-10-03-P07a','P07a approval provenance drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','provider_status_mapping_proven','helping_rep_rule_approved','transfer_rule_approved'].every(k=>p07a[k]===false),'P07a cannot approve provider/attribution/enforcement gates');
for(const row of p07a.cases.filter(x=>x.direction==='outbound'))assert(row.actual_attempt_verified===true&&row.goal_credit===1&&row.cadence_credit===(row.spacing_eligible?1:0),'P07a attempt/goal/cadence spacing drift: '+row.id);
const inboundCredit=p07a.cases.find(x=>x.id==='answered_inbound');
assert(inboundCredit.answered_by_assigned_rep===true&&inboundCredit.goal_credit===0&&inboundCredit.cadence_credit===1&&inboundCredit.clears_call_catchup===true&&inboundCredit.ordinary_calls_remaining===1&&inboundCredit.clears_sms_catchup===false,'P07a inbound coverage/goal/channel drift');
for(const id of ['missed_inbound','api_error_without_attempt','button_press_only','duplicate_receipt','internal_call','in_progress']){const row=p07a.cases.find(x=>x.id===id);assert(row?.goal_credit===0&&row?.cadence_credit===0,'P07a excluded evidence drift: '+id);}
const p07b=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p07b-outbound-attribution.json'),'utf8'));
assert(p07b.synthetic===true&&p07b.decision_revision==='P07b-v1'&&p07b.approval_ref==='owner-session-2026-10-03-P07b','P07b provenance drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','helping_rep_inbound_approved','helping_rep_sms_approved','assignment_changed','rep_access_expanded'].every(k=>p07b[k]===false),'P07b cannot approve inbound/SMS/access/enforcement');
for(const row of p07b.cases){if(row.pending_verification)assert(row.eligible_cadence_credit===0&&Object.keys(row.goal_credits).length===0,'P07b ambiguity credit drift');else assert(row.eligible_cadence_credit===1&&row.goal_credits[row.initiating_rep]===1&&Object.values(row.goal_credits).reduce((n,x)=>n+x,0)===1,'P07b initiator-only/lead single-credit drift: '+row.id);}
assert(p07b.cases.find(x=>x.id==='bob_helps_alice')?.goal_credits.alice===0&&p07b.cases.find(x=>x.id==='alice_transfers_to_bob')?.goal_credits.bob===0&&p07b.cases.filter(x=>x.clears_call_catchup).every(x=>x.extra_goal_credit_for_catchup===0),'P07b assigned-owner/transfer/catchup goal drift');
const p07c=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p07c-inbound-helping.json'),'utf8'));
assert(p07c.synthetic===true&&p07c.decision_revision==='P07c-v1'&&p07c.approval_ref==='owner-session-2026-10-03-P07c','P07c provenance drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','provider_evidence_proven','helping_rep_sms_approved','assignment_changed','rep_access_expanded'].every(k=>p07c[k]===false),'P07c cannot approve SMS/provider/access/enforcement');
for(const row of p07c.cases)assert(Object.values(row.goal_credits).every(x=>x===0)&&row.applicable_cadence_credit===(['missed_inbound','ambiguous_rep','ambiguous_lead'].includes(row.id)?0:1),'P07c inbound goal/transfer/ambiguity drift: '+row.id);
const inboundHelp=p07c.cases.find(x=>x.id==='bob_answers_alices_lead');
assert(inboundHelp.reviewed_sales_reps===true&&inboundHelp.unique_lead===true&&inboundHelp.assigned_rep==='alice'&&inboundHelp.call_catchup_cleared===true&&inboundHelp.sms_catchup_cleared===false&&inboundHelp.ordinary_calls_remaining===1,'P07c catchup/channel/assignment drift');
const p07d=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p07d-sms-status-corrections.json'),'utf8'));
assert(p07d.synthetic===true&&p07d.decision_revision==='P07d-v1'&&p07d.approval_ref==='owner-session-2026-10-03-P07d','P07d provenance drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','provider_status_mapping_proven','sender_origin_eligibility_approved','calls_changed','outbound_goal_changed','fixed_sms_sequence_shifted','prior_cancelled_work_revived'].every(k=>p07d[k]===false)&&p07d.status_history_preserved===true,'P07d scope/channel/history drift');
const smsStatus=id=>p07d.cases.find(x=>x.id===id);
for(const id of ['sent_delivery_unknown','delivered','sent_then_delivered'])assert(smsStatus(id)?.expected_credit===1&&smsStatus(id)?.logical_messages===1,'P07d sent/delivered single-credit drift');
for(const id of ['queued','pending','send_failure','api_accepted_only'])assert(smsStatus(id)?.expected_credit===0,'P07d pending/failure/no-proof drift');
assert(smsStatus('sent_later_failed').expected_credit===0&&smsStatus('sent_later_failed').requirement_remaining===1&&smsStatus('sent_later_failed').recompute_sms_catchup===true&&smsStatus('failed_with_successful_replacement').failed_message_credit===0&&smsStatus('failed_with_successful_replacement').expected_credit===1&&smsStatus('failed_with_successful_replacement').requirement_remaining===0,'P07d failure/replacement recomputation drift');
const p07e=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p07e-sms-sender-origin.json'),'utf8'));
assert(p07e.synthetic===true&&p07e.decision_revision==='P07e-v1'&&p07e.approval_ref==='owner-session-2026-10-03-P07e','P07e provenance drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','provider_origin_identity_proven','assignment_changed','rep_access_expanded','fixed_sms_sequence_shifted'].every(k=>p07e[k]===false)&&p07e.all_outbound_goal_credits===0&&p07e.one_logical_message_max_cadence_credit===1,'P07e proof/access/channel scope drift');
const smsOrigin=id=>p07e.cases.find(x=>x.id===id);
for(const id of ['typed_assigned_rep','typed_helping_rep','manually_sent_template'])assert(smsOrigin(id)?.deliberately_initiated===true&&smsOrigin(id)?.reviewed_sender===true&&smsOrigin(id)?.expected_sms_credit===1,'P07e deliberate sender eligibility drift');
for(const id of ['automatic_confirmation','unattended_automation','inbound_reply','ambiguous_shared_sender'])assert(smsOrigin(id)?.expected_sms_credit===0,'P07e excluded origin/ambiguity drift');
assert(smsOrigin('typed_helping_rep').sender==='bob'&&smsOrigin('typed_helping_rep').assigned_rep==='alice'&&smsOrigin('typed_helping_rep').clears_sms_catchup===true&&smsOrigin('ambiguous_shared_sender').pending_verification===true,'P07e helper/pending status drift');
const p07f=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p07f-late-evidence.json'),'utf8'));
assert(p07f.synthetic===true&&p07f.decision_revision==='P07f-v1'&&p07f.approval_ref==='owner-session-2026-10-03-P07f','P07f provenance drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','provider_timestamps_proven','receipt_day_duplicate_credit','current_lifecycle_rewound','fixed_sms_sequence_shifted'].every(k=>p07f[k]===false)&&p07f.historical_policy_identity_used===true,'P07f scope/history drift');
for(const row of p07f.cases.filter(x=>x.contact_at))assert(row.credited_date===nyDate(row.contact_at)&&nyDate(row.captured_at)!==row.credited_date&&row.capture_date_goal_credit===0,'P07f actual-date/no-capture-credit drift');
const correction=id=>p07f.cases.find(x=>x.id===id),identityCorrection=correction('corrected_initiator');
assert(correction('on_time_contact_captured_next_day').apparent_miss_removed===true&&Date.parse(correction('genuinely_late_contact').contact_at)>Date.parse(correction('genuinely_late_contact').deadline_at)&&correction('genuinely_late_contact').genuine_deadline_miss_retained===true,'P07f apparent/genuine miss drift');
assert(Object.values(identityCorrection.before).reduce((n,x)=>n+x,0)===1&&Object.values(identityCorrection.after).reduce((n,x)=>n+x,0)===1&&identityCorrection.after.alice===0&&identityCorrection.after.bob===1&&identityCorrection.audit_retained===true&&correction('ambiguous_timestamp').guessed===false&&correction('ambiguous_timestamp').credit_pending===true,'P07f correction/audit/ambiguity drift');
for(const required of ['SPECIFICATION.md','CONTRACTS.md','DECISIONS.md','SPRINT.md','DATA-READINESS.md','VALIDATION.md','CODE-MAP.md','workspace/AGENTS.md','workspace/LEDGER.md','workspace/HANDOFF-TEMPLATE.md'])assert(existsSync(resolve(root,required)),`Missing entry: ${required}`);
const p06b=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p06b-advisory-cooldown.json'),'utf8'));
assert(p06b.synthetic===true&&p06b.decision_revision==='P06b-v1'&&p06b.approval_ref==='owner-session-2026-10-03-P06b','P06b provenance drift');
assert(p06b.complete_policy_approved===false&&p06b.cadence_enforcement_enabled===false&&p06b.restriction_deadline_treatment_approved===false&&p06b.callback_mechanics_approved===false&&p06b.provider_outcome_mapping_proven===false,'P06b historical scope drift');
assert(p06b.warning_threshold===3&&p06b.rolling_hours===24&&p06b.minimum_cadence_start_spacing_minutes===60,'P06b defaults drift');
assert(p06b.cases[0].warning===true&&p06b.cases[0].hard_pause===false&&p06b.cases[0].routine_work_remains_due===true&&p06b.cases[1].goal_credit===1&&p06b.cases[1].cadence_credit===0&&p06b.cases[1].anchor_after==='10:10'&&p06b.cases[2].cadence_credit===1&&p06b.cases[3].ready_to_call===false,'P06b warning/credit/restriction drift');
const p06c=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p06c-restriction-waiver-resume.json'),'utf8'));
assert(p06c.synthetic===true&&p06c.decision_revision==='P06c-v1'&&p06c.approval_ref==='owner-session-2026-10-03-P06c','P06c provenance drift');
assert(p06c.complete_policy_approved===false&&p06c.cadence_enforcement_enabled===false&&p06c.callback_mechanics_approved===false&&p06c.unassigned_treatment_approved===false,'P06c scope drift');
assert(p06c.cases[0].routine_resumes==='Friday'&&p06c.cases[0].new_blocked_interval_misses===0&&p06c.cases[0].unfinished_blocked_requirements_waived===true&&p06c.cases[0].sms_affected===false&&p06c.cases[0].original_age_retained===true&&p06c.cases[0].fixed_sms_sequence_shifted===false&&p06c.cases[1].routine_resumes==='Saturday'&&p06c.cases[1].permitted_call_after_release===true,'P06c release/calendar/channel drift');
assert(p06c.cases[2].prior_genuine_misses_after===2&&p06c.cases[2].catchup_while_restricted==='blocked'&&p06c.cases[2].new_blocked_interval_catchup===0&&p06c.cases[3].remaining_working_minutes_at_release===15&&p06c.cases[3].clock_resumes_when_permitted===true,'P06c history/initial-response drift');
const p06d=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p06d-assignment-responsibility.json'),'utf8'));
assert(p06d.synthetic===true&&p06d.decision_revision==='P06d-v1'&&p06d.approval_ref==='owner-session-2026-10-03-P06d','P06d provenance drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','callback_mechanics_approved','manager_permissions_changed','assignment_evidence_proven'].every(k=>p06d[k]===false),'P06d scope drift');
assert(p06d.cases[0].deadline_after===p06d.cases[0].deadline_before&&p06d.cases[0].historical_miss_responsibility==='Unassigned'&&p06d.cases[0].fresh_response_clock===false&&p06d.cases[1].ordinary_call_credit===1&&p06d.cases[1].call_catchup_after===0&&p06d.cases[1].genuine_1030_miss_retained===true,'P06d inherited deadline/history drift');
assert(p06d.cases[2].prior_miss_responsibility==='alice'&&p06d.cases[2].next_miss_responsibility==='bob'&&['age_reset','deadlines_reset','completed_contacts_reset','spacing_anchor_reset','catchup_reset','prior_goal_credit_moved'].every(k=>p06d.cases[2][k]===false),'P06d reassignment drift');
const p06e=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p06e-explicit-callback.json'),'utf8'));
assert(p06e.synthetic===true&&p06e.decision_revision==='P06e-v1'&&p06e.approval_ref==='owner-session-2026-10-03-P06e','P06e provenance drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','provider_proof','legacy_callback_migration_approved','ai_suggestions_enabled','llm_analysis_in_outreach'].every(k=>p06e[k]===false)&&p06e.mcp_retained===true,'P06e/D01 scope drift');
assert(p06e.callback_window_elapsed_minutes===15&&p06e.cases[0].routine_calls_suspended===true&&p06e.cases[0].call_catchup_prompts_suspended===true&&p06e.cases[0].sms_suspended===false&&p06e.cases[0].prior_misses_erased===false&&p06e.cases[0].ordinary_calls_on_callback_date===0,'P06e quota/channel/window drift');
assert(p06e.cases[1].callback_fulfilled===true&&p06e.cases[1].answered===false&&p06e.cases[1].goal_credit===1&&p06e.cases[2].callback_fulfilled===true&&p06e.cases[2].goal_credit===0&&p06e.cases[3].callback_fulfilled===false&&p06e.cases[4].genuine_callback_miss_retained===true&&p06e.cases[5].actual_restrictions_override===true&&p06e.cases[6].pending_callback_carried===true,'P06e evidence/history/restriction drift');
const p08a=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p08a-roster-goals.json'),'utf8'));
assert(p08a.synthetic===true&&p08a.decision_revision==='P08a-v1'&&p08a.approval_ref==='owner-session-2026-10-03-P08a','P08a provenance drift');
assert(p08a.complete_policy_approved===false&&p08a.cadence_enforcement_enabled===false&&p08a.manager_goal_edit_approved===false&&p08a.default_scheduled_day_goal===100,'P08a scope/default drift');
assert(p08a.rows.reduce((n,r)=>n+r.goal,0)===p08a.expected_team_goal&&p08a.expected_team_goal===350&&p08a.rows.reduce((n,r)=>n+r.actual,0)===p08a.expected_actual&&p08a.rows.filter(r=>r.goal>0).length===p08a.expected_goal_enabled_reps&&p08a.rows.filter(r=>r.goal>0&&r.actual>=r.goal).length===p08a.expected_reps_at_goal,'P08a aggregate denominator drift');
assert(p08a.rows.some(r=>r.goal===100&&r.actual===0)&&p08a.rows[4].label==='No goal today'&&p08a.rows[4].goal_achieved===false&&p08a.absence_pauses_lead_cadence===false&&p08a.absence_workload_flagged===true&&p08a.changes_prospective===true&&p08a.historical_correction_requires_audit===true&&p08a.automatic_partial_day_proration===false,'P08a absence/history drift');
const p09b=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p09b-manager-permissions.json'),'utf8'));
assert(p09b.synthetic===true&&p09b.decision_revision==='P09b-v1'&&p09b.approval_ref==='owner-session-2026-10-03-P09b','P09b provenance drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','runtime_role_binding_proven','generic_admin_advanced_authority_approved','rep_scope_expanded','daily_operations_metrics_changed'].every(k=>p09b[k]===false),'P09b scope drift');
assert(['team_reads','individual_rep_filter','unassigned_reads','assign_reassign','quoted_date_commands','explicit_callback_commands','prospective_absence_override','prospective_partial_day_override','daily_operations_access'].every(k=>p09b.manager_allowed.includes(k)),'P09b allowed permission drift');
assert(['base_goal_edits','roster_edits','work_schedule_edits','cadence_policy_edits','lift_contact_restriction','override_authoritative_closure','historical_responsibility_goal_setting_edits','activation','migration','rollback'].every(k=>p09b.owner_only.includes(k))&&p09b.manager_and_admin_nearly_identical_desk===true&&p09b.advanced_options_capability_gated===true,'P09b/V02 advanced/visual drift');
const p09c=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p09c-admin-owner-role.json'),'utf8'));
assert(p09c.synthetic===true&&p09c.decision_revision==='P09c-v1'&&p09c.approval_ref==='owner-session-2026-10-03-P09c','P09c provenance drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','runtime_binding_proven','separate_intermediate_admin_tier','generic_admin_automatically_elevated','platform_wide_role_rename'].every(k=>p09c[k]===false)&&p09c.admin_means_owner_in_feature===true&&p09c.explicit_trusted_account_binding_required===true&&p09c.manager_permissions==='P09b'&&p09c.rep_scope==='current_assignment_only','P09c scope/role drift');
const p05e=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p05e-intake-priority-uncertainty.json'),'utf8'));
assert(p05e.synthetic===true&&p05e.decision_revision==='P05e-v1'&&p05e.approval_ref==='owner-session-2026-10-03-P05e','P05e provenance drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','source_timestamp_proof','granot_priority_fabricated','historical_import_treated_as_fresh','closure_overridden'].every(k=>p05e[k]===false),'P05e scope drift');
assert(p05e.cases.slice(0,4).every(r=>r.fresh_eligible===true&&r.cadence==='new'&&r.policy_origin==='intake_default'&&r.accepted_priority===null)&&p05e.cases[4].cadence===null&&p05e.cases[4].label==='Priority needs review','P05e intake drift');
assert(p05e.cases.slice(5,7).every(r=>r.cadence===r.last_verified&&r.timeline_reset===false&&r.uncertainty_visible===true)&&p05e.cases[7].label==='No routine cadence'&&p05e.cases[8].label==='No policy configured','P05e uncertainty/accepted mapping drift');
const p05f=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p05f-partial-day-reentry.json'),'utf8'));
assert(p05f.synthetic===true&&p05f.decision_revision==='P05f-v1'&&p05f.approval_ref==='owner-session-2026-10-03-P05f','P05f provenance drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','historical_policy_evidence_proven','initial_clock_restarted','superseded_catchup_revived','earlier_noon_miss_fabricated'].every(k=>p05f[k]===false)&&p05f.duplicate_goal_credit===0,'P05f scope/history drift');
assert(p05f.cases[0].call_remaining===1&&p05f.cases[0].sms_required===0&&p05f.cases[0].due_minute===1200&&p05f.cases[1].call_remaining===1&&p05f.cases[1].sms_required===1&&p05f.cases[2].return_minute===1170&&p05f.cases[2].call_remaining===1&&p05f.cases[2].sms_required===1&&p05f.cases[3].call_remaining===0&&p05f.cases[3].sms_required===0&&p05f.cases[4].call_remaining===1&&p05f.cases[5].sms_remaining===0,'P05f quota/time/credit drift');
const p05g=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p05g-move-date-review.json'),'utf8'));
assert(p05g.synthetic===true&&p05g.decision_revision==='P05g-v1'&&p05g.approval_ref==='owner-session-2026-10-03-P05g','P05g provenance drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','move_fact_proof','canonical_move_source_precedence_changed','closure_authority_changed'].every(k=>p05g[k]===false),'P05g scope drift');
assert(p05g.cases[0].cadence==='new'&&p05g.cases[0].auto_closed===false&&p05g.cases[0].priority_changed===false&&p05g.cases[1].cadence==='quoted'&&p05g.cases[1].auto_closed===false&&p05g.cases[2].cadence_continues===true&&p05g.cases[2].label==='Move date unknown'&&p05g.cases[3].age_reset===false&&p05g.cases[3].contact_history_erased===false,'P05g cadence/history drift');
const p07g=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p07g-event-time-windows.json'),'utf8'));
assert(p07g.synthetic===true&&p07g.decision_revision==='P07g-v1'&&p07g.approval_ref==='owner-session-2026-10-03-P07g','P07g provenance drift');
assert(p07g.complete_policy_approved===false&&p07g.cadence_enforcement_enabled===false&&p07g.provider_timestamp_handling_proof===false&&p07g.goal_day_basis==='outbound_start_new_york_date'&&p07g.inbound_credit_basis==='reviewed_rep_answer_handling'&&p07g.sms_credit_basis==='confirmed_sent_time','P07g scope/time drift');
assert(p07g.cases[0].routine_credit===1&&p07g.cases[1].goal_date===nyDate(p07g.cases[1].start_at)&&p07g.cases[1].goal_credit===1&&p07g.cases[1].next_date_routine_credit===0&&p07g.cases[2].credit_time===p07g.cases[2].sent_local&&p07g.cases[3].cadence_credit===0&&p07g.cases[3].anchor_reset===false,'P07g boundary/spacing drift');
assert(p07g.cases[4].initial_response_satisfied===true&&p07g.cases[4].maximum_arrival_call_credit===1&&p07g.cases[4].goal_credit===0&&p07g.cases[5].existing_channel_catchup_cleared===true&&p07g.cases[5].next_date_routine_credit===0&&p07g.cases[6].history_retained===true&&p07g.cases[6].goal_credit===0&&p07g.cases[6].cadence_credit===0,'P07g origin/catchup/restriction drift');
const p10a=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p10a-prospective-cutover.json'),'utf8'));
assert(p10a.synthetic===true&&p10a.decision_revision==='P10a-v1'&&p10a.approval_ref==='owner-session-2026-10-03-P10a','P10a provenance drift');
assert(['complete_policy_approved','cadence_enforcement_enabled','live_migration_authorized','retry_reprices_boundary','old_lead_initial_clock_restarted','ai_plans_migrated','automatic_launch_goal_proration'].every(k=>p10a[k]===false)&&p10a.migration_paused===true,'P10a activation/scope drift');
assert(p10a.new_pre_activation_misses===0&&p10a.new_pre_activation_catchup===0&&p10a.fixed_cohort_boundary===true&&p10a.original_age_retained===true&&p10a.missing_age_review===true&&p10a.past_due_legacy_callback==='review_without_new_policy_penalty'&&p10a.active_restrictions_preserved===true&&p10a.pending_verified_human_callbacks_preserved===true,'P10a history/migration drift');
assert(p10a.cases[0].remaining_calls===1&&p10a.cases[0].due_minute===1200&&p10a.cases[1].remaining_calls===0&&p10a.cases[2].remaining_calls===1&&p10a.cases[3].remaining_calls===0&&p10a.cases[4].first_date==='next_working_date'&&p10a.cases[5].selected_date_preserved===true,'P10a partial-day/schedule drift');
const p05h=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p05h-lead-eligibility.json'),'utf8'));
assert(p05h.synthetic===true&&p05h.decision_revision==='P05h-v1'&&p05h.approval_ref==='owner-session-2026-10-03-P05h','P05h provenance drift');
assert(p05h.complete_policy_approved===false&&p05h.cadence_enforcement_enabled===false&&p05h.runtime_eligibility_proven===false,'P05h scope drift');
assert(p05h.cases[0].routine_eligible===true&&p05h.cases[1].separate_cadence===false&&p05h.cases[1].duplicate_credit===0&&p05h.cases.slice(2,5).every(r=>r.routine_eligible===false)&&p05h.cases[5].routine_eligible===true&&p05h.cases[5].reporting_changed===false&&p05h.cases[6].review_required===true&&p05h.cases[6].authorized_reopening_required===true&&p05h.cases[6].auto_reopened===false,'P05h eligibility/closure drift');
assert(p05h.cases[7].flag_alone_excludes===false&&p05h.cases[7].flag_alone_merges===false&&p05h.cases[8].automatic_cadence===false&&p05h.cases[9].guessed_cadence===false&&p05h.cases[9].guessed_goal_credit===0&&p05h.cases[10].auto_merge===false&&p05h.cases[10].multiplied_contact_credit===false&&p05h.cases[10].ambiguous_association==='pending','P05h identity/credit drift');
const p06f=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p06f-precedence-collisions.json'),'utf8'));
assert(p06f.synthetic===true&&p06f.decision_revision==='P06f-v1'&&p06f.approval_ref==='owner-session-2026-10-03-P06f','P06f provenance drift');
assert(p06f.complete_policy_approved===false&&p06f.cadence_enforcement_enabled===false&&p06f.runtime_precedence_proven===false&&p06f.daily_goal_overrides_precedence===false&&JSON.stringify(p06f.precedence)==='["authoritative_closure","channel_restriction","explicit_human_schedule","accepted_priority_routine_cadence"]','P06f scope/precedence drift');
assert(p06f.maximum_active_human_plans_per_lead===1&&p06f.replacement_requires_explicit_audited_command===true&&p06f.cases[0].auto_reopened===false&&p06f.cases[0].pending_callback_cancelled===true&&p06f.cases[1].restriction_caused_callback_miss===false&&p06f.cases[1].prior_genuine_misses_retained===true&&p06f.cases[2].pending_human_callback_preserved===true&&p06f.cases[3].pending_human_callback_preserved===true&&p06f.cases[4].ordinary_credit_maximum===1&&p06f.cases[4].goal_credit_maximum===1&&p06f.cases[5].automatic_callback_created===false,'P06f schedule/history/credit drift');
const finalApproval=JSON.parse(readFileSync(resolve(root,'POLICY-APPROVAL.json'),'utf8'));
assert(finalApproval.complete_business_policy_approved===true&&finalApproval.approval_ref==='owner-session-2026-10-03-FINAL-01'&&finalApproval.policy_revision==='final-policy-2026-10-03-v1'&&finalApproval.manual_start_design_approved===true,'Final business approval provenance drift');
assert(['runtime_acceptance_proven','provider_proofs_complete','production_readiness_proven','live_activation_performed','live_migration_performed','bootstrap_controls_enabled','intake_admission_enabled','automation_scheduled'].every(k=>finalApproval[k]===false)&&finalApproval.migration_paused===true,'Policy approval must not claim runtime or live execution');
assert(finalApproval.next_requested_run_date==='2026-10-04'&&finalApproval.next_requested_run_time===null&&finalApproval.timezone==='America/New_York','Requested next-run date/time provenance drift');
assert(config.value.transition.intake_admission_enabled===false&&config.value.transition.intake_admission_at===null&&config.value.transition.intake_admission_watermark===null,'Bootstrap intake gate must be disabled with no implicit boundary');
const p10b=JSON.parse(readFileSync(resolve(root,'contracts/fixtures/p10b-manual-start.json'),'utf8'));
assert(p10b.synthetic===true&&p10b.decision_revision==='P10b-v1'&&p10b.approval_ref==='owner-session-2026-10-03-P10b'&&p10b.launch_design_approved===true&&p10b.complete_business_policy_approved===true,'P10b adoption provenance drift');
assert(['cadence_enforcement_enabled','intake_admission_enabled','live_migration_performed','original_age_reset','retry_expands_scope','historical_records_treated_as_fresh','unselected_existing_auto_enrolled','models_transcription_suggestions_used'].every(k=>p10b[k]===false)&&p10b.new_pre_activation_debt===0&&p10b.report_writes===0,'P10b execution/identity/history drift');
assert(p10b.approximate_initial_leads===20&&JSON.stringify(p10b.initial_rep_count_range)==='[2,3]'&&p10b.seed_reuses_canonical_leads===true&&p10b.selected_id_scope_frozen===true&&p10b.fixed_cohort_boundary===true&&p10b.shadow_working_dates===1&&p10b.post_activation_verification_working_dates===1&&p10b.preferred_activation_new_york_minute===480&&p10b.partial_goal_coverage_label_required===true,'P10b pilot/scope/verification drift');
for(const name of ['OWNER-REQUEST.md','FINAL-POLICY-REVIEW.md','MANUAL-START.md','END-TO-END-RUN.md','POLICY-APPROVAL.json'])assert(existsSync(resolve(root,name)), 'Missing finalized policy artifact: '+name);
assert(readFileSync(resolve(root,'MANUAL-START.md'),'utf8').includes('full approved eligible New/Quoted outbound totals')&&readFileSync(resolve(root,'END-TO-END-RUN.md'),'utf8').includes('morning-only test does not establish'),'Manual launch must retain full goal scope and working-date verification');
if(failures.length){for(const f of failures)process.stderr.write(f+'\n');process.exitCode=1;}
else process.stdout.write(JSON.stringify({status:'passed',contract_version:manifest.contract_version,release_files:Object.keys(manifest.files).length,operative_links:linkCount,scope:'packet integrity/portability/synthetic examples only; runtime acceptance pending'})+'\n');
