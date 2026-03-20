import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import * as satellite from 'satellite.js';
import GUI from 'lil-gui';

// --- Configuration ---
// Define Earth's volumetric radius in kilometers
const EARTH_RADIUS_KM = 6378.137;
// Set Three.js simulation scale (1 Three.js unit = 1000 actual kilometers)
const SCALE = 1 / 1000; 
// Standard gravitational parameter of Earth (μ = G * M) utilized for Keplerian orbital velocity formulas
const MU_EARTH = 398600.4418; // km^3/s^2

// Dictionary mapped to the GUI containing standard orbit parameter presets
const PRESETS = {
  'Landsat-8': {
    tle1: '1 39084U 13008A   24083.50000000  .00000000  00000-0  00000-0 0  9998',
    tle2: '2 39084  98.2000   0.0000 0001000   0.0000   0.0000 14.57100000000000',
    swath: 185
  },
  'ISS': {
    tle1: '1 25544U 98067A   24083.50000000  .00010000  00000-0  18000-3 0  9997',
    tle2: '2 25544  51.6400 330.0000 0005000  46.0000  92.0000 15.50000000000000',
    swath: 500
  },
  'NOAA-20': {
    tle1: '1 43013U 17073A   24083.50000000  .00000000  00000-0  00000-0 0  9999',
    tle2: '2 43013  98.7000   0.0000 0001000   0.0000   0.0000 14.19500000000000',
    swath: 3000
  },
  'Custom': null
};

// --- State ---
// The central state object reacting dynamically to the lil-gui control panel
const params = {
  preset: 'Landsat-8',
  tleLine1: PRESETS['Landsat-8'].tle1,
  tleLine2: PRESETS['Landsat-8'].tle2,
  swathWidth: 185,    // The physical width of the sensor's snapshot footprint (km)
  altitudeScale: 1.0, // A multiplier strictly for visual exaggeration in the 3D scene
  alongTrackAngle: 0, // Pitch (forward/backward) pointing offset (degrees)
  crossTrackAngle: 0, // Roll (sideways) pointing offset (degrees)
  rotationsToKeep: 1, // How many orbital overlaps the system retains footprint histories for
  timeMultiplier: 60, // Speed multiplier accelerating physical simulation time (negative = reverse)
  clearHistory: () => clearSwathHistory() // Function bound to the GUI button
};

// Clock & timezone state
const clockState = {
  timezone: 'IST',
  customOffsetHours: 5.5, // IST default
  setDateTime: '',
  applySetTime: function() {
    if (clockState.setDateTime) {
      const d = new Date(clockState.setDateTime);
      if (!isNaN(d.getTime())) {
        simTime = d.getTime();
        lastScenePos = null;
        clearSwathHistory();
      }
    }
  }
};

const TZ_OFFSETS = {
  'IST': 5.5,
  'PST': -8,
  'UTC': 0,
  'Custom': null
};

let currentSatrec = satellite.twoline2satrec(params.tleLine1, params.tleLine2);
let lastScenePos = null;
let lastSimTime = 0;

function updateSatrec() {
  try {
    // Intelligently parse multi-line pastes directly into Line 1
    if (params.tleLine1.includes('\n')) {
      const lines = params.tleLine1.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      // Handle standard 3-line format (Name, Line 1, Line 2) or basic 2-line format
      if (lines.length >= 3 && lines[1].startsWith('1 ') && lines[2].startsWith('2 ')) {
        params.tleLine1 = lines[1];
        params.tleLine2 = lines[2];
        params.preset = 'Custom';
      } else if (lines.length >= 2 && lines[0].startsWith('1 ') && lines[1].startsWith('2 ')) {
        params.tleLine1 = lines[0];
        params.tleLine2 = lines[1];
        params.preset = 'Custom';
      }
      // Force GUI to visually refresh with the cleanly split data
      gui.controllersRecursive().forEach(c => c.updateDisplay());
    }

    const testSatrec = satellite.twoline2satrec(params.tleLine1, params.tleLine2);
    // Validate the parsed satrec gracefully using current time before committing
    if (!satellite.propagate(testSatrec, new Date()).position) {
      throw new Error("Invalid TLE physical output");
    }
    
    currentSatrec = testSatrec;
    clearSwathHistory();
  } catch(e) {
    console.warn("Invalid or incomplete TLE syntax. Waiting for valid input...", e.message);
  }
}


