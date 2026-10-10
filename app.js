    const MAX_STOPS = 20;
    // Optimize the complete route before splitting navigation URLs. Directions
    // supports 25 intermediate waypoints; keep the public 20-stop limit below it.
    const DIRECTIONS_WAYPOINT_LIMIT = 25;
    let map;
    let directionsService;
    let directionsRenderer;
    let routeMarkers = [];
    const MAPS_LOAD_TIMEOUT_MS = 15000;
    const ROUTE_REQUEST_TIMEOUT_MS = 20000;
    const MAPS_UNAVAILABLE_MESSAGE =
      "The map couldn't load. The Google Maps API key may not be authorized for this site.";
    const OFFLINE_MESSAGE = "You're offline. Saved routes and trip records are available on this device. Connect to use maps, address suggestions, planning, and navigation.";
    let mapsUnavailable = false;
    let mapsAuthFailed = false;

    function handleMapsLoadFailure() {
      clearTimeout(mapsLoadTimer);
      mapsUnavailable = true;
      if (routeRequestPending) {
        // Abandon any in-flight request; its callback may never arrive.
        routeRequestId += 1;
        routeRequestPending = false;
      }
      routeMessage.textContent = navigator.onLine === false ? OFFLINE_MESSAGE : MAPS_UNAVAILABLE_MESSAGE;
      document.getElementById("map").hidden = true;
      const mapNote = document.getElementById("map-access-note");
      mapNote.hidden = false;
      mapNote.textContent = navigator.onLine === false ? OFFLINE_MESSAGE :
        "The live map is unavailable. This Google Maps key is not authorized for this site, or Maps could not load. You can still edit and save routes.";
      // Legacy Places may disable its inputs while handling an authorization
      // failure. Restore plain-text editing after that handler has finished.
      setTimeout(() => {
        startInput.disabled = false;
        destinationInput.disabled = false;
        startInput.style.backgroundImage = "none";
        destinationInput.style.backgroundImage = "none";
        stopInput.style.backgroundImage = "none";
        updateStopCounter();
        for (const row of stopsContainer.children) {
          row.children[1].disabled = false;
          row.children[1].style.backgroundImage = "none";
        }
      }, 0);
    }

    // Google calls this on key/referrer errors such as RefererNotAllowedMapError.
    window.gm_authFailure = () => {
      mapsAuthFailed = true;
      handleMapsLoadFailure();
    };

    const mapsLoadTimer = setTimeout(() => {
      if (!directionsService) handleMapsLoadFailure();
    }, MAPS_LOAD_TIMEOUT_MS);

    function initMap() {
      clearTimeout(mapsLoadTimer);
      if (mapsUnavailable && !mapsAuthFailed) {
        // A slow load arrived after the timeout.
        mapsUnavailable = false;
        if (routeMessage.textContent === MAPS_UNAVAILABLE_MESSAGE) {
          routeMessage.textContent = "";
        }
      }

      map = new google.maps.Map(document.getElementById("map"), {
        center: { lat: 38.5816, lng: -121.4944 },
        zoom: 10,
        styles: typeof D7_MAP_STYLE !== "undefined" ? D7_MAP_STYLE : [],
        mapTypeControl: true,
        fullscreenControl: true,
        zoomControl: true,
        streetViewControl: false,
      });

      directionsService = new google.maps.DirectionsService();
      directionsRenderer = new google.maps.DirectionsRenderer({
        polylineOptions: typeof D7_ROUTE_STYLE !== "undefined" ? D7_ROUTE_STYLE : { strokeColor: "#ed2944", strokeWeight: 5 },
      });
      directionsRenderer.setMap(map);
      if (!mapsAuthFailed) {
        document.getElementById("map").hidden = false;
        document.getElementById("map-access-note").hidden = true;
      }
      attachAllAutocompletes();
    }


    const stops = [];

    const stopInput = document.getElementById("stop-input");
    const addStopButton = document.getElementById("add-stop");
    const stopsContainer = document.getElementById("stops-container");
    const stopCounter = document.getElementById("stop-counter");
    const startInput = document.getElementById("start");
    const destinationInput = document.getElementById("destination");
    const planButton = document.getElementById("plan-route");
    const routeMessage = document.getElementById("route-message");
    const vehicleMpgInput = document.getElementById("vehicle-mpg");
    const fuelPriceInput = document.getElementById("fuel-price");
    const fuelSettings = document.getElementById("fuel-settings");
    const fuelShortcut = document.getElementById("view-fuel");
    const routeNameInput = document.getElementById("route-name");
    const saveRouteButton = document.getElementById("save-route");
    const savedRouteSelect = document.getElementById("saved-route-select");
    const loadRouteButton = document.getElementById("load-route");
    const deleteRouteButton = document.getElementById("delete-route");
    const exportRoutesButton = document.getElementById("export-routes");
    const importRoutesFile = document.getElementById("import-routes-file");
    const backupMessage = document.getElementById("backup-message");
    const SAVED_ROUTES_KEY = "d7SavedRoutes";
    const TRIP_PROGRESS_KEY = "d7TripProgress";
    const TRIP_REPORTS_KEY = "d7TripReports";
    const DRIVER_NAME_KEY = "d7DriverName";
    // Legacy progress has no times; stops before its index were already passed.
    const COMPLETED_UNRECORDED = "completed-time-not-recorded";
    const routeStaleWarning = document.getElementById("route-stale-warning");
    const navigationResults = document.getElementById("navigation-results");
    const navigationControls = document.getElementById("navigation-controls");
    const startFromLocation = document.getElementById("start-from-location");
    const tripPanel = document.getElementById("trip-panel");
    const tripStopNumber = document.getElementById("trip-stop-number");
    const tripStopAddress = document.getElementById("trip-stop-address");
    const tripNextButton = document.getElementById("trip-next");
    const tripBackButton = document.getElementById("trip-back");
    const finishTripButton = document.getElementById("finish-trip");
    const reportPanel = document.getElementById("trip-report");
    const reportMessage = document.getElementById("report-message");
    const driverNameInput = document.getElementById("driver-name");
    const reportNotes = document.getElementById("report-notes");
    const shareReportButton = document.getElementById("share-report");
    const historyMessage = document.getElementById("history-message");
    let routeRequestId = 0;
    let routeRequestPending = false;
    let pendingRouteOptimize = true;
    let routeShown = false;
    let navigationPoints = null;
    let routePlan = null;
    let tripProgress = null;
    let currentReport = null;

    function showView(selected, focusHeading = false) {
      document.getElementById("journey-controls").hidden = selected !== "plan";
      for (const name of ["plan", "saved", "reports"]) {
        document.getElementById(name + "-view").hidden = name !== selected;
        document.getElementById("view-" + name).setAttribute("aria-current", name === selected ? "page" : "false");
      }
      if (focusHeading) {
        const id = selected === "plan" ? (tripProgress ? "trip-heading" : "route-heading") : selected === "saved" ? "saved-heading" : "reports-heading";
        document.getElementById(id).focus();
      }
    }
    document.getElementById("view-plan").addEventListener("click", () => showView("plan", true));
    document.getElementById("view-saved").addEventListener("click", () => showView("saved", true));
    document.getElementById("view-reports").addEventListener("click", () => showView("reports", true));
    const syncFuelDisclosure = () => fuelShortcut.setAttribute("aria-expanded", String(fuelSettings.open));
    fuelSettings.addEventListener("toggle", syncFuelDisclosure);
    fuelShortcut.addEventListener("click", () => {
      showView("plan");
      fuelSettings.open = true;
      syncFuelDisclosure();
      vehicleMpgInput.focus();
    });
    syncFuelDisclosure();
    for (const id of ["home-link", "skip-link"]) {
      document.getElementById(id).addEventListener("click", event => {
        event.preventDefault();
        showView("plan", true);
      });
    }
    showView("plan");

    function mapsUrl(destination, origin, waypoints = []) {
      const parameters = ["api=1"];
      if (origin) {
        parameters.push("origin=" + encodeURIComponent(origin));
      }
      parameters.push("destination=" + encodeURIComponent(destination));
      if (waypoints.length) {
        parameters.push("waypoints=" + waypoints.map(encodeURIComponent).join("|"));
      }
      parameters.push("travelmode=driving");
      return "https://www.google.com/maps/dir/?" + parameters.join("&");
    }

    function showNavigation(points) {
      navigationPoints = points;
      const itinerary = document.getElementById("route-itinerary");
      itinerary.innerHTML = "";
      points.forEach((address, index) => {
        const item = document.createElement("li");
        const label = index === 0 ? "Start" : index === points.length - 1 ? "Finish" : `Stop ${index}`;
        item.textContent = `${label}: ${address}`;
        itinerary.appendChild(item);
      });
      navigationControls.innerHTML = "";
      // Mobile browsers accept only three URL waypoints; other clients accept
      // nine. Split the already optimized order, keeping each boundary shared.
      const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "") ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const step = (mobile ? 3 : 9) + 1;
      const legs = [];
      for (let first = 0; first < points.length - 1; first += step) {
        legs.push(points.slice(first, Math.min(first + step + 1, points.length)));
      }
      legs.forEach((leg, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = legs.length === 1 ? "Navigate" :
          `Navigate leg ${index + 1} of ${legs.length}`;
        button.addEventListener("click", () => {
          window.open(mapsUrl(leg[leg.length - 1], index === 0 && startFromLocation.checked ? null : leg[0], leg.slice(1, -1)), "_blank");
        });
        navigationControls.appendChild(button);
      });
      navigationResults.hidden = !!tripProgress;
    }

    function renderTrip() {
      tripPanel.hidden = !tripProgress;
      document.getElementById("planner-fields").hidden = !!tripProgress;
      document.getElementById("planner-actions").hidden = !!tripProgress;
      navigationResults.hidden = !!tripProgress || !navigationPoints;
      if (!tripProgress) return;
      fuelSettings.open = false;
      syncFuelDisclosure();
      const { addresses, index } = tripProgress;
      tripStopNumber.textContent = `Stop ${index + 1} of ${addresses.length}`;
      tripStopAddress.textContent = addresses[index];
      tripBackButton.disabled = index === 0;
      // A repeated arrival, including at the destination, replaces the earlier time.
      tripNextButton.disabled = false;
      finishTripButton.hidden = !tripProgress.completedAt[addresses.length - 1];
    }

    function saveTrip() {
      try {
        localStorage.setItem(TRIP_PROGRESS_KEY, JSON.stringify(tripProgress));
      } catch {
        routeMessage.textContent = "Could not save trip progress on this device.";
      }
      renderTrip();
    }

    document.getElementById("start-trip").addEventListener("click", () => {
      if (!navigationPoints || !routePlan) return;
      // Preserve an active trip until the driver explicitly finishes or ends it.
      if (tripProgress) {
        routeMessage.textContent = "Finish or end the current trip before starting another.";
        return;
      }
      const mpg = positiveNumber(vehicleMpgInput.value);
      const fuelPrice = positiveNumber(fuelPriceInput.value);
      tripProgress = {
        id: newReportId(), addresses: navigationPoints.slice(1), index: 0,
        startedAt: new Date().toISOString(),
        completedAt: navigationPoints.slice(1).map(() => null),
        routeSnapshot: {
          ...JSON.parse(JSON.stringify(routePlan)), mpg, fuelPrice,
          fuelCost: estimatedFuelCost(Number(routePlan.plannedMiles.toFixed(1)))
        }
      };
      saveTrip();
    });
    document.getElementById("navigate-stop").addEventListener("click", () => {
      if (tripProgress) window.open(mapsUrl(tripProgress.addresses[tripProgress.index]), "_blank");
    });
    tripNextButton.addEventListener("click", () => {
      if (tripProgress) {
        tripProgress.completedAt[tripProgress.index] = new Date().toISOString();
        if (tripProgress.index < tripProgress.addresses.length - 1) tripProgress.index += 1;
        saveTrip();
      }
    });
    tripBackButton.addEventListener("click", () => {
      if (tripProgress && tripProgress.index > 0) {
        tripProgress.index -= 1;
        saveTrip();
      }
    });
    document.getElementById("end-trip").addEventListener("click", () => {
      if (!tripProgress) return;
      if (tripProgress.completedAt.some(time => !time) &&
        !window.confirm("End trip early? The report will show it as incomplete.")) return;
      finishTrip();
    });
    finishTripButton.addEventListener("click", () => {
      if (tripProgress && tripProgress.completedAt[tripProgress.addresses.length - 1]) finishTrip();
    });

    function positiveNumber(value) {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number : null;
    }

    function estimatedFuelCost(miles) {
      const mpg = positiveNumber(vehicleMpgInput.value);
      const price = positiveNumber(fuelPriceInput.value);
      if (!mpg || !price || !Number.isFinite(miles) || miles < 0) return null;
      const cost = miles / mpg * price;
      return Number.isFinite(cost) ? cost : null;
    }

    function refreshFuelEstimate() {
      // Fuel edits change only the estimate for an existing valid plan. Active
      // trips retain the settings captured at their start, including the readout.
      if (!routeShown || !routePlan || tripProgress) return;
      const cost = estimatedFuelCost(Number(routePlan.plannedMiles.toFixed(1)));
      document.getElementById("stat-fuel").textContent = cost === null ? "—" : `$${cost.toFixed(2)}`;
      if (/^Route (?:calculated|optimized):/.test(routeMessage.textContent)) {
        routeMessage.textContent = routeMessage.textContent.replace(/ • Est\. fuel:.*$/, "") +
          (cost === null ? "" : ` • Est. fuel: $${cost.toFixed(2)}`);
      }
    }
    vehicleMpgInput.addEventListener("input", refreshFuelEstimate);
    fuelPriceInput.addEventListener("input", refreshFuelEstimate);

    function newReportId() {
      return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    }

    function validTime(value) {
      return typeof value === "string" && Number.isFinite(Date.parse(value));
    }

    function readDriverName() {
      try { return localStorage.getItem(DRIVER_NAME_KEY) || ""; } catch { return ""; }
    }

    function getTripReports() {
      try {
        const reports = JSON.parse(localStorage.getItem(TRIP_REPORTS_KEY));
        return Array.isArray(reports) ? reports.filter(report => report && typeof report.id === "string" &&
          validTime(report.endedAt) && Array.isArray(report.addresses) &&
          report.addresses.every(address => typeof address === "string") &&
          Array.isArray(report.completedAt) && report.routeSnapshot) : [];
      } catch { return []; }
    }

    function writeTripReports(reports) {
      try {
        localStorage.setItem(TRIP_REPORTS_KEY, JSON.stringify(reports.slice(0, 100)));
        return true;
      } catch { return false; }
    }

    function reportDate(timestamp) {
      const date = new Date(timestamp);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    function timestampText(timestamp) {
      return validTime(timestamp) ? new Date(timestamp).toLocaleString() : "Not recorded";
    }

    function numberText(value, digits = 1, suffix = "", prefix = "") {
      return typeof value === "number" && Number.isFinite(value) ? prefix + value.toFixed(digits) + suffix : "Not recorded";
    }

    function stopsCompleted(report) {
      return report.addresses.filter((_, index) => validTime(report.completedAt[index]) ||
        report.completedAt[index] === COMPLETED_UNRECORDED).length;
    }

    function finishTrip() {
      const endedAt = new Date().toISOString();
      const report = {
        id: tripProgress.id, date: reportDate(tripProgress.startedAt || endedAt),
        driver: readDriverName(), startedAt: tripProgress.startedAt, endedAt,
        elapsedMinutes: tripProgress.startedAt ? Math.max(0, (Date.parse(endedAt) - Date.parse(tripProgress.startedAt)) / 60000) : null,
        addresses: [...tripProgress.addresses], completedAt: [...tripProgress.completedAt],
        routeSnapshot: JSON.parse(JSON.stringify(tripProgress.routeSnapshot)),
        notes: currentReport?.id === tripProgress.id ? currentReport.notes : ""
      };
      report.incomplete = stopsCompleted(report) < report.addresses.length;
      // Save first: a storage failure must not discard the active trip.
      const reports = [report, ...getTripReports().filter(item => item.id !== report.id)];
      if (!writeTripReports(reports)) {
        showReport(report);
        reportMessage.textContent = "Could not save the report on this device. Your trip is still active; try finishing again. You can copy or share this report now.";
        return;
      }
      tripProgress = null;
      try { localStorage.removeItem(TRIP_PROGRESS_KEY); } catch { /* A saved report ID also prevents stale restoration. */ }
      renderTrip();
      renderReportHistory();
      showReport(report);
      reportMessage.textContent = "Report saved.";
    }

    function reportSummaryLines(report) {
      const route = report.routeSnapshot;
      return [
        `Date: ${report.date}`,
        `Status: ${report.incomplete ? "Incomplete" : "Complete"}`,
        `Start time: ${timestampText(report.startedAt)}`,
        `End time: ${timestampText(report.endedAt)}`,
        `Total elapsed time: ${numberText(report.elapsedMinutes, 1, " min")}`,
        `Stops completed: ${stopsCompleted(report)} of ${report.addresses.length}`,
        `Start address: ${route.start || "Not recorded"}`,
        `Destination: ${route.destination}`,
        `Planned route miles: ${numberText(route.plannedMiles)}`,
        `Planned route drive time: ${numberText(route.plannedMinutes, 1, " min")}`,
        `Planned route estimated fuel cost: ${numberText(route.fuelCost, 2, "", "$")}`,
        `MPG used: ${numberText(route.mpg)}; fuel price used: ${numberText(route.fuelPrice, 2, " per gallon", "$")}`
      ];
    }

    function reportStopText(report, index) {
      const completed = report.completedAt[index];
      return `${report.addresses[index]} — ${validTime(completed) ? timestampText(completed) :
        completed === COMPLETED_UNRECORDED ? "Completed (time not recorded)" : "Not completed"}`;
    }

    function reportPlainText(report) {
      return ["D7 Route trip report", `Driver: ${report.driver || "Not specified"}`,
        ...reportSummaryLines(report), "", "Stops (including destination):",
        ...report.addresses.map((_, index) => `${index + 1}. ${reportStopText(report, index)}`),
        "", `Notes: ${report.notes || "None"}`].join("\n");
    }

    function reportSubject(report) {
      return `D7 Route trip report - ${report.date} - ${report.driver || "Not specified"}`;
    }

    function reportMailto(report) {
      return "mailto:?subject=" + encodeURIComponent(reportSubject(report)) +
        "&body=" + encodeURIComponent(reportPlainText(report));
    }

    function showReport(report) {
      showView("reports");
      currentReport = report;
      reportPanel.hidden = false;
      driverNameInput.value = report.driver;
      reportNotes.value = report.notes;
      document.getElementById("report-status").textContent = report.incomplete ? "Incomplete trip" : "Complete trip";
      const summary = document.getElementById("report-summary");
      summary.innerHTML = "";
      reportSummaryLines(report).forEach(line => {
        const paragraph = document.createElement("p");
        paragraph.textContent = line;
        summary.appendChild(paragraph);
      });
      const list = document.getElementById("report-stops");
      list.innerHTML = "";
      report.addresses.forEach((_, index) => {
        const item = document.createElement("li");
        item.textContent = reportStopText(report, index);
        list.appendChild(item);
      });
      shareReportButton.hidden = typeof navigator === "undefined" || typeof navigator.share !== "function";
      reportMessage.textContent = "";
    }

    function renderReportHistory() {
      const list = document.getElementById("trip-reports-list");
      const reports = getTripReports();
      list.innerHTML = "";
      document.getElementById("export-reports").disabled = reports.length === 0;
      if (!reports.length) {
        const empty = document.createElement("p");
        empty.textContent = "No trip reports yet.";
        list.appendChild(empty);
      }
      reports.forEach(report => {
        const row = document.createElement("div");
        row.className = "report-entry";
        const open = document.createElement("button");
        open.type = "button";
        open.textContent = `${report.date} — ${report.driver || "No driver name"} — ${stopsCompleted(report)} of ${report.addresses.length} stops${report.incomplete ? " · Incomplete" : ""}`;
        open.addEventListener("click", () => {
          showReport(report);
          reportPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Delete";
        remove.setAttribute("aria-label", `Delete trip report for ${report.date}, ${report.driver || "no driver name"}`);
        remove.addEventListener("click", () => {
          if (!window.confirm("Delete this trip report?")) return;
          if (!writeTripReports(getTripReports().filter(item => item.id !== report.id))) {
            historyMessage.textContent = "Could not delete the report on this device.";
            return;
          }
          if (currentReport && currentReport.id === report.id) {
            currentReport = null;
            reportPanel.hidden = true;
          }
          historyMessage.textContent = "Report deleted.";
          renderReportHistory();
        });
        row.appendChild(open);
        row.appendChild(remove);
        list.appendChild(row);
      });
    }

    function updateReportDetails() {
      if (!currentReport) return;
      currentReport.driver = driverNameInput.value;
      currentReport.notes = reportNotes.value;
      const reports = getTripReports();
      const index = reports.findIndex(report => report.id === currentReport.id);
      if (index < 0) return; // An unsaved report remains available to copy/share.
      reports[index] = currentReport;
      reportMessage.textContent = writeTripReports(reports) ? "Report saved." : "Could not save report changes on this device.";
      renderReportHistory();
    }
    driverNameInput.addEventListener("input", () => {
      updateReportDetails();
      try { localStorage.setItem(DRIVER_NAME_KEY, driverNameInput.value); }
      catch { reportMessage.textContent = "Could not remember the driver name on this device."; }
    });
    reportNotes.addEventListener("input", updateReportDetails);

    function copyReportFallback(text) {
      const previousFocus = document.activeElement;
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      try {
        textarea.select();
        return document.execCommand("copy");
      } finally {
        textarea.remove();
        if (previousFocus) previousFocus.focus();
      }
    }
    document.getElementById("copy-report").addEventListener("click", async () => {
      if (!currentReport) return;
      const text = reportPlainText(currentReport);
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(text);
      } catch {
        try {
          if (!copyReportFallback(text)) throw new Error("Copy failed");
        } catch {
          reportMessage.textContent = "Could not copy report. Try Email report instead.";
          return;
        }
      }
      reportMessage.textContent = "Copied!";
    });
    document.getElementById("email-report").addEventListener("click", () => {
      if (currentReport) window.location.href = reportMailto(currentReport);
    });
    shareReportButton.addEventListener("click", async () => {
      if (!currentReport || typeof navigator.share !== "function") return;
      try { await navigator.share({ title: reportSubject(currentReport), text: reportPlainText(currentReport) }); }
      catch (error) { if (error.name !== "AbortError") reportMessage.textContent = "Could not share report. Try Copy report instead."; }
    });

    function reportsCsv(reports) {
      const rows = [["date", "driver", "start time", "end time", "elapsed minutes", "stops completed", "total stops",
        "planned miles", "planned minutes", "MPG", "fuel price", "fuel cost", "notes"]];
      reports.forEach(report => {
        const route = report.routeSnapshot;
        rows.push([report.date, report.driver, report.startedAt, report.endedAt, report.elapsedMinutes,
          stopsCompleted(report), report.addresses.length, route.plannedMiles, route.plannedMinutes,
          route.mpg, route.fuelPrice, route.fuelCost, report.notes]);
      });
      return rows.map(row => row.map(value => '"' + String(value ?? "").replace(/"/g, '""') + '"').join(",")).join("\r\n");
    }
    document.getElementById("export-reports").addEventListener("click", () => {
      const reports = getTripReports();
      if (!reports.length) return;
      const url = URL.createObjectURL(new Blob(["\uFEFF", reportsCsv(reports)], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "d7-trip-reports.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    try {
      const savedTrip = JSON.parse(localStorage.getItem(TRIP_PROGRESS_KEY));
      if (savedTrip && Array.isArray(savedTrip.addresses) &&
        savedTrip.addresses.length > 0 && savedTrip.addresses.every(address => typeof address === "string") &&
        Number.isInteger(savedTrip.index) && savedTrip.index >= 0 &&
        savedTrip.index < savedTrip.addresses.length) {
        // Older progress contains only addresses/index. Never invent historical times or mileage.
        tripProgress = {
          ...savedTrip,
          id: typeof savedTrip.id === "string" && savedTrip.id ? savedTrip.id : newReportId(),
          startedAt: validTime(savedTrip.startedAt) ? savedTrip.startedAt : null,
          completedAt: savedTrip.addresses.map((_, index) => validTime(savedTrip.completedAt?.[index]) ? savedTrip.completedAt[index] :
            savedTrip.completedAt?.[index] === COMPLETED_UNRECORDED ||
            (!Array.isArray(savedTrip.completedAt) && index < savedTrip.index) ? COMPLETED_UNRECORDED : null),
          routeSnapshot: {
            start: null, stops: savedTrip.addresses.slice(0, -1), destination: savedTrip.addresses[savedTrip.addresses.length - 1],
            plannedMiles: null, plannedMinutes: null, mpg: null, fuelPrice: null, fuelCost: null, legs: [],
            ...savedTrip.routeSnapshot
          }
        };
        if (getTripReports().some(report => report.id === tripProgress.id)) tripProgress = null;
      }
    } catch { /* Ignore invalid or unavailable storage. */ }
    renderTrip();
    renderReportHistory();

    function clearRouteResults() {
      for (const marker of routeMarkers) marker.setMap(null);
      routeMarkers = [];
      if (directionsRenderer) directionsRenderer.setMap(null);
      routeShown = false;
      navigationPoints = null;
      routePlan = null;
      navigationResults.hidden = true;
      navigationControls.innerHTML = "";
      routeMessage.textContent = "";
    }

    function invalidateRoute() {
      const hadResults = routeShown || routeRequestPending;
      // Even an edit that is later undone must invalidate an in-flight response.
      routeRequestId += 1;
      routeRequestPending = false;
      clearRouteResults();
      if (hadResults) routeStaleWarning.hidden = false;
    }

    destinationInput.addEventListener("input", invalidateRoute);
    startInput.addEventListener("input", invalidateRoute);

    // Bias suggestions toward Northern California (the map is centered on
    // Sacramento) without hard-restricting them. Legacy Autocomplete is used
    // instead of PlaceAutocompleteElement because it attaches to these inputs:
    // a typed address still works, saved values still load, and a missing
    // Places library leaves the fields as plain text. The widget API replaces
    // the input, and this page already loads the classic places library.
    const NORTHERN_CALIFORNIA_BOUNDS = {
      south: 36.9,
      west: -124.5,
      north: 42.0,
      east: -119.0
    };

    function placesAutocompleteOptions() {
      const options = {
        fields: ["formatted_address"],
        strictBounds: false
      };

      try {
        if (typeof google.maps.LatLngBounds === "function") {
          options.bounds = new google.maps.LatLngBounds(
            { lat: NORTHERN_CALIFORNIA_BOUNDS.south, lng: NORTHERN_CALIFORNIA_BOUNDS.west },
            { lat: NORTHERN_CALIFORNIA_BOUNDS.north, lng: NORTHERN_CALIFORNIA_BOUNDS.east }
          );
        } else {
          options.bounds = NORTHERN_CALIFORNIA_BOUNDS;
        }
      } catch {
        options.bounds = NORTHERN_CALIFORNIA_BOUNDS;
      }

      return options;
    }

    function attachAutocomplete(input, onFormattedAddress) {
      if (!input || input._d7PlacesAttached || mapsUnavailable || navigator.onLine === false) return;

      let AutocompleteCtor;
      try {
        AutocompleteCtor = google.maps.places.Autocomplete;
      } catch {
        return;
      }
      if (typeof AutocompleteCtor !== "function") return;

      try {
        const autocomplete = new AutocompleteCtor(input, placesAutocompleteOptions());
        input._d7PlacesAttached = true;
        autocomplete.addListener("place_changed", () => {
          let place = {};
          try {
            place = autocomplete.getPlace() || {};
          } catch {
            return;
          }
          if (!place.formatted_address) return;
          input.value = place.formatted_address;
          input.textContent = place.formatted_address;
          if (onFormattedAddress) onFormattedAddress(place.formatted_address);
        });
      } catch {
        // Places failed to initialize; keep the plain text input.
      }
    }

    function onStopFormatted(input) {
      const index = input._stopIndex;
      if (typeof index !== "number" || index < 0 || index >= stops.length) return;
      const current = stopsContainer.children[index] &&
        stopsContainer.children[index].children[1];
      // renderStops replaces inputs; ignore a suggestion from a detached field.
      if (current && current !== input) return;
      stops[index] = input.value;
      onPlannedAddressFormatted();
    }

    function onPlannedAddressFormatted() {
      // Place details can finish after Plan Route is clicked. Keep the user's
      // pending plan, but discard its response and request the normalized inputs.
      // Manual input still invalidates immediately and cancels this continuation.
      const resumePendingPlan = routeRequestPending;
      const resumeOptimize = pendingRouteOptimize;
      invalidateRoute();
      if (resumePendingPlan && !stopInput.value.trim()) {
        routeStaleWarning.hidden = true;
        calculateRoute(resumeOptimize);
      }
    }

    function attachAllAutocompletes() {
      attachAutocomplete(startInput, onPlannedAddressFormatted);
      attachAutocomplete(stopInput);
      attachAutocomplete(destinationInput, onPlannedAddressFormatted);
      // Stop rows attach on focus (see renderStops).
    }

    function updateStopCounter() {
      stopCounter.textContent =
        `${stops.length} of ${MAX_STOPS} stops between start and destination`;

      const limitReached = stops.length >= MAX_STOPS;

      addStopButton.disabled = limitReached;
      stopInput.disabled = limitReached;

      if (limitReached) {
        stopInput.placeholder = "Maximum of 20 stops reached";
      } else {
        stopInput.placeholder = "Add a stop address";
      }
    }

    function renderStops() {
      stopsContainer.innerHTML = "";

      stops.forEach((address, index) => {
        const stopItem = document.createElement("div");
        stopItem.className = "stop-item";
        stopItem.setAttribute("data-stop-number", index + 1);

        const stopNumber = document.createElement("span");
        stopNumber.className = "stop-number";
        stopNumber.textContent = index + 1;
        stopNumber.setAttribute("aria-hidden", "true");

        const stopAddress = document.createElement("input");
        stopAddress.className = "stop-address";
        stopAddress.type = "text";
        stopAddress.value = address;
        stopAddress.textContent = address;
        stopAddress.placeholder = "Enter an address";
        stopAddress.autocomplete = "off";
        stopAddress.ariaLabel = "Stop " + (index + 1);
        stopAddress._stopIndex = index;

        stopAddress.addEventListener("input", () => {
          stops[index] = stopAddress.value;
          stopAddress.textContent = stopAddress.value;
          invalidateRoute();
        });
        // Attach Places when the row is first focused. renderStops rebuilds
        // every row, and each Autocomplete adds a .pac-container to <body>
        // that is never removed, so attaching eagerly leaks one per row per render.
        stopAddress.addEventListener("focus", () => {
          attachAutocomplete(stopAddress, () => onStopFormatted(stopAddress));
        });

        const removeButton = document.createElement("button");
        removeButton.className = "remove-button";
        removeButton.type = "button";
        removeButton.textContent = "×";
        removeButton.setAttribute("aria-label", "Remove stop " + (index + 1));

        removeButton.addEventListener("click", () => {
          stops.splice(index, 1);
          invalidateRoute();
          renderStops();
          const nextRow = stopsContainer.children[Math.min(index, stops.length - 1)];
          if (nextRow) nextRow.children[1].focus();
          else stopInput.focus();
          routeMessage.textContent = "";
        });

        stopItem.appendChild(stopNumber);
        stopItem.appendChild(stopAddress);
        stopItem.appendChild(removeButton);

        stopsContainer.appendChild(stopItem);
      });

      updateStopCounter();
    }

    function addStop() {
      const address = stopInput.value.trim();

      if (!address) {
        routeMessage.textContent =
          "Enter an address before adding a stop.";
        stopInput.focus();
        return;
      }

      if (stops.length >= MAX_STOPS) {
        routeMessage.textContent =
          "You have reached the 20-stop limit.";
        return;
      }

      stops.push(address);
      invalidateRoute();

      stopInput.value = "";
      routeMessage.textContent = "";

      renderStops();

      stopInput.focus();
    }

    addStopButton.addEventListener("click", addStop);

    stopInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      // Places uses Enter to pick a suggestion. Don't also add the stop
      // while a suggestion dropdown is open. Every autocomplete field has its
      // own .pac-container, so check all of them. A missing querySelectorAll
      // (tests, or Places not loaded) still adds the typed address.
      try {
        if (typeof document.querySelectorAll === "function") {
          const dropdownOpen = [...document.querySelectorAll(".pac-container")].some(
            (pac) => pac.style.display !== "none" && pac.offsetParent !== null
          );
          if (dropdownOpen) return;
        }
      } catch {
        // Ignore and add the typed stop.
      }
      addStop();
    });

    function getSavedRoutes() {
      try {
        const value = JSON.parse(localStorage.getItem(SAVED_ROUTES_KEY));
        return value && typeof value === "object" && !Array.isArray(value)
          ? Object.assign(Object.create(null), value) : Object.create(null);
      } catch {
        return Object.create(null);
      }
    }

    const BACKUP_FORMAT = "d7-route-backup";
    const MAX_BACKUP_BYTES = 1024 * 1024;
    const MAX_BACKUP_ROUTES = 500;
    let backupImportId = 0;

    function backupAddress(value) {
      if (typeof value !== "string" || !value.trim() || value.length > 512) {
        throw new Error("Every address must be text between 1 and 512 characters.");
      }
      return value.trim();
    }

    function normalizeBackupRoutes(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("The backup must contain a saved routes object.");
      }
      const names = Object.keys(value);
      if (names.length > MAX_BACKUP_ROUTES) throw new Error("A backup can contain up to 500 routes.");
      const routes = Object.create(null);
      for (const name of names) {
        if (!name.trim() || name.length > 128) throw new Error("Route names must be between 1 and 128 characters.");
        const route = value[name];
        if (!route || typeof route !== "object" || Array.isArray(route) || !Array.isArray(route.stops)) {
          throw new Error("Each route must contain a stops array.");
        }
        const legacy = !Object.prototype.hasOwnProperty.call(route, "start");
        if (route.stops.length > MAX_STOPS + (legacy ? 1 : 0)) {
          throw new Error("A route can contain up to 20 stops between start and finish.");
        }
        const addresses = route.stops.map(backupAddress);
        const start = legacy ? backupAddress(addresses.shift()) : backupAddress(route.start);
        const fuel = (value, fallback) => {
          const raw = value == null ? fallback : value;
          if (!["string", "number"].includes(typeof raw) || !positiveNumber(raw)) {
            throw new Error("MPG and fuel price must be positive numbers.");
          }
          return String(raw);
        };
        routes[name] = {
          start, stops: addresses, destination: backupAddress(route.destination),
          vehicleMpg: fuel(route.vehicleMpg, "15"), fuelPrice: fuel(route.fuelPrice, "4.50"),
        };
      }
      return routes;
    }

    function savedRoutesForBackup() {
      // Preserve storage errors and malformed data as errors instead of overwriting them.
      return normalizeBackupRoutes(JSON.parse(localStorage.getItem(SAVED_ROUTES_KEY) || "{}"));
    }

    exportRoutesButton.addEventListener("click", () => {
      try {
        const backup = {
          format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(),
          routes: savedRoutesForBackup(),
        };
        const text = JSON.stringify(backup, null, 2);
        const blob = new Blob([text], { type: "application/json" });
        if (blob.size > MAX_BACKUP_BYTES) throw new Error("The backup exceeds the 1 MB file limit.");
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "d7-saved-routes-" + backup.exportedAt.slice(0, 10) + ".json";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        backupMessage.textContent = "Saved routes exported. Keep the file private if it contains customer addresses.";
      } catch (error) {
        backupMessage.textContent = "Could not export routes. " + error.message;
      }
    });

    document.getElementById("import-routes").addEventListener("click", () => importRoutesFile.click());
    importRoutesFile.addEventListener("change", async () => {
      const importId = ++backupImportId;
      const file = importRoutesFile.files && importRoutesFile.files[0];
      if (!file) return;
      try {
        if (file.size > MAX_BACKUP_BYTES) throw new Error("Choose a JSON backup under 1 MB.");
        const text = await file.text();
        if (importId !== backupImportId) return;
        if (new Blob([text]).size > MAX_BACKUP_BYTES) throw new Error("Choose a JSON backup under 1 MB.");
        const backup = JSON.parse(text);
        if (!backup || backup.format !== BACKUP_FORMAT || backup.version !== 1) {
          throw new Error("Choose a D7 saved routes backup (version 1).");
        }
        const imported = normalizeBackupRoutes(backup.routes);
        const existing = savedRoutesForBackup();
        const names = Object.keys(imported);
        if (!names.length) throw new Error("The backup contains no saved routes.");
        const collisions = names.filter(name => Object.prototype.hasOwnProperty.call(existing, name));
        if (collisions.length && !window.confirm(`Replace ${collisions.length} saved route(s) with matching names? Other saved routes will be kept.`)) {
          backupMessage.textContent = "Import cancelled. Saved routes were kept.";
          return;
        }
        const merged = Object.assign(Object.create(null), existing, imported);
        if (Object.keys(merged).length > MAX_BACKUP_ROUTES) throw new Error("Import would exceed the 500 saved route limit.");
        // A single write: invalid files, cancellation or a quota error keep old data intact.
        localStorage.setItem(SAVED_ROUTES_KEY, JSON.stringify(merged));
        updateSavedRouteOptions(savedRouteSelect.value);
        backupMessage.textContent = `Imported ${names.length} saved route(s). Choose one and Load to use it.`;
      } catch (error) {
        if (importId === backupImportId) backupMessage.textContent = "Could not import routes. " + error.message;
      } finally {
        if (importId === backupImportId) importRoutesFile.value = "";
      }
    });

    function updateSavedRouteOptions(selectedName = "") {
      const savedRoutes = getSavedRoutes();
      const names = Object.keys(savedRoutes).sort((a, b) =>
        a.localeCompare(b)
      );
      exportRoutesButton.disabled = names.length === 0;

      savedRouteSelect.innerHTML = "";

      if (names.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No saved routes";
        savedRouteSelect.appendChild(option);
        return;
      }

      names.forEach((name) => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        option.selected = name === selectedName;
        savedRouteSelect.appendChild(option);
      });
    }

    saveRouteButton.addEventListener("click", () => {
      const name = routeNameInput.value.trim();
      const destination = destinationInput.value.trim();
      const start = startInput.value.trim();

      if (!name) {
        routeMessage.textContent = "Enter a name for this route.";
        routeNameInput.focus();
        return;
      }

      if (!start || !destination) {
        routeMessage.textContent =
          "Enter a starting address and final destination before saving.";
        showView("plan");
        if (!start) startInput.focus();
        else destinationInput.focus();
        return;
      }

      const savedRoutes = getSavedRoutes();
      if (Object.prototype.hasOwnProperty.call(savedRoutes, name) &&
        !window.confirm(`Replace the saved route “${name}”?`)) {
        routeMessage.textContent = "Route was not overwritten.";
        return;
      }

      savedRoutes[name] = {
        start,
        stops: [...stops],
        destination,
        vehicleMpg: vehicleMpgInput.value,
        fuelPrice: fuelPriceInput.value
      };

      try {
        localStorage.setItem(SAVED_ROUTES_KEY, JSON.stringify(savedRoutes));
      } catch {
        routeMessage.textContent = "Could not save the route on this device.";
        return;
      }

      updateSavedRouteOptions(name);
      routeMessage.textContent = "Route saved: " + name + ".";
    });

    loadRouteButton.addEventListener("click", () => {
      const name = savedRouteSelect.value;
      const savedRoute = getSavedRoutes()[name];

      if (!savedRoute) {
        routeMessage.textContent = "Choose a saved route first.";
        return;
      }

      invalidateRoute();
      const savedStops = Array.isArray(savedRoute.stops) ? savedRoute.stops : [];
      let start;
      let loadedStops;
      if (typeof savedRoute.start === "string" && savedRoute.start.trim()) {
        start = savedRoute.start.trim();
        loadedStops = savedStops;
      } else {
        // Older saves had no start field; the first stop was the origin.
        start = String(savedStops[0] || "").trim();
        loadedStops = savedStops.slice(1);
      }
      startInput.value = start;
      stops.splice(
        0,
        stops.length,
        ...loadedStops.slice(0, MAX_STOPS).map((stop) => String(stop))
      );
      destinationInput.value = savedRoute.destination || "";
      vehicleMpgInput.value = savedRoute.vehicleMpg || "15";
      fuelPriceInput.value = savedRoute.fuelPrice || "4.50";
      routeNameInput.value = name;
      renderStops();
      showView("plan", true);

      routeMessage.textContent =
        "Route loaded: " + name + ". Choose Optimize Route or Calculate Route.";
    });

    deleteRouteButton.addEventListener("click", () => {
      const name = savedRouteSelect.value;
      const savedRoutes = getSavedRoutes();

      if (!name || !Object.prototype.hasOwnProperty.call(savedRoutes, name)) {
        routeMessage.textContent = "Choose a saved route first.";
        return;
      }

      if (!window.confirm(`Delete the saved route “${name}”?`)) {
        routeMessage.textContent = "Route was not deleted.";
        return;
      }

      delete savedRoutes[name];

      try {
        localStorage.setItem(SAVED_ROUTES_KEY, JSON.stringify(savedRoutes));
      } catch {
        routeMessage.textContent = "Could not delete the route on this device.";
        return;
      }

      if (routeNameInput.value.trim() === name) routeNameInput.value = "";
      updateSavedRouteOptions();
      routeMessage.textContent = "Route deleted: " + name + ".";
    });

    updateSavedRouteOptions();

    function planRoute(optimize) {
      // A typed but unadded stop must never be silently left out of the plan.
      if (stopInput.value.trim()) {
        routeMessage.textContent = "Add your typed stop before planning the route.";
        stopInput.focus();
        return;
      }
      calculateRoute(optimize);
    }
    planButton.addEventListener("click", () => planRoute(true));
    document.getElementById("calculate-route").addEventListener("click", () => planRoute(false));

    function calculateRoute(optimize = false) {
      pendingRouteOptimize = optimize;
      // Only the latest request may publish results, including repeated clicks.
      const requestId = ++routeRequestId;
      routeRequestPending = false;
      clearRouteResults();
      const destination = destinationInput.value.trim();
      const origin = startInput.value.trim();

      if (!origin) {
        routeMessage.textContent = "Enter a starting address.";
        startInput.focus();
        return;
      }

      if (!destination) {
        routeMessage.textContent = "Enter your final destination.";
        destinationInput.focus();
        return;
      }

      if (stops.some((address) => !String(address).trim())) {
        routeMessage.textContent = "Enter an address for every stop.";
        return;
      }

      if (stops.length > MAX_STOPS || stops.length > DIRECTIONS_WAYPOINT_LIMIT) {
        routeMessage.textContent = "You have reached the 20-stop limit.";
        return;
      }

      if (navigator.onLine === false) {
        routeMessage.textContent = OFFLINE_MESSAGE;
        return;
      }

      if (mapsUnavailable) {
        routeMessage.textContent = MAPS_UNAVAILABLE_MESSAGE;
        return;
      }

      if (!directionsService) {
        routeMessage.textContent = "Wait for the map to load, then try again.";
        return;
      }

      const requestedStops = stops.map((address) => String(address));
      const waypoints = requestedStops.map((address) => ({
        location: address.trim(),
        stopover: true
      }));

      routeMessage.textContent = optimize
        ? "Optimizing route..."
        : "Calculating route...";

      routeRequestPending = true;
      const routeTimeout = setTimeout(() => {
        if (requestId !== routeRequestId) return;
        // Bump the ID so a late response is ignored.
        routeRequestId += 1;
        routeRequestPending = false;
        routeMessage.textContent = "Route request timed out. Please try again.";
      }, ROUTE_REQUEST_TIMEOUT_MS);
      directionsService.route(
        {
          origin: origin,
          destination: destination,
          waypoints: waypoints,
          optimizeWaypoints: optimize,
          travelMode: google.maps.TravelMode.DRIVING
        },
        (result, status) => {
          clearTimeout(routeTimeout);
          if (requestId !== routeRequestId) return;
          routeRequestPending = false;
          if (JSON.stringify(stops) !== JSON.stringify(requestedStops) ||
            destinationInput.value.trim() !== destination ||
            startInput.value.trim() !== origin) {
            invalidateRoute();
            routeStaleWarning.hidden = false;
            return;
          }

          if (status === "OK") {
            const route = result && result.routes && result.routes[0];
            if (!route || !Array.isArray(route.legs) ||
                route.legs.length !== requestedStops.length + 1 ||
                route.legs.some(leg => !leg || !leg.distance || !leg.duration ||
                  !Number.isFinite(leg.distance.value) || leg.distance.value < 0 ||
                  !Number.isFinite(leg.duration.value) || leg.duration.value < 0)) {
              routeMessage.textContent = "Could not calculate route: incomplete route result. Please try again.";
              return;
            }
            let orderedStops = requestedStops;
            if (optimize && requestedStops.length > 0) {
              const order = route.waypoint_order;
              if (!Array.isArray(order) || order.length !== requestedStops.length ||
                  new Set(order).size !== requestedStops.length ||
                  !order.every(index => Number.isInteger(index) && index >= 0 && index < requestedStops.length)) {
                routeMessage.textContent = "Could not calculate route: invalid optimized stop order. Please try again.";
                return;
              }
              orderedStops = order.map((index) => requestedStops[index]);
              stops.splice(0, stops.length, ...orderedStops);
              renderStops();
            }
            const markers = typeof renderRouteMarkers === "function" ? renderRouteMarkers(map, result) : null;
            routeMarkers = markers || [];
            if (typeof directionsRenderer.setOptions === "function") {
              directionsRenderer.setOptions({ suppressMarkers: !!markers });
            }
            directionsRenderer.setDirections(result);
            directionsRenderer.setMap(map);
            routeShown = true;
            routeStaleWarning.hidden = true;
            showNavigation([origin, ...orderedStops.map((address) => address.trim()), destination]);

            let totalDistance = 0;
            let totalDuration = 0;

            route.legs.forEach((leg) => {
              totalDistance += leg.distance.value;
              totalDuration += leg.duration.value;
            });

            routePlan = {
              start: origin, stops: navigationPoints.slice(1, -1), destination,
              plannedMiles: totalDistance / 1609.344,
              plannedMinutes: totalDuration / 60,
              legs: route.legs.map((leg, index) => ({
                from: navigationPoints[index], to: navigationPoints[index + 1],
                plannedMiles: leg.distance.value / 1609.344,
                plannedMinutes: leg.duration.value / 60
              }))
            };

            const miles = (totalDistance / 1609.344).toFixed(1);
            const minutes = Math.round(totalDuration / 60);
            const estimate = estimatedFuelCost(Number(miles));
            const fuelCost = estimate === null ? "" : ` • Est. fuel: $${estimate.toFixed(2)}`;

            routeMessage.textContent =
              `${optimize ? "Route optimized" : "Route calculated"}: ${miles} miles • ${minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`}${fuelCost}`;
          } else {
            routeMessage.textContent =
              `Could not calculate route: ${status}`;
          }
        }
      );
    }

    updateStopCounter();
  
    function presentRouteReadout() {
      const message = document.getElementById("route-message");
      if (!message) return;
      const text = message.textContent || "";
      const matched = text.match(/^Route (?:calculated|optimized): ([\d.]+) miles • ([^•]+?)(?: • Est\. fuel: (\$[\d.]+))?$/);
      const milesEl = document.getElementById("stat-miles");
      const unitEl = document.getElementById("stat-miles-unit");
      const durationEl = document.getElementById("stat-duration");
      const fuelEl = document.getElementById("stat-fuel");
      const clears = !text ||
        /^(Calculating route|Optimizing route|Could not calculate route|Enter a starting address|Enter your final destination|Enter an address for every stop|Route request timed out|Route loaded:|Wait for the map)/.test(text) ||
        text.indexOf("couldn't load") !== -1;
      if (milesEl && durationEl && fuelEl) {
        if (matched) {
          milesEl.textContent = matched[1];
          if (unitEl) unitEl.textContent = "mi";
          durationEl.textContent = matched[2].trim();
          fuelEl.textContent = matched[3] || "—";
        } else if (clears) {
          milesEl.textContent = "—";
          if (unitEl) unitEl.textContent = "";
          durationEl.textContent = "—";
          fuelEl.textContent = "—";
        }
      }
      let kind = "";
      if (/^(Calculating route|Optimizing route|Wait for the map)/.test(text)) kind = "is-busy";
      else if (matched || /^(Route saved|Route loaded|Route deleted):/.test(text)) kind = "is-ok";
      else if (text) kind = "is-error";
      message.className = "route-message" + (kind ? " " + kind : "");
    }

    function presentNotice(id, base) {
      const el = document.getElementById(id);
      if (!el) return;
      const text = el.textContent || "";
      const kind = !text ? "" : text.indexOf("Could not") === 0 ? "is-error" : "is-ok";
      el.className = base + (kind ? " " + kind : "");
    }

    function watchText(id, fn) {
      const el = document.getElementById(id);
      if (!el || typeof MutationObserver !== "function") return;
      const observer = new MutationObserver(fn);
      observer.observe(el, { childList: true, characterData: true, subtree: true });
    }

    presentRouteReadout();
    presentNotice("report-message", "report-message");
    presentNotice("history-message", "history-message");
    watchText("route-message", presentRouteReadout);
    watchText("report-message", function () { presentNotice("report-message", "report-message"); });
    watchText("history-message", function () { presentNotice("history-message", "history-message"); });

    let shellReady = false;
    const offlineStatus = document.getElementById("offline-status");
    function showConnectionStatus() {
      if (navigator.onLine === false) offlineStatus.textContent = OFFLINE_MESSAGE;
      else offlineStatus.textContent = shellReady
        ? "Ready to reopen offline. Maps and planning need internet."
        : "Offline access becomes available after the app shell is saved on this device.";
    }
    showConnectionStatus();
    if (typeof window.addEventListener === "function") {
      window.addEventListener("offline", () => {
        invalidateRoute();
        showConnectionStatus();
      });
      window.addEventListener("online", () => {
        showConnectionStatus();
        if (mapsUnavailable && !mapsAuthFailed) {
          offlineStatus.textContent += " Reload to reconnect Google Maps.";
        }
      });
    }
    if (navigator.serviceWorker && window.isSecureContext) {
      navigator.serviceWorker.register("./service-worker.js", { scope: "./", updateViaCache: "none" })
        .then(() => navigator.serviceWorker.ready)
        .then(() => { shellReady = true; showConnectionStatus(); })
        .catch(() => {
          offlineStatus.textContent = "Offline setup could not finish. Reopen online to try again.";
        });
    }
