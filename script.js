import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// Load date function (for the date slider)
async function loadDates() {
    try {
        const response = await fetch('date_list.csv');
        const data = await response.text();
        // Remove header, filter empty, and TRIM every string
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
labelRenderer.domElement.style.pointerEvents = 'none'; // Crucial: let clicks pass through
document.body.appendChild(labelRenderer.domElement);

// --- GLOBAL STATE ---
let rowsToShow = 0;
let isPaused = false;
let targetPlanet = null; 
const planets = [];

let dateLabels = [];
let timeDirection = 1; // 1 for forward, -1 for reverse
let timeScale = 0.3;   // Controlled by slider
const dateElement = document.getElementById('current-date');

// --- PAUSE BUTTON ---
const pauseBtn = document.getElementById('pause-btn');
pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    pauseBtn.innerText = isPaused ? "Play" : "Pause";
});

// Reverse Button
document.getElementById('reverse-btn').addEventListener('click', () => {
    timeDirection *= -1; // Toggle between 1 and -1
    const btn = document.getElementById('reverse-btn');
    btn.style.color = timeDirection === -1 ? "#ff4444" : "white";
});

// Speed Slider
const speedSlider = document.getElementById('speed-slider');
const speedReadout = document.getElementById('speed-readout');
speedSlider.value = 1;

//this is to fix sim speed, timerate, and slider position being desynced on initialization
function updateSpeedReadout() {
    // 2. Your logarithmic formula
    timeScale = 10**((parseFloat(speedSlider.value) * 1.5) - 2);
    
    // 3. Calculate Days Per Second (assuming 60fps)
    const daysPerSec = timeScale * 60;
    
    // 4. Update the display text
    if (daysPerSec < 1) {
        speedReadout.innerText = `${daysPerSec.toFixed(2)} d/s`;
    } else {
        speedReadout.innerText = `${Math.round(daysPerSec)} d/s`;
    }
}
//Run the function once immediately so sim speed and readout match the slider
updateSpeedReadout();
speedSlider.addEventListener('input', updateSpeedReadout);

speedSlider.addEventListener('input', (e) => {
    // Your logarithmic formula
    timeScale = 10**((parseFloat(e.target.value) * 1.5) - 2);
    
    // Calculate Days Per Second (assuming 60fps)
    const daysPerSec = timeScale * 60;
    
    // Update the display
    if (daysPerSec < 1) {
        speedReadout.innerText = `${daysPerSec.toFixed(2)} d/s`;
    } else {
        speedReadout.innerText = `${Math.round(daysPerSec)} d/s`;
    }
});


const dateInput = document.getElementById('current-date');

dateInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const inputVal = dateInput.value.trim();
        
        // Find the index of the date entered
        const targetIndex = dateLabels.findIndex(date => date.trim() === inputVal);

        if (targetIndex !== -1) {
            // Jump the simulation to that day
            rowsToShow = targetIndex;
            
            // Force an immediate update so the planets snap instantly
            planets.forEach(p => p.update(targetIndex));
            
            // Visual feedback
            dateInput.blur(); // Remove focus
            dateInput.style.color = '#00ff00'; // Flash green for success
            setTimeout(() => dateInput.style.color = '#00d4ff', 500);
            
            console.log(`Jumping to index: ${targetIndex}`);
        } else {
            // Error feedback
            dateInput.style.color = '#ff4444'; // Flash red for "not found"
            setTimeout(() => dateInput.style.color = '#00d4ff', 500);
            console.warn("Date not found in list. Use format: YYYY-MM-DD");
        }
    }
});

// Pause the simulation while typing so it doesn't fight the user
dateInput.addEventListener('focus', () => {
    isPausedBeforeTyping = isPaused;
    isPaused = true;
});

dateInput.addEventListener('blur', () => {
    isPaused = isPausedBeforeTyping;
});

let isPausedBeforeTyping = false;

// SPACEBAR TOGGLE
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        // Prevent the page from scrolling down when space is pressed
        e.preventDefault(); 
        // Trigger the existing pause button logic
        pauseBtn.click();
    }
});

// --- RULER GLOBAL STATE ---
let rulerTarget = null; 

const rulerMaterial = new THREE.LineBasicMaterial({ color: 0xffff00, depthTest: false });
const rulerGeometry = new THREE.BufferGeometry();
// Pre-allocate space for 2 points (6 floats) to prevent rendering errors
rulerGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
const rulerLine = new THREE.Line(rulerGeometry, rulerMaterial);
rulerLine.visible = false;
rulerLine.frustumCulled = false; // Keep visible even if center is off-screen
scene.add(rulerLine);