// --- Clock Display ---
function updateClockDisplay(simDate) {
  const el = document.getElementById('sim-clock');
  if (!el) return;
  
  // Convert UTC sim time to the selected timezone
  const utcMs = simDate.getTime();
  const offsetMs = clockState.customOffsetHours * 3600000;
  const localDate = new Date(utcMs + offsetMs);
  
  const year = localDate.getUTCFullYear();
  const month = String(localDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(localDate.getUTCDate()).padStart(2, '0');
  const hours = String(localDate.getUTCHours()).padStart(2, '0');
  const mins = String(localDate.getUTCMinutes()).padStart(2, '0');
  const secs = String(localDate.getUTCSeconds()).padStart(2, '0');
  
  const tzLabel = clockState.timezone === 'Custom' 
    ? `UTC${clockState.customOffsetHours >= 0 ? '+' : ''}${clockState.customOffsetHours}` 
    : clockState.timezone;

  const dateEl = document.getElementById('sim-clock-date');
  const timeEl = document.getElementById('sim-clock-time');
  const tzEl = document.getElementById('sim-clock-tz');
  const speedEl = document.getElementById('sim-clock-speed');
  
  if (dateEl) dateEl.textContent = `${year}-${month}-${day}`;
  if (timeEl) timeEl.textContent = `${hours}:${mins}:${secs}`;
  if (tzEl) tzEl.textContent = tzLabel;
  if (speedEl) {
    const mult = params.timeMultiplier;
    speedEl.textContent = mult >= 0 ? `${mult}×` : `${mult}× (REV)`;
    speedEl.style.color = mult < 0 ? '#ff6b6b' : '#66fcf1';
  }
}

// Arrays and timers for trailing footprint caching
let swathHistory = [];
let simTime = new Date().getTime(); // Simulation's internal clock
let lastSwathCapture = 0;
const SWATH_CAPTURE_INTERVAL = 2000; // Delay between footprint snapshots (in sim milliseconds)

// --- Init Scene ---
// Select the injection container inside index.html
const container = document.getElementById('app');

// Initialize the Three.js logical environment
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0c10); // Deep space dark background
scene.fog = new THREE.FogExp2(0x0b0c10, 0.02); // Add exponential cosmic fog for depth fading

// Initialize the 3D lens evaluating field of view and rendering aspect ratio
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 10, 20); // Position camera diagonally above the globe

// Initialize the primary WebGL hardware drawing context
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement); // Inject exactly into the DOM

// Initialize the specialized CSS HTML 2D overlay context 
// This creates a concurrent <canvas> routing standard HTML elements over specific 3D Cartesian coordinates
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none'; // CRITICAL: Stop the overlay from eating mouse clicks
container.appendChild(labelRenderer.domElement);

// Bind the mouse and touch controls allowing camera panning
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // Provides smooth deceleration inertia
controls.enablePan = false;
controls.minDistance = 7;
controls.maxDistance = 50;

// --- Earth Setup ---
const earthGroup = new THREE.Group();
scene.add(earthGroup);

// Generate the primary sphere geometry mapped mathematically to our SCALE ratio
const earthRad = EARTH_RADIUS_KM * SCALE;
const earthGeo = new THREE.SphereGeometry(earthRad, 64, 64);

// Inner dark sphere constructed using Phong lighting to respond accurately to the Scene's DirectionalLight
const earthMat = new THREE.MeshPhongMaterial({
  color: 0x1f2833, // Base surface color
  emissive: 0x0b0c10, // Slight underlying glow
  specular: 0x111111, // Smoothness reflections
  shininess: 5,
  transparent: true,
  opacity: 0.95
});
const earthMesh = new THREE.Mesh(earthGeo, earthMat);
earthGroup.add(earthMesh);

// Outer grid bounds (stylized) 
// We load an absolute specular map (white pixels = water, black = land)
const textureLoader = new THREE.TextureLoader();
const waterMask = textureLoader.load('/earth_spec.jpg');

