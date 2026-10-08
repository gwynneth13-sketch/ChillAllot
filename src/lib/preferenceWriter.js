// Serialize writes so slow older requests cannot overwrite newer preferences.
export function createPreferenceWriter(save, onResult) {
  let active = true, pending = null, running = false;
  async function drain() {
    running = true;
    while (active && pending !== null) {
      const value = pending;
      pending = null;
      let error = null;
      try { error = (await save(value))?.error || null; }
      catch (failure) { error = failure; }
      if (active && pending === null) onResult(error);
    }
    running = false;
  }
  return {
    write(value) {
      if (!active) return;
      pending = value;
      if (!running) void drain();
    },
    dispose() { active = false; pending = null; },
  };
}
