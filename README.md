# MCP Server for OSM
## Overview

This is an MCP server for accessing some OSM functions. We will access nominatim functionality of geocoding and reverse geocoding and some of the distance APIs from OSRM. 

Please note that these are open servers, use them lightly and fairly. For production usage consider installing you own servers and using them. The base urls are at the beginning of the file index.js

This can be used as a simple started code to understand MCP servers. It gives implementations of APIs and also haversine distance a non-API implementation.

## Requirements

It need Node version 20 and above

## Features

The following geo services are coded

1. Geocoding using Nominatim API. Sample prompt -Give coordinates of New York
2. Reverse geocoding using Nominatim API. Sample prompt - Give address of (12.77, 78.32)
3. Route distance between 2 points using OSRM. 
4. Haversine distance between 2 points

You can ask for the distance between San Jose and San Fransisco and the server will get the coordinates for both San Jose and San Fransisco and get the straight distance and route distance.

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





