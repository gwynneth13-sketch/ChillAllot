export function choreMembers(chore,members){
 if(Array.isArray(chore.rotationIds))return chore.rotationIds.filter(id=>members.some(m=>m.id===id));
 const current=members.find(m=>m.name===chore.owner);return current?[current.id]:[];
}
export function advanceChore(chore,members){const ids=choreMembers(chore,members);if(!ids.length)return {...chore,rotationIds:[],owner:'',ownerId:null,next:''};const current=chore.ownerId||members.find(m=>m.name===chore.owner)?.id;const index=ids.indexOf(current);const ownerId=ids[(index+1)%ids.length],nextId=ids[(index+2)%ids.length];return {...chore,rotationIds:ids,ownerId,owner:members.find(m=>m.id===ownerId)?.name||'',next:members.find(m=>m.id===nextId)?.name||''};}
