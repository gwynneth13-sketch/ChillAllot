import React,{useEffect,useState} from 'react';
import {supabase} from '../lib/supabase.js';
export default function PushPreferenceSync({account,household,cloud,groups,quietHours,setGroups,setQuietHours}){
 const [ready,setReady]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let alive=true;setReady(false);if(!cloud)return;
  supabase.from('push_preferences').select('*').eq('user_id',account.id).eq('household_id',household.id).maybeSingle().then(({data,error})=>{if(!alive)return;if(error){setError('Notification preferences could not sync.');return;}if(data){setGroups(data.groups);setQuietHours(data.quiet_hours);}setReady(true)});
  return()=>{alive=false};
 },[account.id,household.id,cloud]);
 useEffect(()=>{if(!ready||!cloud)return;let alive=true;const timer=setTimeout(async()=>{const {error}=await supabase.from('push_preferences').upsert({user_id:account.id,household_id:household.id,groups,quiet_hours:quietHours,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'});if(alive)setError(error?'Notification preferences could not sync. Please try again.':'');},300);return()=>{alive=false;clearTimeout(timer)}},[ready,groups,quietHours,account.id,household.id,cloud]);
 return error?<p className="form-message" role="alert">{error}</p>:null;
}
