import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// Load date function (for the date slider)
async function loadDates() {
    try {
        const response = await fetch('date_list.csv');
        const data = await response.text();
        dateLabels = data.split('\n')
            .slice(1)
            .map(line => line.trim())
            .filter(line => line !== "");
        console.log("Dates loaded:", dateLabels.length);
    } catch (e) {
        console.error("Failed to load date_list.csv:", e);
    }
}
loadDates();

// --- SCENE SETUP ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
const renderer = new THREE.WebGLRenderer({ antialias: true });

renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
camera.position.set(0, 300, 500);

// Setup CSS2D Renderer for HTML Labels
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none'; 
document.body.appendChild(labelRenderer.domElement);

// --- GLOBAL STATE ---
let rowsToShow = 0;
let isPaused = false;
let targetPlanet = null; 
const planets = [];

let dateLabels = [];
let timeDirection = 1; 
let timeScale = 0.3;   
const dateInput = document.getElementById('current-date');

// --- PAUSE BUTTON ---
const pauseBtn = document.getElementById('pause-btn');
pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    pauseBtn.innerText = isPaused ? "Play" : "Pause";
});

// Reverse Button
document.getElementById('reverse-btn').addEventListener('click', () => {
    timeDirection *= -1; 
    const btn = document.getElementById('reverse-btn');
    btn.style.color = timeDirection === -1 ? "#ff4444" : "white";
});

// Speed Slider
const speedSlider = document.getElementById('speed-slider');
const speedReadout = document.getElementById('speed-readout');
speedSlider.value = 1;

function updateSpeedReadout() {
    timeScale = 10**((parseFloat(speedSlider.value) * 1.5) - 2);
    const daysPerSec = timeScale * 60;
    
    if (daysPerSec < 1) {
        speedReadout.innerText = `${daysPerSec.toFixed(2)} d/s`;
    } else {
        speedReadout.innerText = `${Math.round(daysPerSec)} d/s`;
    }
}
updateSpeedReadout();
speedSlider.addEventListener('input', updateSpeedReadout);

dateInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const inputVal = dateInput.value.trim();
        const targetIndex = dateLabels.findIndex(date => date.trim() === inputVal);

        if (targetIndex !== -1) {
            rowsToShow = targetIndex;
            planets.forEach(p => p.update(targetIndex));
            dateInput.blur(); 
            dateInput.style.color = '#00ff00'; 
            setTimeout(() => dateInput.style.color = '#00d4ff', 500);
        } else {
            dateInput.style.color = '#ff4444'; 
            setTimeout(() => dateInput.style.color = '#00d4ff', 500);
        }
    }
});

let isPausedBeforeTyping = false;
dateInput.addEventListener('focus', () => {
    isPausedBeforeTyping = isPaused;
    isPaused = true;
});
dateInput.addEventListener('blur', () => {
    isPaused = isPausedBeforeTyping;
});

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault(); 
        pauseBtn.click();
    }
});

// --- RULER GLOBAL STATE ---
let rulerTarget = null; 
const rulerMaterial = new THREE.LineBasicMaterial({ color: 0xffff00, depthTest: false });
const rulerGeometry = new THREE.BufferGeometry();
rulerGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
const rulerLine = new THREE.Line(rulerGeometry, rulerMaterial);
rulerLine.visible = false;
rulerLine.frustumCulled = false; 
scene.add(rulerLine);

const distDiv = document.createElement('div');
distDiv.className = 'distance-label';
distDiv.style.color = '#ffff00'; 
distDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
distDiv.style.padding = '2px 6px';
distDiv.style.borderRadius = '4px';
distDiv.style.fontSize = '12px';
distDiv.style.fontFamily = 'monospace';
distDiv.style.pointerEvents = 'none'; 

const distLabel = new CSS2DObject(distDiv);
scene.add(distLabel);
distLabel.visible = false;

// --- PLANET CLASS ---
class Planet {
    constructor(scene, name, csvPath, color, scaleFactor, trailLength, basePermanent = false) {
        this.scene = scene;
        this.name = name;
        this.csvPath = csvPath;
        this.color = new THREE.Color(color);
        this.scaleFactor = scaleFactor;
        this.trailLength = trailLength;
        this.basePermanent = basePermanent;
        this.isSelected = false;
        
        this.points = [];
        this.mesh = null;
        this.trail = null;
        this.isLoaded = false;
        this.rotationMatrix = new THREE.Matrix4();
        this.step = 1; 
    }

