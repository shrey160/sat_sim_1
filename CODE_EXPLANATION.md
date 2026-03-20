# Code Explanation & Architecture

This document breaks down the core files comprising the Earth Satellite Simulator, detailing their purpose and explaining the exact functionality of critical codeblocks.

## 1. `index.html`

The root HTML index loaded by Vite. It provides the Three.js canvas injection target, the premium glassmorphism UI overlay, and the live Celestrak lookup panel.

### Three.js Container
```html
<div id="app"></div>
<script type="module" src="/main.js"></script>
```
- `<div id="app">`: Acts as the canvas injection target. Three.js attaches its generated `<canvas>` to this element.
- `<script type="module">`: Loads the primary JS file using ES6 module imports.

### UI Overlay Panels
The page includes three click-to-expand glassmorphism panels in the top-left corner:
- **ORBITAL SIMULATOR** — Controls Guide explaining all simulator parameters with sample NORAD Catalog Numbers (ISS `25544`, Hubble `20580`, Landsat-8 `39084`).
- **TLE Format Guide** — High-level summary of Line 1 (identification & drag) and Line 2 (Keplerian elements).
- **TLE Field Breakdown** — Column-by-column reference for every field in both TLE lines.

Each panel uses `onclick` handlers calling `toggleGuide()`, `toggleTLEGuide()`, and `toggleTLEBreakdown()` to show/hide content.

### Live Satellite Lookup Panel
```html
<div class="live-tracker-panel">
  <input type="text" id="catalog-input" placeholder="NORAD Catalog # (e.g. 25544)" />
  <button onclick="fetchCelestrakTLE()">Fetch</button>
  <button class="iss-btn" onclick="loadISS()">🛰️ Track ISS Live</button>
</div>
```
- `fetchCelestrakTLE()`: Fetches from `/celestrak-api?CATNR={id}&FORMAT=TLE` (proxied through Vite to `celestrak.org`), parses the response, and dispatches a `celestrak-tle` custom DOM event consumed by `main.js`.
- `loadISS()`: Shortcut that pre-fills `25544` and triggers the fetch.

## 2. `style.css`

Contains the full design system using CSS custom properties and glassmorphism. Key sections:

