# Earth Satellite Simulator

A lightweight, stylized web-based 3D satellite simulator built with Vanilla JavaScript, Three.js, and Vite.

Website: https://shrey160-satsim1deployed.vercel.app/

## Overview

This project simulates a remote sensing satellite orbiting a 3D Earth using industry-standard **Two-Line Element (TLE)** data — the same format used by NORAD, Celestrak, and Heavens-Above. The simulator projects a dynamic coverage swath (footprint) onto the globe with full along-track and cross-track sensor pointing control. Users can fetch live TLE data directly from Celestrak's public API.

## Features

### TLE-Based Orbit Propagation
- Accepts standard Two-Line Element sets matching the Celestrak/Heavens-Above format.
- Propagates orbits using `satellite.js` (SGP4/SDP4), accurately modeling Earth oblateness and atmospheric drag.
- Preset TLEs for **Landsat-8**, **ISS**, and **NOAA-20** are included.
- Paste full 2-line or 3-line TLE blocks directly into the TLE Line 1 input field — auto-parsing splits and populates both lines automatically.

### LVLH Sensor Pointing
- Constructs a **Local Vertical Local Horizontal (LVLH)** reference frame each frame from the satellite's instantaneous velocity vector.
- **Along-Track Angle (Pitch):** Tilts the sensor forward/backward along the flight path.
- **Cross-Track Angle (Roll):** Tilts the sensor sideways, perpendicular to the flight path.
- Raycasting projects the sensor footprint accurately onto Earth's curved surface.

### Live Celestrak Lookup
- Bottom-right panel allows fetching the **latest TLE** for any satellite by entering its NORAD Catalog Number.
- One-click **Track ISS Live** button for instant ISS orbit visualization.
- Vite dev server proxies requests to `celestrak.org` to bypass CORS restrictions.

### 3D Globe Visualization
- Stylized dark globe with a wireframe ocean mask derived from a specular map (`earth_spec.jpg`).
- Dynamic country borders rendered from GeoJSON (Natural Earth + official India composite boundaries).
- Trailing swath history with time-based opacity fading for coverage visualization.

### Simulation Clock & Time Control
- **Live Simulation Clock**: Real-time display of simulation date and time, accurately reflecting the `Time Speed` multiplier.
- **Timezone Support**: Choose between **IST**, **PST**, **UTC**, or a **Custom UTC Offset** to view the simulation time in your preferred region.
- **Reverse Playback**: The `Time Speed` parameter now accepts negative values (up to -1000x), allowing you to propagate the orbit and swath history backward in time.
- **Jump to Time**: Input any ISO-format date/time string to instantly teleport the simulation to that specific point in history or the future.

### Premium UI
- Glassmorphism header overlay with click-to-expand **Controls Guide**, **TLE Format Guide**, and **TLE Field Breakdown** panels.
- **Interactive Clock Panel**: Centered on the right side, showing time, date, and current playback speed.
- **Togglable Live Lookup**: The Live Satellite Lookup panel is now a discreet pop-up tab at the bottom right to save screen real estate.
- Custom-themed `lil-gui` control panel with backdrop blur and matching color scheme.
- Sample NORAD Catalog Numbers provided: ISS (`25544`), Hubble (`20580`), Landsat-8 (`39084`).

## Dependencies

* **Vite** (`vite`): Frontend bundler and development server with Celestrak API proxy.
* **Three.js** (`three`): WebGL 3D rendering library for the globe, satellite, and footprint geometry.
* **satellite.js** (`satellite.js`): SGP4/SDP4 orbit propagator and coordinate transformation library.
* **lil-gui** (`lil-gui`): Lightweight GUI library for the interactive parameter control panel.

## Installation and Execution

Ensure you have [Node.js](https://nodejs.org/) installed before running these commands.

1. **Navigate to the simulator directory:**
   ```bash
   cd sim
   ```

2. **Install the node modules:**
   ```bash
   npm install
   ```

3. **Boot the local development server:**
   ```bash
   npm run dev
   ```

Navigate your browser to `http://localhost:5173/` (or whichever local port Vite specifies upon launch) to interact with the simulator.

> **Note:** The Live Satellite Lookup feature requires the Vite dev server's proxy (configured in `vite.config.js`) to fetch from Celestrak. This will not work with a static file server.
