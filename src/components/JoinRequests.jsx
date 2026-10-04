import React,{useEffect,useState} from 'react';
import {householdInvitation} from '../lib/householdInvitations.js';

export default function JoinRequests({householdId,onMembershipChanged}) {
  const [rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState('');
  useEffect(()=>{let alive=true;const refresh=async()=>{try{const data=await householdInvitation('list');if(alive){setRows(data);setError('')}}catch(e){if(alive)setError(e.message)}};refresh();const timer=setInterval(refresh,5000);window.addEventListener('focus',refresh);return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',refresh)}},[householdId]);
  const act=async(row,operation)=>{setBusy(row.id);setError('');try{await householdInvitation(operation,{requestId:row.id});setRows(await householdInvitation('list'));onMembershipChanged?.()}catch(e){setError(e.message)}finally{setBusy('')}};
  const visible=rows.filter(r=>r.mine||r.householdId===householdId);
  if(!visible.length&&!error)return null;
  return <section className="join-requests" aria-label="Household requests">{error&&<p role="alert">{error}</p>}{visible.map(row=><div className="join-request" key={row.id}>{row.mine?<><strong>{row.status==='declined'?'Request declined:':'Waiting to join'} {row.householdName}</strong><p>{row.status==='declined'?'The household owner declined this request.':'Your request is waiting for the household owner’s approval.'}</p><button type="button" className="outline" disabled={busy===row.id} onClick={()=>act(row,'cancel')}>{row.status==='declined'?'Dismiss':'Cancel request'}</button></>:<><strong>{row.personName} would like to join</strong><p>{row.inviterName?`Invited by ${row.inviterName}.`:'Joined using an earlier invitation link.'}</p><div className="request-actions"><button type="button" className="outline" disabled={busy===row.id} onClick={()=>act(row,'decline')}>Decline</button><button type="button" className="primary" disabled={busy===row.id} onClick={()=>act(row,'approve')}>Approve</button></div></>}</div>)}</section>;
}