    async load(rotationX = 0, rotationY = 0, rotationZ = 0, step = 1) {
        this.step = step; 
        const euler = new THREE.Euler(rotationX, rotationY, rotationZ);
        this.rotationMatrix.makeRotationFromEuler(euler);

        const response = await fetch(this.csvPath);
        const data = await response.text();
        const rows = data.split('\n').slice(1);

        rows.forEach((row, index) => {
            if (index % step !== 0) return;
            const cols = row.trim().split(',');
            if (cols.length >= 4) {
                let x = parseFloat(cols[2]) * this.scaleFactor;
                let y = parseFloat(cols[3]) * this.scaleFactor;
                let z = parseFloat(cols[1]) * this.scaleFactor;
                
                if (!isNaN(x)) {
                    let vec = new THREE.Vector3(x, y, z);
                    vec.applyMatrix4(this.rotationMatrix);
                    this.points.push(vec);
                }
            }
        });

        const headGeo = new THREE.SphereGeometry(2, 16, 16);
        const headMat = new THREE.MeshBasicMaterial({ color: this.color });
        this.mesh = new THREE.Mesh(headGeo, headMat);
        this.scene.add(this.mesh);

        const labelDiv = document.createElement('div');
        labelDiv.className = 'planet-label';
        labelDiv.textContent = this.name;
        labelDiv.style.color = 'white';
        labelDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
        labelDiv.style.padding = '2px 5px';
        labelDiv.style.border = '1px solid white';
        labelDiv.style.borderRadius = '4px';
        labelDiv.style.fontSize = '10px';
        labelDiv.style.fontFamily = 'monospace';
        labelDiv.style.cursor = 'pointer';
        labelDiv.style.pointerEvents = 'auto';

        labelDiv.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            if (e.shiftKey) {
                if (targetPlanet && targetPlanet !== this) rulerTarget = this;
            } else {
                planets.forEach(p => p.isSelected = false);
                this.isSelected = true;
                targetPlanet = this;
                rulerTarget = null; 
                rulerLine.visible = false;
            }
        });

        this.label = new CSS2DObject(labelDiv);
        this.mesh.add(this.label);

        const geometry = new THREE.BufferGeometry().setFromPoints(this.points);
        const lineIndices = new Float32Array(this.points.length);
        for (let i = 0; i < lineIndices.length; i++) lineIndices[i] = i;
        geometry.setAttribute('lineIndex', new THREE.BufferAttribute(lineIndices, 1));

        const trailMaterial = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            uniforms: {
                uColor: { value: this.color },
                uCurrentIndex: { value: 0.0 },
                uTrailLength: { value: parseFloat(this.trailLength) / step } 
            },
            vertexShader: `
                attribute float lineIndex;
                varying float vOpacity;
                uniform float uCurrentIndex;
                uniform float uTrailLength;
                void main() {
                    float diff = uCurrentIndex - lineIndex;
                    if (diff < 0.0 || diff > uTrailLength) {
                        vOpacity = 0.0;
                    } else {
                        vOpacity = 1.0 - (diff / uTrailLength);
                    }
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = 4.0; 
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                varying float vOpacity;
                void main() {
                    if (vOpacity <= 0.0) discard;
                    gl_FragColor = vec4(uColor, vOpacity);
                }
            `
        });

        this.trail = new THREE.Points(geometry, trailMaterial);
        this.scene.add(this.trail);
        this.isLoaded = true;
    }

    update(indexFloat) {
        if (!this.isLoaded || this.points.length < 2) return;

        const adjustedIndex = indexFloat / this.step;
        const maxIndex = this.points.length - 1;
        
        let indexA = Math.floor(adjustedIndex);
        
        if (indexA >= maxIndex) {
            this.mesh.position.copy(this.points[maxIndex]);
            indexA = maxIndex; 
        } else {
            indexA = Math.max(0, indexA);
            const indexB = indexA + 1;
            const alpha = adjustedIndex % 1;
            this.mesh.position.copy(this.points[indexA]).lerp(this.points[indexB], alpha);
        }

        const trailPointCount = Math.floor(this.trailLength / this.step);
        const start = Math.max(0, indexA - trailPointCount - 2); 
        const end = Math.min(maxIndex, indexA + 2);
        const count = end - start;

        if (count > 0) {
            this.trail.geometry.setDrawRange(start, count);
            this.trail.visible = true;
        } else {
            this.trail.visible = false;
        }

        this.trail.material.uniforms.uCurrentIndex.value = adjustedIndex;

        if (this.label && camera) {
            const dist = camera.position.distanceTo(this.mesh.position);
            const dynamicOffset = (dist * 0.03) + 2; 
            this.label.position.set(0, dynamicOffset, 0);
        }
    }

    updateVisibility(cameraDistance, threshold) {
        if (!this.label) return;
        this.label.element.style.visibility = 
            (this.basePermanent || this.isSelected || cameraDistance < threshold) ? 'visible' : 'hidden';
    }
}

// --- THE SUN ---
const sunGeometry = new THREE.SphereGeometry(12, 32, 32);
const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
const sun = new THREE.Mesh(sunGeometry, sunMaterial);
scene.add(sun);

