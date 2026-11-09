import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import URDFLoader from 'urdf-loader';
import { PointerURDFDragControls } from 'urdf-loader/src/URDFDragControls.js';
import './style.css';

const canvas = document.querySelector('#scene');
const statusText = document.querySelector('#status-text');
const statusIndicator = document.querySelector('.status-dot');
const jointCount = document.querySelector('#joint-count');
const jointList = document.querySelector('#joint-list');
const searchInput = document.querySelector('#joint-search');
const timeline = document.querySelector('#timeline');
const timeReadout = document.querySelector('#time-readout');
const playButton = document.querySelector('#play-toggle');
const playIcon = document.querySelector('#play-icon');
const playLabel = document.querySelector('#play-label');
const animationSelect = document.querySelector('#animation-select');
const loadError = document.querySelector('#load-error');
const dragModeButton = document.querySelector('#drag-mode-toggle');

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e9e9e3');

const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
camera.position.set(2.9, 2.2, 4.1);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

scene.add(new THREE.HemisphereLight('#ffffff', '#b7b7aa', 2.1));
const keyLight = new THREE.DirectionalLight('#fff4df', 3.2);
keyLight.position.set(3.5, 6, 4);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -4;
keyLight.shadow.camera.right = 4;
keyLight.shadow.camera.top = 5;
keyLight.shadow.camera.bottom = -4;
scene.add(keyLight);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.MeshStandardMaterial({ color: '#d9dad3', roughness: 0.92 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.008;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(10, 40, '#a3a99f', '#c8cbc2');
grid.position.y = -0.004;
scene.add(grid);
const axes = new THREE.AxesHelper(0.35);
axes.position.set(-0.9, 0.006, -0.55);
scene.add(axes);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 1, 0);
orbit.enableDamping = true;
orbit.dampingFactor = 0.075;
orbit.minDistance = 1.3;
orbit.maxDistance = 8;

let robot;
let animation;
let animationTime = 0;
let playing = false;
let previousFrameTime = 0;
let animationRequest = 0;
let resizeObserver;
let dragControls = null;
let dragModeEnabled = false;
let pointerOverCanvas = false;
const jointControls = new Map();
const highlightedMaterials = new Map();
const highlightMaterial = new THREE.MeshStandardMaterial({
  color: '#58c39a',
  emissive: '#278c6c',
  emissiveIntensity: 0.4,
  roughness: 0.78,
});

function highlightJoint(joint) {
  function visit(object) {
    if (object !== joint && object.isURDFJoint && object.jointType !== 'fixed') return;
    if (object.isURDFCollider) return;
    if (object.isMesh) {
      highlightedMaterials.set(object, object.material);
      object.material = highlightMaterial;
    }
    for (const child of object.children) visit(child);
  }
  visit(joint);
}

function clearJointHighlight() {
  for (const [mesh, material] of highlightedMaterials) mesh.material = material;
  highlightedMaterials.clear();
}

function resize() {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  camera.aspect = bounds.width / bounds.height;
  camera.updateProjectionMatrix();
  renderer.setSize(bounds.width, bounds.height, false);
}

resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(canvas);
window.addEventListener('resize', resize);
resize();

function setStatus(message, state = '') {
  statusText.textContent = message;
  statusIndicator.dataset.state = state;
}

function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const remainder = Math.floor((milliseconds % 1000) / 100);
  return `0:${String(seconds).padStart(2, '0')}.${remainder}`;
}

function updateTimeline() {
  if (!animation) return;
  timeline.value = String(animationTime);
  timeReadout.textContent = `${formatTime(animationTime)} / ${formatTime(animation.duration)}`;
}

function setJointValue(name, value, syncSlider = true) {
  if (!robot) return;
  const joint = robot.joints[name];
  if (!joint) return;
  robot.setJointValue(name, value);
  const control = jointControls.get(name);
  if (!control || !syncSlider) return;
  const actualValue = joint.angle;
  control.slider.value = String(actualValue);
  control.output.textContent = control.unit === 'deg'
    ? `${(actualValue * 180 / Math.PI).toFixed(1)}°`
    : `${actualValue.toFixed(3)} m`;
}

