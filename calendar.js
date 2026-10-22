/* D7's device-local calendar. Only an explicit form submission schedules a route. */
const D7Calendar = (() => {
  const KEY = "d7CalendarV1";
  const el = id => document.getElementById(id);
  const editor = el("calendar-editor");
  let draft = null;
  let editingId = null;
  let editingOriginal = null;
  let selected = dateKey(new Date());
  let month = selected.slice(0, 7);

  // Date-only strings deliberately avoid UTC conversion and daylight-saving shifts.
  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  function parseDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Choose a valid date.");
    const [year, m, day] = value.split("-").map(Number);
    const date = new Date(year, m - 1, day, 12);
    if (year < 1900 || year > 9999 || dateKey(date) !== value) throw new Error("Choose a valid date.");
    return date;
  }
  function pretty(value) {
    return parseDate(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function notice(text) { el("calendar-message").textContent = text; }
  function read() {
    const data = JSON.parse(localStorage.getItem(KEY) || '{"version":1,"entries":[]}');
    if (!data || data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 500) {
      throw new Error("Calendar data could not be read. Existing data has been kept.");
    }
    const ids = new Set();
    return data.entries.map(entry => {
      if (!entry || typeof entry.id !== "string" || !entry.id || ids.has(entry.id) ||
          typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 128) {
        throw new Error("Calendar data could not be read. Existing data has been kept.");
      }
      ids.add(entry.id);
      parseDate(entry.startDate); parseDate(entry.endDate);
      if (entry.endDate < entry.startDate) throw new Error("Calendar dates could not be read. Existing data has been kept.");
      const route = normalizeBackupRoutes({ route: entry.route }).route;
      return { id: entry.id, name: entry.name, startDate: entry.startDate, endDate: entry.endDate, route };
    });
  }
  function write(entries) {
    if (entries.length > 500) throw new Error("This calendar can hold up to 500 routes.");
    // One atomic storage write; quota or access errors leave the previous value intact.
    localStorage.setItem(KEY, JSON.stringify({ version: 1, entries }));
  }
  function node(tag, text, className) {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
  }
  function button(text, action) {
    const item = node("button", text, "btn");
    item.type = "button";
    item.addEventListener("click", action);
    return item;
  }
  function dates(entry) {
    return entry.startDate === entry.endDate ? pretty(entry.startDate) : `${pretty(entry.startDate)} – ${pretty(entry.endDate)}`;
  }
  function currentSnapshot() {
    if (!routePlan || !routeShown || routeRequestPending || tripProgress ||
        startInput.value.trim() !== routePlan.start || destinationInput.value.trim() !== routePlan.destination ||
        JSON.stringify(stops) !== JSON.stringify(routePlan.stops)) {
      throw new Error("Plan the final route before adding it to the calendar.");
    }
    // Store user-entered addresses and their finalized order, not provider map results.
    return normalizeBackupRoutes({ route: {
      start: routePlan.start, destination: routePlan.destination, stops: [...routePlan.stops],
      stopLabels: stops.map((_, i) => stopLabels[i] || ""),
      stopFirst: stops.map((_, i) => !!stopFirst[i]),
      routeInstructions: el("route-instructions").value || "",
      routePriority: el("route-priority").value || "efficiency",
      northernCutoff: el("northern-cutoff").value || "40",
      vehicleMpg: positiveNumber(vehicleMpgInput.value) ? vehicleMpgInput.value : "15",
      fuelPrice: positiveNumber(fuelPriceInput.value) ? fuelPriceInput.value : "4.50"
    }}).route;
  }
  function openEditor(entry) {
    editingId = entry ? entry.id : null;
    editingOriginal = entry ? JSON.stringify(entry) : null;
    draft = entry ? entry.route : currentSnapshot();
    el("calendar-editor-heading").textContent = entry ? "Reschedule route" : "Add route to calendar";
    el("calendar-save").textContent = entry ? "Save changes" : "Add to calendar";
    el("calendar-name").value = entry ? entry.name : routeNameInput.value.trim();
    el("calendar-start").value = entry ? entry.startDate : selected;
    el("calendar-end").value = entry ? entry.endDate : selected;
    el("calendar-route-summary").textContent = `${draft.stops.length} stop${draft.stops.length === 1 ? "" : "s"} · ${draft.start} → ${draft.destination}. A separate copy keeps this stop order.`;
    editor.hidden = false;
    showView("calendar");
    render();
    el("calendar-name").focus();
  }
  function closeEditor() {
    editor.hidden = true;
    draft = null; editingId = null; editingOriginal = null;
  }
  function openRoute(entry) {
    if (tripProgress) {
      notice("Finish or end the active trip before loading another route.");
      return;
    }
    if ((startInput.value.trim() || destinationInput.value.trim() || stops.length) &&
        !window.confirm("Load this calendar route into the planner? This replaces the current draft. The calendar copy stays saved.")) return;
    const route = entry.route;
    invalidateRoute();
    startInput.value = route.start;
    destinationInput.value = route.destination;
    stops.splice(0, stops.length, ...route.stops);
    stopLabels.splice(0, stopLabels.length, ...route.stops.map((_, i) => (route.stopLabels || [])[i] || ""));
    stopFirst.splice(0, stopFirst.length, ...route.stops.map((_, i) => !!(route.stopFirst || [])[i]));
    el("route-instructions").value = route.routeInstructions || "";
    el("route-priority").value = route.routePriority || "efficiency";
    el("northern-cutoff").value = route.northernCutoff || "40";
    vehicleMpgInput.value = route.vehicleMpg;
    fuelPriceInput.value = route.fuelPrice;
    routeNameInput.value = entry.name;
    updatePrioritySummary(); renderStops();
    showView("plan", true);
    routeMessage.textContent = `Route loaded: ${entry.name}. Choose Keep My Order to refresh directions in the scheduled order.`;
  }
  function entryCard(entry) {
    const card = node("article", undefined, "calendar-entry");
    card.appendChild(node("h4", entry.name));
    card.appendChild(node("p", `${dates(entry)} · ${entry.route.stops.length} stop${entry.route.stops.length === 1 ? "" : "s"}`, "hint"));
    const details = node("details");
    details.appendChild(node("summary", "View route"));
    const list = node("ol", undefined, "calendar-route-list");
    list.appendChild(node("li", `Start: ${entry.route.start}`));
    entry.route.stops.forEach((address, index) => {
      const label = (entry.route.stopLabels || [])[index];
      list.appendChild(node("li", `Stop ${index + 1}: ${label ? label + " — " : ""}${address}`));
    });
    list.appendChild(node("li", `Finish: ${entry.route.destination}`));
    details.appendChild(list);
    card.appendChild(details);
    const actions = node("div", undefined, "calendar-actions");
    actions.appendChild(button("Load route", () => openRoute(entry)));
    actions.appendChild(button("Reschedule", () => { notice(""); openEditor(entry); }));
    actions.appendChild(button("Remove", () => {
      if (!window.confirm(`Remove “${entry.name}” from the calendar? Saved routes and trip reports are kept.`)) return;
      try {
        const entries = read();
        const latest = entries.find(item => item.id === entry.id);
        if (latest && JSON.stringify(latest) !== JSON.stringify(entry)) throw new Error("This entry changed in another tab. Reopen Calendar and try again.");
        write(entries.filter(item => item.id !== entry.id));
        if (editingId === entry.id) closeEditor();
        render(); notice("Route removed from calendar.");
      } catch (error) { notice("Could not remove route. " + error.message); }
    }));
    card.appendChild(actions);
    return card;
  }
  function render() {
    let entries;
    try { entries = read(); }
    catch (error) {
      el("calendar-days").innerHTML = "";
      el("calendar-entries").innerHTML = "";
      notice("Could not open calendar. " + error.message);
      return;
    }
    const first = parseDate(month + "-01");
    const year = first.getFullYear(), m = first.getMonth();
    const days = new Date(year, m + 1, 0, 12).getDate();
    el("calendar-month").textContent = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    el("calendar-previous").disabled = month === "1900-01";
    el("calendar-next").disabled = month === "9999-12";
    const grid = el("calendar-days");
    grid.innerHTML = "";
    for (let i = 0; i < first.getDay(); i++) grid.appendChild(node("span"));
    const today = dateKey(new Date());
    for (let day = 1; day <= days; day++) {
      const key = `${month}-${String(day).padStart(2, "0")}`;
      const count = entries.filter(entry => entry.startDate <= key && entry.endDate >= key).length;
      const item = button(String(day), () => { selected = key; render(); el("calendar-day-" + key).focus(); });
      item.id = "calendar-day-" + key;
      item.className = "calendar-day" + (count ? " has-routes" : "");
      item.setAttribute("aria-label", `${pretty(key)}${count ? `, ${count} scheduled route${count === 1 ? "" : "s"}` : ", no routes"}`);
      item.setAttribute("aria-pressed", String(key === selected));
      if (key === today) item.setAttribute("aria-current", "date");
      grid.appendChild(item);
    }
    el("calendar-day-heading").textContent = pretty(selected);
    const agenda = el("calendar-entries");
    agenda.innerHTML = "";
    const matching = entries.filter(entry => entry.startDate <= selected && entry.endDate >= selected)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!matching.length) agenda.appendChild(node("p", "No routes scheduled for this date. When your route is ready, choose Add to calendar from the planner.", "hint"));
    matching.forEach(entry => agenda.appendChild(entryCard(entry)));
  }
  el("view-calendar").addEventListener("click", () => { notice(""); showView("calendar", true); render(); });
  el("add-to-calendar").addEventListener("click", () => {
    try { read(); notice(""); openEditor(null); }
    catch (error) { routeMessage.textContent = "Could not schedule route. " + error.message; }
  });
  editor.addEventListener("submit", event => {
    event.preventDefault();
    try {
      if (!draft) throw new Error("Choose a route first.");
      const name = el("calendar-name").value.trim();
      if (!name || name.length > 128) throw new Error("Enter a route name of 1–128 characters.");
      const startDate = el("calendar-start").value, endDate = el("calendar-end").value;
      parseDate(startDate); parseDate(endDate);
      if (endDate < startDate) throw new Error("End date must be on or after the start date.");
      const entries = read();
      if (editingId && JSON.stringify(entries.find(item => item.id === editingId)) !== editingOriginal) {
        throw new Error("This entry changed in another tab. Cancel and reopen it before rescheduling.");
      }
      const duplicate = entries.some(item => item.id !== editingId && item.startDate === startDate && item.endDate === endDate &&
        JSON.stringify(item.route) === JSON.stringify(draft));
      if (duplicate) throw new Error("This route is already scheduled for those dates. Open its calendar entry to reschedule it.");
      const id = editingId || crypto.randomUUID();
      const entry = { id, name, startDate, endDate, route: draft };
      const changed = !!editingId;
      write([...entries.filter(item => item.id !== id), entry]);
      selected = startDate; month = startDate.slice(0, 7);
      closeEditor(); render();
      notice(changed ? "Calendar route updated." : "Route added to calendar.");
      el("calendar-heading").focus();
    } catch (error) { notice("Could not save calendar route. " + error.message); }
  });
  el("calendar-cancel").addEventListener("click", () => { closeEditor(); notice("Calendar unchanged."); el("calendar-heading").focus(); });
  function moveMonth(offset) {
    const date = parseDate(month + "-01");
    date.setMonth(date.getMonth() + offset);
    if (date.getFullYear() < 1900 || date.getFullYear() > 9999) return;
    selected = dateKey(date); month = selected.slice(0, 7); render();
  }
  el("calendar-previous").addEventListener("click", () => moveMonth(-1));
  el("calendar-next").addEventListener("click", () => moveMonth(1));
  el("calendar-today").addEventListener("click", () => { selected = dateKey(new Date()); month = selected.slice(0, 7); render(); });
  if (typeof window.addEventListener === "function") window.addEventListener("storage", event => {
    if ((event.key === KEY || event.key === null) && !el("calendar-view").hidden) render();
  });
  render();
  return { render };
})();
