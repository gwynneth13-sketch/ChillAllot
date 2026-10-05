import React from 'react';
import SectionIcon from './SectionIcon.jsx';
export default function NotificationInbox({items,onOpen,onViewAll,onMarkAll,compact=false}){
 const unread=items.filter(n=>!n.read).length;
 return <section className="notification-inbox"><div className="inbox-heading"><h2>Notifications</h2>{unread>0&&<small>{unread} unread</small>}{compact?<button className="text-button" onClick={onViewAll}>View all</button>:items.length>0&&<button className="text-button" onClick={onMarkAll}>Mark all read</button>}</div>{!compact&&<p className="inbox-description">Your reminders and household updates.</p>}<div className="inbox-entries">{items.length?items.slice(0,compact?3:items.length).map(n=><button className="inbox-entry" key={n.id} onClick={()=>onOpen(n)}><SectionIcon name={n.section}/><span><strong>{n.title}</strong><p>{n.detail}</p><small>{n.time}</small></span>{!n.read&&<span className="inbox-dot" aria-label="Unread"/>}</button>):<p className="inbox-empty">You’re all caught up.</p>}</div></section>
}
