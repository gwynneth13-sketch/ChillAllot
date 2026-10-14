import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import webpush from 'npm:web-push@3.6.7';
// Server only. Credentials must be stored in Edge Function secrets, never VITE_*.
const encoder=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const json64=value=>b64(encoder.encode(JSON.stringify(value)));
function fcmMessage(device,notice,silent){
 return {message:{token:device.token,notification:{title:notice.title,body:notice.detail},
  data:{notification_id:notice.id},android:{priority:'high',ttl:'3600s',restricted_package_name:device.app_id,
   notification:{channel_id:silent?'chillallot_quiet':'chillallot_updates',tag:notice.id,icon:'ic_push_notification',...(silent?{}:{sound:'default'})}}}};
}
function createFcmSender({credential,projectId,fetcher=fetch,cryptoApi=crypto,now=Date.now}){
 let cached=null;
 async function accessToken(){
  if(cached&&cached.expires>now()+60000)return cached.value;
  const account=JSON.parse(credential);
  if(!projectId||account.project_id!==projectId||!account.client_email||!account.private_key)throw Error('FCM server configuration is invalid');
  const issued=Math.floor(now()/1000);
  const unsigned=json64({alg:'RS256',typ:'JWT'})+'.'+json64({iss:account.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:issued,exp:issued+3600});
  const pem=account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
  const key=await cryptoApi.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const signature=await cryptoApi.subtle.sign('RSASSA-PKCS1-v1_5',key,encoder.encode(unsigned));
  const result=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+b64(signature)}),signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!result.ok)throw Error('FCM server authentication failed');
  const data=await result.json();
  if(!data.access_token||!Number.isFinite(data.expires_in)||data.expires_in<=0)throw Error('FCM authentication returned no usable token');
  cached={value:data.access_token,expires:now()+Math.min(data.expires_in,3600)*1000};return cached.value;
 }
 return async(device,notice,silent)=>{
  if(device.platform!=='android'||device.project_id!==projectId||device.app_id!=='com.chillallot.app.test')throw Error('Unsupported native push target');
  const access=await accessToken();
  const response=await fetcher('https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(projectId)+'/messages:send',{
   method:'POST',headers:{authorization:'Bearer '+access,'content-type':'application/json'},body:JSON.stringify(fcmMessage(device,notice,silent)),signal:AbortSignal.timeout(10000),redirect:'error'});
  if(response.ok)return 'accepted';
  if(response.status===401)cached=null;
  let error;try{error=(await response.json()).error;}catch{}
  // A project/configuration 404 is not an expired token. Inspect the FCM detail.
  if(error?.details?.some(d=>d['@type']==='type.googleapis.com/google.firebase.fcm.v1.FcmError'&&d.errorCode==='UNREGISTERED'))return 'expired';
  throw Error('FCM delivery failed');
 };
}

