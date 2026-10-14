import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {readFile} from 'node:fs/promises';

async function setup({status=200,reason,environment='sandbox'}={}) {
 const source=await readFile(new URL('../supabase/functions/push-delivery/index.ts',import.meta.url),'utf8');
 const script=stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm,''));
 const context={createClient:()=>({}),webpush:{},Deno:{env:{get:()=>undefined},serve(){}},TextEncoder,btoa,atob,crypto,fetch,Date,Intl,Response,AbortSignal,Uint8Array,URLSearchParams};
 vm.createContext(context);vm.runInContext(script,context);
 const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const pem='-----BEGIN PRIVATE KEY-----\n'+Buffer.from(await crypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64')+'\n-----END PRIVATE KEY-----';
 const calls=[];let clock=1700000000000;
 const send=context.createApnsSender({credentials:{sandbox:{teamId:'TEAM',keyId:'KEY',privateKey:pem},production:{teamId:'TEAM',keyId:'PROD',privateKey:pem}},now:()=>clock,
  fetcher:async(url,request)=>{calls.push({url,request});return new Response(JSON.stringify({reason}),{status});}});
 const device={app_id:'com.gwynneth13.chillallot',environment,token:'ab'.repeat(32)};
 const notice={id:'00000000-0000-0000-0000-000000000012',household_id:'home',title:'Bill reminder',detail:'Due soon'};
 return {send,device,notice,calls,keys,advance:ms=>clock+=ms};
}
test('sends a signed sandbox alert with item routing and honors silent preference',async()=>{
 const s=await setup();assert.equal(await s.send(s.device,s.notice,true),'accepted');
 const {url,request}=s.calls[0];assert.ok(url.startsWith('https://api.sandbox.push.apple.com/3/device/'));
 assert.equal(request.headers['apns-topic'],s.device.app_id);
 assert.equal(request.headers['apns-push-type'],'alert');
 assert.equal(request.headers['apns-collapse-id'],s.notice.id);
 const payload=JSON.parse(request.body);assert.equal(payload.notification_id,s.notice.id);assert.equal(payload.aps.sound,undefined);
 const jwt=request.headers.authorization.slice(7),[header,claims,signature]=jwt.split('.');
 assert.equal(JSON.parse(Buffer.from(header,'base64url')).alg,'ES256');
 assert.equal(JSON.parse(Buffer.from(claims,'base64url')).iss,'TEAM');
 assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},s.keys.publicKey,Buffer.from(signature,'base64url'),new TextEncoder().encode(header+'.'+claims)),true);
});
test('production uses its host and key; cache refreshes before one hour',async()=>{
 const s=await setup({environment:'production'});await s.send(s.device,s.notice,false);
 assert.ok(s.calls[0].url.startsWith('https://api.push.apple.com/'));
 assert.equal(JSON.parse(s.calls[0].request.body).aps.sound,'default');
 const first=s.calls[0].request.headers.authorization;
 s.advance(10*60000);await s.send(s.device,s.notice,false);assert.equal(s.calls[1].request.headers.authorization,first);
 s.advance(41*60000);await s.send(s.device,s.notice,false);assert.notEqual(s.calls[2].request.headers.authorization,first);
});
test('only Unregistered retires a token; environment/key errors remain retryable',async()=>{
 const expired=await setup({status:410,reason:'Unregistered'});assert.equal(await expired.send(expired.device,expired.notice,false),'expired');
 for(const [status,reason] of [[400,'BadDeviceToken'],[403,'InvalidProviderToken'],[429,'TooManyRequests'],[503,'ServiceUnavailable']]){
  const s=await setup({status,reason});await assert.rejects(s.send(s.device,s.notice,false),/Apple push delivery failed/);
 }
});