function createJointRow(name, joint) {
  const movableType = joint.jointType;
  const isLinear = movableType === 'prismatic';
  const minimum = Number.isFinite(Number(joint.limit?.lower)) ? Number(joint.limit.lower) : -Math.PI;
  const maximum = Number.isFinite(Number(joint.limit?.upper)) ? Number(joint.limit.upper) : Math.PI;
  const initialValue = THREE.MathUtils.clamp(0, minimum, maximum);
  const unit = isLinear ? 'm' : 'deg';

  const row = document.createElement('label');
  row.className = 'joint-row';
  row.dataset.joint = name.toLowerCase();

  const top = document.createElement('span');
  top.className = 'joint-meta';
  const nameLabel = document.createElement('span');
  nameLabel.className = 'joint-name';
  nameLabel.textContent = name.replaceAll('_', ' ');
  const output = document.createElement('output');
  output.className = 'joint-value';
  output.textContent = isLinear ? `${initialValue.toFixed(3)} m` : `${(initialValue * 180 / Math.PI).toFixed(1)}°`;
  top.append(nameLabel, output);

  const slider = document.createElement('input');
  slider.className = 'joint-slider';
  slider.type = 'range';
  slider.min = String(minimum);
  slider.max = String(maximum);
  slider.step = isLinear ? '0.001' : '0.01';
  slider.value = String(initialValue);
  slider.setAttribute('aria-label', name.replaceAll('_', ' '));
  slider.addEventListener('input', () => {
    pausePlayback();
    setJointValue(name, Number(slider.value));
  });
  row.append(top, slider);
  jointControls.set(name, { slider, output, unit, initialValue, row });
  return row;
}

function buildJointControls() {
  const movable = Object.entries(robot.joints)
    .filter(([, joint]) => ['revolute', 'continuous', 'prismatic'].includes(joint.jointType));
  const groups = new Map([
    ['Head & neck', []],
    ['Left arm', []],
    ['Right arm', []],
    ['Left leg', []],
    ['Right leg', []],
    ['Other', []],
  ]);

  for (const [name, joint] of movable) {
    let group = 'Other';
    if (/^(neck|head)_/.test(name)) group = 'Head & neck';
    else if (name.startsWith('left_') && /shoulder|elbow|wrist|thumb|index|middle|ring|little/.test(name)) group = 'Left arm';
    else if (name.startsWith('right_') && /shoulder|elbow|wrist|thumb|index|middle|ring|little/.test(name)) group = 'Right arm';
    else if (name.startsWith('left_') && /hip|knee|ankle/.test(name)) group = 'Left leg';
    else if (name.startsWith('right_') && /hip|knee|ankle/.test(name)) group = 'Right leg';
    groups.get(group).push([name, joint]);
  }

  jointList.replaceChildren();
  for (const [groupName, joints] of groups) {
    if (!joints.length) continue;
    const section = document.createElement('details');
    section.className = 'joint-group';
    section.open = groupName.includes('leg') || groupName === 'Head & neck';
    const summary = document.createElement('summary');
    summary.innerHTML = `<span>${groupName}</span><span class="group-count">${joints.length}</span>`;
    const rows = document.createElement('div');
    rows.className = 'joint-rows';
    for (const [name, joint] of joints) rows.append(createJointRow(name, joint));
    section.append(summary, rows);
    jointList.append(section);
  }

  jointCount.textContent = `${movable.length} joints`;
}

function applyAnimation(time) {
  if (!animation || !robot) return;
  const frames = animation.keyframes;
  let nextIndex = frames.findIndex(frame => frame.time >= time);
  if (nextIndex < 0) nextIndex = frames.length - 1;
  const previousIndex = Math.max(0, nextIndex - 1);
  const next = frames[nextIndex];
  const previous = frames[previousIndex];
  const span = next.time - previous.time;
  const amount = span === 0 ? 0 : THREE.MathUtils.clamp((time - previous.time) / span, 0, 1);

  for (const name of animation.joints) {
    let from = 0;
    let to = 0;
    for (let index = previousIndex; index >= 0; index -= 1) {
      if (Number.isFinite(frames[index].values[name])) {
        from = frames[index].values[name];
        break;
      }
    }
    for (let index = nextIndex; index >= 0; index -= 1) {
      if (Number.isFinite(frames[index].values[name])) {
        to = frames[index].values[name];
        break;
      }
    }
    const control = jointControls.get(name);
    if (control) setJointValue(name, THREE.MathUtils.lerp(from, to, amount));
  }
}

