(() => {
  const origin = 'https://d7-route-command-center.codydavidek0104.chatgpt.site';
  const queueKey = 'd7CommandCenterPendingV1';
  const sequenceKey = 'd7CommandCenterSequenceV1';
  let connection = null, ready = false, getActive = () => null;
  let pending = {}, sequence = 0, lastSaved = 0;
  try { pending = JSON.parse(localStorage.getItem(queueKey) || '{}'); sequence = Number(localStorage.getItem(sequenceKey)) || 0; } catch {}
  if (!pending || typeof pending !== 'object' || Array.isArray(pending)) pending = {};
  function status(text) { document.getElementById('command-center-status').textContent = text; }
  function persist() {
    try { localStorage.setItem(queueKey, JSON.stringify(pending)); localStorage.setItem(sequenceKey, String(sequence)); }
    catch { status('Progress could not be queued on this device. Keep the connection open and retry.'); }
  }
  function publish(trip) {
    if (!trip?.id || !trip.startedAt || !Array.isArray(trip.addresses) || !trip.addresses.length) return;
    // Only counts and timestamps cross to the private dashboard; no names, addresses, or coordinates.
    const completedStops = trip.addresses.filter((_, i) => trip.completedAt?.[i] === 'completed-time-not-recorded' ||
      (typeof trip.completedAt?.[i] === 'string' && Number.isFinite(Date.parse(trip.completedAt[i])))).length;
    sequence = Math.max(sequence + 1, Date.now());
    pending[trip.id] = {
      id: trip.id, sequence, totalStops: trip.addresses.length, completedStops,
      currentStop: Math.min(trip.addresses.length, Math.max(1, (trip.index ?? 0) + 1)),
      startedAt: trip.startedAt, endedAt: trip.endedAt || null,
      state: trip.endedAt ? completedStops === trip.addresses.length ? 'completed' : 'incomplete' : 'active'
    };
    persist(); flush();
  }
  function flush() {
    if (!connection || connection.closed || !ready) return;
    // Send one at a time so the receiver can acknowledge every queued final report.
    const next = Object.values(pending).sort((a,b) => a.sequence - b.sequence)[0];
    if (next) connection.postMessage({type:'d7-progress-update', trip:next}, origin);
  }
  document.getElementById('connect-command-center').addEventListener('click', () => {
    ready = false;
    connection = window.open(origin + '/?connect=1', 'd7-route-progress');
    status(connection ? 'In the command center window, sign in and choose Connect route progress.' : 'Allow the command center window to open, then try Connect again.');
  });
  window.addEventListener('message', event => {
    if (event.origin !== origin || event.source !== connection) return;
    const data = event.data;
    if (data?.type === 'd7-progress-ready') {
      ready = true; status('Connected. Stop progress will sync while the connection window stays open.');
      const active = getActive(); if (active) publish(active); else flush();
    } else if (data?.type === 'd7-progress-saved' && ready) {
      if (pending[data.id]?.sequence === data.sequence) { delete pending[data.id]; persist(); }
      lastSaved = Date.now(); status('Connected. Progress saved to your command center.'); flush();
    } else if (data?.type === 'd7-progress-disconnected') {
      ready = false; status('Disconnected. Use Connect to resume syncing.');
    }
  });
  setInterval(() => {
    if (!connection) return;
    if (connection.closed) {ready=false;connection=null;status('Connection window closed. Progress is queued on this device; reconnect to sync.');return;}
    if (!ready) {connection.postMessage({type:'d7-progress-hello'},origin);return;}
    const active = getActive();
    if (active) publish(active); else flush();
    if (Object.keys(pending).length && Date.now() - lastSaved > 45000) status('Waiting for the command center to save progress. Updates remain queued on this device.');
  }, 15000);
  window.addEventListener('online', flush);
  window.D7Progress = { publish, configure(readActive) { getActive = readActive; } };
})();
