// Face Authentication Demo (browser-only)
// Stores enrollments in localStorage (demo). For enterprise: store on backend with access control.

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const nameInput = document.getElementById('name');
const verifyAs = document.getElementById('verifyAs');

const btnStartCam = document.getElementById('btnStartCam');
const btnEnroll = document.getElementById('btnEnroll');
const btnAuth = document.getElementById('btnAuth');
const btnClear = document.getElementById('btnClear');

const resultEl = document.getElementById('result');
const scoreEl = document.getElementById('score');

const LS_KEY = 'face_auth_demo_enrollments_v1';

// Thresholds: lower = stricter. Typical face-api ranges vary by camera/lighting.
// For demo: tune between 0.45–0.60.
const VERIFIED_THRESHOLD = 0.50;
const UNCERTAIN_THRESHOLD = 0.58;

let camStream = null;
let modelsLoaded = false;
let authInterval = null;

function setResult(state, text) {
  resultEl.className = `result ${state}`;
  resultEl.textContent = `Result: ${text}`;
}

function loadEnrollments() {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function saveEnrollments(obj) {
  localStorage.setItem(LS_KEY, JSON.stringify(obj));
}

function refreshUserList() {
  const enrollments = loadEnrollments();
  const names = Object.keys(enrollments).sort();

  verifyAs.innerHTML = '';
  for (const n of names) {
    const opt = document.createElement('option');
    opt.value = n; opt.textContent = n;
    verifyAs.appendChild(opt);
  }

  btnAuth.disabled = !(names.length > 0 && camStream && modelsLoaded);
}

async function startCamera() {
  if (camStream) return;

  camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  video.srcObject = camStream;
  await video.play();

  overlay.width = video.videoWidth || 640;
  overlay.height = video.videoHeight || 480;

  btnEnroll.disabled = !(modelsLoaded && camStream);
  refreshUserList();
}

async function loadModels() {
  // Models are expected under /models
  // You will copy the model weight files into the models folder.
  const url = '/models';

  // Fast + good enough for demo:
  await faceapi.nets.tinyFaceDetector.loadFromUri(url);
  await faceapi.nets.faceLandmark68Net.loadFromUri(url);
  await faceapi.nets.faceRecognitionNet.loadFromUri(url);

  modelsLoaded = true;
  btnEnroll.disabled = !(modelsLoaded && camStream);
  refreshUserList();
}

async function getSingleFaceDescriptor() {
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });

  const det = await faceapi
    .detectSingleFace(video, opts)
    .withFaceLandmarks()
    .withFaceDescriptor();

  return det || null;
}

function drawBox(det) {
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  if (!det) return;
  const { x, y, width, height } = det.detection.box;
  ctx.strokeStyle = '#00ff88';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, width, height);
}

function avgDescriptor(descriptors) {
  const len = descriptors[0].length;
  const out = new Array(len).fill(0);
  for (const d of descriptors) for (let i = 0; i < len; i++) out[i] += d[i];
  for (let i = 0; i < len; i++) out[i] /= descriptors.length;
  return out;
}

async function enroll() {
  const userName = nameInput.value.trim();
  if (!userName) {
    alert('Please enter a name first.');
    return;
  }

  setResult('neutral', 'Capturing enrollment… Please look at the camera.');
  scoreEl.textContent = '';

  // Capture multiple samples to stabilize enrollment
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const det = await getSingleFaceDescriptor();
    drawBox(det);
    if (det?.descriptor) samples.push(Array.from(det.descriptor));
    await new Promise(r => setTimeout(r, 350));
  }

  if (samples.length < 3) {
    setResult('warn', 'Enrollment failed (face not detected reliably). Improve lighting and try again.');
    return;
  }

  const enrollments = loadEnrollments();
  enrollments[userName] = {
    descriptor: avgDescriptor(samples),
    enrolledAt: new Date().toISOString()
  };
  saveEnrollments(enrollments);

  setResult('ok', `Enrolled "${userName}" successfully.`);
  refreshUserList();
}

function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

function stopAuthLoop() {
  if (authInterval) {
    clearInterval(authInterval);
    authInterval = null;
  }
}

async function startAuthentication() {
  stopAuthLoop();

  const targetName = verifyAs.value;
  const enrollments = loadEnrollments();
  const record = enrollments[targetName];

  if (!record?.descriptor) {
    alert('Please enroll at least one user first.');
    return;
  }

  setResult('neutral', `Authenticating as "${targetName}"…`);
  scoreEl.textContent = 'Keep your face centered; avoid backlight.';

  authInterval = setInterval(async () => {
    const det = await getSingleFaceDescriptor();
    drawBox(det);

    if (!det?.descriptor) {
      setResult('warn', 'No face detected (move closer / improve lighting).');
      return;
    }

    const live = Array.from(det.descriptor);
    const dist = euclideanDistance(live, record.descriptor);

    // Lower distance = more similar
    scoreEl.textContent = `Similarity distance: ${dist.toFixed(3)} (lower is better)`;

    if (dist <= VERIFIED_THRESHOLD) {
      setResult('ok', 'Verified ✅');
    } else if (dist <= UNCERTAIN_THRESHOLD) {
      setResult('warn', 'Uncertain ⚠️ (try again / adjust lighting)');
    } else {
      setResult('bad', 'Not Verified ❌');
    }
  }, 700);
}

function clearAll() {
  if (confirm('Clear all enrollments stored in this browser?')) {
    localStorage.removeItem(LS_KEY);
    refreshUserList();
    setResult('neutral', 'Cleared enrollments.');
    scoreEl.textContent = '';
  }
}

btnStartCam.addEventListener('click', startCamera);
btnEnroll.addEventListener('click', enroll);
btnAuth.addEventListener('click', startAuthentication);
btnClear.addEventListener('click', clearAll);

window.addEventListener('beforeunload', stopAuthLoop);

(async function init() {
  setResult('neutral', 'Loading models…');
  try {
    await loadModels();
    setResult('neutral', 'Models loaded. Click “Start Camera”, then Enroll.');
  } catch (e) {
    console.error(e);
    setResult('bad', 'Model load failed. Ensure /models folder exists with required files.');
  }
  refreshUserList();
})();
