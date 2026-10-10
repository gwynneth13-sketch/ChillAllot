import React,{useEffect,useRef,useState} from 'react';

export default function AppointmentCards({appointments,account,members,today,focusRequest,onReminder,onEdit,onRemove,onAssign,ui}){
 const [focused,setFocused]=useState(null),[routeError,setRouteError]=useState('');
 const handled=useRef(null),card=useRef(null);
 useEffect(()=>{
  if(!focusRequest||handled.current===focusRequest)return;
  handled.current=focusRequest;
  const target=appointments.find(a=>a.id===focusRequest.appointmentId);
  setFocused(target?.id||null);
  setRouteError(target?'':'This appointment was removed, changed, or is no longer shared with you.');
 },[focusRequest,appointments]);
 useEffect(()=>{if(focused){card.current?.scrollIntoView({block:'center'});card.current?.focus({preventScroll:true});}},[focused,focusRequest]);
 const {formatReminderTime,formatDateDisplay,reminderLabel}=ui;
 return <>
  {routeError&&<p className="form-message" role="status">{routeError}</p>}
  <div className="card-list">{appointments.map(a=><article className={'appointment-card'+(focused===a.id?' appointment-notification-target':'')} key={a.id} tabIndex={-1} ref={focused===a.id?card:null}>
   <div className="appointment-body"><div className="appt-heading"><strong>{a.name}</strong>
    {a.date&&a.date<today&&<button type="button" className="outline small old-appointment" onClick={()=>onRemove(a)}>Delete old appointment</button>}
    <span className="tag">{a.for?`FOR ${a.for.toUpperCase()}`:'HOUSEHOLD'}</span>{a.video&&<span className="tag violet">VIDEO</span>}
   </div>
   <p>◷ &nbsp;{formatReminderTime(a.time)} &nbsp; · &nbsp; {formatDateDisplay(a.date)}</p>
   {a.place&&<p>⌖ &nbsp;{a.place} &nbsp;·&nbsp; <a href={a.video?'https://meet.example.com/therapy':'https://maps.google.com/?q='+encodeURIComponent(a.place)} target="_blank" rel="noreferrer">{a.video?'Join video call':'Open map'} ↗</a></p>}
   {a.note&&<p>📝 &nbsp;{a.note}</p>}
   <button type="button" className="plain appt-reminder appointment-reminder-link" aria-label={(a.reminder?'Change reminder for ':'Set reminder for ')+a.name} onClick={()=>onReminder(a)}>
    {a.reminder?<>🔔 &nbsp;{reminderLabel(a.reminder).replace(/^Every\s+/i,'')}{a.reminderTime&&<> <span>·</span> {formatReminderTime(a.reminderTime)}</>}</>:<>🔔 &nbsp;Set reminder</>}
   </button>
   <div className="appt-actions">{a.creatorId===account.id?<button className="outline small" onClick={()=>onEdit(a)}>Edit</button>:<button className="outline small" onClick={()=>onReminder(a)}>My reminder</button>}
    {!a.creatorId&&members.some(m=>m.id===account.id&&m.role==='Owner')&&<button className="outline small" onClick={()=>onAssign(a)}>Assign creator</button>}
    <button className="plain small" onClick={()=>onRemove(a)}>Remove</button>
   </div></div>
  </article>)}{appointments.length===0&&<div className="empty">No appointments yet. Add an appointment to start your list.</div>}</div>
 </>;
}
