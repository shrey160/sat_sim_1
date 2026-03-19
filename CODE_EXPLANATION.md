# Code Explanation & Architecture

This document breaks down the core files comprising the Earth Satellite Simulator, detailing their purpose and explaining the exact functionality of critical codeblocks.

## 1. `index.html`

This is the root HTML index loaded by Vite. It provides the most basic foundational DOM node and triggers the javascript evaluation.

```html
<div id="app"></div>
<script type="module" src="/main.js"></script>
```
- `<div id="app"></div>`: Acts as the literal canvas injection target. Three.js strictly attaches its generated `<canvas>` to this element.
- `<script type="module" src="/main.js">`: Tells the browser to load our primary JS file utilizing modern ES6 module imports (allowing native `import` declarations).

## 2. `style.css`

Contains fundamental CSS styling asserting that the page utilizes modern sans-serif fonts alongside overriding user-agent boundaries to force absolute full-screen scaling.

```css
.satellite-label {
  color: #66fcf1;
  font-family: monospace;
  /* ... cosmetic styling ... */
  pointer-events: none;
}
```
- `pointer-events: none;`: This is arguably the most important CSS property in the stack. Because standard HTML `<div>` labels physically float _above_ the WebGL canvas, they normally block mouse clicks. Banning pointer events ensures hovering over the satellite label doesn't block the user from panning or rotating the 3D globe underneath via `OrbitControls`.

## 3. `main.js`

This file houses the entire monolithic Three.js application. It is structurally segmented into setup, object generation, and the localized high-speed render loop. 

### Configuration & State
```javascript
const PRESETS = {
  'Landsat-8': { alt: 705, inc: 98.2, swath: 185 },
  'ISS': { alt: 420, inc: 51.6, swath: 500 },
  // ...
};
```
Defines standardized orbital configurations. The values represent predefined altitude (in km), inclination (in degrees), and swath footprint width (in km). `params` is the central state object that the GUI actively mutates on the fly.

### Scene Initialization
```javascript
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, ...);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
const labelRenderer = new CSS2DRenderer();
```
Initializes the pure spatial environment. We explicitly utilize dual renderers: `WebGLRenderer` handles the 3D computational geometry representing the Earth and orbit lines, while `CSS2DRenderer` overlays standard HTML text elements (the satellite nameplate bounding box) natively mapped to floating 3D relative spaces tracking the satellite.

### The Earth Globe & Ocean Masking
```javascript
const textureLoader = new THREE.TextureLoader();
const waterMask = textureLoader.load('/earth_spec.jpg');

const earthMat = new THREE.MeshPhongMaterial({ ... });

const wireMat = new THREE.MeshBasicMaterial({
  wireframe: true,
  alphaMap: waterMask
});
```
We actively construct the Earth utilizing layered geometries. The internal sphere is a solid, slightly shaded material (`earthMat`). Stacked exactly above it rests a stylized geometric grid (`wireMat`). 
By loading `earth_spec.jpg` (a greyscale image where oceans are purely white pixels and landmasses are solid black pixels) and injecting it into `alphaMap: waterMask`, the Three.js shader natively calculates grid opacity via pixel lightness, hiding the wireframe exclusively on land.

### GeoJSON Border parsing
```javascript
Promise.all([
  fetch('/countries.geojson').then(r => r.json()),
  fetch('/india.geojson').then(r => r.json())
]).then(([worldData, indiaData]) => { ... })
```
Fetches JSON coordinate structures detailing physical territory. We load the standard world map and explicit specific layouts concurrently.

```javascript
// Point Projection Mathematics
const clat1 = Math.cos(lat1 * Math.PI/180), slat1 = Math.sin(lat1 * Math.PI/180);
const clon1 = Math.cos(lon1 * Math.PI/180), slon1 = Math.sin(lon1 * Math.PI/180);

bordersPoints.push(r * clat1 * clon1, r * slat1, -r * clat1 * slon1);
```
During parsing, we execute complex trigonometric projections converting spherical `(Latitude, Longitude)` geometries directly into fixed spatial `(X, Y, Z)` Cartesian matrices matching our specific orientation (equator on the horizontal axis). This converts raw coordinates into a single, aggressively optimized vertex array rendered physically onto the sphere as `THREE.LineSegments`.

### Orbital Mechanics Propagation
Inside `animate()`, we execute Keplerian dynamics natively:
```javascript
const r = EARTH_RADIUS_KM + params.altitude; 
const n = Math.sqrt(MU_EARTH / Math.pow(r, 3)); 
const M = n * (simTime / 1000); 
```
Calculates precise parametric positions natively in the satellite's orbital plane. It parses the object's *mean motion (n)* derived solely from the orbital radius, establishing the exact *orbital anomaly position (M)* iterating against time step deltas.
```javascript
const x_eci = x_orb * Math.cos(raan) - (y_orb * Math.cos(inc)) * Math.sin(raan);
// ...
const gmst = satellite.gstime(t);
const positionEcf = satellite.eciToEcf(positionEci, gmst);
```
Takes the flat 2D parametric geometry and physically rotates it into precise 3D plane vectors accounting for User GUI variables: **Inclination** and the Right Ascension of the Ascending Node (**RAAN**). 
The final position (still in absolute ECI frames) is rotated underneath the globe factoring the dynamic Greenwich Sidereal Time (fetching GMST via `satellite.js`). This executes native conversion to actual ECEF space—anchoring satellite movement precisely above rotating map topography.

### Remote Sensing & Swath Rendering
```javascript
const pointingDir = satDir.clone().negate(); 
pointingDir.applyAxisAngle(east, nadirRad);

const intersect = ray.intersectSphere(earthSphere, hit);
```
Fires an invisible 3D laser (Raycast) downward from the satellite directly toward Earth's surface. Pitch adjustments are injected natively by tilting the vector sideways by configuring the Nadir Angle variable. 
```javascript
if (simTime - lastSwathCapture > SWATH_CAPTURE_INTERVAL) {
  swathHistory.push({ mesh: hMesh, time: simTime });
}
```
When this laser intersects geometry, the sensor maps a 2D semi-transparent footprint. As the satellite loops, a secondary memory snapshot generator captures and clones footprints aggressively based on internal iteration timers, injecting exact clones into cache memory `swathHistory`. 

```javascript
while (swathHistory.length > 0 && (simTime - swathHistory[0].time) > maxAgeMs) {
    const old = swathHistory.shift();
    scene.remove(old.mesh);
}
```
Memory garbage collection natively prunes the cache. It compares the elapsed age of footprints against `maxAgeMs` (Orbital Period * Allowed Trailing Rotations), forcibly destroying meshes mathematically that exceed history buffers to prevent VRAM memory overflowing.
