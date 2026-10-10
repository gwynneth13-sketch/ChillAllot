import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import webpush from 'npm:web-push@3.6.7';
const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const allowedEndpoint=(endpoint:string)=>/^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com)\//.test(endpoint);
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
  for(const job of jobs){
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
    await done();
   }catch{
    await checked(admin.from('push_delivery_jobs').update({claimed_at:null,available_at:new Date(Date.now()+Math.min(3600,30*2**job.attempts)*1000).toISOString(),last_error:'Delivery failed; retry scheduled'}).eq('notification_id',job.notification_id));
   }
  }
  return Response.json({processed:jobs.length});
 }catch{return new Response('Could not process delivery queue',{status:500});}
});
