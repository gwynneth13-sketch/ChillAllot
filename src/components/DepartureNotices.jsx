import React,{useEffect,useState} from 'react';
import {householdDepartureNotice} from '../lib/householdBackend.js';

export default function DepartureNotices({household}) {
 const [rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState('');
 useEffect(()=>{let alive=true,inFlight=false;setRows([]);setError('');if(household.role!=='owner')return;const refresh=async()=>{if(inFlight)return;inFlight=true;try{const data=await householdDepartureNotice(household.id);if(alive){setRows(data);setError('')}}catch(e){if(alive)setError(e.message)}finally{inFlight=false}};refresh();const timer=setInterval(refresh,5000);window.addEventListener('focus',refresh);return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',refresh)}},[household.id,household.role]);
 const dismiss=async id=>{setBusy(id);try{setRows(await householdDepartureNotice(household.id,'dismiss',id));setError('')}catch(e){setError(e.message)}finally{setBusy('')}};
 if(household.role!=='owner'||(!rows.length&&!error))return null;
 return <section className="join-requests departure-notices" aria-label="Household updates">{error&&<p className="form-message" role="alert">{error}</p>}{rows.map(row=><div className="join-request" key={row.id}><strong>{row.name} left the household</strong><p>{row.transferredOwnership?`${row.successorName} is now the household owner.`:`${row.successorName} takes over the shared entries they created.`}{row.unpaidShares>0&&` ${row.unpaidShares} unpaid bill share${row.unpaidShares===1?' needs':'s need'} review.`}</p><button type="button" className="outline" disabled={busy===row.id} onClick={()=>dismiss(row.id)}>Dismiss</button></div>)}</section>;
}
