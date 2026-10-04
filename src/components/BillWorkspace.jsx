import React, {useEffect,useState,useRef} from 'react';
import {billRequest,billRows} from '../lib/billing.js';
import {localBillRequest} from '../lib/localBilling.js';

export function useBills(householdId,cloud,account,members) {
  const [bills,setBills]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const alive=useRef(true),generation=useRef(0),mutating=useRef(false);
  const request=(action='list',id='',values={})=>cloud?billRequest(householdId,action,id,values):localBillRequest(householdId,action,id,values,account,members);
  useEffect(()=>{alive.current=true;let pending=false;
    const refresh=async()=>{if(pending||mutating.current)return;pending=true;const token=generation.current;try{const rows=await request();if(alive.current&&token===generation.current){setBills(rows);setError('')}}catch(e){if(alive.current&&token===generation.current)setError(e.message)}finally{pending=false}};
    refresh();const timer=setInterval(refresh,4000);window.addEventListener('focus',refresh);
    return()=>{alive.current=false;clearInterval(timer);window.removeEventListener('focus',refresh)};
  },[householdId]);
  const act=async(action,id,values)=>{if(mutating.current)throw Error('Please wait for the current save.');mutating.current=true;setBusy(true);generation.current++;try{const rows=await request(action,id,values);setBills(rows);setError('');return rows}catch(e){setError(e.message);throw e}finally{mutating.current=false;setBusy(false)}};
  return {bills,error,busy,act};
}

