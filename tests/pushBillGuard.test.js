import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {readFile} from 'node:fs/promises';

// Execute the actual worker handler with test database/transport adapters.
// No real credentials, network calls or push subscriptions are used.
async function worker({access=[true,true],quiet=false,read=false}={}){
 const calls=[],updates=[];let sends=0,handler;
 const notice={id:'00000000-0000-0000-0000-000000000001',household_id:'home',recipient_id:'payer',section:'Bills',item_id:'rent',title:'Rent',detail:'Due soon',read_at:read?'read':null};
 const job={notification_id:notice.id,attempts:1};
 const device={endpoint:'https://fcm.googleapis.com/test-only',subscription:{}};
 const admin={rpc(name,args){calls.push({name,args});return Promise.resolve({data:name==='claim_push_jobs'?[job]:access.length>1?access.shift():access[0]});},from(table){
  let update=null;
  const query={select(){return query},eq(){return query},single(){return query},maybeSingle(){return query},update(value){update=value;updates.push({table,value});return query},upsert(){return query},delete(){return query},then(resolve,reject){
   const data=update?null:table==='notification_inbox'?notice:table==='household_members'?[{user_id:'payer'}]:table==='push_preferences'?{groups:{Sound:false},quiet_hours:quiet?{enabled:true,start:'00:00',end:'23:59'}:{enabled:false},timezone:'UTC'}:table==='push_devices'?[device]:[];
   return Promise.resolve({data}).then(resolve,reject);
  }};return query;
 }};
 const source=await readFile(new URL('../supabase/functions/push-delivery/index.ts',import.meta.url),'utf8');
 const script=stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm,''));
 const Clock=quiet?class extends Date{constructor(...args){super(...(args.length?args:['2026-10-08T12:00:00Z']))}static now(){return new Date('2026-10-08T12:00:00Z').getTime()}}:Date;
 vm.runInNewContext(script,{createClient:()=>admin,webpush:{generateRequestDetails:()=>({endpoint:device.endpoint,method:'POST',headers:{},body:[]})},Deno:{env:{get:name=>({PUSH_WORKER_TOKEN:'test-only',PUSH_PUBLIC_KEY:'test-only',PUSH_PRIVATE_KEY:'test-only'})[name]},serve:fn=>{handler=fn}},Response,Date:Clock,Intl,Uint8Array,AbortSignal,fetch:async()=>{sends++;return {ok:true,status:201}}});
 const response=await handler(new Request('https://worker.example.test',{method:'POST',headers:{authorization:'Bearer test-only'}}));
 return {calls,updates,sends,response};
}
test('worker stops an obsolete bill notice before looking up phone devices',async()=>{
 const result=await worker({access:[false]});assert.equal(result.response.status,200);assert.equal(result.sends,0);
 assert.equal(result.updates[0].value.last_error,'Bill notification no longer applies');
});
test('worker checks again before each actual bill push and rejects a mid-processing change',async()=>{
 const result=await worker({access:[true,false]});assert.equal(result.sends,0);
 assert.equal(result.calls.filter(c=>c.name==='push_bill_notice_current').length,2);
});
test('a current bill reminder reaches the push transport once; read notices never do',async()=>{
 const current=await worker();assert.equal(current.sends,1);
 const read=await worker({read:true});assert.equal(read.sends,0);
 assert.equal(read.calls.filter(c=>c.name==='push_bill_notice_current').length,0);
});
test('quiet hours defer a valid bill reminder without sending or consuming a retry attempt',async()=>{
 const result=await worker({quiet:true});assert.equal(result.sends,0);
 assert.equal(result.updates[0].value.available_at,'2026-10-08T23:59:00.000Z');
 assert.equal(result.updates[0].value.attempts,0);
});