function pausePlayback() {
  playing = false;
  playIcon.textContent = '▶';
  playLabel.textContent = 'Play';
}

function resetJointPose() {
  for (const [name, control] of jointControls) setJointValue(name, control.initialValue);
}

function frame(now) {
  requestAnimationFrame(frame);
  if (playing && animation) {
    if (previousFrameTime) animationTime += now - previousFrameTime;
    if (animationTime >= animation.duration) {
      if (document.querySelector('#loop-toggle').checked) animationTime %= animation.duration;
      else {
        animationTime = animation.duration;
        pausePlayback();
      }
    }
    applyAnimation(animationTime);
    updateTimeline();
  }
  previousFrameTime = now;
  if (pointerOverCanvas) dragControls?.update();
  orbit.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

function setDragMode(enabled) {
  if (!robot || enabled === dragModeEnabled) return;
  dragModeEnabled = enabled;
  dragModeButton.setAttribute('aria-pressed', String(enabled));
  dragModeButton.title = enabled ? 'Disable joint dragging' : 'Enable joint dragging';

  if (enabled) {
    pausePlayback();
    orbit.enableRotate = false;
    orbit.enablePan = false;
    canvas.dataset.dragMode = 'true';
    dragControls = new PointerURDFDragControls(robot, camera, canvas);
    dragControls.updateJoint = (joint, angle) => setJointValue(joint.name, angle);
    dragControls.onDragStart = joint => {
      pausePlayback();
      orbit.enabled = false;
      jointControls.get(joint.name)?.row.classList.add('is-manipulated');
      canvas.style.cursor = 'grabbing';
      setStatus(`Moving ${joint.name.replaceAll('_', ' ')}`, 'ready');
    };
    dragControls.onDragEnd = joint => {
      orbit.enabled = true;
      jointControls.get(joint.name)?.row.classList.remove('is-manipulated');
      canvas.style.cursor = 'grab';
      setStatus('Model ready', 'ready');
    };
    dragControls.onHover = joint => {
      highlightJoint(joint);
      jointControls.get(joint.name)?.row.classList.add('is-hovered');
      canvas.style.cursor = 'grab';
      setStatus(`Joint: ${joint.name.replaceAll('_', ' ')}`, 'ready');
    };
    dragControls.onUnhover = joint => {
      clearJointHighlight();
      const row = jointControls.get(joint.name)?.row;
      row?.classList.remove('is-hovered', 'is-manipulated');
      canvas.style.cursor = dragModeEnabled ? 'crosshair' : '';
      setStatus(dragModeEnabled ? 'Drag a joint' : 'Model ready', 'ready');
    };
    canvas.style.cursor = 'crosshair';
    setStatus('Drag a joint', 'ready');
    return;
  }

  if (dragControls?.manipulating) dragControls.setGrabbed(false);
  if (dragControls?.hovered) dragControls.onUnhover(dragControls.hovered);
  dragControls?.dispose();
  dragControls = null;
  orbit.enabled = true;
  orbit.enableRotate = true;
  orbit.enablePan = true;
  delete canvas.dataset.dragMode;
  canvas.style.cursor = '';
  setStatus('Model ready', 'ready');
}

canvas.addEventListener('mouseenter', () => { pointerOverCanvas = true; });
canvas.addEventListener('mouseleave', () => {
  pointerOverCanvas = false;
  if (dragControls?.hovered && !dragControls.manipulating) {
    dragControls.onUnhover(dragControls.hovered);
    dragControls.hovered = null;
  }
});

canvas.addEventListener('mousedown', event => {
  if (dragModeEnabled && event.button !== 0) event.stopImmediatePropagation();
});
canvas.addEventListener('contextmenu', event => {
  if (dragModeEnabled) event.preventDefault();
});

function forwardTouchAsMouse(type, event) {
  if (!dragModeEnabled) return;
  const touch = type === 'mouseup' ? event.changedTouches[0] : event.touches[0];
  if (!touch) return;
  event.preventDefault();
  canvas.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: touch.clientX,
    clientY: touch.clientY,
    button: 0,
    buttons: type === 'mouseup' ? 0 : 1,
  }));
}

