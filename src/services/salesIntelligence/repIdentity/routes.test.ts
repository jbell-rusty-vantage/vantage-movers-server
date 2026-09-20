import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { requireApiSecret } from "../../../middleware/requireApiSecret";
import { computeAdminActorSignature } from "../../operationsRegistry/trustedActor";
import { createSalesIntelligenceBoundaryRouter } from "../../../routes/sales-intelligence-boundary.routes";
import { createSalesIntelligenceAdminRouter, CSI_ADMIN_PREFIX } from "../../../routes/sales-intelligence-admin.routes";
import { createSalesIntelligenceCronRouter, CSI_CRON_PATHS } from "../../../routes/sales-intelligence-cron.routes";
import { CsiError } from "../auth";

test("all five Rep routes enforce Owner, strict contracts, scope, flags and idempotency header", async () => {
  const saved={ ...process.env }; process.env.VANTAGE_API_SECRET="synthetic-global";
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET="synthetic-signature"; process.env.SALES_INTELLIGENCE_ENABLED="true";
  const writes:string[]=[], reads:string[]=[]; let failure:CsiError|null=null;
  const write=async (action:string)=>{ writes.push(action); if(failure) throw failure; return { response:{ accepted:true },replayed:false }; };
  const app=express(); app.use(express.json()); app.use("/api/v1",requireApiSecret);
  app.use(createSalesIntelligenceBoundaryRouter({ connect:async()=>{} }));
  app.use(createSalesIntelligenceAdminRouter({ connect:async()=>{},
    reps:async()=>{ reads.push("list"); return { as_of:new Date().toISOString(),coverage:{ known_through:null,gaps:[],capabilities:{},ai_paused:false },items:[],next_cursor:null,
      directory:{ status:"missing",snapshot_id:null,taken_at:null,completeness:"provider_completeness_unverified",users:[],next_cursor:null } }; },
    rep:async()=>{ reads.push("detail"); return null; },
    createRep:async()=>write("create"),proposeReps:async()=>write("propose"),reviewRep:async()=>write("review"),
  }));
  const server=app.listen(0,"127.0.0.1"); await new Promise<void>(r=>server.once("listening",r));
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`,id="a".repeat(24);
  async function call(method:string,path:string,body?:unknown,role="owner",key=true) {
    const fields={ adminId:"synthetic",email:"owner@example.test",role,timestamp:String(Date.now()),requestId:"csi10",method,path:path.split("?")[0]! };
    return fetch(url+path,{ method,headers:{ "content-type":"application/json","x-api-secret":"synthetic-global",
      "x-vantage-admin-user-id":fields.adminId,"x-vantage-admin-email":fields.email,"x-vantage-admin-role":role,"x-vantage-admin-timestamp":fields.timestamp,
      "x-vantage-admin-request-id":fields.requestId,"x-vantage-admin-signature":computeAdminActorSignature(fields,"synthetic-signature"),
      ...(key?{ "idempotency-key":"test-key" }: {}) },body:body===undefined?undefined:JSON.stringify(body) });
  }
  const link={ agent_id:id,rc_account_id:"synthetic",rc_extension_id:"101",role_kind:"sales_rep",effective_from:"2026-09-01T00:00:00Z",effective_to:null,nudge_channels_allowed:[] };
  const routes=[{ path:"/reps",body:{ expected_revision:1,link,reason:"Owner" } },
    { path:"/reps/propose",body:{ expected_revision:1,rc_account_id:"synthetic",directory_snapshot_id:id,reason:"Owner" } },
    { path:`/reps/${id}/review`,body:{ expected_revision:1,link,status:"reviewed",reason:"Owner" } }];
  try {
    for(const route of routes) {
      const path=CSI_ADMIN_PREFIX+route.path;
      assert.equal((await call("POST",path,route.body,"admin")).status,403);
      assert.equal((await call("POST",path,route.body,"owner",false)).status,400);
      assert.equal((await call("POST",path,{ ...route.body,automatic:true })).status,400);
      assert.equal((await call("POST",path,route.body)).status,200);
    }
    assert.deepEqual(writes,["create","propose","review"]);
    const page=await call("GET",`${CSI_ADMIN_PREFIX}/reps?rc_account_id=synthetic`); assert.equal(page.status,200);
    assert.equal((await call("GET",`${CSI_ADMIN_PREFIX}/reps`)).status,200);
    const pageBody=await page.json(); assert.equal(typeof pageBody.as_of,"string"); assert.equal(pageBody.coverage.known_through,null); assert.deepEqual(pageBody.data.items,[]);
    assert.equal((await call("GET",`${CSI_ADMIN_PREFIX}/reps/${id}`)).status,404);
    assert.deepEqual(reads,["list","list","detail"]); assert.equal(writes.length,3);
    assert.equal((await call("GET",`${CSI_ADMIN_PREFIX}/reps?rc_account_id=synthetic&scope=historical`)).status,403);
    failure=new CsiError("REVISION_CONFLICT"); assert.equal((await call("POST",CSI_ADMIN_PREFIX+routes[2]!.path,routes[2]!.body)).status,409);
    process.env.SALES_INTELLIGENCE_ENABLED="false";
    for(const route of routes) assert.equal((await call("POST",CSI_ADMIN_PREFIX+route.path,route.body)).status,404);
  } finally { server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r())); process.env=saved; }
});
test("minute recovery invokes registered bounded rep stage, honors flag and cron authentication",async()=>{
  const saved=process.env.CRON_SECRET; process.env.CRON_SECRET="synthetic-cron"; let enabled=false,calls=0;
  const app=express(); app.use(createSalesIntelligenceCronRouter({ connect:async()=>{},flag:f=>enabled&&f==="ENABLED",
    drainRepIdentity:async()=>{ calls++; return { outcomes:["not_claimable"] }; },
    drainRebuild:async()=>({ claimed:0,completed:0,failed:0,lease_lost:0,deadline_reached:false }) }));
  const server=app.listen(0,"127.0.0.1"); await new Promise<void>(r=>server.once("listening",r));
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}${CSI_CRON_PATHS.jobRecovery}`;
  try { assert.equal((await fetch(url)).status,401); const headers={ authorization:"Bearer synthetic-cron" };
    await fetch(url,{ headers }); assert.equal(calls,0); enabled=true;
    const result=await (await fetch(url,{ headers })).json(); assert.deepEqual(result.rep_identity_reevaluate,{ outcomes:["not_claimable"] }); assert.equal(calls,1);
  } finally { server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r())); if(saved===undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET=saved; }
});
