import { requireSupabase } from './supabase.js';

export async function householdInvitation(operation, values={}) {
  const {data,error}=await requireSupabase().rpc('household_invitation', {operation,input_values:values});
  if(error) throw Error(error.code==='PGRST202'?'The invitation database update is needed before using invitations.':error.message);
  return data;
}
