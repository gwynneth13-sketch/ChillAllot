import React, {useEffect, useState} from 'react';
import {iosPush, iosPushReady} from '../lib/iosPush.js';

export default function IosPushPreferences({cloud}) {
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => iosPush.subscribe(setEnabled), []);
  const change = async () => {
    setBusy(true); setError('');
    try {await (enabled ? iosPush.disable() : iosPush.enable());}
    catch (error) {setError(error.message || 'Phone notifications could not be updated.');}
    finally {setBusy(false);}
  };
  return <section className="unlock-preferences"><h2>Phone notifications</h2>
    <p className="modal-description">Receive household updates even when ChillAllot is closed.</p>
    {!cloud ? <p className="helper">Sign in to enable phone notifications.</p> : !iosPushReady ?
      <p className="helper">Phone notification setup is being completed.</p> :
      <button type="button" className="outline small" disabled={busy} onClick={change}>
        {busy ? 'Please wait…' : enabled ? 'Turn off on this device' : 'Enable on this device'}
      </button>}
    {error && <p className="form-message" role="alert">{error}</p>}
  </section>;
}
