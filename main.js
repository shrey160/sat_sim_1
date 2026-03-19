import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import * as satellite from 'satellite.js';
import GUI from 'lil-gui';

// --- Configuration ---
const EARTH_RADIUS_KM = 6378.137;
const SCALE = 1 / 1000; // 1 unit = 1000 km
const MU_EARTH = 398600.4418; // km^3/s^2

const PRESETS = {
  'Landsat-8': { alt: 705, inc: 98.2, swath: 185 },
  'ISS': { alt: 420, inc: 51.6, swath: 500 },
  'NOAA-20': { alt: 824, inc: 98.7, swath: 3000 },
  'Custom': null
};

// --- State ---
const params = {
  preset: 'Landsat-8',
  altitude: 705,      // km
  inclination: 98.2,  // deg
  raan: 0,            // deg
  swathWidth: 185,    // km
  altitudeScale: 1.0, // Multiplier for altitude to see effect easily
  nadirAngle: 0,      // degrees (roll)
  rotationsToKeep: 1,
  timeMultiplier: 60, // speed up time
  clearHistory: () => clearSwathHistory()
};

let swathHistory = [];
let simTime = new Date().getTime();
let lastSwathCapture = 0;
const SWATH_CAPTURE_INTERVAL = 2000; // ms in sim time

