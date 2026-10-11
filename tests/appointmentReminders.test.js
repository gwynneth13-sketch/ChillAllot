import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const home='00000000-0000-0000-0000-000000000010',secondHome='00000000-0000-0000-0000-000000000011';
const creator='00000000-0000-0000-0000-000000000001',member='00000000-0000-0000-0000-000000000002',outsider='00000000-0000-0000-0000-000000000003';
const details={name:'Condo inspection',date:'2026-10-20',time:'14:00',reminder:'Every 1 day before',reminderTime:'09:00'};
async function database(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create table public.profiles(id uuid primary key references auth.users,display_name text);
 create table public.households(id uuid primary key);
 create table public.household_members(household_id uuid,user_id uuid,role text);
 create table public.household_data(household_id uuid,data_key text,payload jsonb);
 alter table public.household_data enable row level security;
 create function public.is_household_member(h uuid) returns boolean language sql as $$select exists(select 1 from public.household_members where household_id=h and user_id=auth.uid())$$;
 create schema private;create table private.shopping_workspaces(household_id uuid,payload jsonb);
 insert into auth.users values('${creator}'),('${member}'),('${outsider}');
 insert into public.profiles select id,'Test member' from auth.users;
 insert into public.households values('${home}'),('${secondHome}');
 insert into public.household_members values('${home}','${creator}','owner'),('${home}','${member}','member'),('${secondHome}','${creator}','owner'),('${secondHome}','${member}','member');`);
 for(const file of ['notification-inbox-setup.sql','push-delivery-setup.sql','appointment-access-setup.sql','appointment-notifications-setup.sql','appointment-reminders-setup.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
 for(const h of [home,secondHome])for(const id of [creator,member])await db.query('insert into public.push_preferences(user_id,household_id,timezone) values($1,$2,$3)',[id,h,'America/Chicago']);
 return db;
}
async function action(db,who,op='list',id='inspection',values={},h=home){
 await db.query("select set_config('test.uid',$1,false)",[who]);await db.exec('set role authenticated');
 try{return (await db.query('select public.appointment_workspace($1,$2,$3,$4::jsonb) as result',[h,op,id,JSON.stringify(values)])).rows[0].result;}
 finally{await db.exec('reset role')}
}
const enqueue=async(db,at='2026-10-19T14:00:00Z')=>(await db.query('select private.enqueue_appointment_reminders($1) as count',[at])).rows[0].count;
const notices=async db=>(await db.query("select * from public.notification_inbox where event_key like 'appointment-reminder:%' order by created_at,id")).rows;
const plan=async(db,id='inspection',who=creator,h=home)=>(await db.query('select * from private.appointment_reminder_plan($1,$2,$3)',[h,id,who])).rows[0];
const current=async(db,id)=>(await db.query('select public.push_appointment_notice_current($1) as ok',[id])).rows[0].ok;

test('scheduled appointments use only personal choices, recipient timezones and both household memberships',async()=>{
 const db=await database();try{
  await action(db,creator,'create','inspection',details);
  assert.equal(await plan(db,'inspection',member),undefined);
  await action(db,member,'settings','inspection',{reminder:'Every 1 day before',reminderTime:'10:00'});
  assert.equal(await enqueue(db),1);assert.equal(await enqueue(db),0);
  assert.equal((await notices(db))[0].recipient_id,creator);
  await db.query("update public.push_preferences set timezone='America/New_York' where user_id=$1 and household_id=$2",[member,home]);
  assert.equal(await enqueue(db),1);
  await action(db,creator,'create','inspection',{...details,reminder:''},secondHome);
  await action(db,member,'settings','inspection',{reminder:'Every 1 day before',reminderTime:'09:00'},secondHome);
  assert.equal(await enqueue(db),1);
  const rows=await notices(db);assert.equal(rows.length,3);
  assert.deepEqual(rows.filter(n=>n.recipient_id===member).map(n=>n.household_id).sort(),[home,secondHome]);
  assert.equal((await action(db,creator))[0].reminderTime,'09:00');
 }finally{await db.close()}
});

test('hour/minute offsets anchor to appointment time; calendar clocks handle DST and month end',async()=>{
 const db=await database();try{
  await action(db,creator,'create','inspection',{...details,reminder:'Every 2 hours before'});
  assert.equal((await plan(db)).remind_at.toISOString(),'2026-10-20T17:00:00.000Z');
  await action(db,creator,'settings','inspection',{reminder:'15 minutes before'});
  assert.equal((await plan(db)).remind_at.toISOString(),'2026-10-20T18:45:00.000Z');
  await action(db,creator,'edit','inspection',{...details,date:'2026-11-02',expectedRevision:1});
  assert.equal((await plan(db)).remind_at.toISOString(),'2026-11-01T15:00:00.000Z');
  await action(db,creator,'edit','inspection',{...details,date:'2026-03-09',expectedRevision:2,reminderTime:'02:30'});
  assert.equal((await plan(db)).remind_at.toISOString(),'2026-03-08T08:30:00.000Z');
  await action(db,creator,'edit','inspection',{...details,date:'2026-03-08',time:'03:30',expectedRevision:3,reminder:'Every 2 hours before'});
  assert.equal((await plan(db)).remind_at.toISOString(),'2026-03-08T06:30:00.000Z');
  await action(db,creator,'settings','inspection',{reminder:'Every 1 month before',reminderTime:'09:00'});
  await db.query("update private.appointments set record=jsonb_set(record,'{date}','\"2026-03-31\"')");
  assert.equal((await plan(db)).remind_at.toISOString(),'2026-02-28T15:00:00.000Z');
 }finally{await db.close()}
});

test('pending notices and jobs cancel after personal opt-out, removal, departure or deletion',async()=>{
 const db=await database();try{
  await action(db,creator,'create','inspection',details);assert.equal(await enqueue(db),1);
  await action(db,creator,'settings','inspection',{reminder:'',reminderTime:''});await enqueue(db);assert.equal((await notices(db)).length,0);
  await action(db,member,'settings','inspection',details);assert.equal(await enqueue(db),1);
  await action(db,member,'remove');await enqueue(db);assert.equal((await notices(db)).length,0);
  await action(db,creator,'create','leaving',{...details,reminder:''});
  await action(db,member,'settings','leaving',details);assert.equal(await enqueue(db),1);
  await db.query('delete from public.household_members where household_id=$1 and user_id=$2',[home,member]);
  await enqueue(db);assert.equal((await notices(db)).length,0);
  await action(db,creator,'create','deleting',details);assert.equal(await enqueue(db),1);
  await action(db,creator,'delete','deleting',{expectedRevision:1});await enqueue(db);assert.equal((await notices(db)).length,0);
  assert.equal((await db.query('select count(*)::int as n from public.push_delivery_jobs')).rows[0].n,0);
 }finally{await db.close()}
});

test('timing edits reschedule unread events; date/time changes identify the new appointment occurrence',async()=>{
 const db=await database();try{
  await action(db,creator,'create','inspection',details);assert.equal(await enqueue(db),1);
  await action(db,creator,'settings','inspection',{reminder:details.reminder,reminderTime:'11:00'});
  assert.equal(await enqueue(db),0);assert.equal((await notices(db)).length,0);
  assert.equal(await enqueue(db,'2026-10-19T16:00:00Z'),1);
  await action(db,creator,'edit','inspection',{...details,time:'15:00',date:'2026-10-21',expectedRevision:1});
  assert.equal(await enqueue(db),0);assert.equal((await notices(db)).length,0);
  assert.equal(await enqueue(db,'2026-10-20T14:00:00Z'),1);
  assert.match((await notices(db))[0].event_key,/2026-10-21T15:00:00$/);
 }finally{await db.close()}
});

test('read or accepted reminders cannot repeat for the same occurrence after opt-out and re-enable',async()=>{
 const db=await database();try{
  for(const accepted of [false,true]){
   const id=accepted?'accepted':'read';await action(db,creator,'create',id,details);assert.equal(await enqueue(db),1);
   const notice=(await notices(db)).find(n=>n.item_id===id);
   if(accepted)await db.query('insert into public.push_delivery_receipts(notification_id,endpoint) values($1,$2)',[notice.id,'https://example.invalid/device']);
   else await db.query('update public.notification_inbox set read_at=now() where id=$1',[notice.id]);
   await action(db,creator,'settings',id,{reminder:''});await enqueue(db);
   await action(db,creator,'settings',id,details);assert.equal(await enqueue(db),0);
   assert.equal((await notices(db)).filter(n=>n.item_id===id).length,1);
  }
 }finally{await db.close()}
});

test('invalid records/zones are isolated, and expiry blocks late or after-start delivery',async()=>{
 const db=await database();try{
  await action(db,creator,'create','inspection',{...details,reminder:'Every 0 days before',reminderTime:'15:00'});
  assert.equal(await plan(db),undefined);assert.equal(await enqueue(db,'2026-10-20T20:00:00Z'),0);
  await action(db,creator,'settings','inspection',details);
  assert.equal(await enqueue(db,'2026-10-20T14:00:00Z'),0);
  await db.query("update public.push_preferences set timezone='invalid/zone' where user_id=$1",[creator]);assert.equal(await plan(db),undefined);
  await db.query("update public.push_preferences set timezone='America/Chicago' where user_id=$1",[creator]);
  await db.query("update private.appointments set record=jsonb_set(record,'{date}','\"2026-02-30\"')");assert.equal(await plan(db),undefined);
  await action(db,creator,'create','valid',details);assert.equal(await enqueue(db),1);
  await action(db,creator,'settings','valid',{reminder:'Every 2 hours before'});
  assert.equal(await enqueue(db,'2026-10-20T17:00:00Z'),1);
  const hourPlan=await plan(db,'valid');assert.equal(hourPlan.expires_at.toISOString(),'2026-10-20T19:00:00.000Z');
  await enqueue(db,'2026-10-20T19:00:00Z');assert.equal((await notices(db)).length,0);
  await action(db,creator,'settings','valid',{reminder:'Every 0 hours before'});
  assert.equal(await enqueue(db,'2026-10-20T19:00:00Z'),1);
  assert.equal((await plan(db,'valid')).expires_at.toISOString(),'2026-10-20T19:05:00.000Z');
  await enqueue(db,'2026-10-20T19:05:00Z');assert.equal((await notices(db)).length,0);
 }finally{await db.close()}
});

test('live delivery guard rechecks personal choices, changed start, removal and membership; existing notices still work',async()=>{
 const db=await database();try{
  const timing=(await db.query("select to_char(now() at time zone 'America/Chicago','YYYY-MM-DD') as day,to_char((now()+interval '1 hour') at time zone 'America/Chicago','YYYY-MM-DD') as start_day,to_char((now()+interval '1 hour') at time zone 'America/Chicago','HH24:MI') as start_clock")).rows[0];
  const values={...details,date:timing.start_day,time:timing.start_clock,reminder:'Every 2 hours before'};
  await action(db,creator,'create','inspection',values);
  assert.equal((await db.query('select private.enqueue_appointment_reminders() as n')).rows[0].n,1);
  const [notice]=await notices(db);
  await db.exec('set role service_role');assert.equal(await current(db,notice.id),true);await db.exec('reset role');
  await action(db,creator,'settings','inspection',{reminder:''});assert.equal(await current(db,notice.id),false);
  await action(db,creator,'settings','inspection',values);assert.equal(await current(db,notice.id),true);
  await action(db,creator,'edit','inspection',{...values,time:timing.start_clock==='12:00'?'13:00':'12:00',expectedRevision:1});assert.equal(await current(db,notice.id),false);
  await action(db,creator,'create','added',{...details,notifyMemberIds:[member]});
  const added=(await db.query("select * from public.notification_inbox where item_id='added'")).rows[0];assert.equal(await current(db,added.id),true);
  await action(db,member,'remove','added');assert.equal(await current(db,added.id),false);
  await action(db,creator,'create','departure',values);
  await db.query('select private.enqueue_appointment_reminders()');
  const leaving=(await notices(db)).find(n=>n.item_id==='departure');assert.ok(leaving);
  await db.query('delete from public.household_members where household_id=$1 and user_id=$2',[home,creator]);
  assert.equal(await current(db,leaving.id),false);
 }finally{await db.close()}
});

test('scheduler, plans and private ledger are unavailable to ordinary accounts; worker guard remains service-only',async()=>{
 const db=await database();try{
  await assert.rejects(action(db,outsider),/Household access/);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select private.enqueue_appointment_reminders()'),/permission denied/);
  await assert.rejects(db.query('select * from private.appointment_reminder_events'),/permission denied/);
  await assert.rejects(db.query('select private.appointment_reminder_plan($1,$2,$3)',[home,'inspection',creator]),/permission denied/);
  await assert.rejects(db.query('select public.push_appointment_notice_current(gen_random_uuid())'),/permission denied/);
  await db.exec('reset role;set role service_role');
  assert.equal(await current(db,'00000000-0000-0000-0000-000000000099'),false);
 }finally{await db.close()}
});
