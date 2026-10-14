import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const owner='00000000-0000-0000-0000-000000000001', other='00000000-0000-0000-0000-000000000002';
const installation='00000000-0000-0000-0000-000000000011', second='00000000-0000-0000-0000-000000000012';
const token='ab'.repeat(32);
async function database() {
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create schema auth;create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
  grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
  insert into auth.users values('${owner}'),('${other}');`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261014183653_ios_push_devices.sql',import.meta.url),'utf8'));
 return db;
}
async function asUser(db,user,sql,args=[]) {
 await db.query("select set_config('test.uid',$1,false)",[user]);await db.exec('set role authenticated');
 try{return await db.query(sql,args);}finally{await db.exec('reset role');}
}
const register=(db,user,id=installation,value=token,environment='sandbox')=>asUser(db,user,
 'select public.register_ios_push_device($1,$2,$3) as id',[id,value,environment]);

test('registration is idempotent, rotates tokens, and deduplicates installations',async()=>{
 const db=await database();try{
  const first=(await register(db,owner)).rows[0].id;
  assert.equal((await register(db,owner)).rows[0].id,first);
  await register(db,owner,installation,'cd'.repeat(32));
  assert.equal((await db.query('select count(*) from public.ios_push_devices')).rows[0].count,1);
  assert.equal((await register(db,owner,second,'cd'.repeat(32))).rows[0].id,first);
  assert.equal((await db.query('select installation_id from public.ios_push_devices')).rows[0].installation_id,second);
 }finally{await db.close();}
});
test('another account cannot read, claim, or delete the phone registration',async()=>{
 const db=await database();try{
  await register(db,owner);
  assert.equal((await asUser(db,other,'select * from public.ios_push_devices')).rows.length,0);
  await assert.rejects(register(db,other),/previous account/);
  await assert.rejects(register(db,other,second),/previous account/);
  await asUser(db,other,'select public.remove_ios_push_device($1)',[installation]);
  assert.equal((await db.query('select count(*) from public.ios_push_devices')).rows[0].count,1);
  await asUser(db,owner,'select public.remove_ios_push_device($1)',[installation]);
  await register(db,other);assert.equal((await db.query('select user_id from public.ios_push_devices')).rows[0].user_id,other);
 }finally{await db.close();}
});
test('invalid tokens, environments, anonymous users, and direct writes are rejected',async()=>{
 const db=await database();try{
  await assert.rejects(register(db,owner,installation,'https://example.test'),/Invalid iPhone/);
  await assert.rejects(register(db,owner,installation,token,'anything'),/Invalid iPhone/);
  await assert.rejects(register(db,'',installation),/Sign in/);
  await assert.rejects(asUser(db,owner,'insert into public.ios_push_devices(installation_id,user_id,token,environment) values($1,$2,$3,$4)',[installation,other,token,'sandbox']),/permission denied/);
 }finally{await db.close();}
});
