// THROWAWAY, synthetic in-memory model: one shared duty without changing receiver_agent.
export const ny = at => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)).map(p=>[p.type,p.value]));
  return {day:`${parts.year}-${parts.month}-${parts.day}`,minute:Number(parts.hour)*60+Number(parts.minute)};
};
export function initial() {
  return {at:'2026-10-14T14:00:00Z',closedDates:[],actors:{A:{role:'rep',eligible:true,providerReviewed:true,goalOn:true},B:{role:'rep',eligible:true,providerReviewed:true,goalOn:false},Owner:{role:'owner',eligible:true},Manager:{role:'manager',eligible:true},Inactive:{role:'rep',eligible:false},Admin:{role:'admin',eligible:false}},leads:[
    {id:'P1',name:'Synthetic Form Lead',model:'FormLead',receiver:'B',priority:'9',status:'open',entered:'2026-10-14T12:00:00Z'},
    {id:'P2',name:'Synthetic Call Lead',model:'CallLead',receiver:null,priority:'9',status:'open',entered:'2026-10-14T12:00:00Z'},
    {id:'N1',name:'Private assigned New',model:'FormLead',receiver:'A',priority:'0',status:'open'},
    {id:'Q1',name:'Private assigned Quoted',model:'FormLead',receiver:'B',priority:'1',status:'open'},
    {id:'O1',name:'Private assigned Other',model:'CallLead',receiver:'A',priority:'2',status:'open'},
    {id:'C1',name:'Booked Pool held',model:'FormLead',receiver:'B',priority:'9',status:'booked'}
  ],events:[],claims:{},log:[]};
}
const eligible = (s,actor) => !!s.actors[actor]?.eligible;
const pool = lead => lead.priority==='9' && lead.status==='open';
export const visible = (s,actor,filter) => eligible(s,actor) ? s.leads.filter(l=>{
  if(filter==='Pool') return pool(l);
  if(l.priority==='9'||l.status!=='open')return false;
  if(!['owner','manager'].includes(s.actors[actor].role)&&l.receiver!==actor)return false;
  return filter==='New'?l.priority==='0':filter==='Quoted'?l.priority==='1':!['0','1'].includes(l.priority);
}) : [];
function qualifies(s,lead,event,day) {
  const clock=ny(event.at),entry=ny(lead.entered);
  return event.lead===lead.id && clock.day===day && clock.minute>=480 && clock.minute<1200 && !s.closedDates.includes(day) &&
    event.confirmed && event.external && event.uniqueAssociation && eligible(s,event.caller) && s.actors[event.caller]?.providerReviewed &&
    (event.direction==='outbound'||event.direction==='answered_inbound') && event.at>=lead.entered &&
    !(entry.day===day&&entry.minute>1170);
}
export function duty(s,lead) {
  const {day}=ny(s.at),entry=ny(lead.entered);
  const qualifying=s.events.filter(e=>qualifies(s,lead,e,day)).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
  const state=!pool(lead)?'ineligible':s.closedDates.includes(day)?'waived':entry.day===day&&entry.minute>1170?'next working day':qualifying.length?'complete':'due';
  return {key:`${lead.model}:${lead.id}:${day}:pool_call`,state,required:state==='due'||state==='complete'?1:0,completion:qualifying[0]?.id??null,actualCaller:qualifying[0]?.caller??null,assignedRep:lead.receiver,qualifyingCalls:qualifying.length};
}
export function metrics(s,actor) {
  const assigned=s.leads.filter(l=>pool(l)&&l.receiver===actor),day=ny(s.at).day;
  return {assignedPool:assigned.length,assignedCompleted:assigned.filter(l=>duty(s,l).state==='complete').length,
    actualOutbound:s.events.filter(e=>e.caller===actor&&e.direction==='outbound'&&e.confirmed&&e.external&&ny(e.at).day===day).length,
    individualGoalOn:s.actors[actor]?.goalOn??false};
}
export function dispatch(previous,action) {
  const s=structuredClone(previous),l=s.leads.find(v=>v.id===action.lead);
  if(action.type==='clock')s.at=action.at;
  else if(action.type==='closedDate')s.closedDates=[...new Set([...s.closedDates,ny(s.at).day])];
  else if(action.type==='transition'&&l) {l.priority=action.priority;l.status=action.status??'open';if(action.priority==='9'&&!l.entered)l.entered=s.at;}
  else if(action.type==='claim'&&l&&pool(l)&&eligible(s,action.actor)) {
    const claim=s.claims[l.id];if(!claim||claim.expires<=s.at||claim.actor===action.actor)s.claims[l.id]={actor:action.actor,expires:new Date(+new Date(s.at)+120000).toISOString()};
  } else if(action.type==='call'&&l&&pool(l)&&eligible(s,action.caller)) {
    const old=s.events.find(e=>e.id===action.id);
    if(!old)s.events.push({confirmed:true,external:true,uniqueAssociation:true,direction:'outbound',at:s.at,...action});
    else s.log.push(JSON.stringify(old)===JSON.stringify({...old,...action})?'replay ignored':'same event id with changed payload held');
  }
  s.log.push(`${action.type}: ${action.id??action.lead??action.at??''}`);
  return s;
}