function apnsPayload(notice,silent){
 return {aps:{alert:{title:String(notice.title||'ChillAllot').slice(0,100),body:String(notice.detail||'You have a household update.').slice(0,600)},
  'thread-id':notice.household_id,...(silent?{}:{sound:'default'})},notification_id:notice.id};
}
function createApnsSender({credentials,fetcher=fetch,cryptoApi=crypto,now=Date.now}){
 const cache=new Map();
 async function providerToken(environment){
  const existing=cache.get(environment);
  if(existing&&existing.expires>now())return existing.value;
  const config=credentials[environment];
  if(!config?.teamId||!config?.keyId||!config?.privateKey)throw Error('Apple push configuration is incomplete');
  const unsigned=json64({alg:'ES256',kid:config.keyId})+'.'+json64({iss:config.teamId,iat:Math.floor(now()/1000)});
  const pem=config.privateKey.replace(/\\n/g,'\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
  const key=await cryptoApi.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const signature=await cryptoApi.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,encoder.encode(unsigned));
  const value=unsigned+'.'+b64(signature);
  // Apple requires refresh between 20 and 60 minutes; cache for 50 minutes.
  cache.set(environment,{value,expires:now()+50*60000});return value;
 }
 return async(device,notice,silent)=>{
  if(device.app_id!=='com.gwynneth13.chillallot'||!['sandbox','production'].includes(device.environment)||!/^[a-f0-9]{32,512}$/.test(device.token))throw Error('Unsupported Apple push target');
  const host=device.environment==='sandbox'?'api.sandbox.push.apple.com':'api.push.apple.com';
  const response=await fetcher('https://'+host+'/3/device/'+device.token,{
   method:'POST',headers:{authorization:'bearer '+await providerToken(device.environment),'content-type':'application/json',
    'apns-topic':device.app_id,'apns-push-type':'alert','apns-priority':'10','apns-expiration':String(Math.floor(now()/1000)+3600),'apns-collapse-id':notice.id},
   body:JSON.stringify(apnsPayload(notice,silent)),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(response.ok)return 'accepted';
  let reason;try{reason=(await response.json()).reason;}catch{}
  // Only Apple's explicit unregistration response retires a token. A wrong
  // signing environment/topic/key must not erase valid registrations.
  if(response.status===410&&reason==='Unregistered')return 'expired';
  throw Error('Apple push delivery failed');
 };
}
const appleCredentials=Object.fromEntries(['sandbox','production'].map(environment=>{
 const prefix='APNS_'+environment.toUpperCase()+'_';
 return [environment,{teamId:Deno.env.get(prefix+'TEAM_ID'),keyId:Deno.env.get(prefix+'KEY_ID'),privateKey:Deno.env.get(prefix+'PRIVATE_KEY')}];
}));
const appleSender=createApnsSender({credentials:appleCredentials});
const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const allowedEndpoint=(endpoint:string)=>/^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com)\//.test(endpoint);
const nativeSender=createFcmSender({credential:Deno.env.get('FCM_SERVICE_ACCOUNT_JSON'),projectId:Deno.env.get('FCM_PROJECT_ID')});
function quietAt(date:Date,p:any){
 const q=p?.quiet_hours;if(!q?.enabled||!/^\d\d:\d\d$/.test(q.start)||!/^\d\d:\d\d$/.test(q.end)||q.start===q.end)return false;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:p.timezone||'UTC',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
 const time=parts.find(x=>x.type==='hour')!.value+':'+parts.find(x=>x.type==='minute')!.value;
 return q.start<q.end?time>=q.start&&time<q.end:time>=q.start||time<q.end;
}
async function checked(query:any){const {data,error}=await query;if(error)throw error;return data;}
Deno.serve(async req=>{
 const secret=Deno.env.get('PUSH_WORKER_TOKEN');
 if(!secret||req.headers.get('authorization')!==`Bearer ${secret}`)return new Response('Unauthorized',{status:401});
 if(req.method!=='POST')return new Response('Use POST',{status:405});
 const publicKey=Deno.env.get('PUSH_PUBLIC_KEY'),privateKey=Deno.env.get('PUSH_PRIVATE_KEY');
 if(!publicKey||!privateKey)return new Response('Push keys are not configured',{status:503});
 try{
  const jobs=await checked(admin.rpc('claim_push_jobs'));
  jobsLoop:for(const job of jobs){
   const done=(last_error:string|null=null)=>checked(admin.from('push_delivery_jobs').update({finished_at:new Date().toISOString(),claimed_at:null,last_error}).eq('notification_id',job.notification_id));
   try{
    const notice=await checked(admin.from('notification_inbox').select('*').eq('id',job.notification_id).single());
    if(notice.read_at){await done();continue;}
    const membership=await checked(admin.from('household_members').select('user_id').eq('household_id',notice.household_id).eq('user_id',notice.recipient_id));
    if(!membership.length){await done('Household access ended');continue;}
    if(notice.section==='Shopping'&&notice.item_id){
     // Recheck access at delivery time, not just when the inbox entry was written.
     const access=await checked(admin.rpc('push_list_access',{h:notice.household_id,list_id:notice.item_id,recipient:notice.recipient_id}));
     if(!access){await done('List access ended');continue;}
    }
    if(notice.section==='Bills'){
     const current=await checked(admin.rpc('push_bill_notice_current',{notice_id:notice.id}));
     if(!current){await done('Bill notification no longer applies');continue;}
    }
    if(notice.section==='Appointments'){
     const current=await checked(admin.rpc('push_appointment_notice_current',{notice_id:notice.id}));
     if(!current){await done('Appointment notification no longer applies');continue;}
    }
    const p=await checked(admin.from('push_preferences').select('*').eq('user_id',notice.recipient_id).eq('household_id',notice.household_id).maybeSingle());
    if(p?.groups?.[notice.section]===false){await done('Group disabled');continue;}
    if(quietAt(new Date(),p)){
     let next=new Date();for(let i=0;i<1500&&quietAt(next,p);i++)next=new Date(next.getTime()+60000);
     await checked(admin.from('push_delivery_jobs').update({available_at:next.toISOString(),claimed_at:null,attempts:job.attempts-1}).eq('notification_id',job.notification_id));continue;
    }
    const devices=await checked(admin.from('push_devices').select('*').eq('user_id',notice.recipient_id));
    for(const device of devices){
     // Recheck each device after quiet-hour deferral, retries and earlier sends.
     if(notice.section==='Bills'&&!await checked(admin.rpc('push_bill_notice_current',{notice_id:notice.id}))){break;}
     if(notice.section==='Appointments'&&!await checked(admin.rpc('push_appointment_notice_current',{notice_id:notice.id}))){break;}
     if(!allowedEndpoint(device.endpoint))throw Error('Invalid push endpoint');
     const receipt=await checked(admin.from('push_delivery_receipts').select('endpoint').eq('notification_id',notice.id).eq('endpoint',device.endpoint));if(receipt.length)continue;
     const silent=(p?.groups?.Sound??p?.groups?.['Sound & vibration'])===false;
     const details=webpush.generateRequestDetails(device.subscription,JSON.stringify({id:notice.id,title:notice.title,detail:notice.detail,silent}),{TTL:3600,topic:notice.id.replaceAll('-','').slice(0,32),vapidDetails:{subject:'https://chill-allot.vercel.app',publicKey,privateKey}});
     const response=await fetch(details.endpoint,{method:details.method,headers:details.headers,body:Uint8Array.from(details.body).buffer,redirect:'error',signal:AbortSignal.timeout(10000)});
     if(response.status===404||response.status===410){await checked(admin.from('push_devices').delete().eq('endpoint',device.endpoint));continue;}
     if(!response.ok)throw Error('Push service rejected delivery');
     await checked(admin.from('push_delivery_receipts').upsert({notification_id:notice.id,endpoint:device.endpoint},{onConflict:'notification_id,endpoint'}));
    }
    const nativeDevices=await checked(admin.from('native_push_devices').select('*').eq('user_id',notice.recipient_id));
    const iosDevices=await checked(admin.from('ios_push_devices').select('*').eq('user_id',notice.recipient_id));
    const targets=[...nativeDevices.map(device=>({device,table:'native_push_devices',sender:nativeSender,prefix:'native:'})),
     ...iosDevices.map(device=>({device,table:'ios_push_devices',sender:appleSender,prefix:'ios:'}))];
    for(const {device,table,sender,prefix} of targets){
     // Preserve access cancellation even if an earlier device send took time.
     const currentNotice=await checked(admin.from('notification_inbox').select('read_at').eq('id',notice.id).maybeSingle());if(!currentNotice||currentNotice.read_at)break;
     const currentMembership=await checked(admin.from('household_members').select('user_id').eq('household_id',notice.household_id).eq('user_id',notice.recipient_id));
     if(!currentMembership.length)break;
     if(notice.section==='Shopping'&&notice.item_id&&!await checked(admin.rpc('push_list_access',{h:notice.household_id,list_id:notice.item_id,recipient:notice.recipient_id})))break;
     if(notice.section==='Bills'&&!await checked(admin.rpc('push_bill_notice_current',{notice_id:notice.id})))break;
     if(notice.section==='Appointments'&&!await checked(admin.rpc('push_appointment_notice_current',{notice_id:notice.id})))break;
     const endpoint=prefix+device.id;
     const receipt=await checked(admin.from('push_delivery_receipts').select('endpoint').eq('notification_id',notice.id).eq('endpoint',endpoint));if(receipt.length)continue;
     const latestDevice=await checked(admin.from(table).select('*').eq('id',device.id).eq('user_id',notice.recipient_id).maybeSingle());if(!latestDevice)continue;
     const latestPreferences=await checked(admin.from('push_preferences').select('*').eq('user_id',notice.recipient_id).eq('household_id',notice.household_id).maybeSingle());
     if(latestPreferences?.groups?.[notice.section]===false)break;
     if(quietAt(new Date(),latestPreferences)){
      let next=new Date();for(let i=0;i<1500&&quietAt(next,latestPreferences);i++)next=new Date(next.getTime()+60000);
      await checked(admin.from('push_delivery_jobs').update({available_at:next.toISOString(),claimed_at:null,attempts:job.attempts-1}).eq('notification_id',job.notification_id));continue jobsLoop;
     }
     const silent=(latestPreferences?.groups?.Sound??latestPreferences?.groups?.['Sound & vibration'])===false;
     const result=await sender(latestDevice,notice,silent);
     if(result==='expired'){await checked(admin.from(table).delete().eq('id',device.id).eq('token',latestDevice.token));continue;}
     await checked(admin.from('push_delivery_receipts').upsert({notification_id:notice.id,endpoint},{onConflict:'notification_id,endpoint'}));
    }
    await done();
   }catch{
    await checked(admin.from('push_delivery_jobs').update({claimed_at:null,available_at:new Date(Date.now()+Math.min(3600,30*2**job.attempts)*1000).toISOString(),last_error:'Delivery failed; retry scheduled'}).eq('notification_id',job.notification_id));
   }
  }
  return Response.json({processed:jobs.length});
 }catch{return new Response('Could not process delivery queue',{status:500});}
});
