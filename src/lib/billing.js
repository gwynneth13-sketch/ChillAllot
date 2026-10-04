import { supabase } from './supabase.js';

export async function billRequest(householdId, action='list', billId='', values={}) {
  const { data, error } = await supabase.rpc('bill_workspace', { target_household: householdId, operation: action, target_bill: billId, input_values: values });
  if(error) throw new Error(error.code==='PGRST202'?'The bill database update is needed before this screen can be used.':error.message);
  return data;
}

export function nextBillDate(date,cadence) {
  const d=new Date(date+'T12:00:00'), day=d.getDate(), month=d.getMonth();
  const match=(cadence||'').match(/^Every (\d+) (days?|weeks?|months?|years?)$/i);
  const count=match?Number(match[1]):1;
  const unit=match?match[2].toLowerCase().replace(/s$/,''):cadence?.includes('Monthly')?'month':cadence==='Annually'?'year':cadence==='Weekly'?'week':'';
  if(!unit)return date;
  if(unit==='day'||unit==='week')d.setDate(day+count*(unit==='week'?7:1));
  else {d.setDate(1);if(unit==='month')d.setMonth(month+count);else d.setFullYear(d.getFullYear()+count);d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));}
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function billRows(bills,filter,userId,today,query='') {
  return bills.filter(b=>b.creatorId).flatMap(b=>{
    const mine=b.payerIds.includes(userId), paid=b.cycles?.find(c=>c.due===b.due)?.paidIds.includes(userId);
    if(filter==='Paid')return (b.cycles||[]).filter(c=>c.paidIds.includes(userId)).map(c=>({...b,...c.snapshot,due:c.due,source:b,paidIds:c.paidIds,history:true}));
    if(b.cadence==='One-time'&&b.payerIds.every(id=>(b.currentPaidIds||[]).includes(id)))return [];
    if(!mine)return filter==='Overdue'?(b.due<today?[{...b,source:b}]:[]):b.due>=today?[{...b,source:b}]:[];
    if(paid&&b.cadence==='One-time')return [];
    const row=paid?{...b,due:nextBillDate(b.due,b.cadence),nextPreview:true,source:b}:{...b,source:b};
    return filter==='Overdue'?(row.due<today?[row]:[]):row.due>=today?[row]:[];
  }).filter(b=>b.name.toLowerCase().includes(query.trim().toLowerCase())&&(filter!=='Overdue'||b.due<today)).sort((a,b)=>filter==='Paid'?b.due.localeCompare(a.due):a.due.localeCompare(b.due));
}
