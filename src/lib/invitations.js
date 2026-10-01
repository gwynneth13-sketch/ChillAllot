const pendingKey = 'chillallot.pendingInvite';

export function invitationUrl(code) {
  const url = new URL('/', window.location.origin);
  url.searchParams.set('invite', code.trim().toUpperCase());
  return url.toString();
}

export function pendingInvitation() {
  const params = new URLSearchParams(window.location.search);
  const fromLink = params.get('invite');
  if (fromLink !== null) {
    const code = fromLink.trim().toUpperCase();
    try { sessionStorage.setItem(pendingKey, code); } catch {}
    return code;
  }
  try { return sessionStorage.getItem(pendingKey) || ''; } catch { return ''; }
}

export function clearInvitation() {
  try { sessionStorage.removeItem(pendingKey); } catch {}
  const url = new URL(window.location.href);
  url.searchParams.delete('invite');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}
