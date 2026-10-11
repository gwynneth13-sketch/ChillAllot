import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const home='00000000-0000-0000-0000-000000000010';
const owner='00000000-0000-0000-0000-000000000001',payer='00000000-0000-0000-0000-000000000002',viewer='00000000-0000-0000-0000-000000000003',outsider='00000000-0000-0000-0000-000000000004';
const base={name:'Rent',amount:100,amountType:'fixed',due:'2026-10-09',cadence:'Monthly',kind:'Manual',visibility:'household',viewerIds:[],payerIds:[owner,payer],allocations:[{userId:owner,percent:50},{userId:payer,percent:50}],reminder:'Every 1 day before',reminderTime:'09:00'};
async function database(){
 const db=new PGlite();
 // Minimal Supabase auth/household prerequisites; actual feature SQL runs unchanged.
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create table public.profiles(id uuid primary key references auth.users,display_name text);
 create table public.households(id uuid primary key);
 create table public.household_members(household_id uuid references public.households,user_id uuid references public.profiles,role text,primary key(household_id,user_id));
 create table public.household_data(household_id uuid,data_key text,payload jsonb);
 create function public.is_household_member(h uuid) returns boolean language sql as $$select exists(select 1 from public.household_members where household_id=h and user_id=auth.uid())$$;
 create schema private;create table private.shopping_workspaces(household_id uuid,payload jsonb);
 insert into auth.users values('${owner}'),('${payer}'),('${viewer}'),('${outsider}');
 insert into public.profiles select id,'Test member' from auth.users;
 insert into public.households values('${home}');
 insert into public.household_members values('${home}','${owner}','owner'),('${home}','${payer}','member'),('${home}','${viewer}','member');`);
 for(const file of ['bill-access-setup.sql','notification-inbox-setup.sql','push-delivery-setup.sql','bill-reminders-setup.sql']){
  await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
 }
 for(const id of [owner,payer,viewer])await db.query('insert into public.push_preferences(user_id,household_id,timezone) values($1,$2,$3)',[id,home,'America/Chicago']);
 return db;
}
async function action(db,who,op,id='rent',values={}){
 await db.query("select set_config('test.uid',$1,false)",[who]);
 await db.exec('set role authenticated');
 try{return (await db.query('select public.bill_workspace($1,$2,$3,$4::jsonb) as result',[home,op,id,JSON.stringify(values)])).rows[0].result;}
 finally{await db.exec('reset role')}
}
const enqueue=async(db,at='2026-10-08T14:00:00Z')=>(await db.query('select private.enqueue_bill_reminders($1) as count',[at])).rows[0].count;
const inbox=async db=>(await db.query('select * from public.notification_inbox order by created_at,id')).rows;
test('creator notice is optional and only goes to other payers; reminders never inherit',async()=>{
 const db=await database();try{
  await action(db,owner,'create','rent',{...base,notifyPayers:true});
  const notices=await inbox(db);assert.equal(notices.length,1);assert.equal(notices[0].recipient_id,payer);assert.equal(notices[0].item_id,'rent');assert.equal(notices[0].item_due,null);
  const own=(await action(db,owner,'list'))[0],other=(await action(db,payer,'list'))[0];
  assert.equal(own.reminder,base.reminder);assert.equal(other.reminder,'');assert.equal(other.defaults.reminder,'');
  assert.equal(JSON.stringify(other).includes(owner+'":{"reminder"'),false);
  await action(db,owner,'create','quiet',{...base,notifyPayers:false});assert.equal((await inbox(db)).length,1);
 }finally{await db.close()}
});
test('personal reminders use each payer timezone, deduplicate runs, and ignore nonpayers',async()=>{
 const db=await database();try{
  await action(db,owner,'create','rent',base);
  await action(db,payer,'settings','rent',{reminder:'Every 1 day before',reminderTime:'10:00'});
  await action(db,viewer,'settings','rent',{reminder:'Every 1 day before',reminderTime:'09:00'});
  assert.equal(await enqueue(db),1);assert.equal(await enqueue(db),0);
  assert.equal((await inbox(db))[0].recipient_id,owner);
  await db.query("update public.push_preferences set timezone='America/New_York' where user_id=$1",[payer]);
  assert.equal(await enqueue(db),1);assert.equal((await inbox(db)).length,2);
  assert.equal((await action(db,owner,'list'))[0].reminderTime,'09:00');
 }finally{await db.close()}
});
test('unread stale reminders reschedule after edits and disappear after opt-out, payment, deletion or departure',async()=>{
 const db=await database();try{
  await action(db,owner,'create','rent',base);assert.equal(await enqueue(db),1);
  await action(db,owner,'settings','rent',{reminder:'Every 1 day before',reminderTime:'11:00'});
  assert.equal(await enqueue(db),0);assert.equal((await inbox(db)).length,0);
  assert.equal(await enqueue(db,'2026-10-08T16:00:00Z'),1);
  await action(db,owner,'pay','rent',{due:base.due});await enqueue(db,'2026-10-08T16:01:00Z');assert.equal((await inbox(db)).length,0);
  await action(db,owner,'undo','rent',{due:base.due});assert.equal(await enqueue(db,'2026-10-08T16:02:00Z'),1);
  await action(db,owner,'settings','rent',{reminder:'',reminderTime:''});await enqueue(db);assert.equal((await inbox(db)).length,0);
  await action(db,payer,'settings','rent',{reminder:base.reminder,reminderTime:'09:00'});assert.equal(await enqueue(db),1);
  await db.query('delete from public.household_members where user_id=$1',[payer]);await enqueue(db);assert.equal((await inbox(db)).length,0);
  const b=(await action(db,owner,'list'))[0];await action(db,owner,'delete','rent',{expectedRevision:b.revision});assert.equal(await enqueue(db),0);
 }finally{await db.close()}
});
test('accepted or read reminders cannot be duplicated by later edits or payment Undo',async()=>{
 const db=await database();try{
  await action(db,owner,'create','rent',base);await enqueue(db);
  const notice=(await inbox(db))[0];await db.query('update public.notification_inbox set read_at=$1 where id=$2',['2026-10-08T14:01:00Z',notice.id]);
  await action(db,owner,'pay','rent',{due:base.due});await enqueue(db);
  await action(db,owner,'undo','rent',{due:base.due});assert.equal(await enqueue(db),0);
  assert.equal((await inbox(db)).length,1);
 }finally{await db.close()}
});
test('calendar reminders keep local clock through DST and clamp month end',async()=>{
 const db=await database();try{
  await action(db,owner,'create','rent',{...base,due:'2026-11-02'});
  const plan=async()=>(await db.query('select * from private.bill_reminder_plan($1,$2,$3)',[home,'rent',owner])).rows[0];
  assert.equal((await plan()).remind_at.toISOString(),'2026-11-01T15:00:00.000Z');
  const b=(await action(db,owner,'list'))[0];await action(db,owner,'edit','rent',{...base,due:'2026-03-09',expectedRevision:b.revision});
  assert.equal((await plan()).remind_at.toISOString(),'2026-03-08T14:00:00.000Z');
  await action(db,owner,'settings','rent',{reminder:'Every 1 month before',reminderTime:'09:00'});
  await db.query("update private.bills set record=jsonb_set(record,'{due}','\"2026-03-31\"')");
  assert.equal((await plan()).remind_at.toISOString(),'2026-02-28T15:00:00.000Z');
  await action(db,owner,'settings','rent',{reminder:base.reminder,reminderTime:'02:30'});
  await db.query("update private.bills set record=jsonb_set(record,'{due}','\"2026-03-09\"')");
  assert.equal((await plan()).remind_at.toISOString(),'2026-03-08T08:30:00.000Z');
  await action(db,owner,'settings','rent',{reminder:base.reminder,reminderTime:'01:30'});
  await db.query("update private.bills set record=jsonb_set(record,'{due}','\"2026-11-02\"')");
  assert.equal((await plan()).remind_at.toISOString(),'2026-11-01T07:30:00.000Z');
 }finally{await db.close()}
});
test('legacy shared reminder migration preserves creator choice and respects existing personal opt-out',async()=>{
 const db=await database();try{
  await action(db,owner,'create','rent',base);
  await db.query('update private.bills set preferences=$1,record=record||$2::jsonb',[{},JSON.stringify({reminder:base.reminder,reminderTime:base.reminderTime})]);
  await db.exec(await readFile(new URL('../supabase/bill-access-setup.sql',import.meta.url),'utf8'));
  assert.equal((await action(db,owner,'list'))[0].reminder,base.reminder);
  assert.equal((await action(db,payer,'list'))[0].reminder,'');
  await action(db,owner,'resetSettings','rent');
  await db.exec(await readFile(new URL('../supabase/bill-access-setup.sql',import.meta.url),'utf8'));
  assert.equal((await action(db,owner,'list'))[0].reminder,'');
 }finally{await db.close()}
});
test('delivery rechecks payment, visibility, opt-out and changed timing using the live clock',async()=>{
 const db=await database();try{
  const timing=(await db.query("select (((now()-interval '1 minute') at time zone 'America/Chicago')::date+1)::text as due,to_char((now()-interval '1 minute') at time zone 'America/Chicago','HH24:MI') as clock")).rows[0];
  await action(db,owner,'create','rent',{...base,due:timing.due,reminderTime:timing.clock});
  assert.equal((await db.query('select private.enqueue_bill_reminders() as count')).rows[0].count,1);
  const notice=(await inbox(db))[0];
  const current=async()=>(await db.query('select public.push_bill_notice_current($1) as ok',[notice.id])).rows[0].ok;
  await db.exec('set role service_role');assert.equal(await current(),true);await db.exec('reset role');
  await action(db,owner,'settings','rent',{reminder:'',reminderTime:''});assert.equal(await current(),false);
  await action(db,owner,'settings','rent',{reminder:base.reminder,reminderTime:timing.clock});assert.equal(await current(),true);
  await action(db,owner,'pay','rent',{due:timing.due});assert.equal(await current(),false);
 }finally{await db.close()}
});
test('one-time completion stops reminders; invalid zones and expired reminders are skipped',async()=>{
 const db=await database();try{
  await action(db,owner,'create','rent',{...base,cadence:'One-time'});
  await action(db,owner,'pay','rent',{due:base.due});assert.equal(await enqueue(db),0);
  await action(db,owner,'undo','rent',{due:base.due});
  await db.query("update public.push_preferences set timezone='invalid/zone'");assert.equal(await enqueue(db),0);
  await db.query("update public.push_preferences set timezone='America/Chicago'");assert.equal(await enqueue(db,'2026-10-09T14:00:00Z'),0);
 }finally{await db.close()}
});
test('sharing changes invalidate queued pushes; creator edits cannot replace another payer reminder',async()=>{
 const db=await database();try{
  await action(db,owner,'create','rent',{...base,notifyPayers:true});
  const notice=(await inbox(db))[0];
  await action(db,payer,'settings','rent',{reminder:'Every 2 days before',reminderTime:'08:00',note:'Private payer note'});
  const own=(await action(db,owner,'list'))[0];assert.equal(own.note,'');
  const changed={...base,payerIds:[owner],allocations:[],expectedRevision:own.revision,visibility:'private',name:'Private rent'};
  await action(db,owner,'edit','rent',changed);
  assert.equal((await db.query('select public.push_bill_notice_current($1) as ok',[notice.id])).rows[0].ok,false);
  assert.deepEqual(await action(db,payer,'list'),[]);
  const latest=(await action(db,owner,'list'))[0];await action(db,owner,'edit','rent',{...base,expectedRevision:latest.revision});
  const restored=(await action(db,payer,'list'))[0];assert.equal(restored.reminder,'Every 2 days before');assert.equal(restored.note,'Private payer note');
 }finally{await db.close()}
});
test('scheduler and delivery checks cannot be invoked by ordinary accounts; private preferences remain protected',async()=>{
 const db=await database();try{
  await action(db,owner,'create','rent',base);
  await assert.rejects(action(db,outsider,'list'),/Household access is required/);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select private.enqueue_bill_reminders()'),/permission denied/);
  await assert.rejects(db.query('select * from private.bills'),/permission denied/);
  await assert.rejects(db.query('select public.push_bill_notice_current(gen_random_uuid())'),/permission denied/);
  await db.exec('reset role;set role service_role');
  assert.equal((await db.query('select public.push_bill_notice_current(gen_random_uuid()) as ok')).rows[0].ok,false);
 }finally{await db.close()}
});
