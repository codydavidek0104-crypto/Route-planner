/* Optional map tools and on-demand NWS forecasts; neither changes route order. */
const D7RouteTools = (() => {
  const el = id => document.getElementById(id);
  const select = el("weather-stop");
  const check = el("check-weather");
  const results = el("weather-results");
  let activeMap, mapsApi, traffic, trafficOn = false;
  let points = [], requestId = 0, controller;
  const cache = new Map();
  const text = (tag, value, className) => {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    return element;
  };
  function coordinate(location) {
    try {
      const lat = typeof location?.lat === "function" ? location.lat() : location?.lat;
      const lng = typeof location?.lng === "function" ? location.lng() : location?.lng;
      return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
    } catch { return null; }
  }
  function cancelWeather() {
    requestId++;
    if (controller) controller.abort();
    controller = null;
    results.innerHTML = "";
    el("weather-message").textContent = "";
    check.disabled = navigator.onLine === false || !points[Number(select.value)]?.location;
  }
  function clear() {
    points = [];
    cancelWeather();
    select.innerHTML = "";
    const option = text("option", "Plan a route first"); option.value = "";
    select.appendChild(option); select.value = "";
    select.disabled = true; check.disabled = true;
    el("fit-route").disabled = true;
  }
  function ready(map, api) {
    activeMap = map; mapsApi = api;
    el("toggle-traffic").disabled = navigator.onLine === false || typeof api.TrafficLayer !== "function";
    el("fit-route").disabled = !points.length || points.some(point => !point.location);
  }
  function unavailable() {
    if (traffic) { try { traffic.setMap(null); } catch {} }
    trafficOn = false;
    el("toggle-traffic").setAttribute("aria-pressed", "false");
    el("toggle-traffic").disabled = true;
    el("traffic-note").hidden = true;
    el("fit-route").disabled = true;
    activeMap = null;
  }
  function setRoute(addresses, legs, labels) {
    clear();
    const locations = [coordinate(legs[0]?.start_location), ...legs.map(leg => coordinate(leg.end_location))];
    if (locations.length !== addresses.length) return;
    points = addresses.map((address, index) => ({
      name: `${index === 0 ? "Start" : index === addresses.length - 1 ? "Finish" : "Stop " + index}: ${index > 0 && index < addresses.length - 1 && labels[index - 1] ? labels[index - 1] + " — " : ""}${address}`,
      location: locations[index]
    }));
    select.innerHTML = "";
    points.forEach((point, index) => {
      const option = text("option", point.name + (point.location ? "" : " (location unavailable)"));
      option.value = String(index); option.disabled = !point.location;
      select.appendChild(option);
    });
    const first = points.findIndex(point => point.location);
    select.value = first < 0 ? "" : String(first);
    select.disabled = first < 0;
    check.disabled = first < 0 || navigator.onLine === false;
    el("fit-route").disabled = !activeMap || points.some(point => !point.location);
    if (first < 0) el("weather-message").textContent = "Weather locations were not returned for this route. Try planning again when online.";
  }
  function safeForecastUrl(value) {
    const url = new URL(value);
    if (url.origin !== "https://api.weather.gov" || !/^\/gridpoints\/[A-Z]{3}\/\d+,\d+\/forecast$/.test(url.pathname) || url.search || url.hash) {
      throw new Error("The weather service returned an unsupported forecast link.");
    }
    return url.href;
  }
  async function getJson(url, signal) {
    // Browsers supply their User-Agent; this client requests GeoJSON over HTTPS.
    const response = await fetch(url, { signal, headers: { Accept: "application/geo+json" }, credentials: "omit", redirect: "error" });
    if (response.status === 404) throw new Error("A National Weather Service forecast is not available at this location. Coverage is limited to supported U.S. locations.");
    if (response.status === 429) throw new Error("The weather service is busy. Please try again shortly.");
    if (!response.ok) throw new Error("The weather service could not respond. Please try again.");
    return response.json();
  }
  function forecastData(data) {
    const properties = data?.properties;
    const updated = properties?.updateTime || properties?.generatedAt;
    if (!updated || !Number.isFinite(Date.parse(updated)) || Date.now() - Date.parse(updated) > 48 * 60 * 60 * 1000) {
      throw new Error("The weather service did not return a recent forecast. Please try again later.");
    }
    if (!Array.isArray(properties.periods)) throw new Error("The weather forecast was incomplete.");
    const periods = properties.periods.filter(period => period && Date.parse(period.endTime) > Date.now()).slice(0, 14);
    if (!periods.length || periods.some(period => !Number.isFinite(Date.parse(period.startTime)) ||
        !Number.isFinite(Date.parse(period.endTime)) || Date.parse(period.endTime) <= Date.parse(period.startTime) ||
        typeof period.name !== "string" || !Number.isFinite(period.temperature) || !["F", "C"].includes(period.temperatureUnit) ||
        typeof period.shortForecast !== "string")) throw new Error("The weather service did not return usable forecast periods.");
    return { updated, periods };
  }
  function displayForecast(forecast, point) {
    results.innerHTML = "";
    results.appendChild(text("h3", point.name));
    const stamp = text("p", "NWS forecast updated " + new Date(forecast.updated).toLocaleString() + " (your device time).", "hint");
    results.appendChild(stamp);
    const list = document.createElement("ul"); list.className = "weather-periods";
    for (const period of forecast.periods) {
      const item = document.createElement("li");
      item.appendChild(text("strong", `${period.name} · ${period.temperature}°${period.temperatureUnit}`));
      item.appendChild(text("p", period.shortForecast));
      const precipitation = period.probabilityOfPrecipitation?.value;
      const details = [];
      if (typeof period.windSpeed === "string") details.push(`Wind ${period.windSpeed}${typeof period.windDirection === "string" ? " " + period.windDirection : ""}`);
      if (Number.isFinite(precipitation) && precipitation >= 0 && precipitation <= 100) details.push(`Precipitation ${precipitation}%`);
      if (details.length) item.appendChild(text("small", details.join(" · ")));
      list.appendChild(item);
    }
    results.appendChild(list);
    const link = text("a", "Full forecast from the National Weather Service");
    link.href = `https://forecast.weather.gov/MapClick.php?lat=${point.location.lat.toFixed(4)}&lon=${point.location.lng.toFixed(4)}`;
    link.target = "_blank"; link.rel = "noopener noreferrer";
    results.appendChild(link);
  }
  async function loadWeather() {
    cancelWeather();
    const point = points[Number(select.value)];
    if (!point?.location) { el("weather-message").textContent = "Plan a route and choose a location first."; return; }
    if (navigator.onLine === false) { el("weather-message").textContent = "Connect to the internet to check the forecast."; return; }
    const id = requestId;
    controller = new AbortController();
    const currentController = controller;
    const signal = currentController.signal;
    const timer = setTimeout(() => currentController.abort(), 15000);
    check.disabled = true;
    el("weather-message").textContent = "Checking the forecast…";
    try {
      const key = `${point.location.lat.toFixed(4)},${point.location.lng.toFixed(4)}`;
      const cached = cache.get(key);
      let forecast;
      if (cached && Date.now() - cached.time < 10 * 60 * 1000) forecast = forecastData({ properties: cached.forecast });
      else {
        const location = await getJson("https://api.weather.gov/points/" + key, signal);
        if (id !== requestId) return;
        const data = await getJson(safeForecastUrl(location?.properties?.forecast), signal);
        forecast = forecastData(data);
        if (id !== requestId) return;
        if (cache.size >= 20) cache.delete(cache.keys().next().value);
        cache.set(key, { time: Date.now(), forecast: { updateTime: forecast.updated, periods: forecast.periods } });
      }
      if (id !== requestId) return;
      displayForecast(forecast, point);
      el("weather-message").textContent = "Upcoming forecast. Period names refer to local time at this stop.";
    } catch (error) {
      if (id === requestId) el("weather-message").textContent = error.name === "AbortError"
        ? "The weather request timed out. Try again when the connection is stable."
        : "Could not load weather. " + error.message;
    } finally {
      clearTimeout(timer);
      if (id === requestId) { controller = null; check.disabled = navigator.onLine === false || !point.location; }
    }
  }
  select.addEventListener("change", cancelWeather);
  check.addEventListener("click", loadWeather);
  el("view-weather").addEventListener("click", () => {
    showView("plan"); el("weather-panel").open = true;
    el("weather-heading").focus(); el("weather-panel").scrollIntoView({ block: "start" });
  });
  el("toggle-traffic").addEventListener("click", () => {
    if (!activeMap || navigator.onLine === false || typeof mapsApi?.TrafficLayer !== "function") return;
    try {
      if (!traffic) traffic = new mapsApi.TrafficLayer();
      traffic.setMap(trafficOn ? null : activeMap);
      trafficOn = !trafficOn;
      el("toggle-traffic").setAttribute("aria-pressed", String(trafficOn));
      el("traffic-note").hidden = !trafficOn;
      el("map-tool-message").textContent = "";
    } catch { el("map-tool-message").textContent = "Traffic could not load. Please try again."; }
  });
  el("fit-route").addEventListener("click", () => {
    if (!activeMap || !points.length || points.some(point => !point.location)) return;
    try {
      const bounds = new mapsApi.LatLngBounds();
      points.forEach(point => bounds.extend(point.location));
      activeMap.fitBounds(bounds);
      el("map-tool-message").textContent = "";
    } catch { el("map-tool-message").textContent = "Could not show the full route. Use the map controls to adjust the view."; }
  });
  if (typeof window.addEventListener === "function") {
    window.addEventListener("offline", () => {
      cancelWeather(); check.disabled = true; el("toggle-traffic").disabled = true;
      if (trafficOn && traffic) { try { traffic.setMap(null); } catch {} }
      trafficOn = false; el("toggle-traffic").setAttribute("aria-pressed", "false"); el("traffic-note").hidden = true;
      el("weather-message").textContent = "Connect to the internet to check the forecast.";
    });
    window.addEventListener("online", () => {
      check.disabled = !points[Number(select.value)]?.location;
      el("toggle-traffic").disabled = !activeMap || typeof mapsApi?.TrafficLayer !== "function";
    });
  }
  clear();
  return { ready, unavailable, clear, setRoute };
})();
