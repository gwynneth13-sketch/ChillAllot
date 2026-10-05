import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase.js';
const empty=()=>({tabs:[],data:{},revision:0});
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
export function localShoppingRequest(home,actor,members,operation='list',values={}){
 const key='chillallot.private-shopping.'+home;let all=read(key,null);
 if(!all){const oldItems=read('chillallot.shopping.'+home,[]),oldQuick=read('chillallot.quickAdds.'+home,[]),oldSuggestions=read('chillallot.suggestions.'+home,{items:{},pairs:{}});const hasLegacy=oldItems.length||oldQuick.length||Object.keys(oldSuggestions.items||{}).length||Object.keys(oldSuggestions.pairs||{}).length;const legacy=read('chillallot.shoppingLists.'+home,{tabs:hasLegacy?[{id:'main',name:'My list'}]:[],data:{}});const owner=members.find(m=>m.role==='Owner')?.id;if(!owner)throw Error('Household members are still loading');all={...legacy,revision:1,tabs:legacy.tabs.map(t=>({...t,creatorId:t.creatorId||owner,memberIds:t.memberIds||members.map(m=>m.id)})),data:{...legacy.data,main:{items:read('chillallot.shopping.'+home,[]),quickAdds:read('chillallot.quickAdds.'+home,[]),suggestions:read('chillallot.suggestions.'+home,{items:{},pairs:{}})}}};}
 const visible=t=>t.creatorId===actor||t.memberIds.includes(actor);
 if(!members.some(m=>m.id===actor))throw Error('Household access is required');
 if(operation==='save'){
  if(values.revision!==all.revision)throw Error('Shopping lists changed. Reload and try again');
  const ids=new Set();for(const t of values.tabs){if(!t.id||ids.has(t.id)||!t.name?.trim()||t.name.length>60)throw Error('Invalid shopping list');ids.add(t.id);const old=all.tabs.find(x=>x.id===t.id);if(old){if(!visible(old))throw Error('List access is required');if(old.creatorId!==t.creatorId)throw Error('List creator cannot be changed');if(old.creatorId!==actor&&(old.name!==t.name||JSON.stringify(old.memberIds)!==JSON.stringify(t.memberIds)))throw Error('Only the creator can manage this list');}else if(t.creatorId!==actor)throw Error('The creator must be the current user');if(!t.memberIds.includes(t.creatorId)||t.memberIds.some(id=>!members.some(m=>m.id===id)))throw Error('Select current household members');}
  if(all.tabs.some(t=>visible(t)&&!ids.has(t.id)&&t.creatorId!==actor))throw Error('Only the creator can delete this list');
  const hidden=all.tabs.filter(t=>!visible(t));all={tabs:[...hidden,...values.tabs],data:Object.fromEntries([...hidden,...values.tabs].map(t=>[t.id,ids.has(t.id)?values.data[t.id]:all.data[t.id]])),revision:all.revision+1};
 }
 localStorage.setItem(key,JSON.stringify(all));const tabs=all.tabs.filter(visible);return {...all,tabs,data:Object.fromEntries(tabs.map(t=>[t.id,all.data[t.id]||{}]))};
}
export function useShopping(home,cloud,account,members){
 const [value,setValue]=useState(empty),[error,setError]=useState(''),[ready,setReady]=useState(false);const latest=useRef(value),dirty=useRef(false),saving=useRef(false);latest.current=value;
 const request=async(op='list',v={})=>{if(!cloud)return localShoppingRequest(home,account.id,members,op,v);const {data,error}=await supabase.rpc('shopping_workspace',{target_household:home,operation:op,input_values:v});if(error)throw Error(error.code==='PGRST202'?'The shopping database update is needed before this screen can be used.':error.message);return data};
 useEffect(()=>{let active=true;setReady(false);dirty.current=false;setValue(empty());const refresh=async()=>{if(dirty.current||saving.current)return;try{const result=await request();if(active&&!dirty.current&&!saving.current){setValue(current=>JSON.stringify(current)===JSON.stringify(result)?current:result);setReady(true);setError('')}}catch(e){if(active)setError(e.message)}};refresh();const timer=setInterval(refresh,2000);return()=>{active=false;clearInterval(timer)}},[home,cloud,account.id,JSON.stringify(members)]);
 useEffect(()=>{if(!ready||!dirty.current||saving.current)return;let active=true;const timer=setTimeout(async()=>{saving.current=true;const outgoing=latest.current;try{const result=await request('save',outgoing);if(active){if(latest.current===outgoing){dirty.current=false;setValue(result)}else setValue(current=>({...current,revision:result.revision}));setError('')}}catch(e){if(active){dirty.current=false;setError(e.message);try{setValue(await request())}catch{}}}finally{saving.current=false}},250);return()=>{clearTimeout(timer)}},[value,ready]);
 return {value,error,ready,setValue:update=>{if(!ready||error)return;dirty.current=true;setValue(current=>typeof update==='function'?update(current):update)}};
}
