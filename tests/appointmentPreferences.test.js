import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {localAppointmentRequest} from '../src/lib/localAppointments.js';

const home='00000000-0000-0000-0000-000000000010';
const creator='00000000-0000-0000-0000-000000000001';
const member='00000000-0000-0000-0000-000000000002';
const outsider='00000000-0000-0000-0000-000000000003';
const details={name:'Condo inspection',date:'2026-10-20',time:'14:00',reminder:'Every 1 day before',reminderTime:'09:00'};

async function database(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create table public.profiles(id uuid primary key,display_name text);
 create table public.households(id uuid primary key);
 create table public.household_members(household_id uuid,user_id uuid,role text);
 create table public.household_data(household_id uuid,data_key text,payload jsonb);
 alter table public.household_data enable row level security;
 insert into public.profiles values('${creator}','Creator'),('${member}','Member'),('${outsider}','Outsider');
 insert into public.households values('${home}');
 insert into public.household_members values('${home}','${creator}','owner'),('${home}','${member}','member');`);
 await db.exec(await readFile(new URL('../supabase/appointment-access-setup.sql',import.meta.url),'utf8'));
 return db;
}
async function action(db,who,op='list',values={}){
 await db.query("select set_config('test.uid',$1,false)",[who]);
 await db.exec('set role authenticated');
 try{return (await db.query('select public.appointment_workspace($1,$2,$3,$4::jsonb) as result',[home,op,'inspection',JSON.stringify(values)])).rows[0].result;}
 finally{await db.exec('reset role')}
}

test('new appointments cannot pre-set another member reminder, including older client payloads',async()=>{
 const db=await database();try{
  await action(db,creator,'create',{...details,memberReminders:[{userId:member,member:'Member',reminder:'Every 2 days before',time:'08:00'}]});
  const mine=(await action(db,creator))[0],theirs=(await action(db,member))[0];
  assert.equal(mine.reminder,details.reminder);assert.equal(mine.reminderTime,'09:00');
  assert.equal(theirs.reminder,'');assert.equal(theirs.reminderTime,'');
 }finally{await db.close()}
});

test('personal edits and opt-out survive creator edits and setup reapplication',async()=>{
 const db=await database();try{
  await action(db,creator,'create',details);
  await action(db,member,'settings',{reminder:'Every 2 hours before',reminderTime:''});
  const before=(await action(db,creator))[0];
  await action(db,creator,'edit',{...details,name:'Updated inspection',expectedRevision:before.revision,memberReminders:[{userId:member,reminder:'Every 3 days before',time:'08:00'}]});
  assert.equal((await action(db,member))[0].reminder,'Every 2 hours before');
  await action(db,member,'settings',{reminder:'',reminderTime:''});
  await db.exec(await readFile(new URL('../supabase/appointment-access-setup.sql',import.meta.url),'utf8'));
  assert.equal((await action(db,member))[0].reminder,'');
  assert.equal((await action(db,creator))[0].reminder,details.reminder);
 }finally{await db.close()}
});

test('appointment preferences stay private and outsiders cannot use the workspace',async()=>{
 const db=await database();try{
  await action(db,creator,'create',details);
  await assert.rejects(action(db,outsider),/Household access is required/);
  await assert.rejects(action(db,outsider,'settings',{reminder:'Every 1 hour before'}),/Household access is required/);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select preferences from private.appointments'),/permission denied/);
  await db.exec('reset role;set role anon');
  await assert.rejects(db.query('select public.appointment_workspace($1)',[home]),/permission denied/);
 }finally{await db.close()}
});

test('local preview follows the same independent reminder and opt-out rules',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 const store=new Map();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)}});
 const members=[{id:creator,name:'Creator',role:'Owner'},{id:member,name:'Member',role:'Member'}];
 const request=(who,op='list',values={})=>localAppointmentRequest(home,op,'inspection',values,{id:who},members);
 try{
  await request(creator,'create',{...details,memberReminders:[{userId:member,reminder:'Every 2 days before',time:'08:00'}]});
  assert.equal((await request(member))[0].reminder,'');
  await request(member,'settings',{reminder:'Every 2 hours before'});
  const before=(await request(creator))[0];
  await request(creator,'edit',{...details,expectedRevision:before.revision});
  assert.equal((await request(member))[0].reminder,'Every 2 hours before');
  await request(member,'settings',{reminder:''});
  assert.equal((await request(member))[0].reminder,'');
  assert.equal((await request(creator))[0].reminder,details.reminder);
 }finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;}
});