const sunObject = { mesh: sun, name: "Sun" };

const sunDiv = document.createElement('div');
sunDiv.className = 'planet-label';
sunDiv.textContent = 'SUN';
sunDiv.style.color = 'white';
sunDiv.style.background = 'rgba(0, 0, 0, 0.6)';
sunDiv.style.padding = '5px 10px';
sunDiv.style.border = '1px solid #ffffff'; 
sunDiv.style.borderRadius = '4px';
sunDiv.style.fontFamily = 'monospace';
sunDiv.style.fontSize = '14px';
sunDiv.style.cursor = 'pointer';
sunDiv.style.pointerEvents = 'auto';

sunDiv.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    if (e.shiftKey) {
        if (targetPlanet && targetPlanet !== sunObject) {
            rulerTarget = sunObject;
        }
    } else {
        planets.forEach(p => p.isSelected = false);
        targetPlanet = sunObject;
        rulerTarget = null; 
        rulerLine.visible = false;
        controls.target.set(0, 0, 0); 
    }
});

const sunLabel = new CSS2DObject(sunDiv);
sunLabel.position.set(0, 15, 0); 
sun.add(sunLabel);

// --- INITIALIZE PLANETS ---
const earthTilt = -23.44 * (Math.PI / 180);

const mercury = new Planet(scene, 'MERCURY', 'mercury-2000-110k.csv', 0xb3b2b3, 0.00000067, 88, false);
mercury.load(0, 0, earthTilt, 1);
planets.push(mercury);

const venus = new Planet(scene, 'VENUS', 'venus-2000-110k.csv', 0xf3ce87, 0.00000067, 225, false);
venus.load(0, 0, earthTilt, 1);
planets.push(venus);

const earth = new Planet(scene, 'EARTH', 'earth-2000-110k.csv', 0x4957a5, 0.00000067, 365, false);
earth.load(0, 0, earthTilt, 1);
planets.push(earth);

const mars = new Planet(scene, 'MARS', 'mars-2000-110k.csv', 0xb2494f, 0.00000067, 684, false);
mars.load(0, 0, earthTilt, 1);
planets.push(mars);

const jupiter = new Planet(scene, 'JUPITER', 'jupiter-2000-110k.csv', 0xdd7c52, 0.00000067, 4333, true);
jupiter.load(0, 0, earthTilt, 5); 
planets.push(jupiter);

const saturn = new Planet(scene, 'SATURN', 'saturn-2000-110k.csv', 0xf3d5b7, 0.00000067, 10759, true);
saturn.load(0, 0, earthTilt, 10); 
planets.push(saturn);

const uranus = new Planet(scene, 'URANUS', 'uranus-2000-110k.csv', 0x94d5dc, 0.00000067, 30687, true);
uranus.load(0, 0, earthTilt, 30); 
planets.push(uranus);

const neptune = new Planet(scene, 'NEPTUNE', 'neptune-2000-110k.csv', 0x677ea0, 0.00000067, 60190, true);
neptune.load(0, 0, earthTilt, 30); 
planets.push(neptune);

