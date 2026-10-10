import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const home='00000000-0000-0000-0000-000000000010';
const creator='00000000-0000-0000-0000-000000000001',member='00000000-0000-0000-0000-000000000002',other='00000000-0000-0000-0000-000000000003',outsider='00000000-0000-0000-0000-000000000004';
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
 insert into auth.users values('${creator}'),('${member}'),('${other}'),('${outsider}');
 insert into public.profiles select id,'Same name' from auth.users;
 insert into public.households values('${home}');
 insert into public.household_members values('${home}','${creator}','owner'),('${home}','${member}','member'),('${home}','${other}','member');`);
 for(const file of ['notification-inbox-setup.sql','push-delivery-setup.sql','appointment-access-setup.sql','appointment-notifications-setup.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
 return db;
}
async function action(db,who,op='list',id='inspection',values={}){
 await db.query("select set_config('test.uid',$1,false)",[who]);await db.exec('set role authenticated');
 try{return (await db.query('select public.appointment_workspace($1,$2,$3,$4::jsonb) as result',[home,op,id,JSON.stringify(values)])).rows[0].result;}
 finally{await db.exec('reset role')}
}
const notices=async db=>(await db.query('select * from public.notification_inbox order by created_at,id')).rows;
const current=async(db,id)=>(await db.query('select public.push_appointment_notice_current($1) as current',[id])).rows[0].current;

test('appointment notices are optional, use selected IDs and never pre-set recipient reminders',async()=>{
 const db=await database();try{
  await action(db,creator,'create','quiet',details);assert.equal((await notices(db)).length,0);
  await action(db,creator,'create','inspection',{...details,notifyMemberIds:[member,member,creator]});
  const rows=await notices(db);assert.equal(rows.length,1);assert.equal(rows[0].recipient_id,member);
  assert.equal(rows[0].section,'Appointments');assert.equal(rows[0].item_id,'inspection');
  assert.match(rows[0].detail,/set your own reminder/);assert.equal(await current(db,rows[0].id),true);
  assert.equal((await db.query('select count(*)::int as n from public.push_delivery_jobs')).rows[0].n,1);
  assert.equal((await action(db,member)).find(a=>a.id==='inspection').reminder,'');
  assert.equal((await action(db,creator)).find(a=>a.id==='inspection').reminderTime,'09:00');
  await db.query('select private.notify_appointment_members($1,$2,$3::jsonb,false)',[home,'inspection',JSON.stringify([member])]);
  assert.equal((await notices(db)).length,1);
 }finally{await db.close()}
});

test('invalid recipient selections roll back creation; settings never send notices',async()=>{
 const db=await database();try{
  await assert.rejects(action(db,creator,'create','inspection',{...details,notifyMemberIds:[outsider]}),/Only household members/);
  assert.equal((await db.query('select count(*)::int as n from private.appointments')).rows[0].n,0);
  await assert.rejects(action(db,creator,'create','inspection',{...details,notifyMemberIds:'bad'}),/Choose household members/);
  await action(db,creator,'create','inspection',details);
  await action(db,member,'settings','inspection',{reminder:'Every 1 day before',reminderTime:'10:00',notifyMemberIds:[other]});
  assert.equal((await notices(db)).length,0);
  assert.equal((await action(db,member))[0].reminderTime,'10:00');
 }finally{await db.close()}
});

test('optional edit notices are revision-specific and preserve personal reminders',async()=>{
 const db=await database();try{
  await action(db,creator,'create','inspection',details);
  await action(db,member,'settings','inspection',{reminder:'Every 1 day before',reminderTime:'10:00'});
  await action(db,creator,'edit','inspection',{...details,expectedRevision:1,notifyMemberIds:[member]});
  const [notice]=await notices(db);assert.match(notice.title,/Appointment updated/);assert.equal(await current(db,notice.id),true);
  assert.equal((await action(db,member))[0].reminderTime,'10:00');
  await action(db,creator,'edit','inspection',{...details,expectedRevision:2});
  assert.equal((await notices(db)).length,1);assert.equal(await current(db,notice.id),false);
 }finally{await db.close()}
});

test('appointment push is rejected after personal removal, departure, reading or deletion',async()=>{
 const db=await database();try{
  await action(db,creator,'create','inspection',{...details,notifyMemberIds:[member,other]});
  const rows=await notices(db),first=rows.find(n=>n.recipient_id===member),second=rows.find(n=>n.recipient_id===other);
  await action(db,member,'remove');assert.equal(await current(db,first.id),false);
  await db.query('delete from public.household_members where household_id=$1 and user_id=$2',[home,other]);
  assert.equal(await current(db,second.id),false);
  await action(db,creator,'create','reading',{...details,notifyMemberIds:[member]});
  const read=(await notices(db)).find(n=>n.item_id==='reading');
  await db.query('update public.notification_inbox set read_at=now() where id=$1',[read.id]);
  assert.equal(await current(db,read.id),false);
  await action(db,creator,'create','deleting',{...details,notifyMemberIds:[member]});
  const deleted=(await notices(db)).find(n=>n.item_id==='deleting');
  await action(db,creator,'delete','deleting',{expectedRevision:1});assert.equal(await current(db,deleted.id),false);
 }finally{await db.close()}
});

test('ordinary accounts cannot forge notices or call the delivery guard; outsiders cannot edit',async()=>{
 const db=await database();try{
  await action(db,creator,'create','inspection',details);
  await assert.rejects(action(db,outsider,'edit','inspection',{...details,expectedRevision:1,notifyMemberIds:[member]}),/Household access/);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select private.notify_appointment_members($1,$2,$3::jsonb,false)',[home,'inspection',JSON.stringify([member])]),/permission denied/);
  await assert.rejects(db.query('select public.push_appointment_notice_current(gen_random_uuid())'),/permission denied/);
  await assert.rejects(db.query("insert into public.notification_inbox(recipient_id,household_id,section,event_key,title) values($1,$2,'Appointments','forged','Forged')",[member,home]),/permission denied/);
  await db.exec('reset role;set role service_role');
  assert.equal(await current(db,'00000000-0000-0000-0000-000000000099'),false);
 }finally{await db.close()}
});
