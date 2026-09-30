import { requireSupabase } from './supabase.js';

export async function createAccount({ email, password, name }) {
  const client = requireSupabase();
  const { data, error } = await client.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: { data: { display_name: name.trim() } },
  });
  if (error) throw error;
  return data;
}

export async function signIn({ email, password }) {
  const client = requireSupabase();
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await requireSupabase().auth.signOut();
  if (error) throw error;
}

export async function getHouseholdsForUser(userId) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('household_members')
    .select('role,households(id,name,invite_code,created_at)')
    .eq('user_id', userId);
  if (error) throw error;
  return (data || []).map(({ role, households }) => ({ ...households, role }));
}

export async function getHouseholdMembers(householdId) {
  const { data, error } = await requireSupabase()
    .from('household_members')
    .select('role,profiles(id,display_name,badge_color,avatar_key)')
    .eq('household_id', householdId);
  if (error) throw error;
  return (data || []).map(({ role, profiles }) => ({
    id: profiles.id,
    name: profiles.display_name || 'Household member',
    email: '',
    role: role === 'owner' ? 'Owner' : 'Member',
    badgeColor: profiles.badge_color || 'sage',
    avatarKey: profiles.avatar_key || 'initial',
  }));
}

export async function getMyProfile(userId) {
  const { data, error } = await requireSupabase()
    .from('profiles')
    .select('display_name,badge_color,avatar_key')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateMyBadge({ color, avatar }) {
  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  const { error } = await client.from('profiles').update({ badge_color: color, avatar_key: avatar || 'initial', updated_at: new Date().toISOString() }).eq('id', user.id);
  if (error) throw error;
}

export async function createHousehold(name) {
  const { data, error } = await requireSupabase().rpc('create_household', { household_name: name });
  if (error) throw error;
  return data;
}

export async function joinHousehold(inviteCode) {
  const { data, error } = await requireSupabase().rpc('join_household', { invite_code_input: inviteCode });
  if (error) throw error;
  return data;
}

export async function readHouseholdData(householdId, dataKey) {
  const { data, error } = await requireSupabase()
    .from('household_data')
    .select('payload')
    .eq('household_id', householdId)
    .eq('data_key', dataKey)
    .maybeSingle();
  if (error) throw error;
  return data?.payload ?? null;
}

export async function writeHouseholdData(householdId, dataKey, payload) {
  const { error } = await requireSupabase()
    .from('household_data')
    .upsert({ household_id: householdId, data_key: dataKey, payload, updated_at: new Date().toISOString() }, {
      onConflict: 'household_id,data_key',
    });
  if (error) throw error;
}
