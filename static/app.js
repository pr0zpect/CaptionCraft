/* ═══════════════════════════════════════════════
   CaptionCraft AI — Future JS Controller
   ═══════════════════════════════════════════════ */

const state = {
  imageDataUrl: null,
  platform: 'instagram',
  tone: 'casual',
  extra: '',
  user: null,
  token: localStorage.getItem('token') || null
};

const BACKEND_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:5001/api"
  : "https://tender-feet-share.loca.lt/api";

// Elements
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const dropIdle = document.getElementById("drop-idle");
const dropPreview = document.getElementById("drop-preview");
const previewImg = document.getElementById("preview-img");
const browseBtn = document.getElementById("browse-btn");
const changeImgBtn = document.getElementById("change-img-btn");

const panelUpload = document.getElementById("panel-upload");
const panelConfig = document.getElementById("panel-config");
const panelResults = document.getElementById("panel-results");

const step1El = document.getElementById("step-1");
const step2El = document.getElementById("step-2");
const step3El = document.getElementById("step-3");

const nextBtn1 = document.getElementById("next-btn-1");
const backBtn1 = document.getElementById("back-btn-1");
const generateBtn = document.getElementById("generate-btn");
const genLabel = document.getElementById("gen-label");
const genSpinner = document.getElementById("gen-spinner");

const resultThumb = document.getElementById("result-thumb");
const captionsList = document.getElementById("captions-list");
const backBtn2 = document.getElementById("back-btn-2");
const startOverBtn = document.getElementById("start-over-btn");
const regenerateBtn = document.getElementById("regenerate-btn");
const toast = document.getElementById("toast");

// Auth & Gate Elements
const authGate = document.getElementById("auth-gate");
const appContent = document.getElementById("app-content");
const historyModal = document.getElementById("history-modal");
const authNavBtn = document.getElementById("auth-nav-btn");
const historyBtn = document.getElementById("history-btn");
const logoutBtn = document.getElementById("logout-btn");

const gateLoginSubmit = document.getElementById("gate-login-submit");
const gateSignupSubmit = document.getElementById("gate-signup-submit");
const historyContent = document.getElementById("history-content");

// Navigation
function showPanel(panelName) {
  [panelUpload, panelConfig, panelResults].forEach(p => p.classList.add("hidden"));
  [step1El, step2El, step3El].forEach(s => s.classList.remove("active"));

  if (panelName === 'upload') {
    panelUpload.classList.remove('hidden');
    step1El.classList.add('active');
  } else if (panelName === 'config') {
    panelConfig.classList.remove('hidden');
    step2El.classList.add('active');
  } else if (panelName === 'results') {
    panelResults.classList.remove('hidden');
    step3El.classList.add('active');
  }
}

nextBtn1.addEventListener("click", () => showPanel("config"));
backBtn1.addEventListener("click", () => showPanel("upload"));
backBtn2.addEventListener("click", () => showPanel("config"));
startOverBtn.addEventListener("click", () => {
  state.imageDataUrl = null;
  dropPreview.classList.add("hidden");
  dropIdle.classList.remove("hidden");
  nextBtn1.disabled = true;
  showPanel("upload");
});

// Toast
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toast.classList.add("hidden"), 3000);
}

// Upload Handling
async function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) return showToast("Invalid image file!");
  
  const reader = new FileReader();
  reader.onload = e => {
    state.imageDataUrl = e.target.result;
    previewImg.src = state.imageDataUrl;
    dropIdle.classList.add("hidden");
    dropPreview.classList.remove("hidden");
    nextBtn1.disabled = false;
  };
  reader.readAsDataURL(file);
}

dropZone.addEventListener("click", e => { if(e.target !== changeImgBtn) fileInput.click(); });
browseBtn.addEventListener("click", e => { e.stopPropagation(); fileInput.click(); });
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
  fileInput.value = ""; 
});
changeImgBtn.addEventListener("click", e => {
  e.stopPropagation();
  fileInput.click();
});
dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", e => { dropZone.classList.remove("dragover"); });
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

// Selectors
document.querySelectorAll(".pill").forEach(btn => {
  btn.addEventListener("click", function() {
    const parent = this.closest(".pill-group");
    parent.querySelectorAll(".pill").forEach(b => b.classList.remove("active"));
    this.classList.add("active");
    if (parent.id === "platform-grid") state.platform = this.dataset.value;
    if (parent.id === "tone-grid") state.tone = this.dataset.value;
  });
});

document.getElementById("extra-input").addEventListener("input", function() {
  state.extra = this.value;
});

// API Call
async function performGeneration() {
  if (!state.token) {
    showToast("Please login to generate captions");
    return;
  }
  generateBtn.disabled = true;
  regenerateBtn.disabled = true;
  genLabel.classList.add("hidden");
  genSpinner.classList.remove("hidden");

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      body: JSON.stringify({
        image: state.imageDataUrl,
        platform: state.platform,
        tone: state.tone,
        extra: state.extra
      })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    renderResults(data.captions);
    
    // Save to History if logged in
    if (state.token) {
      saveToHistory(data.captions[0]);
    }

    showPanel("results");
  } catch (err) {
    showToast(err.message || "Failed to generate");
  } finally {
    generateBtn.disabled = false;
    regenerateBtn.disabled = false;
    genLabel.classList.remove("hidden");
    genSpinner.classList.add("hidden");
  }
}

