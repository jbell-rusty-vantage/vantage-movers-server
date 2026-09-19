import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { readFileSync } from "node:fs";
import { requireApiSecret } from "../../../middleware/requireApiSecret";
import { computeAdminActorSignature } from "../../operationsRegistry/trustedActor";
import { createSalesIntelligenceBoundaryRouter } from "../../../routes/sales-intelligence-boundary.routes";
import { createSalesIntelligenceAdminRouter, CSI_ADMIN_PREFIX } from "../../../routes/sales-intelligence-admin.routes";
import { createSalesIntelligenceCronRouter, CSI_CRON_PATHS } from "../../../routes/sales-intelligence-cron.routes";
import { CsiError } from "../auth";

test("nudge routes enforce signed Owner, feature, strict input, idempotency; GET never dispatches", async () => {
  const saved={...process.env}; Object.assign(process.env,{VANTAGE_API_SECRET:"synthetic-global",VANTAGE_ADMIN_PROXY_SIGNING_SECRET:"synthetic-signature",SALES_INTELLIGENCE_ENABLED:"true",SALES_INTELLIGENCE_NUDGE_ENABLED:"true"});
  let sends=0, previews=0, reads=0;
  const app=express();app.use(express.json());app.use("/api/v1",requireApiSecret);app.use(createSalesIntelligenceBoundaryRouter({connect:async()=>{}}));
  app.use(createSalesIntelligenceAdminRouter({connect:async()=>{},nudgePreview:async()=>{previews++;throw new CsiError("NUDGE_DESTINATION_IS_CUSTOMER");},
    nudgeSend:async()=>{sends++;throw new CsiError("REVISION_CONFLICT");},nudges:async()=>{reads++;return {as_of:new Date().toISOString(),coverage:{known_through:null,gaps:[],capabilities:{},ai_paused:false},data:{items:[],next_cursor:null}};}}));
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`,path=`${CSI_ADMIN_PREFIX}/nudges`;
  const body={expected_revision:1,expected_rep_revision:1,nudge:{outreach_record_id:"a".repeat(24),rep_identity_link_id:"b".repeat(24),channel:"team_messaging",template_key:"review_context",template_version:1,purpose:"review_context"}};
  async function call(method:string,target:string,payload?:unknown,role="owner",key=true,signed=true){
    const fields={adminId:"synthetic",email:"owner@example.test",role,timestamp:String(Date.now()),requestId:"csi14",method,path:target.split("?")[0]!};
    return fetch(url+target,{method,headers:{"content-type":"application/json","x-api-secret":"synthetic-global","x-api-key":"synthetic-global",
      ...(key?{"idempotency-key":"nudge-proof"}:{}),...(signed?{"x-vantage-admin-user-id":fields.adminId,"x-vantage-admin-email":fields.email,"x-vantage-admin-role":role,
        "x-vantage-admin-timestamp":fields.timestamp,"x-vantage-admin-request-id":fields.requestId,"x-vantage-admin-signature":computeAdminActorSignature(fields,"synthetic-signature")}: {})},
      ...(payload===undefined?{}:{body:JSON.stringify(payload)})});
  }
  try {
    for(const target of [path,`${path}/preview`]){
      assert.equal((await call("POST",target,body,"owner",true,false)).status,403);
      assert.equal((await call("POST",target,body,"admin")).status,403);
      assert.equal((await call("POST",target,body,"owner",false)).status,400);
      assert.equal((await call("POST",target,{...body,chat_id:"arbitrary"})).status,400);
    }
    assert.equal((await call("POST",`${path}/preview`,body)).status,422);assert.equal((await call("POST",path,body)).status,409);
    assert.equal(previews,1);assert.equal(sends,1);
    process.env.SALES_INTELLIGENCE_NUDGE_ENABLED="false";
    assert.equal((await call("POST",path,body)).status,404);assert.equal((await call("GET",path)).status,200);assert.equal(reads,1);assert.equal(sends,1);
    assert.equal((await call("GET",`${path}?repair=true`)).status,400);
  } finally {await new Promise<void>(r=>server.close(()=>r()));for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});
test("repair cron is authenticated, disabled without DB, registered every five minutes", async()=>{
  const previous=process.env.CRON_SECRET;process.env.CRON_SECRET="synthetic-cron";
  let enabled=false,calls=0,connects=0;const app=express();app.use(createSalesIntelligenceCronRouter({flag:()=>enabled,connect:async()=>{connects++;},drainNudgeRepair:async()=>{calls++;return {status:"completed",scheduled:0,outcomes:[]};}}));
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}${CSI_CRON_PATHS.nudgeRepair}`;
  try {assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{authorization:"Bearer synthetic-cron"}})).status,200);assert.equal(connects,0);
    enabled=true;assert.equal((await fetch(url,{headers:{authorization:"Bearer synthetic-cron"}})).status,200);assert.equal(calls,1);
    const config=JSON.parse(readFileSync("vercel.json","utf8"));assert.ok(config.crons.some((c:{path:string;schedule:string})=>c.path===CSI_CRON_PATHS.nudgeRepair&&c.schedule==="*/5 * * * *"));
  }finally{await new Promise<void>(r=>server.close(()=>r()));if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;}
});
