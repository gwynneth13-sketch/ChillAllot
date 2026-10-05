import {useCallback,useEffect,useState} from 'react';
import {supabase} from './supabase.js';

export function useNotificationInbox(account,household,cloud){
 const [items,setItems]=useState([]),[error,setError]=useState('');
 const userId=account?.id,householdId=household?.id;
 useEffect(()=>{
  let active=true;
  setItems([]);setError('');
  if(!cloud||!supabase||!userId||!householdId)return;
  async function refresh(){
   const result=await supabase.from('notification_inbox').select('*').eq('recipient_id',userId).eq('household_id',householdId).order('created_at',{ascending:false}).limit(100);
   if(!active)return;
   if(result.error){setError('Your notifications could not load. Please try again.');return;}
   setError('');setItems(result.data.map(n=>({...n,read:Boolean(n.read_at),time:new Date(n.created_at).toLocaleString()})));
  }
  refresh();
  const timer=setInterval(refresh,30000);
  const focus=()=>refresh();window.addEventListener('focus',focus);
  return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',focus)};
 },[userId,householdId,cloud]);
 const markRead=useCallback(async id=>{
  if(!cloud){setItems(rows=>rows.map(n=>!id||n.id===id?{...n,read:true}:n));return true;}
  let query=supabase.from('notification_inbox').update({read_at:new Date().toISOString()}).eq('recipient_id',userId).eq('household_id',householdId).is('read_at',null);
  if(id)query=query.eq('id',id);
  const {error}=await query;
  if(error){setError('Could not mark notifications as read. Please try again.');return false;}
  setItems(rows=>rows.map(n=>!id||n.id===id?{...n,read:true}:n));return true;
 },[userId,householdId,cloud]);
 return {items,setItems,markRead,error};
}
