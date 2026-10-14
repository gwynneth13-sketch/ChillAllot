import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {readFile} from 'node:fs/promises';

// Execute the actual worker handler with test database/transport adapters.
// No real credentials, network calls or push subscriptions are used.
async function worker({access=[true,true],quiet=false,read=false,section='Bills',nativeKind=null,receipt=false,deviceGone=false,expired=false}={}){
 const calls=[],updates=[],requests=[];let sends=0,handler;
 const notice={id:'00000000-0000-0000-0000-000000000001',household_id:'home',recipient_id:'payer',section,item_id:'rent',title:'Rent',detail:'Due soon',read_at:read?'read':null};
 const job={notification_id:notice.id,attempts:1};
 const device={endpoint:'https://fcm.googleapis.com/test-only',subscription:{}};
 const phone={id:'device',token:nativeKind==='ios'?'ab'.repeat(32):'android-token',environment:'sandbox',platform:'android',app_id:nativeKind==='ios'?'com.gwynneth13.chillallot':'com.chillallot.app.test',project_id:'chillallot-b4ce8'};
 const admin={rpc(name,args){calls.push({name,args});return Promise.resolve({data:name==='claim_push_jobs'?[job]:access.length>1?access.shift():access[0]});},from(table){
  let update=null,one=false;
  const query={select(){return query},eq(){return query},single(){one=true;return query},maybeSingle(){one=true;return query},update(value){update=value;updates.push({table,value});return query},upsert(value){updates.push({table,value});return query},delete(){updates.push({table,deleted:true});return query},then(resolve,reject){
   const nativeTable=nativeKind==='ios'?'ios_push_devices':'native_push_devices';
   const data=update?null:table==='notification_inbox'?notice:table==='household_members'?[{user_id:'payer'}]:table==='push_preferences'?{groups:{Sound:false},quiet_hours:quiet?{enabled:true,start:'00:00',end:'23:59'}:{enabled:false},timezone:'UTC'}:table==='push_devices'?(nativeKind?[]:[device]):nativeKind&&table===nativeTable?(one?(deviceGone?null:phone):[phone]):table==='push_delivery_receipts'&&receipt?[{endpoint:'existing'}]:[];
   return Promise.resolve({data}).then(resolve,reject);
  }};return query;
 }};
 const source=await readFile(new URL('../supabase/functions/push-delivery/index.ts',import.meta.url),'utf8');
 const script=stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm,''));
 const Clock=quiet?class extends Date{constructor(...args){super(...(args.length?args:['2026-10-08T12:00:00Z']))}static now(){return new Date('2026-10-08T12:00:00Z').getTime()}}:Date;
 const secrets={PUSH_WORKER_TOKEN:'test-only',PUSH_PUBLIC_KEY:'test-only',PUSH_PRIVATE_KEY:'test-only',
  APNS_SANDBOX_TEAM_ID:'TEAM',APNS_SANDBOX_KEY_ID:'KEY',APNS_SANDBOX_PRIVATE_KEY:'AA==',
  FCM_PROJECT_ID:'chillallot-b4ce8',FCM_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'chillallot-b4ce8',client_email:'test@example.test',private_key:'AA=='})};
 vm.runInNewContext(script,{createClient:()=>admin,webpush:{generateRequestDetails:()=>({endpoint:device.endpoint,method:'POST',headers:{},body:[]})},Deno:{env:{get:name=>secrets[name]},serve:fn=>{handler=fn}},Response,Date:Clock,Intl,Uint8Array,AbortSignal,TextEncoder,btoa,atob,URLSearchParams,crypto:{subtle:{importKey:async()=>({}),sign:async()=>new Uint8Array(64)}},fetch:async(url,request)=>{
  if(url==='https://oauth2.googleapis.com/token')return {ok:true,json:async()=>({access_token:'test',expires_in:3600})};
  sends++;requests.push({url,request});return {ok:!expired,status:expired?410:201,json:async()=>({reason:'Unregistered'})};
 }});
 const response=await handler(new Request('https://worker.example.test',{method:'POST',headers:{authorization:'Bearer test-only'}}));
 return {calls,updates,sends,response,requests};
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

test('appointment delivery is checked before processing and before each device send',async()=>{
 const stopped=await worker({section:'Appointments',access:[false]});assert.equal(stopped.sends,0);
 assert.equal(stopped.updates[0].value.last_error,'Appointment notification no longer applies');
 const changed=await worker({section:'Appointments',access:[true,false]});assert.equal(changed.sends,0);
 assert.equal(changed.calls.filter(c=>c.name==='push_appointment_notice_current').length,2);
 const valid=await worker({section:'Appointments'});assert.equal(valid.sends,1);
 const quiet=await worker({section:'Appointments',quiet:true});assert.equal(quiet.sends,0);assert.equal(quiet.updates[0].value.attempts,0);
});

test('the worker delivers native iOS and preserves the existing Android path',async()=>{
 for(const nativeKind of ['ios','android']){
  const result=await worker({nativeKind});assert.equal(result.sends,1);assert.equal(result.response.status,200);
  const receipt=result.updates.find(row=>row.table==='push_delivery_receipts');
  assert.equal(receipt.value.endpoint,nativeKind==='ios'?'ios:device':'native:device');
  if(nativeKind==='ios'){
   const payload=JSON.parse(result.requests[0].request.body);
   assert.equal(payload.notification_id,'00000000-0000-0000-0000-000000000001');
   assert.equal(payload.aps.sound,undefined);
  }
 }
});
test('iOS sends are skipped after access changes, receipt, opt-out, or unregister',async()=>{
 assert.equal((await worker({nativeKind:'ios',access:[true,false]})).sends,0);
 assert.equal((await worker({nativeKind:'ios',section:'Shopping',access:[true,false]})).sends,0);
 assert.equal((await worker({nativeKind:'ios',receipt:true})).sends,0);
 assert.equal((await worker({nativeKind:'ios',deviceGone:true})).sends,0);
 assert.equal((await worker({nativeKind:'ios',read:true})).sends,0);
 const quiet=await worker({nativeKind:'ios',quiet:true});assert.equal(quiet.sends,0);assert.equal(quiet.updates[0].value.attempts,0);
});
test('explicit APNs unregistration retires only the matching token',async()=>{
 const result=await worker({nativeKind:'ios',expired:true});assert.equal(result.sends,1);
 assert.ok(result.updates.some(row=>row.table==='ios_push_devices'&&row.deleted));
 assert.equal(result.updates.some(row=>row.table==='push_delivery_receipts'),false);
});