- **`:root` Variables**: `--primary-color` (#66fcf1), `--secondary-color` (#45a29e), `--dark-bg`, `--panel-bg`, `--text-light`.
- **Header Overlay**: `.header-content` uses `backdrop-filter: blur(12px)`, semi-transparent background, and `pointer-events: auto` for click interactivity.
- **Satellite Label**: `.satellite-label` uses `pointer-events: none` — critical to prevent the label from blocking OrbitControls mouse interactions on the 3D canvas.
- **lil-gui Overrides**: Custom CSS variables override the default lil-gui theme to match the dark-cyan aesthetic with glassmorphism blur.
- **Live Tracker Panel**: `.live-tracker-panel` positioned `bottom: 30px; right: 20px` with matching glassmorphism styling, input focus glow effects, and gradient ISS button.

## 3. `vite.config.js`

Configures the Vite development server proxy to bypass CORS when fetching TLEs from Celestrak.

```javascript
proxy: {
  '/celestrak-api': {
    target: 'https://celestrak.org',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/celestrak-api/, '/NORAD/elements/gp.php'),
  }
}
```
Client-side fetch calls to `/celestrak-api?CATNR=25544&FORMAT=TLE` are transparently rewritten and proxied to `https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE`.

## 4. `main.js`

Houses the entire Three.js application. Structurally segmented into configuration, scene setup, TLE propagation, LVLH pointing, and the render loop.

### Configuration & State
```javascript
const PRESETS = {
  'Landsat-8': { tle1: '1 39084U ...', tle2: '2 39084 ...', swath: 185 },
  'ISS':       { tle1: '1 25544U ...', tle2: '2 25544 ...', swath: 500 },
  // ...
};
```
Presets now store full TLE strings instead of parametric values. `params` holds `tleLine1`, `tleLine2`, `alongTrackAngle`, `crossTrackAngle`, and other state variables that the GUI mutates on the fly.

### TLE Parsing & Validation
```javascript
function updateSatrec() {
  // Detect multi-line pastes in tleLine1 and auto-split
  if (params.tleLine1.includes('\n')) {
    const lines = params.tleLine1.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    // Handle 3-line (Name + Line1 + Line2) or 2-line format
    // ...
  }
  const testSatrec = satellite.twoline2satrec(params.tleLine1, params.tleLine2);
  // Validate by propagating to current time before committing
  if (!satellite.propagate(testSatrec, new Date()).position) throw new Error("Invalid TLE");
  currentSatrec = testSatrec;
}
```
Intelligently handles pasted multi-line TLE blocks. Validates the parsed satellite record by test-propagating before committing, preventing crashes from malformed input.

### TLE Orbit Propagation
```javascript
const positionAndVelocity = satellite.propagate(currentSatrec, t);
const positionEci = positionAndVelocity.position;
const gmst = satellite.gstime(t);
const positionEcf = satellite.eciToEcf(positionEci, gmst);
```
Replaces the previous manual Keplerian engine entirely. `satellite.js` runs the SGP4/SDP4 propagator internally, handling all orbital mechanics (including J2 oblateness perturbations and atmospheric drag from BSTAR). The result is converted from ECI to ECEF coordinates using Greenwich Sidereal Time.

### LVLH Frame & Sensor Pointing
```javascript
// Derive velocity from frame-to-frame position delta
let sceneVel = new THREE.Vector3(1, 0, 0);
if (lastScenePos && (simTime !== lastSimTime)) {
   sceneVel.subVectors(satGroup.position, lastScenePos).normalize();
}

// Construct LVLH basis
const nadir = satGroup.position.clone().negate().normalize();
const crossTrack = nadir.clone().cross(sceneVel).normalize();
const alongTrack = crossTrack.clone().cross(nadir).normalize();

// Apply sensor pointing offsets
const pointingDir = nadir.clone();
pointingDir.applyAxisAngle(crossTrack, pitchRad);  // Along-track (pitch)
pointingDir.applyAxisAngle(alongTrack, rollRad);    // Cross-track (roll)
```
Computes the instantaneous velocity vector by differencing consecutive frame positions. Constructs a mathematically correct LVLH reference frame:
- **Nadir**: Points from the satellite toward Earth's center.
- **Cross-Track**: Perpendicular to both nadir and velocity (orbit normal direction).
- **Along-Track**: Forward along the flight path.

Pitch and Roll rotations are applied around the cross-track and along-track axes respectively, producing the final sensor pointing direction used for raycasting.

### Swath Raycasting & History
```javascript
const ray = new THREE.Ray(satGroup.position, pointingDir);
const intersect = ray.intersectSphere(earthSphere, hit);
```
Fires an invisible ray from the satellite in the computed pointing direction. Where it intersects the Earth sphere, a semi-transparent footprint circle is placed tangent to the surface. Historical footprints are cached in `swathHistory` and time-faded based on orbital period × trailing rotations.

### Celestrak Event Listener
```javascript
window.addEventListener('celestrak-tle', (e) => {
  const { line1, line2, name } = e.detail;
  params.tleLine1 = line1;
  params.tleLine2 = line2;
  // Update satellite record, label, and reset simulation time
});
```
Listens for the custom DOM event dispatched by the HTML panel's `fetchCelestrakTLE()` function. Injects the fetched TLE data into the simulation state, updates the GUI display, and resets simulation time to current real time for accurate propagation.

### The Earth Globe & Ocean Masking
```javascript
const waterMask = textureLoader.load('/earth_spec.jpg');
const wireMat = new THREE.MeshBasicMaterial({
  wireframe: true,
  alphaMap: waterMask
});
```
The Earth is constructed using layered geometries. The internal sphere uses `MeshPhongMaterial`. A wireframe mesh stacked above uses `earth_spec.jpg` (greyscale: white = ocean, black = land) as an `alphaMap`, causing the grid to appear exclusively over oceans.

### GeoJSON Border Parsing
```javascript
Promise.all([
  fetch('/countries.geojson').then(r => r.json()),
  fetch('/india.geojson').then(r => r.json())
]).then(([worldData, indiaData]) => { ... })
```
Fetches Natural Earth world boundaries and official India composite boundaries concurrently. Spherical coordinates are projected into 3D Cartesian space using trigonometric transforms and rendered as `THREE.LineSegments`.
