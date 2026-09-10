#!/usr/bin/env node
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
//const fetch = require('node-fetch');
const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const OSRM_BASE_URL = "http://router.project-osrm.org/";
const HTTP_HEADERS = {
  "User-Agent": "osm-mcp-server/1.0 (MCP server for Nominatim and OSRM)",
};

const server = new Server(
  { name: "osm-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Define the tools with the required inputSchema property
const TOOLS = [
  {
    name: "about",
    description: "Returns information about this MCP server",
    inputSchema: {  // This MUST be inputSchema, not parameters
      type: "object",
      properties: {},
      required: []
    }
  },


  {
    name: "distanceWithHaversine",
    description: "Calculate the distance between 2 coordinates using the Haversine formula",
    inputSchema: {
      type: "object",
      properties: {
        lat1: {
          type: "number",
          description: "Latitude of the first point"
        },
        lon1: {
          type: "number",
          description: "Longitude of the first point"
        },
        lat2: {
          type: "number",
          description: "Latitude of the second point"
        },
        lon2: {
          type: "number",
          description: "Longitude of the second point"
        }
      },
      required: ["lat1", "lon1", "lat2", "lon2"]
    }
  },
  {
    name: "reverse_geocode",
    description: "For a given lat and lon give the address",
    inputSchema: {
      type: "object",
      properties: {
        lat: {
          type: "number",
          description: "Latitude of the  point"
        },
        lon: {
          type: "number",
          description: "Longitude of the point"
        }
      },
      required: ["lat", "lon"]
    }
    
  },
  {
    name: "geocode",
    description: "For a given address, provide the latitude and longitude",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "The address to geocode"
        }
      },
      required: ["address"]
    }
  },
  {
    name: "routeDistance",
    description: "Calculate the route distance between two coordinates using the OSRM API",
    inputSchema: {
      type: "object",
      properties: {
        lat1: {
          type: "number",
          description: "Latitude of the first point"
        },
        lon1: {
          type: "number",
          description: "Longitude of the first point"
        },
        lat2: {
          type: "number",
          description: "Latitude of the second point"
        },
        lon2: {
          type: "number",
          description: "Longitude of the second point"
        }
      },
      required: ["lat1", "lon1", "lat2", "lon2"]
    }
  }
];