// --- Init Scene ---
const container = document.getElementById('app');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0c10);
scene.fog = new THREE.FogExp2(0x0b0c10, 0.02);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 10, 20);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none';
container.appendChild(labelRenderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 7;
controls.maxDistance = 50;

// --- Earth Setup ---
const earthGroup = new THREE.Group();
scene.add(earthGroup);

// Stylized Earth: Wireframe + Solid inner sphere
const earthRad = EARTH_RADIUS_KM * SCALE;
const earthGeo = new THREE.SphereGeometry(earthRad, 64, 64);

// Inner dark sphere
const earthMat = new THREE.MeshPhongMaterial({
  color: 0x1f2833,
  emissive: 0x0b0c10,
  specular: 0x111111,
  shininess: 5,
  transparent: true,
  opacity: 0.95
});
const earthMesh = new THREE.Mesh(earthGeo, earthMat);
earthGroup.add(earthMesh);

// Outer grid bounds (stylized)
const wireMat = new THREE.MeshBasicMaterial({
  color: 0x45a29e,
  wireframe: true,
  transparent: true,
  opacity: 0.15
});
const wireMesh = new THREE.Mesh(earthGeo, wireMat);
wireMesh.scale.setScalar(1.001);
earthGroup.add(wireMesh);

// Add equator line
const equatorGeo = new THREE.RingGeometry(earthRad + 0.05, earthRad + 0.06, 64);
const equatorMat = new THREE.MeshBasicMaterial({ color: 0x45a29e, side: THREE.DoubleSide, transparent: true, opacity: 0.4 });
const equatorMesh = new THREE.Mesh(equatorGeo, equatorMat);
equatorMesh.rotation.x = Math.PI / 2;
earthGroup.add(equatorMesh);

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
directionalLight.position.set(10, 10, 10);
scene.add(directionalLight);

// --- Satellite Setup ---
const satGroup = new THREE.Group();
scene.add(satGroup);

const satGeo = new THREE.OctahedronGeometry(0.15, 0);
const satMat = new THREE.MeshBasicMaterial({ color: 0x66fcf1, wireframe: true });
const satMesh = new THREE.Mesh(satGeo, satMat);
satGroup.add(satMesh);

const satCoreGeo = new THREE.SphereGeometry(0.05, 8, 8);
const satCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const satCoreMesh = new THREE.Mesh(satCoreGeo, satCoreMat);
satGroup.add(satCoreMesh);

const satDiv = document.createElement('div');
satDiv.className = 'satellite-label';
satDiv.textContent = params.preset;
const satLabel = new CSS2DObject(satDiv);
satLabel.position.set(0, 0.3, 0);
satGroup.add(satLabel);

const swathMat = new THREE.MeshBasicMaterial({
  color: 0x66fcf1,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.3,
  depthWrite: false
});

function createSwathGeometry(widthKm) {
  const angle = (widthKm / 2) / EARTH_RADIUS_KM; // Radians from center of earth
  const rad = Math.sin(angle) * (earthRad + 0.01);
  return new THREE.CircleGeometry(rad, 32);
}

let activeSwathGeo = createSwathGeometry(params.swathWidth);
const activeSwathMesh = new THREE.Mesh(activeSwathGeo, swathMat);
scene.add(activeSwathMesh);

// --- GUI ---
const gui = new GUI({ title: 'Satellite Control' });
gui.add(params, 'preset', Object.keys(PRESETS)).name('Orbit Preset').onChange(v => {
  if (PRESETS[v]) {
    params.altitude = PRESETS[v].alt;
    params.inclination = PRESETS[v].inc;
    params.swathWidth = PRESETS[v].swath;
    gui.controllersRecursive().forEach(c => c.updateDisplay());
  }
  satLabel.element.textContent = v;
  updateSwathSize();
});
gui.add(params, 'altitude', 200, 36000).name('Altitude (km)').listen().onChange(clearSwathHistory);
gui.add(params, 'inclination', 0, 180).name('Inclination (deg)').listen().onChange(clearSwathHistory);
gui.add(params, 'raan', 0, 360).name('RAAN (deg)').listen().onChange(clearSwathHistory);
gui.add(params, 'swathWidth', 50, 5000).name('Swath Width (km)').listen().onChange(updateSwathSize);
gui.add(params, 'altitudeScale', 0.5, 3.0).name('Altitude Multiplier');
gui.add(params, 'nadirAngle', -60, 60).name('Nadir Angle (deg)');
gui.add(params, 'rotationsToKeep', 0.1, 5).name('Trailing Rotations').onChange(clearSwathHistory);
gui.add(params, 'timeMultiplier', 1, 1000).name('Time Speed');
gui.add(params, 'clearHistory').name('Clear Trail');

function updateSwathSize() {
  activeSwathGeo.dispose();
  activeSwathGeo = createSwathGeometry(params.swathWidth);
  activeSwathMesh.geometry = activeSwathGeo;
  clearSwathHistory();
  if (params.preset === 'Custom') {
    satLabel.element.textContent = 'Custom';
  }
}

function clearSwathHistory() {
  swathHistory.forEach(item => {
    scene.remove(item.mesh);
    item.mesh.geometry.dispose();
    item.mesh.material.dispose();
  });
  swathHistory = [];
}

// --- Animation Loop ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const stepMs = delta * 1000 * params.timeMultiplier;
  simTime += stepMs;
  const t = new Date(simTime);

  // --- Parametric Keplerian Orbit ---
  const r = EARTH_RADIUS_KM + params.altitude; // km
  const n = Math.sqrt(MU_EARTH / Math.pow(r, 3)); // mean motion rad/s
  const orbitalPeriodMs = (2 * Math.PI / n) * 1000;
  
  // Orbit Anomaly (angle in orbital plane)
  const M = n * (simTime / 1000); 
  
  // Position in Orbital Plane (X' and Y')
  const x_orb = r * Math.cos(M);
  const y_orb = r * Math.sin(M);
  
  // Inclination and RAAN rotations to ECI
  const inc = THREE.MathUtils.degToRad(params.inclination);
  const raan = THREE.MathUtils.degToRad(params.raan);
  
  const x_eci = x_orb * Math.cos(raan) - (y_orb * Math.cos(inc)) * Math.sin(raan);
  const y_eci = x_orb * Math.sin(raan) + (y_orb * Math.cos(inc)) * Math.cos(raan);
  const z_eci = y_orb * Math.sin(inc);
  
  const positionEci = { x: x_eci, y: y_eci, z: z_eci };
  const gmst = satellite.gstime(t);

  // ECI to ECEF (rotating frame)
  const positionEcf = satellite.eciToEcf(positionEci, gmst);
  
  // Scale to Three.js units
  // ECEF coordinates: X towards Greenwich meridian, Z towards North Pole.
  // Three.js: map ECEF Z -> Three.js Y, X -> Three.js X, Y -> Three.js -Z
  let x = positionEcf.x * SCALE;
  let y = positionEcf.z * SCALE;
  let z = -positionEcf.y * SCALE;

  // Apply altitude scale for visual effect
  const dist = Math.sqrt(x*x + y*y + z*z);
  const alt = dist - earthRad;
  const scaledDist = earthRad + (alt * params.altitudeScale);
  const ratio = scaledDist / dist;
  x *= ratio;
  y *= ratio;
  z *= ratio;

  satGroup.position.set(x, y, z);
  
  // Animate satellite mesh
  satMesh.rotation.x += delta;
  satMesh.rotation.y += delta * 1.5;

  // --- Update Swath Position & Orientation ---
  const satDir = satGroup.position.clone().normalize();
  
  const north = new THREE.Vector3(0, 1, 0);
  const east = new THREE.Vector3().crossVectors(north, satDir).normalize();
  
  const pointingDir = satDir.clone().negate(); // towards earth
  const nadirRad = THREE.MathUtils.degToRad(params.nadirAngle);
  pointingDir.applyAxisAngle(east, nadirRad);

  const ray = new THREE.Ray(satGroup.position, pointingDir);
  const earthSphere = new THREE.Sphere(new THREE.Vector3(0,0,0), earthRad + 0.01);
  const hit = new THREE.Vector3();
  const intersect = ray.intersectSphere(earthSphere, hit);

  if (intersect) {
    activeSwathMesh.position.copy(hit);
    
    const up = hit.clone().normalize();
    activeSwathMesh.lookAt(hit.clone().add(up));
    activeSwathMesh.visible = true;

    // Persist step
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
      hMesh.quaternion.copy(activeSwathMesh.quaternion);
      scene.add(hMesh);

      swathHistory.push({
        mesh: hMesh,
        time: simTime
      });
    }
  } else {
    activeSwathMesh.visible = false;
  }

  // Manage History Persistence
  const maxAgeMs = params.rotationsToKeep * orbitalPeriodMs;
  
  while (swathHistory.length > 0 && (simTime - swathHistory[0].time) > maxAgeMs) {
    const old = swathHistory.shift();
    scene.remove(old.mesh);
    old.mesh.material.dispose();
  }

  // Fade out swaths
  swathHistory.forEach(item => {
    const age = simTime - item.time;
    const normalizedAge = age / maxAgeMs;
    if (item.mesh.material) {
      item.mesh.material.opacity = Math.max(0, 0.15 * (1.0 - normalizedAge));
    }
  });

  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