canvas.addEventListener('touchstart', event => forwardTouchAsMouse('mousedown', event), { passive: false });
canvas.addEventListener('touchmove', event => forwardTouchAsMouse('mousemove', event), { passive: false });
canvas.addEventListener('touchend', event => forwardTouchAsMouse('mouseup', event), { passive: false });
canvas.addEventListener('touchcancel', event => forwardTouchAsMouse('mouseup', event), { passive: false });
window.addEventListener('mouseup', () => {
  if (dragControls?.manipulating) dragControls.setGrabbed(false);
  if (!pointerOverCanvas && dragControls?.hovered) {
    dragControls.onUnhover(dragControls.hovered);
    dragControls.hovered = null;
  }
});

async function loadRobot() {
  setStatus('Loading model');
  const loader = new URDFLoader();
  loader.load('/model/robot.urdf', loadedRobot => {
    robot = loadedRobot;
    robot.rotation.x = -Math.PI / 2;
    robot.traverse(object => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        if (object.material) object.material.roughness = 0.78;
      }
    });
    const bounds = new THREE.Box3().setFromObject(robot);
    const center = bounds.getCenter(new THREE.Vector3());
    robot.position.set(-center.x, -bounds.min.y, -center.z);
    robot.updateMatrixWorld(true);
    scene.add(robot);
    orbit.target.set(0, 1, 0);
    buildJointControls();
    setStatus('Model ready', 'ready');
    document.querySelector('#reset-joints').disabled = false;
    document.querySelector('#view-reset').disabled = false;
    dragModeButton.disabled = false;
    loadError.hidden = true;
    loadAnimation(animationSelect.value);
  }, undefined, error => {
    console.error(error);
    setStatus('Model unavailable', 'error');
    loadError.hidden = false;
    loadError.textContent = 'Could not load /model/robot.urdf. Check that the URDF and meshes are mounted and available.';
    jointList.innerHTML = '<div class="empty-state">No joints available.</div>';
  });
}

async function loadAnimation(animationName) {
  const request = ++animationRequest;
  pausePlayback();
  animation = null;
  animationTime = 0;
  playButton.disabled = true;
  timeline.disabled = true;
  resetJointPose();
  timeReadout.textContent = 'Loading animation';

  try {
    const response = await fetch(`/animations/${animationName}.json`);
    if (!response.ok) throw new Error(`Animation request failed: ${response.status}`);
    const loadedAnimation = await response.json();
    if (request !== animationRequest) return;
    animation = loadedAnimation;
    timeline.max = String(animation.duration);
    timeline.disabled = false;
    playButton.disabled = false;
    applyAnimation(0);
    updateTimeline();
  } catch (error) {
    if (request !== animationRequest) return;
    console.error(error);
    timeReadout.textContent = 'Animation unavailable';
  }
}

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim().toLowerCase();
  for (const row of jointList.querySelectorAll('.joint-row')) {
    row.hidden = query.length > 0 && !row.dataset.joint.includes(query);
  }
  for (const group of jointList.querySelectorAll('.joint-group')) {
    const visibleRows = group.querySelectorAll('.joint-row:not([hidden])').length;
    group.hidden = visibleRows === 0;
    if (query && visibleRows) group.open = true;
  }
});

document.querySelector('#reset-joints').addEventListener('click', () => {
  pausePlayback();
  resetJointPose();
  animationTime = 0;
  updateTimeline();
});

document.querySelector('#view-reset').addEventListener('click', () => {
  camera.position.set(2.9, 2.2, 4.1);
  orbit.target.set(0, 1, 0);
  orbit.update();
});

animationSelect.addEventListener('change', () => loadAnimation(animationSelect.value));
dragModeButton.addEventListener('click', () => setDragMode(!dragModeEnabled));

playButton.addEventListener('click', () => {
  if (!animation) return;
  if (playing) pausePlayback();
  else {
    if (animationTime >= animation.duration) animationTime = 0;
    playing = true;
    playIcon.textContent = 'Ⅱ';
    playLabel.textContent = 'Pause';
    previousFrameTime = 0;
    applyAnimation(animationTime);
  }
});

timeline.addEventListener('input', () => {
  pausePlayback();
  animationTime = Number(timeline.value);
  applyAnimation(animationTime);
  updateTimeline();
});

loadRobot();