// --- DISTANCE LABEL SETUP --- may delete later if i dont like it
const distDiv = document.createElement('div');
distDiv.className = 'distance-label';
distDiv.style.color = '#ffff00'; // Match the line color
distDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
distDiv.style.padding = '2px 6px';
distDiv.style.borderRadius = '4px';
distDiv.style.fontSize = '12px';
distDiv.style.fontFamily = 'monospace';
distDiv.style.pointerEvents = 'none'; // Don't let it block clicks

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
        this.step = 1; // Store the step for use in update
    }

    async load(rotationX = 0, rotationY = 0, rotationZ = 0, step = 1) {
        this.step = step; 
        const euler = new THREE.Euler(rotationX, rotationY, rotationZ);
        this.rotationMatrix.makeRotationFromEuler(euler);

        const response = await fetch(this.csvPath);
        const data = await response.text();
        const rows = data.split('\n').slice(1);

        rows.forEach((row, index) => {
            // PERFORMANCE FIX: Only load every Nth row
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

        // Planet Mesh
        const headGeo = new THREE.SphereGeometry(2, 16, 16);
        const headMat = new THREE.MeshBasicMaterial({ color: this.color });
        this.mesh = new THREE.Mesh(headGeo, headMat);
        this.scene.add(this.mesh);

        // Label Setup
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

        // Trail Setup
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
                uTrailLength: { value: parseFloat(this.trailLength) / step } // Adjust trail length for step
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

        // 1. Convert the current "Day" to the "Array Index"
        // (e.g., if it's Day 30 and step is 10, we are at Array Index 3)
        const adjustedIndex = indexFloat / this.step;
        const maxIndex = this.points.length - 1;
        
        let indexA = Math.floor(adjustedIndex);
        
        // 2. Position Clamping & Interpolation
        if (indexA >= maxIndex) {
            this.mesh.position.copy(this.points[maxIndex]);
            indexA = maxIndex; // Keep it capped
        } else {
            indexA = Math.max(0, indexA);
            const indexB = indexA + 1;
            const alpha = adjustedIndex % 1;
            this.mesh.position.copy(this.points[indexA]).lerp(this.points[indexB], alpha);
        }

        // 3. THE PERFORMANCE COMBO: setDrawRange + Step
        // trailLength is in DAYS, so we divide by step to find how many POINTS that is.
        const trailPointCount = Math.floor(this.trailLength / this.step);
        
        // We only tell the GPU to look at the slice of the array that is visible
        const start = Math.max(0, indexA - trailPointCount - 2); 
        const end = Math.min(maxIndex, indexA + 2);
        const count = end - start;

        if (count > 0) {
            this.trail.geometry.setDrawRange(start, count);
            this.trail.visible = true;
        } else {
            this.trail.visible = false;
        }

        // 4. Update Shader Uniform
        // The shader still needs the adjustedIndex to calculate the fade-out
        this.trail.material.uniforms.uCurrentIndex.value = adjustedIndex;

        // 5. Dynamic Label Offset
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

const sunObject = { 
    mesh: sun, 
    name: "Sun" 
};
// SUN LABEL
const sunDiv = document.createElement('div');
sunDiv.className = 'planet-label';
sunDiv.textContent = 'SUN';

// Explicit styles to ensure it matches the others
sunDiv.style.color = 'white';
sunDiv.style.background = 'rgba(0, 0, 0, 0.6)';
sunDiv.style.padding = '5px 10px';
sunDiv.style.border = '1px solid #ffffff'; // Golden border for the sun
sunDiv.style.borderRadius = '4px';
sunDiv.style.fontFamily = 'monospace';
sunDiv.style.fontSize = '14px';
sunDiv.style.cursor = 'pointer';
sunDiv.style.pointerEvents = 'auto';

sunDiv.addEventListener('mousedown', (e) => {
    e.stopPropagation();

    if (e.shiftKey) {
        // If holding shift, set Sun as the RULER target
        if (targetPlanet && targetPlanet !== sunObject) {
            rulerTarget = sunObject;
        }
    } else {
        // Normal click: Focus the Sun and CLEAR the ruler
        planets.forEach(p => p.isSelected = false);
        targetPlanet = sunObject;
        
        rulerTarget = null; // Fixes the "ghost line" bug
        rulerLine.visible = false;
        
        controls.target.set(0, 0, 0); 
        console.log("Focused on the Sun");
    }
});

const sunLabel = new CSS2DObject(sunDiv);
sunLabel.position.set(0, 15, 0); // Position it slightly above the Sun mesh
sun.add(sunLabel);


// --- INITIALIZE PLANETS ---
// Tilt Constant
const earthTilt = -23.44 * (Math.PI / 180);

const mercury = new Planet(scene, 'MERCURY', 'mercury-2000-110k.csv', 0xb3b2b3, 0.00000067, 88, false);
mercury.load(0, 0, earthTilt, 1); // 1 dot per day
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
jupiter.load(0, 0, earthTilt, 5); // 1 dot every 5 days
planets.push(jupiter);

const saturn = new Planet(scene, 'SATURN', 'saturn-2000-110k.csv', 0xf3d5b7, 0.00000067, 10759, true);
saturn.load(0, 0, earthTilt, 10); // 1 dot every 10 days
planets.push(saturn);

const uranus = new Planet(scene, 'URANUS', 'uranus-2000-110k.csv', 0x94d5dc, 0.00000067, 30687, true);
uranus.load(0, 0, earthTilt, 30); // 1 dot every month
planets.push(uranus);

const neptune = new Planet(scene, 'NEPTUNE', 'neptune-2000-110k.csv', 0x677ea0, 0.00000067, 60190, true);
neptune.load(0, 0, earthTilt, 30); // 1 dot every month
planets.push(neptune);


// --- WINDOW RESIZE ---
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
        // Increment or decrement based on speed and direction
        rowsToShow += (timeScale * timeDirection);
    }

    // --- BOUNDARY GUARD ---
    // 1. Determine the last possible index in your data
    const maxDays = dateLabels.length > 0 ? dateLabels.length - 1 : 0;

    // 2. Clamp rowsToShow so it never goes below 0 or above the last CSV row
    if (rowsToShow < 0) {
        rowsToShow = 0;
    } else if (rowsToShow > maxDays) {
        rowsToShow = maxDays;
    }

    planets.forEach(p => p.update(rowsToShow));

    // UPDATE DATE DISPLAY
    if (dateLabels.length > 0) { // Ensure we have data
        const currentIndex = Math.floor(rowsToShow);
        const safeIndex = Math.max(0, Math.min(currentIndex, dateLabels.length - 1));
        
        // Only update the input value if the user isn't currently typing in it
        if (document.activeElement !== dateInput) {
            dateInput.value = dateLabels[safeIndex];
        }
    }

    // Follow logic (Will trigger once we have labels to set targetPlanet)
    if (targetPlanet && targetPlanet.mesh) {
        const lastPosition = new THREE.Vector3().copy(controls.target);
        const newPosition = targetPlanet.mesh.position;
        const delta = new THREE.Vector3().subVectors(newPosition, lastPosition);
        
        camera.position.add(delta);
        controls.target.copy(newPosition);
    }

    // 1. Get the current distance from camera to the center of the world (or current target)
    const currentDist = camera.position.distanceTo(controls.target);
    const zoomThreshold = 1500; // Adjust this based on your scale

    // 2. Update planet label visibility
    planets.forEach(p => {
        if (p.isLoaded) p.updateVisibility(currentDist, zoomThreshold);
    });

    //Update sun label distance
    if (sunLabel && sun && camera) {
    const sunDist = camera.position.distanceTo(sun.position);
    sunLabel.position.set(0, sunDist * 0.03 + 15, 0);
    }

    // --- RULER UPDATE LOGIC ---
    if (targetPlanet?.mesh && rulerTarget?.mesh) {
        rulerLine.visible = true;
        distLabel.visible = true;

        const p1 = targetPlanet.mesh.position;
        const p2 = rulerTarget.mesh.position;
        
        // 1. Calculate Real World Distance (Kilometers)
        const threeDist = p1.distanceTo(p2);
        const realKM = threeDist / 0.00000067;

        // 2. Calculate Travel Time
        // Formula: $t = 2 * \sqrt{\frac{d}{g}}$
        // g = 2.986e7 km/day^2
        const g = 2.986 * Math.pow(10, 7);
        const travelDays = 2 * Math.sqrt(realKM / g);

        // 3. Update Line Buffer
        const posAttr = rulerLine.geometry.attributes.position;
        posAttr.array[0] = p1.x; posAttr.array[1] = p1.y; posAttr.array[2] = p1.z;
        posAttr.array[3] = p2.x; posAttr.array[4] = p2.y; posAttr.array[5] = p2.z;
        posAttr.needsUpdate = true;

        // 4. Update Label Position (Midpoint)
        distLabel.position.set(
            (p1.x + p2.x) / 2,
            (p1.y + p2.y) / 2,
            (p1.z + p2.z) / 2
        );

        // 5. Update Text Display
        // Formats: X,XXX km | X.XX days
        distDiv.textContent = `${Math.round(realKM).toLocaleString()} km | ${travelDays.toFixed(2)} days`;

    } else {
        rulerLine.visible = false;
        distLabel.visible = false;
    }

    controls.update(); 
    renderer.render(scene, camera);
    
    // Add this line here:
    labelRenderer.render(scene, camera);
}

animate();