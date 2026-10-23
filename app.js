    const MAX_STOPS = 500;
    // Directions permits 25 intermediate waypoints per request. Larger routes
    // share section endpoints; optimization keeps those boundaries fixed.
    const DIRECTIONS_WAYPOINT_LIMIT = 25;
    let map;
    let directionsService;
    let directionsRenderer;
    let sectionRenderers = [];
    let routeMarkers = [];
    const MAPS_LOAD_TIMEOUT_MS = 15000;
    const ROUTE_REQUEST_TIMEOUT_MS = 20000;
    const MAPS_UNAVAILABLE_MESSAGE =
      "The map couldn't load. The Google Maps API key may not be authorized for this site.";
    const OFFLINE_MESSAGE = "You're offline. Saved routes and trip records are available on this device. Connect to use maps, address suggestions, planning, and navigation.";
    let mapsUnavailable = false;
    let mapsAuthFailed = false;

    function handleMapsLoadFailure() {
      if (typeof D7RouteTools !== "undefined") D7RouteTools.unavailable();
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
      if (!mapsAuthFailed && typeof D7RouteTools !== "undefined") D7RouteTools.ready(map, google.maps);
    }


    const stops = [];
    const stopLabels = [];
    const stopFirst = [];

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
      const panel = selected === "calendar" ? "plan" : selected;
      document.getElementById("workspace").setAttribute("data-view", selected);
      document.getElementById("journey-controls").hidden = panel !== "plan";
      for (const name of ["plan", "saved", "calendar", "reports"]) {
        document.getElementById(name + "-view").hidden = (name === "calendar" ? "plan" : name) !== panel;
        document.getElementById("view-" + name).setAttribute("aria-current", name === selected ? "page" : "false");
      }
      if (focusHeading) {
        const id = selected === "plan" ? (tripProgress ? "trip-heading" : "route-heading") : selected + "-heading";
        document.getElementById(id).focus({ preventScroll: selected === "calendar" });
        if (selected === "calendar") document.getElementById(id).scrollIntoView({ block: "start", behavior: "instant" });
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
        item.textContent = `${label}: ${index > 0 && index < points.length - 1 && stopLabels[index - 1] ? stopLabels[index - 1] + " — " : ""}${address}`;
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
      const label=tripProgress.routeSnapshot?.stopLabels?.[index];
      tripStopAddress.textContent = (label ? label+" — " : "")+addresses[index];
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
    // New sessions use the national-average reference declared in index.html.
    // Explicit route loads and active-trip snapshots retain their own fuel values.

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
      const label=report.routeSnapshot?.stopLabels?.[index];
      return `${label ? label+" — " : ""}${report.addresses[index]} — ${validTime(completed) ? timestampText(completed) :
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
      if (typeof D7RouteTools !== "undefined") D7RouteTools.clear();
      for (const marker of routeMarkers) marker.setMap(null);
      routeMarkers = [];
      if (directionsRenderer) directionsRenderer.setMap(null);
      for (const renderer of sectionRenderers) renderer.setMap(null);
      sectionRenderers = [];
      routeShown = false;
      navigationPoints = null;
      routePlan = null;
      document.getElementById("route-order-note").textContent = "";
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
        stopInput.placeholder = `Maximum of ${MAX_STOPS} stops reached`;
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
        stopItem.setAttribute("data-stop-caption", `Stop ${index + 1}${stopLabels[index] ? " · " + stopLabels[index] : ""}`);

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
        stopAddress.ariaLabel = "Stop " + (index + 1) + (stopLabels[index] ? ": " + stopLabels[index] : "");
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
          try {
            const parsed=D7Import.instructions(document.getElementById("route-instructions").value||"",MAX_STOPS);
            if(parsed.first.length)document.getElementById("route-instructions").value=D7Import.instructionText({...parsed,first:parsed.first.filter(n=>n!==index+1).map(n=>n>index+1?n-1:n)});
          } catch { /* Invalid text remains visible and will block planning. */ }
          stops.splice(index, 1);
          stopLabels.splice(index, 1);
          stopFirst.splice(index, 1);
          updatePrioritySummary();
          invalidateRoute();
          renderStops();
          const nextRow = stopsContainer.children[Math.min(index, stops.length - 1)];
          if (nextRow) nextRow.children[1].focus();
          else stopInput.focus();
          routeMessage.textContent = "";
        });

        const controls = document.createElement("div");
        controls.className = "stop-order-controls";
        const firstLabel = document.createElement("label");
        const firstBox = document.createElement("input");
        firstBox.type = "checkbox"; firstBox.checked = !!stopFirst[index];
        firstBox.setAttribute("aria-label", `Do stop ${index+1} first`);
        firstBox.addEventListener("change", () => {
          stopFirst[index] = firstBox.checked;
          if(!firstBox.checked)try {
            const parsed=D7Import.instructions(document.getElementById("route-instructions").value||"",MAX_STOPS);
            if(parsed.first.includes(index+1))document.getElementById("route-instructions").value=D7Import.instructionText({...parsed,first:parsed.first.filter(n=>n!==index+1)});
          } catch { /* Invalid text remains visible. */ }
          invalidateRoute(); updatePrioritySummary();
        });
        firstLabel.appendChild(firstBox);
        const firstText = document.createElement("span"); firstText.textContent = "First";
        firstLabel.appendChild(firstText); controls.appendChild(firstLabel);
        for (const [direction, text] of [[-1,"↑"],[1,"↓"]]) {
          const button = document.createElement("button"); button.type = "button";
          button.textContent = text; button.disabled = index+direction<0 || index+direction>=stops.length;
          button.setAttribute("aria-label", `Move stop ${index+1} ${direction<0 ? "up" : "down"}`);
          button.addEventListener("click", () => {
            const target = index+direction;
            if(target<0 || target>=stops.length)return;
            let parsed;try { parsed=D7Import.instructions(document.getElementById("route-instructions").value||"",MAX_STOPS); } catch { parsed={priority:"efficiency",cutoff:40,first:[]}; }
            const instructed=stops.map((_,i)=>parsed.first.includes(i+1));
            [instructed[index],instructed[target]]=[instructed[target],instructed[index]];
            if(parsed.first.length)document.getElementById("route-instructions").value=D7Import.instructionText({...parsed,first:instructed.map((v,i)=>v?i+1:null).filter(Boolean)});
            for(const items of [stops,stopLabels,stopFirst]) [items[index],items[target]]=[items[target],items[index]];
            invalidateRoute();renderStops();
            routeMessage.textContent = "Stop order changed. Keep My Order preserves this order; Plan Route applies your priorities.";
          });
          controls.appendChild(button);
        }
        stopItem.appendChild(stopNumber);
        stopItem.appendChild(stopAddress);
        stopItem.appendChild(removeButton);
        stopItem.appendChild(controls);

        stopsContainer.appendChild(stopItem);
      });

      updateStopCounter();
      updatePrioritySummary();
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
          `You have reached the ${MAX_STOPS}-stop limit.`;
        return;
      }

      stops.push(address);
      stopLabels.push("");
      stopFirst.push(false);
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
          throw new Error(`A route can contain up to ${MAX_STOPS} stops between start and finish.`);
        }
        let labels = null;
        if (route.stopLabels != null) {
          if (!Array.isArray(route.stopLabels) || route.stopLabels.length !== route.stops.length ||
              route.stopLabels.some(label => typeof label !== "string" || label.length > 128)) {
            throw new Error("Store labels must match the stops and contain at most 128 characters each.");
          }
          labels = [...route.stopLabels];
          if (legacy) labels.shift();
        }
        const preferences = {};
        if (route.stopFirst != null) {
          if(!Array.isArray(route.stopFirst) || route.stopFirst.length!==route.stops.length || route.stopFirst.some(v=>typeof v!=="boolean"))
            throw new Error("First-stop flags must match the stops.");
          preferences.stopFirst = legacy ? route.stopFirst.slice(1) : [...route.stopFirst];
        }
        if(route.routeInstructions != null) {
          D7Import.instructions(route.routeInstructions, route.stops.length);preferences.routeInstructions=route.routeInstructions;
        }
        if(route.routePriority != null) {
          if(!["efficiency","north","south"].includes(route.routePriority))throw new Error("Unknown route priority.");
          preferences.routePriority=route.routePriority;
        }
        if(route.northernCutoff != null) {
          const cutoff=Number(route.northernCutoff);
          if(!Number.isFinite(cutoff) || cutoff < -90 || cutoff > 90)throw new Error("Invalid northern cutoff.");
          preferences.northernCutoff=String(cutoff);
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
          start, stops: addresses, ...(labels ? { stopLabels: labels } : {}), ...preferences, destination: backupAddress(route.destination),
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

      try { D7Import.instructions(document.getElementById("route-instructions").value || "", stops.length); }
      catch(error) { routeMessage.textContent=error.message; return; }
      const savedRoutes = getSavedRoutes();
      if (Object.prototype.hasOwnProperty.call(savedRoutes, name) &&
        !window.confirm(`Replace the saved route “${name}”?`)) {
        routeMessage.textContent = "Route was not overwritten.";
        return;
      }

      savedRoutes[name] = {
        start,
        stops: [...stops],
        ...(stopLabels.some(Boolean) ? { stopLabels: [...stopLabels] } : {}),
        ...(stopFirst.some(Boolean) ? { stopFirst: [...stopFirst] } : {}),
        ...(document.getElementById("route-instructions").value.trim() ? { routeInstructions: document.getElementById("route-instructions").value.trim() } : {}),
        ...((document.getElementById("route-priority").value || "efficiency") !== "efficiency" ? {
          routePriority: document.getElementById("route-priority").value,
          northernCutoff: document.getElementById("northern-cutoff").value || "40"
        } : {}),
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
      if (loadedStops.length > MAX_STOPS) {
        routeMessage.textContent = `This saved route has more than ${MAX_STOPS} stops. Its saved record has been kept unchanged.`;
        return;
      }
      invalidateRoute();
      startInput.value = start;
      stops.splice(
        0,
        stops.length,
        ...loadedStops.map((stop) => String(stop))
      );
      const labels = Array.isArray(savedRoute.stopLabels) ? savedRoute.stopLabels : [];
      stopLabels.splice(0, stopLabels.length, ...loadedStops.map((_, i) => String(labels[i + (savedRoute.start ? 0 : 1)] || "").slice(0, 128)));
      stopFirst.splice(0,stopFirst.length,...loadedStops.map((_,i)=>!!(savedRoute.stopFirst||[])[i+(savedRoute.start?0:1)]));
      document.getElementById("route-priority").value = ["north","south"].includes(savedRoute.routePriority) ? savedRoute.routePriority : "efficiency";
      document.getElementById("northern-cutoff").value = String(savedRoute.northernCutoff ?? "40");
      document.getElementById("route-instructions").value = savedRoute.routeInstructions || (savedRoute.routePriority && savedRoute.routePriority!=="efficiency" ? savedRoute.routePriority+" first; north cutoff: "+(savedRoute.northernCutoff||40) : "");
      updatePrioritySummary();
      destinationInput.value = savedRoute.destination || "";
      vehicleMpgInput.value = savedRoute.vehicleMpg || "15";
      fuelPriceInput.value = savedRoute.fuelPrice || "4.50";
      routeNameInput.value = name;
      renderStops();
      showView("plan", true);

      routeMessage.textContent =
        "Route loaded: " + name + ". Choose Plan Route or Keep My Order.";
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

    function updatePrioritySummary() {
      let priority = document.getElementById("route-priority").value || "efficiency";
      let cutoff = document.getElementById("northern-cutoff").value || "40";
      let parsed;
      try { parsed = D7Import.instructions(document.getElementById("route-instructions").value || "", MAX_STOPS); }
      catch(error) { document.getElementById("priority-summary").textContent=error.message; return; }
      document.getElementById("route-priority").value=parsed.priority;
      document.getElementById("northern-cutoff").value=String(parsed.cutoff);
      priority=parsed.priority;cutoff=String(parsed.cutoff);
      for(let i=0;i<stops.length;i++) {
        const box=stopsContainer.children[i]?.children[3]?.children[0]?.children[0];
        if(box)box.checked=!!stopFirst[i] || parsed.first.includes(i+1);
      }
      const count = stops.filter((_,i)=>stopFirst[i] || parsed.first.includes(i+1)).length;
      document.getElementById("priority-summary").textContent =
        `${parsed.first.length ? "Do stops " + parsed.first.join(", ") + " first; " : count ? count + " selected stops first; " : ""}${priority==="north" ? "stops at or above latitude " + cutoff + " before southern stops" : priority==="south" ? "stops below latitude " + cutoff + " before northern stops" : "reduce driving across the full list"}. Plan Route applies these rules. Keep My Order ignores priority rules and preserves your exact entered order.`;
    }
    for(const id of ["route-instructions"]) document.getElementById(id).addEventListener("input",()=>{
      invalidateRoute();updatePrioritySummary();
    });
    updatePrioritySummary();

    let importSheets = [], importRecords = [], importGeneration = 0, appliedImport = null;
    const importFile = document.getElementById("spreadsheet-file");
    const importMessage = document.getElementById("spreadsheet-message");
    const importPreview = document.getElementById("spreadsheet-preview");
    function importSelected() {
      return importRecords.filter((row,i)=>row.valid && document.getElementById("import-row-"+i)?.checked);
    }
    function updateImportCount() {
      const rows=importSelected();
      const mode=document.getElementById("spreadsheet-mode").value;
      const total=rows.length+(mode==="replace"?0:stops.length);
      document.getElementById("import-count").textContent = `${rows.length} rows selected · ${total} intermediate stops after import (maximum ${MAX_STOPS}).`;
      for(const id of ["apply-spreadsheet","import-optimize"])document.getElementById(id).disabled=!rows.length || total>MAX_STOPS;
    }
    function previewSpreadsheet(resetMapping=false) {
      const sheet=importSheets[Number(document.getElementById("spreadsheet-sheet").value)||0];
      if(!sheet)return;
      const row=Math.max(0,Math.min(49,Number(document.getElementById("spreadsheet-header-row").value||1)-1));
      const hasHeaders=document.getElementById("spreadsheet-has-header").checked;
      const headers=sheet.rows[row]||[];
      const width=Math.max(headers.length,...sheet.rows.slice(row,row+10).map(r=>r.length));
      if(resetMapping) {
        const detected=hasHeaders ? D7Import.mapping(headers) : {...D7Import.mapping([]),address:0};
        for(const field of ["address","street","city","state","postal","country","label","first"]) {
          const select=document.getElementById("column-"+field); select.innerHTML="";
          const none=document.createElement("option");none.value="-1";none.textContent="Not used";select.appendChild(none);
          for(let i=0;i<width;i++) {
            const option=document.createElement("option");option.value=String(i);
            option.textContent=(hasHeaders?String(headers[i]||""):"")||`Column ${i+1}`;select.appendChild(option);
          }
          select.value=String(detected[field]);
        }
      }
      const fields={};
      for(const field of ["address","street","city","state","postal","country","label","first"])fields[field]=Number(document.getElementById("column-"+field).value);
      importRecords=D7Import.preview(sheet.rows,row,hasHeaders,fields);
      importPreview.innerHTML="";
      importRecords.forEach((record,i)=>{
        const tr=document.createElement("tr");const include=document.createElement("td");
        const checkbox=document.createElement("input");checkbox.type="checkbox";checkbox.id="import-row-"+i;
        checkbox.checked=record.valid;checkbox.disabled=!record.valid;checkbox.setAttribute("aria-label",`Include spreadsheet row ${record.row}`);
        checkbox.addEventListener("change",updateImportCount);include.appendChild(checkbox);tr.appendChild(include);
        for(const text of [String(record.row),record.label,record.address,record.first?"First":"",record.issue]){
          const td=document.createElement("td");td.textContent=text;tr.appendChild(td);
        }
        importPreview.appendChild(tr);
      });
      const invalid=importRecords.filter(r=>!r.valid).length;
      importMessage.textContent=`${importRecords.length} nonempty rows; ${invalid} unusable rows excluded. Review the columns and selected rows. Addresses are checked for usable text here; Google resolves them when you plan.`;
      updateImportCount();
    }
    function selectSheet() {
      const sheet=importSheets[Number(document.getElementById("spreadsheet-sheet").value)||0];
      const detected=D7Import.detect(sheet.rows);
      document.getElementById("spreadsheet-header-row").value=String(detected.row+1);
      document.getElementById("spreadsheet-has-header").checked=detected.hasHeaders;
      previewSpreadsheet(true);
    }
    importFile.addEventListener("change",async()=>{
      const generation=++importGeneration;
      const file=importFile.files && importFile.files[0];if(!file)return;
      invalidateRoute();document.getElementById("route-instructions").value="";updatePrioritySummary();
      importRecords=[];document.getElementById("spreadsheet-review").hidden=true;
      importMessage.textContent="Reading spreadsheet on this device...";
      try {
        const sheets=await D7Import.readFile(file,typeof ExcelJS!=="undefined"?ExcelJS:null);
        if(generation!==importGeneration)return;
        if(!sheets.length)throw new Error("No readable sheets were found.");
        importSheets=sheets;
        const select=document.getElementById("spreadsheet-sheet");select.innerHTML="";
        sheets.forEach((sheet,i)=>{const option=document.createElement("option");option.value=String(i);option.textContent=sheet.name;select.appendChild(option);});
        // Choose the first sheet with recognizable address columns, not a cover sheet.
        const preferred=sheets.findIndex(sheet=>D7Import.detect(sheet.rows).hasHeaders);
        select.value=String(preferred<0?0:preferred);
        document.getElementById("spreadsheet-review").hidden=false;selectSheet();
      } catch(error) {
        if(generation===importGeneration)importMessage.textContent="Could not read spreadsheet. "+error.message;
      }
    });
    document.getElementById("spreadsheet-sheet").addEventListener("change",selectSheet);
    for(const id of ["spreadsheet-header-row","spreadsheet-has-header"])document.getElementById(id).addEventListener("change",()=>previewSpreadsheet(true));
    for(const field of ["address","street","city","state","postal","country","label","first"])document.getElementById("column-"+field).addEventListener("change",()=>previewSpreadsheet());
    document.getElementById("spreadsheet-mode").addEventListener("change",updateImportCount);
    function applySpreadsheet(plan) {
      if(tripProgress){importMessage.textContent="Finish or end the active trip before importing a new draft.";return;}
      const selected=importSelected();const replace=document.getElementById("spreadsheet-mode").value==="replace";
      const signature=JSON.stringify([importGeneration,replace,selected.map(row=>[row.row,row.address,row.label,row.first])]);
      if(signature===appliedImport) {
        importMessage.textContent="These rows are already loaded. Plan Route uses your current draft and revisions. Select a new file or change the row selection to import again.";
        if(plan)planRoute(true);
        return;
      }
      if(!selected.length || selected.length+(replace?0:stops.length)>MAX_STOPS){importMessage.textContent=`Select between 1 and ${MAX_STOPS} stops in total.`;return;}
      invalidateRoute();
      if(replace){stops.splice(0);stopLabels.splice(0);stopFirst.splice(0);}
      for(const record of selected){stops.push(record.address);stopLabels.push(record.label);stopFirst.push(record.first);}
      appliedImport=signature;
      renderStops();updateImportCount();document.getElementById("job-spreadsheet-details").open=false;
      importMessage.textContent=`Imported ${selected.length} stops into the draft. Start, Finish and saved routes were kept. Set any priorities, then Plan Route.`;
      if(plan)planRoute(true);
    }
    document.getElementById("apply-spreadsheet").addEventListener("click",()=>applySpreadsheet(false));
    document.getElementById("import-optimize").addEventListener("click",()=>applySpreadsheet(true));

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

    // A full-list heuristic, not a claim of shortest driving distance. Initial
    // Directions legs provide coordinates using the existing enabled service.
    function geographicStopOrder(legs, firstFlags = [], priority = "efficiency", cutoff = 40) {
      function coordinate(location) {
        if (!location) return null;
        const lat = typeof location.lat === "function" ? location.lat() : location.lat;
        const lng = typeof location.lng === "function" ? location.lng() : location.lng;
        return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
          ? { lat: lat * Math.PI / 180, lng: lng * Math.PI / 180 } : null;
      }
      const points = [coordinate(legs[0].start_location), ...legs.map(leg => coordinate(leg.end_location))];
      if (points.some(point => !point)) return null;
      const distance = (a, b) => {
        const x = points[a], y = points[b];
        const v = Math.sin((x.lat-y.lat)/2)**2 + Math.cos(x.lat)*Math.cos(y.lat)*Math.sin((x.lng-y.lng)/2)**2;
        return 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, v))));
      };
      const tier = index => firstFlags[index-1] ? 0 : priority === "north"
        ? (points[index].lat*180/Math.PI >= cutoff ? 1:2)
        : priority === "south" ? (points[index].lat*180/Math.PI < cutoff ? 1:2) : 1;
      const remaining = new Set(Array.from({ length: points.length-2 }, (_, i) => i+1));
      const order = [0];
      while (remaining.size) {
        let closest, best = Infinity;
        const nextTier = Math.min(...[...remaining].map(tier));
        for (const candidate of remaining) {
          if(tier(candidate)!==nextTier)continue;
          const cost = distance(order[order.length-1], candidate);
          if (cost < best) { closest = candidate; best = cost; }
        }
        remaining.delete(closest); order.push(closest);
      }
      order.push(points.length-1);
      // Bounded 2-opt improvement keeps both endpoints fixed.
      for (let pass = 0; pass < 4; pass++) {
        let changed = false;
        for (let i = 1; i < order.length-2; i++) {
          for (let j = i+1; j < order.length-1; j++) {
            if(tier(order[i])!==tier(order[j]))break;
            const old = distance(order[i-1],order[i]) + distance(order[j],order[j+1]);
            const next = distance(order[i-1],order[j]) + distance(order[i],order[j+1]);
            if (next + 1e-12 < old) {
              order.splice(i,j-i+1,...order.slice(i,j+1).reverse()); changed = true;
            }
          }
        }
        if (!changed) break;
      }
      return { indices: order.slice(1,-1).map(index => index-1), tiers: firstFlags.map((_,i)=>tier(i+1)) };
    }

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

      if (stops.length > MAX_STOPS) {
        routeMessage.textContent = `You have reached the ${MAX_STOPS}-stop limit.`;
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

      const requestedStops = stops.map(address => String(address));
      const requestedLabels = requestedStops.map((_, i) => stopLabels[i] || "");
      let parsedInstructions;
      try { parsedInstructions = D7Import.instructions(document.getElementById("route-instructions").value || "", requestedStops.length); }
      catch(error) { routeMessage.textContent = error.message; document.getElementById("route-instructions").focus(); return; }
      document.getElementById("route-priority").value = parsedInstructions.priority;
      document.getElementById("northern-cutoff").value = String(parsedInstructions.cutoff);
      const requestedFirst = requestedStops.map((_,i)=>!!stopFirst[i] || parsedInstructions.first.includes(i+1));
      const priority = document.getElementById("route-priority").value || "efficiency";
      const cutoff = Number(document.getElementById("northern-cutoff").value || "40");
      if(optimize && (!["efficiency","north","south"].includes(priority) || !Number.isFinite(cutoff) || cutoff < -90 || cutoff > 90)) {
        routeMessage.textContent = "Choose a supported route priority and a latitude between -90 and 90.";
        return;
      }
      const constrained = priority!=="efficiency" || requestedFirst.some(Boolean);
      let tiers = requestedStops.map(()=>1);
      let sectionOffsets = [];
      let activeIndices = requestedStops.map((_, i) => i);
      let phase = optimize && (requestedStops.length > DIRECTIONS_WAYPOINT_LIMIT || constrained) ? "baseline" : "final";
      let baseline = null;
      let sections;
      function buildSections(indices) {
        activeIndices = indices;
        const points = [origin, ...indices.map(i => requestedStops[i].trim()), destination];
        sections = []; sectionOffsets = [];
        let first=0;
        while(first < points.length-1) {
          let last=Math.min(first+DIRECTIONS_WAYPOINT_LIMIT+1,points.length-1);
          if(phase==="final" && optimize && constrained && first<indices.length) {
            // Never let Google's section optimizer exchange priority groups.
            const group=tiers[indices[first]];
            let boundary=first+1;
            while(boundary<indices.length && tiers[indices[boundary]]===group)boundary++;
            last=Math.min(last,boundary);
            if(boundary===indices.length && last===boundary && last-first<=DIRECTIONS_WAYPOINT_LIMIT)last++;
          }
          sectionOffsets.push(first);sections.push(points.slice(first,last+1));first=last;
        }
      }
      buildSections(activeIndices);
      let completed = [];
      let orderedPoints = [origin];
      let orderedIndices = [];
      let allLegs = [];
      routeRequestPending = true;

      const current = () => requestId === routeRequestId;
      function fail(message) {
        if (!current()) return;
        routeRequestPending = false;
        routeMessage.textContent = message;
      }
      function publish() {
        let keptOriginal = false;
        if (baseline && baseline.complies && allLegs.reduce((sum, leg) => sum + leg.distance.value, 0) > baseline.distance) {
          ({ completed, allLegs, orderedPoints, orderedIndices } = baseline);
          keptOriginal = true;
        }
        const totalDistance = allLegs.reduce((sum, leg) => sum + leg.distance.value, 0);
        const totalDuration = allLegs.reduce((sum, leg) => sum + leg.duration.value, 0);
        if (!Number.isFinite(totalDistance) || !Number.isFinite(totalDuration)) {
          fail("Could not calculate route: invalid route totals. Please try again.");
          return;
        }
        const orderedStops = orderedPoints.slice(1, -1);
        // Only publish after every section is validated. Intermediate successes
        // never expose a partial map, navigation, trip snapshot or stop reorder.
        const markers = typeof renderRouteMarkers === "function"
          ? renderRouteMarkers(map, { routes: [{ legs: allLegs }] }) : null;
        routeMarkers = markers || [];
        try {
          const fitAll = completed.length > 1 && typeof google.maps.LatLngBounds === "function" &&
            typeof map.fitBounds === "function";
          const bounds = fitAll ? new google.maps.LatLngBounds() : null;
          completed.forEach((result, index) => {
            const renderer = index === 0 ? directionsRenderer : new google.maps.DirectionsRenderer({
              polylineOptions: typeof D7_ROUTE_STYLE !== "undefined" ? D7_ROUTE_STYLE : { strokeColor: "#ed2944", strokeWeight: 5 }
            });
            if (index > 0) sectionRenderers.push(renderer);
            if (typeof renderer.setOptions === "function") {
              renderer.setOptions({ suppressMarkers: !!markers, preserveViewport: !!fitAll });
            }
            renderer.setDirections(result);
            renderer.setMap(map);
            if (bounds) {
              // Bounds from actual returned leg coordinates also cover every
              // section when the provider omits an optional route bounds object.
              const route = result.routes[0];
              if (route.bounds) bounds.union(route.bounds);
              else for (const leg of route.legs) {
                if (leg.start_location) bounds.extend(leg.start_location);
                if (leg.end_location) bounds.extend(leg.end_location);
              }
            }
          });
          if (bounds && !bounds.isEmpty()) map.fitBounds(bounds);
        } catch {
          clearRouteResults();
          fail("Could not calculate route: the map could not display the complete route. Please try again.");
          return;
        }
        if (optimize && requestedStops.length) {
          stops.splice(0, stops.length, ...orderedStops);
          stopLabels.splice(0, stopLabels.length, ...orderedIndices.map(i => requestedLabels[i]));
          stopFirst.splice(0, stopFirst.length, ...orderedIndices.map(i => requestedFirst[i]));
          if(parsedInstructions.first.length)document.getElementById("route-instructions").value=D7Import.instructionText({...parsedInstructions, first:orderedIndices.map((original,i)=>parsedInstructions.first.includes(original+1)?i+1:null).filter(Boolean)});
          renderStops();
        }
        document.getElementById("route-order-note").textContent = baseline
          ? (keptOriginal ? "Kept the entered order because it had a shorter driving distance than the optimized candidate."
            : "Geographic ordering across the full list, then optimization within priority groups. Your selected priorities take precedence over distance. This is a heuristic, not a guaranteed shortest route.")
          : "";
        routeRequestPending = false;
        routeShown = true;
        routeStaleWarning.hidden = true;
        showNavigation(orderedPoints);
        routePlan = {
          start: origin, stops: orderedStops, destination,
          ...(stopLabels.some(Boolean) ? {stopLabels:[...stopLabels]} : {}),
          plannedMiles: totalDistance / 1609.344,
          plannedMinutes: totalDuration / 60,
          legs: allLegs.map((leg, index) => ({
            from: orderedPoints[index], to: orderedPoints[index + 1],
            plannedMiles: leg.distance.value / 1609.344,
            plannedMinutes: leg.duration.value / 60
          }))
        };
        if (typeof D7RouteTools !== "undefined") D7RouteTools.setRoute(orderedPoints, allLegs, stopLabels);
        const miles = (totalDistance / 1609.344).toFixed(1);
        const minutes = Math.round(totalDuration / 60);
        const estimate = estimatedFuelCost(Number(miles));
        const fuelCost = estimate === null ? "" : ` • Est. fuel: $${estimate.toFixed(2)}`;
        routeMessage.textContent =
          `${optimize ? "Route optimized" : "Route calculated"}: ${miles} miles • ${minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`}${fuelCost}`;
      }
      function requestSection(index) {
        if (!current()) return;
        const section = sections[index];
        const intermediate = section.slice(1, -1);
        routeMessage.textContent = `${optimize ? "Optimizing route" : "Calculating route"}...` +
          (sections.length > 1 ? ` ${phase === "baseline" ? "Locating stops · " : ""}Section ${index + 1} of ${sections.length}.` : "");
        let answered=false;
        const routeTimeout = setTimeout(() => {
          if (!current()) return;
          routeRequestId += 1;
          routeRequestPending = false;
          routeMessage.textContent = "Route request timed out. Please try again.";
        }, ROUTE_REQUEST_TIMEOUT_MS);
        try {
          directionsService.route({
            origin: section[0], destination: section[section.length - 1],
            waypoints: intermediate.map(address => ({ location: address, stopover: true })),
            optimizeWaypoints: optimize && phase !== "baseline", travelMode: google.maps.TravelMode.DRIVING
          }, (result, status) => {
            if(answered)return;answered=true;
            clearTimeout(routeTimeout);
            if (!current()) return;
            if (JSON.stringify(stops) !== JSON.stringify(requestedStops) ||
                destinationInput.value.trim() !== destination || startInput.value.trim() !== origin) {
              invalidateRoute();
              routeStaleWarning.hidden = false;
              return;
            }
            if (status !== "OK") {
              if (status === "MAX_ROUTE_LENGTH_EXCEEDED" && section.length > 2) {
                // A geographically long/complex section may need fewer stops
                // than Google's waypoint ceiling. Split internally and retry.
                const middle = Math.floor((section.length - 1) / 2);
                const offset = sectionOffsets[index];
                sections.splice(index, 1, section.slice(0, middle + 1), section.slice(middle));
                sectionOffsets.splice(index, 1, offset, offset + middle);
                requestSection(index);
                return;
              }
              fail(`Could not calculate route: ${status}`);
              return;
            }
            const route = result && result.routes && result.routes[0];
            if (!route || !Array.isArray(route.legs) || route.legs.length !== section.length - 1 ||
                route.legs.some(leg => !leg || !leg.distance || !leg.duration ||
                  !Number.isFinite(leg.distance.value) || leg.distance.value < 0 ||
                  !Number.isFinite(leg.duration.value) || leg.duration.value < 0)) {
              fail("Could not calculate route: incomplete route result. Please try again.");
              return;
            }
            const sectionOffset = sectionOffsets[index];
            const intermediateIndices = activeIndices.slice(sectionOffset,sectionOffset+intermediate.length);
            let ids = intermediateIndices;
            let ordered = intermediate;
            if (optimize && phase !== "baseline" && intermediate.length) {
              const order = route.waypoint_order;
              if (!Array.isArray(order) || order.length !== intermediate.length ||
                  new Set(order).size !== intermediate.length ||
                  !order.every(i => Number.isInteger(i) && i >= 0 && i < intermediate.length)) {
                fail("Could not calculate route: invalid optimized stop order. Please try again.");
                return;
              }
              ordered = order.map(i => intermediate[i]);
              ids = order.map(i => intermediateIndices[i]);
            }
            completed.push(result);
            allLegs.push(...route.legs);
            orderedPoints.push(...ordered, section[section.length - 1]);
            orderedIndices.push(...ids);
            if (index+1 < sections.length) orderedIndices.push(activeIndices[sectionOffset+intermediate.length]);
            if (index + 1 < sections.length) requestSection(index + 1);
            else if (phase === "baseline") {
              if(!Number.isFinite(allLegs.reduce((sum,leg)=>sum+leg.distance.value,0)) || !Number.isFinite(allLegs.reduce((sum,leg)=>sum+leg.duration.value,0))) { fail("Could not calculate route: invalid route totals. Please try again."); return; }
              const order = geographicStopOrder(allLegs,requestedFirst,priority,cutoff);
              if (!order) {
                fail("Could not optimize the full stop list: address coordinates were unavailable. Use Keep My Order to preserve your order.");
                return;
              }
              tiers=order.tiers;
              baseline = { completed, allLegs, orderedPoints, orderedIndices,
                complies: orderedIndices.every((id,i)=>i===0 || tiers[orderedIndices[i-1]]<=tiers[id]),
                distance: allLegs.reduce((sum, leg) => sum+leg.distance.value,0) };
              phase = "final";
              completed = []; allLegs = []; orderedPoints = [origin]; orderedIndices = [];
              buildSections(order.indices);
              requestSection(0);
            } else publish();
          });
        } catch {
          answered=true;clearTimeout(routeTimeout);
          fail("Could not calculate route: the request could not be sent. Please try again.");
        }
      }
      requestSection(0);
      if(requestedStops.length>25)routeMessage.scrollIntoView({block:"nearest"});
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
