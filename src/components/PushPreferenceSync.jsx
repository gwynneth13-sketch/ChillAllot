import React,{useEffect,useRef,useState} from 'react';
import {supabase} from '../lib/supabase.js';
import {createPreferenceWriter} from '../lib/preferenceWriter.js';
export default function PushPreferenceSync({account,household,cloud,groups,quietHours,setGroups,setQuietHours}){
 const scope=JSON.stringify([account.id,household.id,cloud]);
 const [readyScope,setReadyScope]=useState(null),[error,setError]=useState('');
 const writer=useRef(null);
 useEffect(()=>{
  let alive=true;setReadyScope(null);setError('');if(!cloud||!supabase)return;
  const currentWriter=createPreferenceWriter(value=>supabase.from('push_preferences').upsert({user_id:account.id,household_id:household.id,...value}),failure=>setError(failure?'Notification preferences could not sync. Please try again.':''));
  writer.current=currentWriter;
  async function load(){try{
   const {data,error}=await supabase.from('push_preferences').select('*').eq('user_id',account.id).eq('household_id',household.id).maybeSingle();
   if(!alive)return;if(error)throw error;
   if(data){setGroups(data.groups);setQuietHours(data.quiet_hours);}setReadyScope(scope);
  }catch{if(alive)setError('Notification preferences could not sync. Please try again.');}}
  void load();
  return()=>{alive=false;currentWriter.dispose();if(writer.current===currentWriter)writer.current=null};
 },[account.id,household.id,cloud,scope,setGroups,setQuietHours]);
 useEffect(()=>{
  if(readyScope!==scope||!cloud)return;
  const currentWriter=writer.current;
  const timer=setTimeout(()=>currentWriter?.write({groups,quiet_hours:quietHours,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'}),300);
  return()=>clearTimeout(timer);
 },[readyScope,scope,groups,quietHours,cloud]);
 return error?<p className="form-message" role="alert">{error}</p>:null;
}