// We apply the image inside 'alphaMap'. Only white pixels remain fully opaque.
// This natively isolates the wireframe geometry exclusively highlighting Earth's oceans and major lakes.
const wireMat = new THREE.MeshBasicMaterial({
  color: 0x45a29e,
  wireframe: true,
  transparent: true,
  opacity: 0.15,
  alphaMap: waterMask // Masks transparency strictly to water regions
});
const wireMesh = new THREE.Mesh(earthGeo, wireMat);
wireMesh.scale.setScalar(1.001); // Scale slightly larger to prevent geometry z-fighting collision
earthGroup.add(wireMesh);

// Add the 3D equator ring using flat Circle mathematics
const equatorGeo = new THREE.RingGeometry(earthRad + 0.05, earthRad + 0.06, 64);
const equatorMat = new THREE.MeshBasicMaterial({ color: 0x45a29e, side: THREE.DoubleSide, transparent: true, opacity: 0.4 });
const equatorMesh = new THREE.Mesh(equatorGeo, equatorMat);
equatorMesh.rotation.x = Math.PI / 2; // Lay flat along the XZ plane
earthGroup.add(equatorMesh);

// Initialize illumination lighting parameters
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Flat brightness everywhere
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 2); // Simulates strong solar light from a fixed orbit
directionalLight.position.set(10, 10, 10);
scene.add(directionalLight);

// --- Satellite Setup ---
const satGroup = new THREE.Group();
scene.add(satGroup);

// Generate the satellite marker using an Octahedron to create an angular techy diamond shape
const satGeo = new THREE.OctahedronGeometry(0.15, 0);
const satMat = new THREE.MeshBasicMaterial({ color: 0x66fcf1, wireframe: true });
const satMesh = new THREE.Mesh(satGeo, satMat);
satGroup.add(satMesh);

// Insert a solid white sphere directly into the core of the diamond to simulate glow
const satCoreGeo = new THREE.SphereGeometry(0.05, 8, 8);
const satCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const satCoreMesh = new THREE.Mesh(satCoreGeo, satCoreMat);
satGroup.add(satCoreMesh);

// Generate the HTML text label component
const satDiv = document.createElement('div');
satDiv.className = 'satellite-label';
satDiv.textContent = params.preset;
// Wrap the standard Node element inside CSS2DObject to pair it mathematically with satGroup
const satLabel = new CSS2DObject(satDiv);
satLabel.position.set(0, 0.3, 0); // Offset above the core diamond
satGroup.add(satLabel);

// Define standard materials tracking the instantaneous remote sensing footprint mapped upon the ground
const swathMat = new THREE.MeshBasicMaterial({
  color: 0x66fcf1,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.3,
  depthWrite: false // Prevents the footprint from glitching inside other transparent layers
});

// A localized generation tool defining exact footprint boundaries
function createSwathGeometry(widthKm) {
  // Translate literal kilometers directly against the central angle formula spanning Earth's center
  const angle = (widthKm / 2) / EARTH_RADIUS_KM; 
  const rad = Math.sin(angle) * (earthRad + 0.01); 
  return new THREE.CircleGeometry(rad, 32); // Generate a highly segmented circle polygon
}

let activeSwathGeo = createSwathGeometry(params.swathWidth);
const activeSwathMesh = new THREE.Mesh(activeSwathGeo, swathMat);
scene.add(activeSwathMesh);

// --- GUI ---
const gui = new GUI({ title: 'Satellite Control' });

// Orbit Property Handlers connecting directly to our params logic
const orbitFolder = gui.addFolder('Orbit Parameters');
orbitFolder.add(params, 'preset', Object.keys(PRESETS)).name('Orbit Preset').onChange(v => {
  if (PRESETS[v]) {
    params.tleLine1 = PRESETS[v].tle1;
    params.tleLine2 = PRESETS[v].tle2;
    params.swathWidth = PRESETS[v].swath;
    gui.controllersRecursive().forEach(c => c.updateDisplay());
    updateSatrec();
  }
  satLabel.element.textContent = v;
  updateSwathSize();
});
orbitFolder.add(params, 'tleLine1').name('TLE Line 1').listen().onChange(updateSatrec);
orbitFolder.add(params, 'tleLine2').name('TLE Line 2').listen().onChange(updateSatrec);