generateBtn.addEventListener("click", performGeneration);
regenerateBtn.addEventListener("click", performGeneration);

// Results
function renderResults(captions) {
  resultThumb.src = state.imageDataUrl;
  captionsList.innerHTML = "";
  
  captions.forEach((cap, idx) => {
    const div = document.createElement("div");
    div.className = "cap-card";
    div.innerHTML = `
      <div class="cap-header">
        <div class="cap-num">Variation ${idx + 1}</div>
        <button class="copy-btn" id="copy-${idx}">Copy</button>
      </div>
      <div class="cap-text">${escapeHtml(cap)}</div>
    `;
    captionsList.appendChild(div);

    div.querySelector(`#copy-${idx}`).addEventListener("click", function() {
      navigator.clipboard.writeText(cap);
      this.textContent = "Copied!";
      showToast("Copied to clipboard");
      setTimeout(() => this.textContent = "Copy", 2000);
    });
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ─── Auth & History Logic ─── */

async function checkAuth() {
  const storedUser = localStorage.getItem('user');
  if (state.token && storedUser) {
    try {
      state.user = JSON.parse(storedUser);
      updateUIForAuth(true);
    } catch(e) { updateUIForAuth(false); }
  } else {
    updateUIForAuth(false);
  }
}

function updateUIForAuth(isLoggedIn) {
  if (isLoggedIn) {
    authGate.classList.add("hidden");
    appContent.classList.remove("hidden");
    authNavBtn.textContent = `Hi, ${state.user.name.split(' ')[0]}`;
    historyBtn.style.display = 'block';
    logoutBtn.style.display = 'block';
  } else {
    authGate.classList.remove("hidden");
    appContent.classList.add("hidden");
    authNavBtn.textContent = 'Login ✧';
    historyBtn.style.display = 'none';
    logoutBtn.style.display = 'none';
  }
}

// Modal Toggles
document.getElementById("close-history").addEventListener("click", () => historyModal.classList.add("hidden"));
document.getElementById("gate-show-signup").addEventListener("click", () => {
  document.getElementById("gate-login").classList.add("hidden");
  document.getElementById("gate-signup").classList.remove("hidden");
});
document.getElementById("gate-show-login").addEventListener("click", () => {
  document.getElementById("gate-login").classList.remove("hidden");
  document.getElementById("gate-signup").classList.add("hidden");
});

// Login
gateLoginSubmit.addEventListener("click", async () => {
  const email = document.getElementById("gate-email").value;
  const password = document.getElementById("gate-password").value;
  
  try {
    const res = await fetch(`${BACKEND_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    
    updateUIForAuth(true);
    showToast("Welcome back!");
  } catch (err) {
    showToast(err.message);
  }
});

// Signup
gateSignupSubmit.addEventListener("click", async () => {
  const name = document.getElementById("gate-signup-name").value;
  const email = document.getElementById("gate-signup-email").value;
  const password = document.getElementById("gate-signup-password").value;
  
  try {
    const res = await fetch(`${BACKEND_URL}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    
    updateUIForAuth(true);
    showToast("Account created!");
  } catch (err) {
    showToast(err.message);
  }
});

// Logout
logoutBtn.addEventListener("click", () => {
  state.token = null;
  state.user = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  updateUIForAuth(false);
  showToast("Logged out");
});

// History Save
async function saveToHistory(caption) {
  try {
    await fetch(`${BACKEND_URL}/history`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.token}`
      },
      body: JSON.stringify({ caption_text: caption })
    });
  } catch (err) { console.error("History save failed", err); }
}

// History Fetch
historyBtn.addEventListener("click", async () => {
  historyModal.classList.remove("hidden");
  historyContent.innerHTML = "<p>Loading history...</p>";
  
  try {
    const res = await fetch(`${BACKEND_URL}/history`, {
      headers: { "Authorization": `Bearer ${state.token}` }
    });
    const data = await res.json();
    
    historyContent.innerHTML = "";
    if (data.length === 0) {
      historyContent.innerHTML = "<p>No history yet.</p>";
      return;
    }
    
    data.forEach(item => {
      const div = document.createElement("div");
      div.className = "history-item";
      div.innerHTML = `
        <div>
          <p>${escapeHtml(item.caption_text)}</p>
          <small>${new Date(item.created_at).toLocaleString()}</small>
        </div>
        <button class="btn-delete-small" onclick="deleteHistoryItem(${item.id})">Delete</button>
      `;
      historyContent.appendChild(div);
    });
  } catch (err) {
    historyContent.innerHTML = "<p>Error loading history.</p>";
  }
});

window.deleteHistoryItem = async (id) => {
  try {
    await fetch(`${BACKEND_URL}/history/${id}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${state.token}` }
    });
    historyBtn.click(); // Refresh
  } catch (err) { showToast("Delete failed"); }
};

document.getElementById("close-history").addEventListener("click", () => historyModal.classList.add("hidden"));

// Init
checkAuth();
