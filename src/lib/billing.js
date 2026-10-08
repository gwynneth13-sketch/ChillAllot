import { supabase } from './supabase.js';

export async function billRequest(householdId, action='list', billId='', values={}) {
  const { data, error } = await supabase.rpc('bill_workspace', { target_household: householdId, operation: action, target_bill: billId, input_values: values });
  if(error) throw new Error(error.code==='PGRST202'?'The bill database update is needed before this screen can be used.':error.message);
  return data;
}

export {nextBillDate,billRows,splitBillAmounts} from './billModel.js';
