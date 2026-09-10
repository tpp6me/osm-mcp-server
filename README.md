# MCP Server for OSM
## Overview

This is an MCP server for accessing OSM functions: Nominatim (geocoding/reverse/lookup), OSRM (routing/matrix/trip) and Overpass (nearby POI search).

Please note that these are open servers, use them lightly and fairly. For production usage consider installing your own servers and using them. Set custom endpoints via env vars (see below).

## Requirements

Node 20+

`npm install`

## Features (v2.0.0, 12 tools)

1. `geocode` – address → coords (top result, `limit`, `countrycodes`)
2. `search_places` – query → up to 20 structured results
3. `reverse_geocode` – lat/lon → address (`zoom` 0-18)
4. `place_details` – OSM lookup by `osm_type` + `osm_id`
5. `distanceWithHaversine` – straight-line distance (`km`/`mi`/`m`)
6. `routeDistance` – OSRM distance (`driving`/`walking`/`cycling`)
7. `route_details` – distance + duration + turn-by-turn steps
8. `distance_matrix` – OSRM table for 2-10 points
9. `optimize_trip` – OSRM trip (TSP) for 2-10 waypoints
10. `find_nearby_places` – Overpass POIs: restaurant, cafe, hotel, fuel, atm, etc. within radius
11. `get_map_link` – openstreetmap.org link for coords
12. `about` – server info

Sample prompts: "Give coordinates of New York", "Coffee shops within 1km of (12.97, 77.59)?", "Optimize a trip visiting A, B, C", "Driving route Berlin → Potsdam with steps?".

## Env vars

```
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org
OSRM_BASE_URL=https://router.project-osrm.org
OVERPASS_BASE_URL=https://overpass-api.de/api/interpreter
NOMINATIM_EMAIL=you@example.com   # optional, for large usage
```

## Installation

To install the dependancies

`npm install`

Else you can install the dependancy 

`npm install @modelcontextprotocol/sdk`

To enable the MCP server in the workspace we have create a directory and a configuration file in that directory.

```
mkdir .vscode
cd .vscode
touch mcp.json

```

Make a directory called .vscode in you working directory, create a file called mcp.json and add the configuration below. Update the paths to you node and your API key

```javascript
{
    "servers": {
        "my-mcp-server-bfba9100": {
            "type": "stdio",
            "command": "/path/to/node",
            "args": [       
                "/path/to/index.js"
            ],
            "env": {

            },
        }
    }
}
```

### Global VScode

Add the configuration file in ~/.vscode to make it accessible across all directories

### Cursor

The global and local workspace will work for cursor also. The directories will be called .cursor. You can place the configuration file.

## Claude Integration

The MCP server can be added to Claude Desktop app. Find the file claude_desktop_config.json. In MAC they will be available at 

` ~/Library/Application\ Support/Claude/claude_desktop_config.json

## Using custom Nominatim and OSRM servers

This MCP server can be used with custom Nominatim and OSRM servers, for e.g. your own servers if you choose to host them. This is usually recommended for production use. Change the lines

```
const NOMINATIM_BASE_URL = "<CUSTOM NOMINATIM SERVER>";
const OSRM_BASE_URL = "<CUSTOM OSRM SERVER>";





