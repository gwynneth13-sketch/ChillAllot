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
    const row=paid?{...b,due:nextBillDate(b.due,b.cadence),amount:b.amountType==='variable'?null:b.amount,nextPreview:true,source:b}:{...b,source:b};
    return filter==='Overdue'?(row.due<today?[row]:[]):row.due>=today?[row]:[];
  }).filter(b=>b.name.toLowerCase().includes(query.trim().toLowerCase())&&(filter!=='Overdue'||b.due<today)).sort((a,b)=>filter==='Paid'?b.due.localeCompare(a.due):a.due.localeCompare(b.due));
}

// Resolve from the currently authorized workspace, including paid history.
export function billNotificationTarget(bills,billId,due,userId,today) {
  for(const filter of ['Upcoming','Overdue','Paid']){
    const row=billRows(bills,filter,userId,today).find(b=>b.id===billId&&(!due||b.due===due));
    if(row)return {filter,billId:row.id,due:row.due};
  }
  return null;
}

// Allocate whole cents first, then distribute residual cents by largest remainder.
// Member IDs break ties consistently, regardless of display order.
export function splitBillAmounts(amount,allocations=[]) {
  if(amount==null||!allocations.length)return [];
  const cents=BigInt(Math.round(Number(amount)*100));
  const weights=allocations.map(a=>BigInt(Number(a.percent).toFixed(12).replace('.','')));
  const total=weights.reduce((n,w)=>n+w,0n);if(total<=0n)return [];
  const parts=allocations.map((a,i)=>({userId:a.userId,cents:cents*weights[i]/total,remainder:cents*weights[i]%total}));
  const remaining=Number(cents-parts.reduce((n,a)=>n+a.cents,0n));
  const order=[...parts].sort((a,b)=>a.remainder>b.remainder?-1:a.remainder<b.remainder?1:a.userId.localeCompare(b.userId));
  for(let i=0;i<remaining;i++)order[i].cents++;
  return parts.map(a=>({userId:a.userId,amount:Number(a.cents)/100}));
}