// --- TRANSPORT SHIP CLASS ---
class TransportShip {
    constructor(scene) {
        this.mesh = new THREE.Mesh(
            new THREE.SphereGeometry(1, 12, 12),
            new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        this.mesh.visible = false;
        scene.add(this.mesh);

        this.active = false;
        this.origin = null;
        this.destination = null;
        this.startTime = 0;
        this.totalDist = 0;
        this.totalDuration = 0;
        
        this.accelConst = 2.986e7 * 0.00000067; 
    }

    launch(from, to, currentTime) {
        this.origin = from;
        this.destination = to;
        this.startTime = currentTime;
        
        // FIX: Snap the ship's physical position to the origin planet IMMEDIATELY
        // This ensures the camera target locks onto the correct starting point instantly
        this.mesh.position.copy(from.mesh.position);
        
        this.totalDist = from.mesh.position.distanceTo(to.mesh.position);
        this.totalDuration = 2 * Math.sqrt(this.totalDist / this.accelConst);
        
        this.active = true;
        this.mesh.visible = true;
    }

    update(currentTime) {
        if (!this.active) return;

        const elapsed = currentTime - this.startTime;

        if (elapsed < 0) {
            this.active = false;
            this.mesh.visible = false;
            return;
        }

        // YOUR WORKING ARRIVAL BLOCK (Telemetry stripped out for later)
        if (elapsed >= this.totalDuration) {
            this.mesh.position.copy(this.destination.mesh.position);
            
            targetPlanet = this.destination;
            planets.forEach(p => p.isSelected = false);
            if (this.destination.name) this.destination.isSelected = true;
            
            isPaused = true;
            pauseBtn.innerText = "Play"; 
            
            this.active = false;
            this.mesh.visible = false;
            return;
        }

        const halfTime = this.totalDuration / 2;
        let d = 0;

        if (elapsed <= halfTime) {
            d = 0.5 * this.accelConst * elapsed * elapsed;
        } else {
            const remainingTime = this.totalDuration - elapsed;
            d = this.totalDist - (0.5 * this.accelConst * remainingTime * remainingTime);
        }

        let t = d / this.totalDist;
        t = Math.max(0, Math.min(1, t));

        this.mesh.position.lerpVectors(
            this.origin.mesh.position, 
            this.destination.mesh.position, 
            t
        );
    }
}

const transportShip = new TransportShip(scene);

// --- GLOBAL EVENT LISTENERS (OUTSIDE ANIMATION LOOP) ---
const launchBtn = document.getElementById('launch-btn');

launchBtn.addEventListener('click', () => {
    if (targetPlanet && rulerTarget && targetPlanet !== rulerTarget) {
        // 1. Trigger the launch mechanics
        transportShip.launch(targetPlanet, rulerTarget, rowsToShow);
        
        // 2. Pivot camera tracking to the ship
        targetPlanet = transportShip; 
        
        // 3. Unpause global time execution safely
        isPaused = false;
        pauseBtn.innerText = "Pause";
        
        // 4. Force button to hide immediately to protect the state engine
        launchBtn.style.display = 'none';
    }
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

// --- ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);

    if (!isPaused) {
        rowsToShow += (timeScale * timeDirection);
    }

    const maxDays = dateLabels.length > 0 ? dateLabels.length - 1 : 0;
    if (rowsToShow < 0) rowsToShow = 0;
    if (rowsToShow > maxDays) rowsToShow = maxDays;

    planets.forEach(p => p.update(rowsToShow));

    // ALWAYS UPDATE THE SHIP REgARDLESS OF RULER STATUS
    transportShip.update(rowsToShow);

    if (dateLabels.length > 0) { 
        const currentIndex = Math.floor(rowsToShow);
        const safeIndex = Math.max(0, Math.min(currentIndex, dateLabels.length - 1));
        if (document.activeElement !== dateInput) {
            dateInput.value = dateLabels[safeIndex];
        }
    }

    if (targetPlanet && targetPlanet.mesh) {
        const lastPosition = new THREE.Vector3().copy(controls.target);
        const newPosition = targetPlanet.mesh.position;
        const delta = new THREE.Vector3().subVectors(newPosition, lastPosition);
        
        camera.position.add(delta);
        controls.target.copy(newPosition);
    }

    const currentDist = camera.position.distanceTo(controls.target);
    const zoomThreshold = 1500; 

    planets.forEach(p => {
        if (p.isLoaded) p.updateVisibility(currentDist, zoomThreshold);
    });

    if (sunLabel && sun && camera) {
        const sunDist = camera.position.distanceTo(sun.position);
        sunLabel.position.set(0, sunDist * 0.03 + 15, 0);
    }

    // MANAGING LAUNCH BUTTON VISIBILITY
    if (targetPlanet?.mesh && rulerTarget?.mesh && !transportShip.active && targetPlanet !== rulerTarget) {
        launchBtn.style.display = 'block';
    } else {
        launchBtn.style.display = 'none';
    }

    // --- RULER UPDATE LOGIC ---
// --- RULER UPDATE LOGIC ---
if (targetPlanet?.mesh && rulerTarget?.mesh && targetPlanet !== rulerTarget) {
    rulerLine.visible = true;
    distLabel.visible = true;

    const p1 = targetPlanet.mesh.position; // This will now be the moving ship!
    const p2 = rulerTarget.mesh.position;   // This is the destination planet
    
    const threeDist = p1.distanceTo(p2);
    const realKM = threeDist / 0.00000067;

    const g = 2.986 * Math.pow(10, 7);
    const travelDays = 2 * Math.sqrt(realKM / g);

    const posAttr = rulerLine.geometry.attributes.position;
    posAttr.array[0] = p1.x; posAttr.array[1] = p1.y; posAttr.array[2] = p1.z;
    posAttr.array[3] = p2.x; posAttr.array[4] = p2.y; posAttr.array[5] = p2.z;
    posAttr.needsUpdate = true;

    distLabel.position.set(
        (p1.x + p2.x) / 2,
        (p1.y + p2.y) / 2,
        (p1.z + p2.z) / 2
    );

    // Displays dynamic remaining distance and remaining flight time
    distDiv.textContent = `${Math.round(realKM).toLocaleString()} km | ${travelDays.toFixed(2)} days`;
} else {
    rulerLine.visible = false;
    distLabel.visible = false;
}

    controls.update(); 
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
}

animate();