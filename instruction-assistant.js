/* Optional translator. Only the text in the plain-English field leaves this page. */
const D7InstructionAssistant = (() => {
  const el = id => document.getElementById(id);
  const input = el('plain-instructions'), review = el('instruction-review');
  const rules = el('converted-instructions'), message = el('instruction-message');
  const button = el('convert-instructions');
  let generation = 0, controller, context = '', confirmed = false, applying = false;
  const routeContext = () => JSON.stringify([startInput.value, destinationInput.value, stops, stopLabels, el('route-instructions').value]);
  function cancel() { generation++; controller?.abort(); controller = null; button.disabled = false; }
  function reset() { cancel(); review.hidden = true; confirmed = false; message.textContent = ''; }
  input.addEventListener('input', () => { reset(); invalidateRoute(); });
  el('route-instructions').addEventListener('input', () => {
    if (applying) return;
    cancel(); review.hidden = true; confirmed = true;
    if (input.value.trim()) message.textContent = 'Using your edited supported rules below.';
  });
  function showReview(value, source) {
    D7Import.instructions(value, stops.length);
    rules.value = value; context = routeContext(); review.hidden = false;
    message.textContent = source + ' Review every rule, edit if needed, then confirm.';
    rules.focus();
  }
  const errors = {
    unsupported: 'This request cannot be fully expressed with the supported rules. Rephrase it using stop numbers, north/south priority or a latitude cutoff. Start/Finish belong in their address fields; weather deadlines and strict north-to-south sequencing are not supported.',
    sensitive_text: 'Remove addresses, contact details and coordinates from this text. Refer to stop numbers instead.',
    not_configured: 'Live AI conversion is not configured in this preview yet. Supported exact rules still work without AI.',
    rate_limited: 'The conversion limit has been reached. Try later, or enter supported rules directly.',
    unavailable: 'Conversion is unavailable. Try again, or enter supported rules directly.'
  };
  button.addEventListener('click', async () => {
    reset(); const text = input.value.trim();
    if (!text || text.length > 512) { message.textContent = 'Enter 1–512 characters.'; return; }
    // The existing parser gets first refusal; exact rules never require the backend.
    let exact = false;
    try { D7Import.instructions(text, 500); exact = true; } catch {}
    if (exact) {
      try { showReview(text, 'Recognized locally; no AI used.'); } catch (error) { message.textContent = error.message; }
      return;
    }
    if (navigator.onLine === false) { message.textContent = errors.unavailable; return; }
    const id = generation, originalContext = routeContext();
    const abort = new AbortController(); controller = abort; button.disabled = true;
    const timer = setTimeout(() => abort.abort(), 20000);
    message.textContent = 'Converting instruction text…';
    try {
      // Same-origin local bridge; a future deployment must configure its reviewed Worker URL.
      const endpoint = el('instruction-endpoint').content;
      const url = new URL(endpoint, location.href);
      if (url.origin !== location.origin && url.protocol !== 'https:') throw new Error();
      const response = await fetch(url.href, { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({text}), signal: abort.signal, credentials: 'omit', redirect: 'error' });
      const data = await response.json();
      if (id !== generation) return;
      if (text !== input.value.trim() || originalContext !== routeContext()) {
        message.textContent = 'The route or instructions changed. Convert again before confirming.'; return;
      }
      if (!response.ok) { message.textContent = errors[data.error] || errors.unavailable; return; }
      if (!data || Object.keys(data).length !== 1 || !Array.isArray(data.clauses) || !data.clauses.length ||
          data.clauses.some(c => typeof c !== 'string' || !/^(north first|south first|north cutoff: -?\d+(?:\.\d+)?|first stops: \d+(?:, \d+)*)$/.test(c))) throw new Error();
      showReview(data.clauses.join('; '), 'Converted rules are suggestions, not an approved plan.');
    } catch (error) {
      if (id === generation) message.textContent = error.name === 'AbortError' ? 'Conversion timed out. Try again or enter supported rules directly.' : errors.unavailable;
    } finally { clearTimeout(timer); if (id === generation) { controller = null; button.disabled = false; } }
  });
  el('confirm-instructions').addEventListener('click', () => {
    if (review.hidden || context !== routeContext()) { reset(); message.textContent = 'The route changed. Convert again before confirming.'; return; }
    try {
      const text = rules.value.trim();
      if (!text) throw new Error('Enter supported rules, or cancel the conversion.');
      D7Import.instructions(text, stops.length);
      applying = true; el('route-instructions').value = text;
      el('route-instructions').dispatchEvent(new Event('input', {bubbles:true})); applying = false;
      confirmed = true; review.hidden = true;
      message.textContent = 'Rules confirmed. Choose Plan Route to apply them. Keep My Order preserves the entered order.';
    } catch (error) { applying = false; message.textContent = error.message; }
  });
  el('cancel-instructions').addEventListener('click', () => { input.value = ''; reset(); message.textContent = 'Conversion cancelled. Existing supported rules are unchanged.'; });
  function beforePlan() {
    if (!input.value.trim() || confirmed) return true;
    input.closest('details').open = true;
    message.textContent = 'Convert and confirm your plain-English instructions, or cancel them, before planning.';
    message.scrollIntoView({block:'center'}); return false;
  }
  return {beforePlan};
})();