const rsFolder = gui.addFolder('Remote Sensing Properties');
rsFolder.add(params, 'swathWidth', 50, 5000).name('Swath Width (km)').listen().onChange(updateSwathSize);
rsFolder.add(params, 'alongTrackAngle', -60, 60).name('Along-Track Angle (deg)');
rsFolder.add(params, 'crossTrackAngle', -60, 60).name('Cross-Track Angle (deg)');
rsFolder.add(params, 'rotationsToKeep', 0.1, 5).name('Trailing Rotations').onChange(clearSwathHistory);
rsFolder.add(params, 'clearHistory').name('Clear Trail');

const simFolder = gui.addFolder('Simulation Settings');
simFolder.add(params, 'altitudeScale', 0.5, 3.0).name('Altitude Multiplier');
simFolder.add(params, 'timeMultiplier', -1000, 1000).step(1).name('Time Speed');

// --- Clock Panel ---
const clockFolder = gui.addFolder('Simulation Clock');
clockFolder.add(clockState, 'timezone', Object.keys(TZ_OFFSETS)).name('Timezone').onChange(v => {
  if (TZ_OFFSETS[v] !== null) {
    clockState.customOffsetHours = TZ_OFFSETS[v];
    gui.controllersRecursive().forEach(c => c.updateDisplay());
  }
});
clockFolder.add(clockState, 'customOffsetHours', -12, 14).step(0.5).name('UTC Offset (hrs)').listen();
clockFolder.add(clockState, 'setDateTime').name('Set Time (ISO)');
clockFolder.add(clockState, 'applySetTime').name('⏱ Jump to Time');

// --- GeoJSON Borders ---
params.showBorders = true;
const borderController = simFolder.add(params, 'showBorders').name('Show Borders');

// Trigger massive asynchronous fetch pulling all natural coordinate geometry for borders
Promise.all([
  fetch('/countries.geojson').then(res => res.json()), // Native world geography 
  fetch('/india.geojson').then(res => res.json()) // Official boundary composite mapping
]).then(([worldData, indiaData]) => {
    const bordersPoints = [];
    const r = earthRad + 0.005; // Slightly offset the boundary mathematically outwards to prevent collision

    // Dedicated parsing routine converting complex JSON chains into strict pairs
    function addRing(ring) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [lon1, lat1] = ring[i];
        const [lon2, lat2] = ring[i+1];
        
        // Complex trigonometric logic transforming Earth spherical maps natively to our unique internal Scene orientation
        // where X correlates to Prime Meridian, Y models Latitude Pole, and inverted Z mirrors longitude 90E
        const clat1 = Math.cos(lat1 * Math.PI/180), slat1 = Math.sin(lat1 * Math.PI/180);
        const clon1 = Math.cos(lon1 * Math.PI/180), slon1 = Math.sin(lon1 * Math.PI/180);
        bordersPoints.push(r * clat1 * clon1, r * slat1, -r * clat1 * slon1);
        
        const clat2 = Math.cos(lat2 * Math.PI/180), slat2 = Math.sin(lat2 * Math.PI/180);
        const clon2 = Math.cos(lon2 * Math.PI/180), slon2 = Math.sin(lon2 * Math.PI/180);
        bordersPoints.push(r * clat2 * clon2, r * slat2, -r * clat2 * slon2);
      }
    }

    // High performance iteration engine detecting array configurations natively per shape
    function parseFeatures(features, excludeIndia) {
      features.forEach(feature => {
        if (!feature.geometry) return;
        // Logic cleanly discarding the standard world-engine's India geometry, allowing immediate bypass
        if (excludeIndia && feature.properties && feature.properties.name === 'India') return;

        if (feature.geometry.type === 'Polygon') {
          feature.geometry.coordinates.forEach(ring => addRing(ring));
        } else if (feature.geometry.type === 'MultiPolygon') {
          feature.geometry.coordinates.forEach(poly => poly.forEach(ring => addRing(ring)));
        } else if (feature.geometry.type === 'LineString') {
          addRing(feature.geometry.coordinates);
        } else if (feature.geometry.type === 'MultiLineString') {
          feature.geometry.coordinates.forEach(ring => addRing(ring));
        }
      });
    }

    // Force strict ordering rendering global structure, followed cleanly by the explicit India composite override dataset
    parseFeatures(worldData.features, true);
    parseFeatures(indiaData.features, false);

    // Compress raw mathematical vertices mathematically against native memory structs bypassing Javascript overhead
    const bordersGeo = new THREE.BufferGeometry();
    bordersGeo.setAttribute('position', new THREE.Float32BufferAttribute(bordersPoints, 3));
    const bordersMat = new THREE.LineBasicMaterial({
      color: 0x45a29e, // Target matching the exact grid mesh color organically
      transparent: true,
      opacity: 0.5
    });
    // Link directly spanning all geometry sequentially drawing continuous boundaries
    const bordersMesh = new THREE.LineSegments(bordersGeo, bordersMat);
    earthGroup.add(bordersMesh);
    
    // Wire visibility toggle internally into the GUI framework natively
    borderController.onChange(v => {
      bordersMesh.visible = v;
    });
  })
  .catch(err => console.error("Error loading GeoJSON", err));


