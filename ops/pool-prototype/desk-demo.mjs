import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { initial, dispatch, visible, duty, metrics } from './shared-state.mjs';
let state=initial();
const frame=()=>({day:state.at,RepA:visible(state,'A','Pool').map(l=>({lead:l.id,...duty(state,l)})),RepB:visible(state,'B','Pool').map(l=>({lead:l.id,...duty(state,l)})),goals:{A:metrics(state,'A'),B:metrics(state,'B')},events:state.events,log:state.log.slice(-3)});
const call={type:'call',lead:'P1',caller:'A',id:'provider-account:session-001:external'};
if(process.argv.includes('--serve')) {
  const server=createServer(async(req,res)=>{
    const path=req.url==='/'?'desk.html':req.url==='/shared-state.mjs'?'shared-state.mjs':null;
    if(!path){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',path.endsWith('.mjs')?'text/javascript':'text/html');res.end(await readFile(new URL(path,import.meta.url)));
  });
  server.listen(4179,'127.0.0.1',()=>console.log('Synthetic Pool prototype: http://127.0.0.1:4179'));
} else if(process.argv.includes('--replay')) {
  const snapshots=[];
  const capture=label=>snapshots.push({label,...frame()});
  capture('both reps see same due duty, B is off goal schedule');
  state=dispatch(state,call);capture('A fulfills B assigned workload; everyone complete; A actual outbound 1');
  state=dispatch(state,call);capture('same call replay; no extra event or credit');
  state=dispatch(state,{...call,caller:'B',id:'provider-account:session-002:external'});capture('distinct simultaneous call; 1 duty, 2 real calls');
  state=dispatch(state,{type:'transition',lead:'P1',priority:'1'});capture('exit evicts from Pool');
  state=dispatch(state,{type:'transition',lead:'P1',priority:'9'});capture('same-day reentry retains completed shared key');
  state=dispatch(state,{type:'clock',at:'2026-10-15T14:00:00Z'});capture('new NY day opens exactly one requirement');
  state=dispatch(state,{type:'transition',lead:'P1',priority:'9',status:'booked'});capture('booked subject ineligible');
  state=dispatch(state,{type:'closedDate'});capture('closed shared calendar waives unassigned P2');
  console.log(JSON.stringify({provenance:'synthetic_in_memory_replay',network_requests:0,production_mutations:0,snapshots},null,2));
} else {
  const rl=createInterface({input:process.stdin,output:process.stdout});
  for(;;){console.clear();console.log(JSON.stringify(frame(),null,2));const key=await rl.question('[a] A calls [b] B simultaneous [r] replay [n] next day [x] exit [e] reenter [c] booked [w] close day [q] quit > ');if(key==='q')break;
    const actions={a:call,b:{...call,caller:'B',id:'provider-account:session-002:external'},r:call,n:{type:'clock',at:'2026-10-15T14:00:00Z'},x:{type:'transition',lead:'P1',priority:'1'},e:{type:'transition',lead:'P1',priority:'9'},c:{type:'transition',lead:'P1',priority:'9',status:'booked'},w:{type:'closedDate'}};
    if(actions[key])state=dispatch(state,actions[key]);
  }rl.close();
}