// Handle all requests
server.fallbackRequestHandler = async (request) => {
  try {
    const { method, params, id } = request;
    console.error(`REQUEST: ${method} [${id}]`);
    
    // Initialize
    if (method === "initialize") {
      return {
        protocolVersion: "2025-04-30",
        capabilities: { tools: {} },
        serverInfo: { name: "osm-mcp-server", version: "1.0.0" }
      };
    }
    
    // Tools list
    if (method === "tools/list") {
      console.error(`TOOLS: ${JSON.stringify(TOOLS)}`);
      return { tools: TOOLS };
    }
    
    // Tool call
    if (method === "tools/call") {
      const { name, arguments: args = {} } = params || {};
      
      if (name === "about") {
        return {
          content: [
            { 
              type: "text", 
              text: `This is a OSM MCP server (version 1.0.0).\n\nIt serves as a yatis for building Claude integrations.` 
            }
          ]
        };
      }

      if (name === "distanceWithHaversine") {
        const { lat1, lon1, lat2, lon2 } = args;
        if (!lat1 || !lon1 || !lat2 || !lon2) {
          return {
            error: {
              code: -32602,
              message: "Missing required parameters: lat1, lon1, lat2, lon2"
            }
          };
        }

        function haversine(lat1, lon1, lat2, lon2) {
          const toRadians = (degree) => (degree * Math.PI) / 180;
          const R = 6371; // Radius of the Earth in kilometers
          const dLat = toRadians(lat2 - lat1);
          const dLon = toRadians(lon2 - lon1);
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRadians(lat1)) *
              Math.cos(toRadians(lat2)) *
              Math.sin(dLon / 2) *
              Math.sin(dLon / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          return R * c; // Distance in kilometers
        }

        const distance = haversine(lat1, lon1, lat2, lon2);
        return {
          content: [
            {
              type: "text",
              text: `The distance between the two points is ${distance.toFixed(2)} kilometers.`
            }
          ]
        };
      }

      if (name === "reverse_geocode") {
        const { lat, lon } = args;
        if (!lat || !lon) {
          return {
            error: {
              code: -32602,
              message: "Missing required parameters: lat, lon"
            }
          };
        }

        console.error(`Reverse geocoding for lat: ${lat}, lon: ${lon}`);

        async function fetchAddress(lat, lon) {
          const url = `${NOMINATIM_BASE_URL}/reverse?format=json&lat=${lat}&lon=${lon}`;
          try {
            const response = await fetch(url, { headers: HTTP_HEADERS });
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            return data.display_name || "Address not found";
          } catch (error) {
            console.error(`Error fetching reverse geocode: ${error.message}`);
            return "Error fetching address";
          }
        }

        const address = await fetchAddress(lat, lon);
        return {
          content: [
            {
              type: "text",
              text: `The address is: ${address}`
            }
          ]
        };
      }

      if (name === "geocode") {
        const { address } = args;
        if (!address) {
          return {
            error: {
              code: -32602,
              message: "Missing required parameter: address"
            }
          };
        }

        console.error(`Geocoding for address: ${address}`);

        async function fetchCoordinates(address) {
          const url = `${NOMINATIM_BASE_URL}/search?format=json&q=${encodeURIComponent(address)}`;
          try {
            const response = await fetch(url, { headers: HTTP_HEADERS });
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            if (data.length > 0) {
              return {
                latitude: data[0].lat,
                longitude: data[0].lon,
                display_name: data[0].display_name
              };
            } else {
              return "Address not found";
            }
          } catch (error) {
            console.error(`Error fetching geocode: ${error.message}`);
            return "Error fetching geocode";
          }
        }

        const result = await fetchCoordinates(address);
        if (typeof result === "string") {
          return {
            content: [
              {
                type: "text",
                text: result
              }
            ]
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `The coordinates for the address are: Latitude ${result.latitude}, Longitude ${result.longitude}. Address: ${result.display_name}`
              }
            ]
          };
        }
      }

      if (name === "routeDistance") {
        const { lat1, lon1, lat2, lon2 } = args;
        if (!lat1 || !lon1 || !lat2 || !lon2) {
          return {
            error: {
              code: -32602,
              message: "Missing required parameters: lat1, lon1, lat2, lon2"
            }
          };
        }

        console.error(`Calculating route distance for coordinates: (${lat1}, ${lon1}) to (${lat2}, ${lon2})`);

        async function fetchRouteDistance(lat1, lon1, lat2, lon2) {
          const baseUrl = `${OSRM_BASE_URL}/route/v1/driving`;
          const url = `${baseUrl}/${lon1},${lat1};${lon2},${lat2}?overview=false`;

          try {
            const response = await fetch(url, { headers: HTTP_HEADERS });
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            if (data.routes && data.routes.length > 0) {
              return data.routes[0].distance; // Distance in meters
            } else {
              throw new Error('No route found');
            }
          } catch (error) {
            console.error(`Error fetching route distance: ${error.message}`);
            return null;
          }
        }

        const distance = await fetchRouteDistance(lat1, lon1, lat2, lon2);
        if (distance !== null) {
          return {
            content: [
              {
                type: "text",
                text: `The route distance is ${(distance / 1000).toFixed(2)} kilometers.`
              }
            ]
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: "Could not calculate the route distance."
              }
            ]
          };
        }
      }

      return {
        error: {
          code: -32601,
          message: `Tool not found: ${name}`
        }
      };
    }
    
    // Required empty responses
    if (method === "resources/list") return { resources: [] };
    if (method === "prompts/list") return { prompts: [] };
    
    // Empty response for unhandled methods
    return {};
    
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    return {
      error: {
        code: -32603,
        message: "Internal error",
        data: { details: error.message }
      }
    };
  }
};

// Connect to stdio transport
const transport = new StdioServerTransport();

// Stay alive on SIGTERM
process.on("SIGTERM", () => {
  console.error("SIGTERM received but staying alive");
});

// Connect server
server.connect(transport)
  .then(() => console.error("Server connected"))
  .catch(error => {
    console.error(`Connection error: ${error.message}`);
    process.exit(1);
  });
