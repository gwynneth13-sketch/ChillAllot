import test from 'node:test';
import assert from 'node:assert/strict';
import {billNotificationTarget} from '../src/lib/billModel.js';
const bill={id:'rent',creatorId:'owner',name:'Rent',payerIds:['me','other'],currentPaidIds:[],due:'2026-10-20',cadence:'Monthly',cycles:[]};
test('bill notifications find upcoming and overdue cards without changing a search',()=>{
 assert.deepEqual(billNotificationTarget([bill],'rent','2026-10-20','me','2026-10-08'),{filter:'Upcoming',billId:'rent',due:'2026-10-20'});
 assert.equal(billNotificationTarget([bill],'rent','2026-10-20','me','2026-10-21').filter,'Overdue');
});
test('paid notifications open history; a partial payment routes next-month reminders to the preview',()=>{
 const paid={...bill,currentPaidIds:['me'],cycles:[{due:bill.due,paidIds:['me'],snapshot:bill}]};
 assert.equal(billNotificationTarget([paid],'rent',bill.due,'me','2026-10-21').filter,'Paid');
 assert.deepEqual(billNotificationTarget([paid],'rent','2026-11-20','me','2026-10-21'),{filter:'Upcoming',billId:'rent',due:'2026-11-20'});
});
test('missing, inaccessible and changed occurrences produce no card target',()=>{
 assert.equal(billNotificationTarget([],'rent',bill.due,'me','2026-10-08'),null);
 assert.equal(billNotificationTarget([bill],'rent','2026-10-19','me','2026-10-08'),null);
});