function AccessFields({bill,userId,members}) {
  const [creator,setCreator]=useState(bill?.creatorId||userId),[visibility,setVisibility]=useState(bill?.visibility||'private');
  const [viewers,setViewers]=useState(bill?.viewerIds||[]),[shares,setShares]=useState(bill?.allocations||[]),[split,setSplit]=useState(!!bill?.allocations?.length);
  const available=visibility==='private'?members.filter(m=>m.id===creator):visibility==='selected'?members.filter(m=>m.id===creator||viewers.includes(m.id)):members;
  const toggle=(id,on)=>{let next=on?[...shares,{userId:id,member:members.find(m=>m.id===id)?.name,percent:0}]:shares.filter(s=>s.userId!==id);next=next.map((s,i)=>({...s,percent:next.length<=2?i===next.length-1?100-Math.floor(100/next.length)*(next.length-1):Math.floor(100/next.length):0}));setShares(next)};
  const update=(id,value)=>setShares(items=>items.map(s=>s.userId===id?{...s,percent:value}:items.length===2?{...s,percent:value===''?'':Math.max(0,Number((100-Number(value)).toFixed(2)))}:s));
  const permitted=shares.filter(s=>available.some(m=>m.id===s.userId));
  return <section className="bill-access">
    {bill&&!bill.creatorId&&<label>Creator<select name="creatorId" value={creator} onChange={e=>{setCreator(e.target.value);setShares([])}}>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
    <label>Who can see this bill?<select name="visibility" value={visibility} onChange={e=>{setVisibility(e.target.value);setShares([]);setSplit(false)}}><option value="private">Only me{bill&&!bill.creatorId?' (the creator)':''}</option><option value="selected">Selected members</option><option value="household">Household</option></select></label>
    {visibility==='selected'&&<fieldset className="notify-members"><legend>Share with</legend>{members.filter(m=>m.id!==creator).map(m=><label key={m.id}><input type="checkbox" checked={viewers.includes(m.id)} onChange={e=>{setViewers(v=>e.target.checked?[...v,m.id]:v.filter(id=>id!==m.id));setShares(s=>s.filter(a=>a.userId!==m.id))}}/>{m.name}</label>)}</fieldset>}
    <input type="hidden" name="viewerIds" value={JSON.stringify(viewers)}/>
    {visibility!=='private'&&<label className="check-option"><input type="checkbox" checked={split} onChange={e=>{setSplit(e.target.checked);setShares([])}}/>Split this bill</label>}
    {split&&visibility!=='private'&&<div className="split-editor-body">{available.map(m=>{const share=permitted.find(s=>s.userId===m.id);return <div className="split-share-row" key={m.id}><label className="split-member"><input type="checkbox" checked={!!share} onChange={e=>toggle(m.id,e.target.checked)}/>{m.name}</label><label className="split-percent"><input aria-label={m.name+' share percentage'} type="text" inputMode="decimal" data-preserve-input value={share?.percent??''} disabled={!share} onFocus={e=>e.target.select()} onClick={e=>e.target.select()} onChange={e=>update(m.id,e.target.value)}/><span>%</span></label></div>})}<div className="split-total">Total <strong>{permitted.reduce((n,s)=>n+(Number(s.percent)||0),0)}%</strong></div></div>}
    <input type="hidden" name="allocations" value={JSON.stringify(split&&visibility!=='private'?permitted:[])}/>
    <input type="hidden" name="splitEnabled" value={split&&visibility!=='private'?'yes':'no'}/>
  </section>;
}

export default function BillWorkspace({data,account,members,adding,onCloseAdd,say,ui}) {
  const {DateField,RecurrenceField,ReminderField,reminderFromForm,cadenceFromForm,formatDateDisplay,formatReminderTime}=ui;
  const [filter,setFilter]=useState('Upcoming'),[searchOpen,setSearchOpen]=useState(false),[query,setQuery]=useState(''),[editing,setEditing]=useState(null),[personal,setPersonal]=useState(null),[formError,setFormError]=useState('');
  const userId=account.id,bill=editing,formOpen=adding||editing||personal;
  const name=id=>members.find(m=>m.id===id)?.name||'Former member';
  const today=new Date(),todayISO=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const overdue=billRows(data.bills,'Overdue',userId,todayISO).length;
  const rows=billRows(data.bills,filter,userId,todayISO,searchOpen?query:'');
  const close=()=>{setEditing(null);setPersonal(null);setFormError('');onCloseAdd()};
  const perform=async(action,id,values,message)=>{try{await data.act(action,id,values);say(message);return true}catch(e){setFormError(e.message);return false}};
  const submit=async e=>{e.preventDefault();const v=Object.fromEntries(new FormData(e.currentTarget));let values;
    if(personal){values={note:v.note||'',bankLink:v.bankLink||'',paymentLink:v.paymentLink||'',reminder:reminderFromForm(v,'reminder'),reminderTime:v.reminderTime||''};}
    else {const allocations=JSON.parse(v.allocations).map(s=>({...s,percent:Number(s.percent)}));
      if(v.splitEnabled==='yes'&&(!allocations.length||allocations.some(s=>!Number.isFinite(s.percent)||s.percent<=0||s.percent>100)||Math.abs(allocations.reduce((n,s)=>n+s.percent,0)-100)>0.001)){setFormError('Choose the payers and make their shares total 100%.');return}
      values={name:v.name.trim(),amount:Number(v.amount),due:v.due,kind:v.kind,cadence:cadenceFromForm(v,'Monthly'),visibility:v.visibility,viewerIds:JSON.parse(v.viewerIds),allocations,payerIds:allocations.length?allocations.map(s=>s.userId):[v.creatorId||bill?.creatorId||userId],note:v.note||'',bankLink:v.bankLink||'',paymentLink:v.paymentLink||'',reminder:reminderFromForm(v,'reminder'),reminderTime:v.reminderTime||'',creatorId:v.creatorId,expectedRevision:bill?.revision};
      if(!values.due){setFormError('Choose a due date.');return}
    }
    if(await perform(personal?'settings':bill?(bill.creatorId?'edit':'assign'):'create',personal?.id||bill?.id||crypto.randomUUID(),values,'Changes saved'))close();
  };
  return <>
    {data.error&&<p className="form-message" role="alert">{data.error}</p>}
    {data.bills.filter(b=>!b.creatorId).map(b=><div className="bill-assignment" key={b.id}><span><strong>{b.name}</strong><small>Choose its creator and who can see it before continuing.</small></span><button className="outline small" onClick={()=>{setEditing(b);setFormError('')}}>Assign creator</button></div>)}
    <div className="toolbar bill-toolbar"><div className="pills">{['Upcoming','Overdue','Paid'].map(x=><button key={x} className={filter===x?'selected':''} onClick={()=>setFilter(x)}>{x}{x==='Overdue'&&overdue>0&&<span className="overdue-count" aria-label={overdue+' overdue bills'}>{overdue}</span>}</button>)}</div><button className="outline small" aria-expanded={searchOpen} onClick={()=>setSearchOpen(v=>!v)}>Search</button></div>
    {overdue>0&&filter!=='Overdue'&&<button className="bill-overdue-notice" onClick={()=>{setFilter('Overdue');setQuery('')}}><strong>{overdue} unpaid {overdue===1?'bill is':'bills are'} overdue.</strong><span>View overdue bills →</span></button>}
    {searchOpen&&<label className="bill-search">Search bills<input type="search" data-preserve-input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by bill name" autoFocus/><button className="plain small" onClick={()=>{setQuery('');setSearchOpen(false)}}>Clear</button></label>}
    <div className="card-list">{rows.map(b=><article className="bill-card" key={b.id+':'+b.due}><div className="bill-main"><div className="bill-title"><div><strong>{b.name}</strong></div><div className="bill-details"><strong className="bill-due">Due {formatDateDisplay(b.due)}</strong><div className="bill-cadence"><span>{b.kind}</span><span>{b.cadence}</span></div>{b.allocations?.length>0&&<div className="bill-split-lines">{b.allocations.map(s=><span key={s.userId}>{name(s.userId)}: {s.percent}%</span>)}</div>}</div></div><div className="bill-amount"><strong>${Number(b.amount).toFixed(2)}</strong>{b.allocations?.map(s=><small key={s.userId}>{name(s.userId)}: ${(b.amount*s.percent/100).toFixed(2)}</small>)}</div></div>
      {(b.note||b.reminder)&&<div className="bill-meta">{b.note&&<span>{b.note}</span>}{b.reminder&&<span>{b.reminder}{b.reminderTime&&' · '+formatReminderTime(b.reminderTime)}</span>}</div>}
      <div className="bill-footer">{b.history&&<span className="paid-status"><span>{account.name} · Paid <button type="button" className="plain small" disabled={data.busy} onClick={()=>perform('undo',b.id,{due:b.due},'Payment undone')}>Undo</button></span></span>}<div>{!b.history&&!b.nextPreview&&b.payerIds.includes(userId)&&<button className="outline small" disabled={data.busy} onClick={()=>perform('pay',b.id,{due:b.due},'Payment saved')}>Mark paid</button>}{b.creatorId===userId?<button className="plain small" onClick={()=>{setEditing({...b.source,...b.source.defaults});setFormError('')}}>Edit</button>:<button className="plain small" onClick={()=>{setPersonal(b.source);setFormError('')}}>My settings</button>}</div><div className="bill-footer-links">{b.bankLink&&<a className="outline small" href={b.bankLink} target="_blank" rel="noreferrer">↗ Bank</a>}{b.paymentLink&&<a className="outline small" href={b.paymentLink} target="_blank" rel="noreferrer">↗ Pay</a>}</div></div>
    </article>)}{!rows.length&&!data.error&&<div className="empty">{data.bills.length?'No matching bills.':'No bills yet. Add a bill to start tracking your household expenses.'}</div>}</div>
    {formOpen&&<div className="overlay" onClick={()=>{if(!data.busy)close()}}><form className="modal bill-editor" role="dialog" aria-modal="true" aria-label={personal?'My bill settings':bill?'Edit bill':'Add bill'} onClick={e=>e.stopPropagation()} onSubmit={submit} key={personal?.id||bill?.id||'new'} autoComplete="off"><button className="modal-close" type="button" aria-label="Close bill editor" disabled={data.busy} onClick={close}>×</button><div className="eyebrow">{personal?'MY BILL SETTINGS':bill&&!bill.creatorId?'ASSIGN BILL CREATOR':bill?'EDIT BILL':'ADD BILL'}</div>
      {personal?<p className="modal-description">Your reminder, notes, and links for {personal.name}.</p>:<><label>Name<input name="name" defaultValue={bill?.name||''} required autoFocus/></label><div className="form-row"><label>Amount<input name="amount" type="text" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" data-preserve-input defaultValue={bill?.amount??''} required onFocus={e=>e.target.select()} onClick={e=>e.target.select()}/></label><DateField name="due" label="Due date" value={bill?.due||''} required/></div><div className="form-row"><label>Type<select name="kind" defaultValue={bill?.kind||'Manual'}><option>Manual</option><option>Auto</option></select></label><RecurrenceField cadence={bill?.cadence||'Monthly'} label="Repeat"/></div><AccessFields bill={bill} members={members} userId={userId}/><p className="modal-description">Shared reminder, note, and links. Each member can customize their own.</p></>}
      <ReminderField reminder={(personal||bill)?.reminder||''} time={(personal||bill)?.reminderTime||''}/><label>Payment note<textarea name="note" rows="2" defaultValue={(personal||bill)?.note||''}/></label><div className="form-row"><label>Payment link<input name="paymentLink" type="url" defaultValue={(personal||bill)?.paymentLink||''}/></label><label>Bank link<input name="bankLink" type="url" defaultValue={(personal||bill)?.bankLink||''}/></label></div>
      {formError&&<p className="form-message" role="alert">{formError}</p>}<div className="modal-actions"><button className="outline" type="button" disabled={data.busy} onClick={close}>Cancel</button><button className="primary" type="submit" disabled={data.busy}>{data.busy?'Saving…':'Save changes'}</button></div>{personal&&<button className="text-button" type="button" disabled={data.busy} onClick={async()=>{if(await perform('resetSettings',personal.id,{},'Shared defaults restored'))close()}}>Use shared defaults</button>}{bill?.creatorId===userId&&<button className="text-button" type="button" onClick={()=>{setPersonal(bill);setEditing(null)}}>Edit only my reminder, notes, and links</button>}
    </form></div>}
  </>;
}
