# Earth Satellite Simulator

A lightweight, stylized web-based 3D satellite simulator built with Vanilla JavaScript, Three.js, and Vite.

## Overview

This project simulates a remote sensing satellite orbiting a 3D Earth, projecting a dynamic coverage swath (footprint) onto the globe. The user has full parametric control over the orbital characteristics and remote sensing sensor properties through an interactive GUI.

## How the Code Works

The core simulation logic lives inside `main.js`:

1. **Three.js SphereGlobe Visualization**: 
   - A `SphereGeometry` forms the Earth, utilizing a dark `MeshPhongMaterial` and an atmospheric edge. 
   - A futuristic glowing wireframe mesh is wrapped around the Earth. We use an `alphaMap` (a high-resolution specular map) loaded from `/earth_spec.jpg`. This calculates opacity natively, dynamically hiding the wireframe on landmasses while allowing the grid to exclusively shade the Earth's oceans and lakes.
   - **Dynamic Country Borders**: Real-world country boundaries (fusing global Natural Earth data with the official DataMeet composite map for Indian territories) are retrieved via native GeoJSON format. A custom algorithm loops through the geometric coordinates, projects Latitude and Longitude into 3D Cartesian space, and renders them seamlessly as `THREE.LineSegments`.

2. **Parametric Keplerian Propagator**:
   - The simulator dynamically calculates real-time coordinates using a custom parametric Keplerian orbital mechanics engine. 
   - Users can manipulate core orbital elements directly from the UI, including **Altitude**, **Inclination**, and Right Ascension of the Ascending Node (**RAAN**). 
   - The engine constructs the 3D orbit natively in the orbital plane and rotates it smoothly into the Earth-Centered Inertial (ECI) coordinate frame.
   - **satellite.js** is leveraged specifically to calculate the Greenwich Mean Sidereal Time (GMST). This maps the exact sideways rotation of the Earth beneath the satellite to translate ECI projections down into accurate Earth-Centered Earth-Fixed (ECEF) coordinates.

3. **Remote Sensing Swath**:
   - As the satellite propagates mathematically, instantaneous raycasting is performed against the `THREE.Sphere` to determine the projected bounds of the camera (including cross-track pitch vectors offset by the user's selected Nadir Angle).
   - A trailing swath history is visualized by duplicating the footprint mesh repeatedly into memory. The rendering loop actively monitors these meshes against an exact time-to-live threshold (measured actively via the satellite's orbital period multiplied by your allowed "Trailing Rotations") to continuously fade them out, creating a fluid animated coverage ribbon.

## Dependencies

*   **Vite** (`vite`): The blazing fast frontend bundler and development server infrastructure.
*   **Three.js** (`three`): The WebGL 3D rendering library used to construct the scene, lights, and models.
*   **satellite.js** (`satellite.js`): Specifically used in this fork for establishing high-precision Earth Sidereal time tracking.
*   **lil-gui** (`lil-gui`): The lightweight drop-in graphical user interface library backing the robust parameter control panel.

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
