#!/usr/bin/env node
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const SERVER_VERSION = "2.0.0";
const NOMINATIM_BASE_URL = (process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org").replace(/\/+$/, "");
const OSRM_BASE_URL = (process.env.OSRM_BASE_URL || "https://router.project-osrm.org").replace(/\/+$/, "");
const OVERPASS_BASE_URL = process.env.OVERPASS_BASE_URL || "https://overpass-api.de/api/interpreter";
const USER_AGENT = `osm-mcp-server/${SERVER_VERSION} (https://github.com/tpp6me/osm-mcp-server)`;
const NOMINATIM_EMAIL = process.env.NOMINATIM_EMAIL || "";
// Credit: User-Agent compliance with Nominatim Usage Policy originally contributed by @alex-georgiou (PR #1).

// --- Helpers ---

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Nominatim policy: max 1 req/sec. Simple throttle + in-memory cache.
let lastNominatimAt = 0;
const nominatimCache = new Map(); // key -> { ts, data }
const CACHE_TTL_MS = 1000 * 60 * 60; // 1h

async function nominatimGet(path) {
  const cacheKey = path;
  const cached = nominatimCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const now = Date.now();
  const wait = 1100 - (now - lastNominatimAt);
  if (wait > 0) await sleep(wait);
  lastNominatimAt = Date.now();

  const url = `${NOMINATIM_BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
  if (res.status === 403 || res.status === 429) {
    throw new Error(`Nominatim blocked/throttled (HTTP ${res.status}). Add a custom NOMINATIM_BASE_URL or NOMINATIM_EMAIL, reduce rate, and ensure User-Agent is set.`);
  }
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  nominatimCache.set(cacheKey, { ts: Date.now(), data });
  return data;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

function errorResult(message) {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

// Common amenity/category -> Overpass tag filter
const CATEGORY_MAP = {
  restaurant: "[amenity=restaurant]",
  cafe: "[amenity=cafe]",
  bar: "[amenity=bar]",
  pub: "[amenity=pub]",
  hotel: "[tourism=hotel]",
  hostel: "[tourism=hostel]",
  hospital: "[amenity=hospital]",
  pharmacy: "[amenity=pharmacy]",
  fuel: "[amenity=fuel]",
  atm: "[amenity=atm]",
  bank: "[amenity=bank]",
  supermarket: "[shop=supermarket]",
  parking: "[amenity=parking]",
  toilets: "[amenity=toilets]",
  drinking_water: "[amenity=drinking_water]",
  school: "[amenity=school]",
  library: "[amenity=library]",
  park: "[leisure=park]",
  playground: "[leisure=playground]",
  museum: "[tourism=museum]",
  viewpoint: "[tourism=viewpoint]",
  charging: "[amenity=charging]",
  ev_charging: "[amenity=charging]",
  fast_food: "[amenity=fast_food]",
  post_box: "[amenity=post_box]",
  police: "[amenity=police]",
};

function overpassFilterFor(category) {
  if (!category) return "";
  const key = category.trim().toLowerCase();
  if (CATEGORY_MAP[key]) return CATEGORY_MAP[key];
  // Allow raw "amenity=cafe" or "shop=bakery" passthrough
  if (key.includes("=")) {
    const [k, v] = key.split("=").map((s) => s.trim().replace(/["'\[\]]/g, ""));
    if (k && v) return `[${k}=${v}]`;
  }
  return `[amenity=${key}]`;
}

// --- Server ---

const server = new McpServer(
  { name: "osm-mcp-server", version: SERVER_VERSION },
  { capabilities: { tools: {} } }
);

server.registerTool(
  "about",
  { description: "Returns information about this MCP server" },
  async () => {
    return textResult(
      `OSM MCP server (version ${SERVER_VERSION}).\n\n` +
        `Tools: geocode, search_places, reverse_geocode, place_details, ` +
        `distanceWithHaversine, routeDistance, route_details, distance_matrix, ` +
        `optimize_trip, find_nearby_places, get_map_link.\n` +
        `Data © OpenStreetMap contributors (ODbL). Please use public Nominatim/OSRM/Overpass endpoints lightly (max 1 req/s for Nominatim); for production host your own and set NOMINATIM_BASE_URL / OSRM_BASE_URL / OVERPASS_BASE_URL.`
    );
  }
);

server.registerTool(
  "geocode",
  {
    description: "For a given address, provide the latitude and longitude (top result)",
    inputSchema: {
      address: z.string().describe("The address to geocode"),
      limit: z.number().int().min(1).max(10).optional().default(1).describe("Max results (default 1)"),
      countrycodes: z.string().optional().describe("Comma-separated ISO country codes, e.g. 'us,de'"),
    },
  },
  async ({ address, limit = 1, countrycodes }) => {
    try {
      let path = `/search?format=jsonv2&q=${encodeURIComponent(address)}&limit=${limit}&addressdetails=1`;
      if (countrycodes) path += `&countrycodes=${encodeURIComponent(countrycodes)}`;
      if (NOMINATIM_EMAIL) path += `&email=${encodeURIComponent(NOMINATIM_EMAIL)}`;
      const data = await nominatimGet(path);
      if (!Array.isArray(data) || data.length === 0) return textResult("Address not found");
      const r = data[0];
      return textResult(
        `The coordinates for the address are: Latitude ${r.lat}, Longitude ${r.lon}. Address: ${r.display_name}`
      );
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.registerTool(
  "search_places",
  {
    description: "Search for places by name/address, returns up to N structured results",
    inputSchema: {
      query: z.string().describe("Search query, e.g. 'coffee in Berlin'"),
      limit: z.number().int().min(1).max(20).optional().default(5).describe("Max results"),
      countrycodes: z.string().optional().describe("Comma-separated ISO country codes"),
    },
  },
  async ({ query, limit = 5, countrycodes }) => {
    try {
      let path = `/search?format=jsonv2&q=${encodeURIComponent(query)}&limit=${limit}&addressdetails=1&extratags=1`;
      if (countrycodes) path += `&countrycodes=${encodeURIComponent(countrycodes)}`;
      if (NOMINATIM_EMAIL) path += `&email=${encodeURIComponent(NOMINATIM_EMAIL)}`;
      const data = await nominatimGet(path);
      if (!Array.isArray(data) || data.length === 0) return textResult("No places found");
      const lines = data.map(
        (r, i) =>
          `${i + 1}. ${r.display_name} (${r.lat}, ${r.lon}) [${r.osm_type}/${r.osm_id}, type=${r.type}]`
      );
      return textResult(`Found ${data.length} place(s):\n${lines.join("\n")}`);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.registerTool(
  "reverse_geocode",
  {
    description: "For a given lat and lon give the address",
    inputSchema: {
      lat: z.number().min(-90).max(90).describe("Latitude"),
      lon: z.number().min(-180).max(180).describe("Longitude"),
      zoom: z.number().int().min(0).max(18).optional().default(18).describe("Detail level 0-18"),
    },
  },
  async ({ lat, lon, zoom = 18 }) => {
    try {
      let path = `/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=${zoom}&addressdetails=1`;
      if (NOMINATIM_EMAIL) path += `&email=${encodeURIComponent(NOMINATIM_EMAIL)}`;
      const data = await nominatimGet(path);
      return textResult(`The address is: ${data.display_name || "Address not found"}`);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.registerTool(
  "place_details",
  {
    description: "Look up an OSM object by osm_type (node/way/relation) and osm_id",
    inputSchema: {
      osm_type: z.enum(["node", "way", "relation", "N", "W", "R"]).describe("OSM type"),
      osm_id: z.number().int().positive().describe("OSM id"),
    },
  },
  async ({ osm_type, osm_id }) => {
    try {
      const prefix = { node: "N", way: "W", relation: "R", N: "N", W: "W", R: "R" }[osm_type];
      const data = await nominatimGet(
        `/lookup?format=jsonv2&osm_ids=${prefix}${osm_id}&addressdetails=1&extratags=1`
      );
      if (!Array.isArray(data) || data.length === 0) return textResult("Place not found");
      const r = data[0];
      return textResult(
        `${r.display_name} (${r.lat}, ${r.lon}) [${r.osm_type}/${r.osm_id}, category=${r.category}, type=${r.type}]`
      );
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.registerTool(
  "distanceWithHaversine",
  {
    description: "Calculate the straight-line distance between 2 coordinates using the Haversine formula",
    inputSchema: {
      lat1: z.number().min(-90).max(90).describe("Latitude of the first point"),
      lon1: z.number().min(-180).max(180).describe("Longitude of the first point"),
      lat2: z.number().min(-90).max(90).describe("Latitude of the second point"),
      lon2: z.number().min(-180).max(180).describe("Longitude of the second point"),
      unit: z.enum(["km", "mi", "m"]).optional().default("km").describe("Unit"),
    },
  },
  async ({ lat1, lon1, lat2, lon2, unit = "km" }) => {
    const km = haversineKm(lat1, lon1, lat2, lon2);
    if (unit === "mi") return textResult(`The distance between the two points is ${(km * 0.621371).toFixed(2)} miles.`);
    if (unit === "m") return textResult(`The distance between the two points is ${(km * 1000).toFixed(0)} meters.`);
    return textResult(`The distance between the two points is ${km.toFixed(2)} kilometers.`);
  }
);

server.registerTool(
  "routeDistance",
  {
    description: "Calculate the driving/walking/cycling route distance between two coordinates using OSRM",
    inputSchema: {
      lat1: z.number().min(-90).max(90),
      lon1: z.number().min(-180).max(180),
      lat2: z.number().min(-90).max(90),
      lon2: z.number().min(-180).max(180),
      profile: z.enum(["driving", "walking", "cycling"]).optional().default("driving"),
    },
  },
  async ({ lat1, lon1, lat2, lon2, profile = "driving" }) => {
    try {
      const url = `${OSRM_BASE_URL}/route/v1/${profile}/${lon1},${lat1};${lon2},${lat2}?overview=false`;
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
      const data = await res.json();
      if (data.routes?.length > 0) {
        const m = data.routes[0].distance;
        return textResult(`The route distance is ${(m / 1000).toFixed(2)} kilometers.`);
      }
      throw new Error(data.message || "No route found");
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.registerTool(
  "route_details",
  {
    description: "Full route with distance, duration and turn-by-turn steps (OSRM)",
    inputSchema: {
      lat1: z.number().min(-90).max(90),
      lon1: z.number().min(-180).max(180),
      lat2: z.number().min(-90).max(90),
      lon2: z.number().min(-180).max(180),
      profile: z.enum(["driving", "walking", "cycling"]).optional().default("driving"),
      steps: z.boolean().optional().default(true).describe("Include turn-by-turn steps"),
    },
  },
  async ({ lat1, lon1, lat2, lon2, profile = "driving", steps = true }) => {
    try {
      const url = `${OSRM_BASE_URL}/route/v1/${profile}/${lon1},${lat1};${lon2},${lat2}?overview=false&steps=${steps}`;
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
      const data = await res.json();
      const route = data.routes?.[0];
      if (!route) throw new Error(data.message || "No route found");
      const mins = Math.round(route.duration / 60);
      let out = `Route (${profile}): ${(route.distance / 1000).toFixed(2)} km, ~${mins} min.`;
      if (steps && route.legs?.[0]?.steps) {
        const stepLines = route.legs[0].steps.slice(0, 20).map((s, i) => {
          const instr = s.maneuver?.type ? `${s.maneuver.type}${s.maneuver.modifier ? " " + s.maneuver.modifier : ""}` : "proceed";
          const road = s.name ? ` on ${s.name}` : "";
          return `${i + 1}. ${instr}${road} (${Math.round(s.distance)} m)`;
        });
        out += `\nSteps:\n${stepLines.join("\n")}`;
      }
      return textResult(out);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.registerTool(
  "distance_matrix",
  {
    description: "Distance/duration matrix between multiple points (OSRM table service, max ~10 points)",
    inputSchema: {
      locations: z
        .array(z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }))
        .min(2)
        .max(10)
        .describe("List of points"),
      profile: z.enum(["driving", "walking", "cycling"]).optional().default("driving"),
    },
  },
  async ({ locations, profile = "driving" }) => {
    try {
      const coords = locations.map((p) => `${p.lon},${p.lat}`).join(";");
      const url = `${OSRM_BASE_URL}/table/v1/${profile}/${coords}?annotations=distance,duration`;
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
      const data = await res.json();
      if (data.code !== "Ok") throw new Error(data.message || "Table request failed");
      const fmt = (m) => (m == null ? "–" : `${(m / 1000).toFixed(1)}km`);
      const rows = data.distances.map((row, i) => `from ${i}: ${row.map(fmt).join(" | ")}`);
      return textResult(`Distance matrix (${profile}):\n${rows.join("\n")}`);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.registerTool(
  "optimize_trip",
  {
    description: "Optimize visit order for up to ~10 waypoints (OSRM trip service, TSP)",
    inputSchema: {
      locations: z
        .array(z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }))
        .min(2)
        .max(10)
        .describe("Waypoints to visit"),
      profile: z.enum(["driving", "walking", "cycling"]).optional().default("driving"),
      roundtrip: z.boolean().optional().default(true).describe("Return to start"),
    },
  },
  async ({ locations, profile = "driving", roundtrip = true }) => {
    try {
      const coords = locations.map((p) => `${p.lon},${p.lat}`).join(";");
      const url = `${OSRM_BASE_URL}/trip/v1/${profile}/${coords}?roundtrip=${roundtrip}&source=first&overview=false`;
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
      const data = await res.json();
      if (data.code !== "Ok") throw new Error(data.message || "Trip request failed");
      const order = data.waypoints?.map((w) => w.waypoint_index).join(" -> ") ?? "?";
      const t = data.trips?.[0];
      const summary = t ? `${(t.distance / 1000).toFixed(2)} km, ~${Math.round(t.duration / 60)} min` : "";
      return textResult(`Optimized order: ${order}\nTotal: ${summary}`);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.registerTool(
  "find_nearby_places",
  {
    description: "Find nearby POIs (restaurants, cafes, hotels, fuel, etc.) via Overpass API",
    inputSchema: {
      lat: z.number().min(-90).max(90).describe("Center latitude"),
      lon: z.number().min(-180).max(180).describe("Center longitude"),
      radius: z.number().int().min(50).max(10000).optional().default(1000).describe("Radius in meters"),
      category: z.string().describe("e.g. restaurant, cafe, hotel, hospital, fuel, atm, supermarket, parking, pharmacy"),
      limit: z.number().int().min(1).max(30).optional().default(10),
    },
  },
  async ({ lat, lon, radius = 1000, category, limit = 10 }) => {
    try {
      const filter = overpassFilterFor(category);
      const ql = `[out:json][timeout:25];nwr(around:${radius},${lat},${lon})${filter};out center ${limit};`;
      const res = await fetch(OVERPASS_BASE_URL, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(ql)}`,
      });
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      const data = await res.json();
      const els = (data.elements || []).slice(0, limit);
      if (els.length === 0) return textResult(`No '${category}' found within ${radius} m.`);
      const lines = els.map((el, i) => {
        const tags = el.tags || {};
        const name = tags.name || "(unnamed)";
        const plat = el.lat ?? el.center?.lat;
        const plon = el.lon ?? el.center?.lon;
        return `${i + 1}. ${name} (${plat}, ${plon}) [${el.type}/${el.id}]`;
      });
      return textResult(`Found ${els.length} '${category}' within ${radius} m:\n${lines.join("\n")}`);
    } catch (e) {
      return errorResult(e.message);
    }
  }
);

server.registerTool(
  "get_map_link",
  {
    description: "Generate an OpenStreetMap link for coordinates",
    inputSchema: {
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
      zoom: z.number().int().min(0).max(19).optional().default(15),
    },
  },
  async ({ lat, lon, zoom = 15 }) => {
    return textResult(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`);
  }
);

// --- Connect ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`osm-mcp-server ${SERVER_VERSION} connected`);
}

process.on("SIGTERM", () => {
  console.error("SIGTERM received but staying alive");
});

main().catch((error) => {
  console.error(`Connection error: ${error.message}`);
  process.exit(1);
});