function updateSwathSize() {
  activeSwathGeo.dispose(); // Critical memory free preventing WebGL leak over time
  activeSwathGeo = createSwathGeometry(params.swathWidth);
  activeSwathMesh.geometry = activeSwathGeo;
  clearSwathHistory();
  if (params.preset === 'Custom') {
    satLabel.element.textContent = 'Custom';
  }
}

function clearSwathHistory() {
  // Dynamically iterate over stored caches actively annihilating history meshes natively
  swathHistory.forEach(item => {
    scene.remove(item.mesh);
    item.mesh.geometry.dispose();
    item.mesh.material.dispose();
  });
  swathHistory = [];
}

// --- Animation Loop ---
const clock = new THREE.Clock(); // Delta time calculator mapping CPU rendering speeds accurately

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta(); // Retrieve physical real-world elapsed time (usually 16ms)
  const stepMs = delta * 1000 * params.timeMultiplier; // Apply fast forwarding logic (negative = reverse)
  simTime += stepMs; // Accumulate native internal simulated timeframe 
  const t = new Date(simTime);

  // Update the clock display
  updateClockDisplay(t);

  // --- TLE Orbit Propagation ---
  const orbitalPeriodMs = (2 * Math.PI / (currentSatrec.no || 0.0698)) * 60000; // Formula deriving the full length of a unified orbital revolution natively

  let positionEci;
  try {
    const positionAndVelocity = satellite.propagate(currentSatrec, t);
    positionEci = positionAndVelocity.position;
  } catch (e) {
    // Return gracefully if string map explicitly fails propagating invalid math
  }
  
  if (positionEci && positionEci.x !== undefined && !isNaN(positionEci.x)) {
    const gmst = satellite.gstime(t);
    const positionEcf = satellite.eciToEcf(positionEci, gmst);
    
    // Scale absolute space correctly converting literal kilometer mapping over exactly to localized Three.js ratios mapped
    let x = positionEcf.x * SCALE;
    let y = positionEcf.z * SCALE;
    let z = -positionEcf.y * SCALE;

    // Emulates custom presentation offsets scaling visually outside bounds natively preserving pure map geometry identical
    const dist = Math.sqrt(x*x + y*y + z*z);
    const alt = dist - earthRad;
    const scaledDist = earthRad + (alt * params.altitudeScale); // Scaling trick manipulating exclusively rendering radius internally
    const ratio = scaledDist / dist;
    x *= ratio;
    y *= ratio;
    z *= ratio;

    satGroup.position.set(x, y, z); // Update primary satellite positioning framework natively
  }

  // Apply a generic visual spin upon the diamond natively purely for aesthetics identically
  satMesh.rotation.x += delta;
  satMesh.rotation.y += delta * 1.5;

  // --- Update Swath Position & Orientation Raycasting ---
  // Determine instantaneous scene velocity to establish Local Vertical Local Horizontal (LVLH) frame mappings exactly
  let sceneVel = new THREE.Vector3(1, 0, 0);
  if (lastScenePos && (simTime !== lastSimTime)) {
     sceneVel.subVectors(satGroup.position, lastScenePos).normalize();
  }
  lastScenePos = satGroup.position.clone();
  lastSimTime = simTime;

  // Creates pure math calculating exact standard LVLH offset matrices natively mapping exact attitude controls
  const nadir = satGroup.position.clone().negate().normalize();
  const crossTrack = nadir.clone().cross(sceneVel).normalize(); 
  const alongTrack = crossTrack.clone().cross(nadir).normalize();

  // Apply absolute angular targeting sweeps mapping exactly sensor offset logics organically 
  const pointingDir = nadir.clone();
  const pitchRad = THREE.MathUtils.degToRad(params.alongTrackAngle);
  const rollRad = THREE.MathUtils.degToRad(params.crossTrackAngle);
  
  pointingDir.applyAxisAngle(crossTrack, pitchRad); // Pitch (forward/backward) mapping natively directly 
  pointingDir.applyAxisAngle(alongTrack, rollRad);  // Roll (sideways cross-track) exactly logically over orbit

  // Constructs native laser logic evaluating intersects matching natively directly upon spherical physics bounds
  const ray = new THREE.Ray(satGroup.position, pointingDir);
  const earthSphere = new THREE.Sphere(new THREE.Vector3(0,0,0), earthRad + 0.01);
  const hit = new THREE.Vector3();
  const intersect = ray.intersectSphere(earthSphere, hit); // Shoots physical ray verifying Earth collision identically

  // If laser hits native terrain geometry effectively:
  if (intersect) {
    activeSwathMesh.position.copy(hit); // Snap footprint geometry identically to intercept origin inherently
    
    // Map upward mathematical normal mirroring precise hit angle to bend polygon strictly tangent to curved space natively
    const up = hit.clone().normalize();
    activeSwathMesh.lookAt(hit.clone().add(up));
    activeSwathMesh.visible = true;

    // Persist step duplicating geometry directly matching timing deltas identically
    if (simTime - lastSwathCapture > SWATH_CAPTURE_INTERVAL) {
      lastSwathCapture = simTime;
      
      const hMesh = new THREE.Mesh(activeSwathGeo, new THREE.MeshBasicMaterial({
        color: 0x45a29e,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.15,
        depthWrite: false
      }));
      hMesh.position.copy(activeSwathMesh.position);
      hMesh.quaternion.copy(activeSwathMesh.quaternion); // Match identical curvature angle directly preserving shape naturally
      scene.add(hMesh);

      swathHistory.push({
        mesh: hMesh,
        time: simTime
      });
    }
  } else {
    // Hide trailing rendering gracefully matching deep space horizons effectively
    activeSwathMesh.visible = false;
  }

  // --- Manage History Persistence ---
  // Derives exact lifetime bound identical comparing true orbit duration exclusively over the user multiplier natively
  const maxAgeMs = params.rotationsToKeep * orbitalPeriodMs;
  
  // Clean dead meshes comparing current ticks accurately pruning natively preserving RAM gracefully
  while (swathHistory.length > 0 && (simTime - swathHistory[0].time) > maxAgeMs) {
    const old = swathHistory.shift();
    scene.remove(old.mesh);
    old.mesh.material.dispose();
  }

  // Seamlessly fade older footprint boundaries organically evaluating localized interpolation natively over literal age exactness
  swathHistory.forEach(item => {
    const age = simTime - item.time;
    const normalizedAge = age / maxAgeMs; // Scale natively tracking exact proportion (0.0 to 1.0)
    if (item.mesh.material) {
      // Curve fade math organically ensuring visibility shrinks explicitly dropping strictly at zero preserving pure rendering naturally
      item.mesh.material.opacity = Math.max(0, 0.15 * (1.0 - normalizedAge));
    }
  });

  // Tick physics natively matching input commands actively
  controls.update(); 
  renderer.render(scene, camera); // Push literal WebGL bytes identically
  labelRenderer.render(scene, camera); // Trigger identical CSS mapping overlays properly
}

// Global browser dimensional scaling catching responsive size shifts purely mapping exact values over dynamically over resizing constraints naturally
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

// Launch loop globally mapping core system immediately natively
animate();

// Listen for live TLE data dispatched by the Celestrak lookup panel
window.addEventListener('celestrak-tle', (e) => {
  const { line1, line2, name } = e.detail;
  params.tleLine1 = line1;
  params.tleLine2 = line2;
  params.preset = 'Custom';
  satLabel.element.textContent = name;
  gui.controllersRecursive().forEach(c => c.updateDisplay());
  updateSatrec();
  updateSwathSize();
  // Reset simulation time to current real time for accurate propagation
  simTime = new Date().getTime();
  lastScenePos = null;
});
