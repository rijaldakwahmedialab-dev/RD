/**
 * Rijal Dakwah Gantt Studio - NLE Timeline Engine
 * Features:
 * - Real 109 pengurus dataset from SK Sekretaris
 * - Premiere / DaVinci Resolve style NLE interface
 * - Dual View: Master Sequence (All Divisions) & Individual Division Tracks
 * - Pre-Event & Post-Event Footage blocks with D-Day Cross Dissolve Transition
 * - Intuitive Drag to Reschedule, Trim In/Out, and Razor Cut
 * - Member Overload / Clash Detection (Hazard stripes)
 * - Protected Editor Gate (Public Read-Only by default, PIN/Password for Kadiv & BPH)
 * - Firebase Firestore Realtime Sync with LocalStorage Fallback
 */

(function () {
  'use strict';

  // --- 1. FIREBASE CONFIG & INITIALIZATION ---
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBuYpiqn65YUrs4kzeByHS6uHVYTZt1vTU",
    authDomain: "rijal-dakwah-portal.firebaseapp.com",
    projectId: "rijal-dakwah-portal",
    storageBucket: "rijal-dakwah-portal.firebasestorage.app",
    messagingSenderId: "638998738133",
    appId: "1:638998738133:web:073e95ded4108ea3ce1e5c"
  };

  let db = null;
  let isFirebaseLive = false;

  try {
    if (typeof firebase !== 'undefined' && firebase.initializeApp) {
      if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      db = firebase.firestore();
      isFirebaseLive = true;
    }
  } catch (e) {
    console.warn("Firebase initialization fallback to LocalStorage:", e);
    isFirebaseLive = false;
  }

  // --- 2. APPLICATION STATE ---
  const state = {
    divisions: window.DATA_SK ? window.DATA_SK.divisions : [],
    members: window.DATA_SK ? window.DATA_SK.members : [],
    projects: [],
    tasks: [],
    currentProjectId: null,
    viewMode: 'division', // 'all' (Master View) | 'division' (Individual Division Track)
    activeDivisionId: 'media', // default division
    zoom: 46, // pixels per day
    activeTool: 'select', // 'select' (V), 'trim' (T), 'razor' (C), 'add' (+)
    isEditorUnlocked: false,
    editorRole: 'guest', // 'guest' | 'kadiv' | 'bph'
    editorDivisionId: null,
    editorName: null,
    playheadDayIndex: 12,
    snapping: true,
    soloTrackId: null,
    mutedTrackIds: new Set(),
    lockedTrackIds: new Set(),
    selectedTaskId: null,
    draggedClip: null,
    dragAction: null, // 'move' | 'trim-left' | 'trim-right'
    dragStartX: 0,
    dragStartY: 0,
    dragInitialStartDate: null,
    dragInitialDuration: 0,
    dragInitialMemberId: null,
    dragTargetTrackId: null,
    calendarCurrentDate: new Date(2026, 9, 1),
    filterSearch: ''
  };
  window.state = state;

  // --- 3. STORAGE & DATA SYNC ENGINE ---
  function loadData() {
    try {
      const localProjects = localStorage.getItem('rd_gantt_projects');
      const localTasks = localStorage.getItem('rd_gantt_tasks');

      if (localProjects && localTasks) {
        try {
          const p = JSON.parse(localProjects);
          const t = JSON.parse(localTasks);
          if (Array.isArray(p) && p.length > 0) {
            state.projects = p;
            state.tasks = Array.isArray(t) ? t : [];
          } else {
            throw new Error("Invalid local projects");
          }
        } catch (e) {
          if (window.INITIAL_SAMPLE) {
            state.projects = JSON.parse(JSON.stringify(window.INITIAL_SAMPLE.projects));
            state.tasks = JSON.parse(JSON.stringify(window.INITIAL_SAMPLE.tasks));
          }
        }
      } else if (window.INITIAL_SAMPLE) {
        state.projects = JSON.parse(JSON.stringify(window.INITIAL_SAMPLE.projects));
        state.tasks = JSON.parse(JSON.stringify(window.INITIAL_SAMPLE.tasks));
        persistData();
      }

      if (state.projects && state.projects.length > 0) {
        state.currentProjectId = state.projects[0].id;
      }
    } catch (err) {
      console.warn("loadData error:", err);
      if (window.INITIAL_SAMPLE) {
        state.projects = JSON.parse(JSON.stringify(window.INITIAL_SAMPLE.projects));
        state.tasks = JSON.parse(JSON.stringify(window.INITIAL_SAMPLE.tasks));
      }
    }

    // Attempt Firebase initial sync if online
    if (isFirebaseLive && db) {
      updateSyncBadge(true, "Mengecek Firebase...");
      db.collection("gantt_projects").limit(1).get()
        .then(snapshot => {
          if (!snapshot.empty) {
            // Listen to real-time updates
            listenToFirebase();
          } else {
            // Seed Firestore with initial sample if collection is empty
            seedFirestore();
          }
        })
        .catch(err => {
          console.warn("Firestore access permission fallback to local:", err.message);
          updateSyncBadge(false, "Offline / LocalStorage");
        });
    } else {
      updateSyncBadge(false, "Offline / LocalStorage");
    }
  }

  function persistData() {
    localStorage.setItem('rd_gantt_projects', JSON.stringify(state.projects));
    localStorage.setItem('rd_gantt_tasks', JSON.stringify(state.tasks));

    // Save to Firestore if connected and editor is active
    if (isFirebaseLive && db && state.isEditorUnlocked) {
      const proj = getCurrentProject();
      if (proj) {
        db.collection("gantt_projects").doc(proj.id).set(proj, { merge: true }).catch(() => {});
      }
      // Save current project tasks
      const currentTasks = state.tasks.filter(t => t.projectId === state.currentProjectId);
      const batch = db.batch();
      currentTasks.forEach(task => {
        const ref = db.collection("gantt_tasks").doc(task.id);
        batch.set(ref, task, { merge: true });
      });
      batch.commit().then(() => {
        updateSyncBadge(true, "Firebase Realtime Synced");
      }).catch(err => {
        console.warn("Firestore sync error:", err);
        updateSyncBadge(false, "Tersimpan Lokal");
      });
    }
  }

  function seedFirestore() {
    if (!db) return;
    const batch = db.batch();
    state.projects.forEach(p => {
      batch.set(db.collection("gantt_projects").doc(p.id), p);
    });
    state.tasks.forEach(t => {
      batch.set(db.collection("gantt_tasks").doc(t.id), t);
    });
    batch.commit().then(() => {
      updateSyncBadge(true, "Tersinkron ke Firebase");
      listenToFirebase();
    }).catch(e => {
      console.warn("Seed failed:", e);
      updateSyncBadge(false, "Tersimpan Lokal");
    });
  }

  function listenToFirebase() {
    if (!db) return;
    db.collection("gantt_tasks").where("projectId", "==", state.currentProjectId)
      .onSnapshot(snapshot => {
        if (!snapshot.empty) {
          const cloudTasks = [];
          snapshot.forEach(doc => cloudTasks.push(doc.data()));
          // Merge with other project tasks
          state.tasks = state.tasks.filter(t => t.projectId !== state.currentProjectId).concat(cloudTasks);
          renderTimeline();
          updateSyncBadge(true, "Firebase Live Sync");
        }
      }, err => {
        console.warn("Snapshot error:", err);
        updateSyncBadge(false, "Tersimpan Lokal");
      });
  }

  function updateSyncBadge(isLive, label) {
    const badge = document.getElementById('syncStatusBadge');
    if (!badge) return;
    if (isLive) {
      badge.className = "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-600/40";
      badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span>${label}</span>`;
    } else {
      badge.className = "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-950/80 text-amber-400 border border-amber-600/40";
      badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500"></span><span>${label}</span>`;
    }
  }

  // --- 4. DATE & TIMELINE MATH ---
  function getCurrentProject() {
    if (!state.projects || state.projects.length === 0) {
      if (window.INITIAL_SAMPLE && window.INITIAL_SAMPLE.projects && window.INITIAL_SAMPLE.projects.length > 0) {
        state.projects = JSON.parse(JSON.stringify(window.INITIAL_SAMPLE.projects));
      } else {
        return null;
      }
    }
    return state.projects.find(p => p.id === state.currentProjectId) || state.projects[0];
  }

  function parseDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return new Date();
    const parts = dateStr.split('-');
    if (parts.length < 3) return new Date();
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    const dt = new Date(y, m, d);
    return isNaN(dt.getTime()) ? new Date() : dt;
  }

  function formatDate(d) {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "2026-10-15";
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function addDays(dateStr, days) {
    const d = parseDate(dateStr);
    d.setDate(d.getDate() + (parseInt(days, 10) || 0));
    return formatDate(d);
  }

  function getDaysDifference(dateStr1, dateStr2) {
    const d1 = parseDate(dateStr1);
    const d2 = parseDate(dateStr2);
    const diffTime = d2.getTime() - d1.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24)) || 0;
  }

  function formatDisplayDate(dateStr) {
    const d = parseDate(dateStr);
    const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    return `${d.getDate()} ${months[d.getMonth()] || 'Okt'}`;
  }

  function formatDayName(dateStr) {
    const d = parseDate(dateStr);
    const days = ["Ahd", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
    return days[d.getDay()] || 'Sen';
  }

  function getProjectDDayDuration(proj) {
    if (!proj) return 1;
    return parseInt(proj.dDayDuration, 10) || 1;
  }

  function getProjectDDayEndDate(proj) {
    if (!proj) return '';
    const dur = getProjectDDayDuration(proj);
    return addDays(proj.dDayDate, dur - 1);
  }

  function isDateInDDay(dateStr, proj) {
    if (!proj || !proj.dDayDate) return false;
    const dur = getProjectDDayDuration(proj);
    const diff = getDaysDifference(proj.dDayDate, dateStr);
    return diff >= 0 && diff < dur;
  }

  function getRelativeDDayLabel(dateStr, projOrDDayStr) {
    if (!projOrDDayStr) return '';
    if (typeof projOrDDayStr === 'string') {
      const diff = getDaysDifference(projOrDDayStr, dateStr);
      if (diff === 0) return "HARI-H";
      if (diff < 0) return `H${diff}`;
      return `H+${diff}`;
    }
    const proj = projOrDDayStr;
    const dur = getProjectDDayDuration(proj);
    const diff = getDaysDifference(proj.dDayDate, dateStr);
    if (diff < 0) return `H${diff}`;
    if (diff < dur) {
      if (dur === 1) return "HARI-H";
      return `HARI-H (D${diff + 1})`;
    }
    const dDayEnd = addDays(proj.dDayDate, dur - 1);
    const diffAfter = getDaysDifference(dDayEnd, dateStr);
    return `H+${diffAfter}`;
  }

  function showToastNotification(message) {
    let toast = document.getElementById('globalToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'globalToast';
      toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[99999] px-4 py-2 rounded-xl bg-slate-950/95 border border-amber-400/80 text-amber-200 text-xs font-bold shadow-2xl backdrop-blur-md transition-all duration-300 pointer-events-none flex items-center gap-2';
      document.body.appendChild(toast);
    }
    toast.innerHTML = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translate(-50%, 0)';
    if (window._toastTimer) clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translate(-50%, 10px)';
    }, 2800);
  }

  // --- 5. INITIAL RENDERING & UI SETUP ---
  function init() {
    try { loadData(); } catch (e) { console.error("loadData error:", e); }
    try { populateProjectSelector(); } catch (e) { console.error("populateProjectSelector error:", e); }
    try { populateDivisionSelector(); } catch (e) { console.error("populateDivisionSelector error:", e); }
    try { setupEventListeners(); } catch (e) { console.error("setupEventListeners error:", e); }
    try { setupToolKeyboardShortcuts(); } catch (e) { console.error("setupToolKeyboardShortcuts error:", e); }
    try { setupContextMenu(); } catch (e) { console.error("setupContextMenu error:", e); }
    try { renderAll(); } catch (e) { console.error("renderAll error:", e); }
  }

  function renderAll() {
    updateEditorAuthBanner();
    renderTimelineHeader();
    renderMasterSequenceBar();
    renderTrackHeaders();
    renderTimeline();
    updateTimecodeHUD();
  }

  function populateProjectSelector() {
    const sel = document.getElementById('projectSelector');
    if (!sel) return;
    sel.innerHTML = state.projects.map(p => 
      `<option value="${p.id}" ${p.id === state.currentProjectId ? 'selected' : ''}>${p.title}</option>`
    ).join('');
  }

  function populateDivisionSelector() {
    const sel = document.getElementById('divisionSelector');
    if (!sel) return;
    let html = `<option value="all" ${state.viewMode === 'all' ? 'selected' : ''}>🎛️ Master Sequence (Seluruh Divisi)</option>`;
    html += `<optgroup label="Divisi Individual">`;
    state.divisions.forEach(d => {
      const isSel = state.viewMode === 'division' && state.activeDivisionId === d.id;
      html += `<option value="${d.id}" ${isSel ? 'selected' : ''}>${d.name}</option>`;
    });
    html += `</optgroup>`;
    sel.innerHTML = html;
  }

  function updateEditorAuthBanner() {
    const banner = document.getElementById('editorAuthBanner');
    const unlockBtn = document.getElementById('unlockEditorBtn');
    const lockBtn = document.getElementById('lockEditorBtn');
    const activeToolBar = document.getElementById('nleToolsBar');

    if (state.isEditorUnlocked) {
      const divName = (state.editorDivisionId || 'BPH').toUpperCase();
      const roleLabel = state.editorRole === 'bph' ? "👑 Super Admin BPH (Full Edit)" : `🎬 Kadiv ${divName} (${state.editorName || 'Editor'})`;
      banner.innerHTML = `
        <div class="flex items-center gap-2 text-xs font-bold text-amber-300">
          <span class="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping"></span>
          <span>MODE EDIT TERBUKA:</span>
          <span class="bg-amber-400/20 px-2 py-0.5 rounded text-amber-200 border border-amber-400/30">${roleLabel}</span>
        </div>
      `;
      unlockBtn.classList.add('hidden');
      lockBtn.classList.remove('hidden');
      activeToolBar.classList.remove('opacity-50', 'pointer-events-none');
    } else {
      banner.innerHTML = `
        <div class="flex items-center gap-2 text-xs text-slate-400 font-medium">
          <i class="fa-solid fa-eye text-emerald-400"></i>
          <span>Mode Publik (View Only) — Klik Buka Editor untuk Mengedit</span>
        </div>
      `;
      unlockBtn.classList.remove('hidden');
      lockBtn.classList.add('hidden');
      activeToolBar.classList.add('opacity-50', 'pointer-events-none');
    }
  }

  // --- 6. MASTER SEQUENCE BAR (PRE-EVENT, D-DAY TRANSITION, POST-EVENT) ---
  function renderMasterSequenceBar() {
    const proj = getCurrentProject();
    const container = document.getElementById('masterSequenceContainer');
    if (!container || !proj) return;

    const totalDays = getDaysDifference(proj.startDate, proj.endDate) + 1;
    const timelineWidth = totalDays * state.zoom;
    container.style.width = `${timelineWidth}px`;

    const dDayOffset = getDaysDifference(proj.startDate, proj.dDayDate);
    const dDayDur = getProjectDDayDuration(proj);
    const preDays = Math.max(0, dDayOffset);
    const postStartOffset = dDayOffset + dDayDur;
    const postDays = Math.max(0, totalDays - postStartOffset);

    const preWidth = preDays * state.zoom;
    const dDayWidth = dDayDur * state.zoom;
    const postWidth = postDays * state.zoom;

    container.innerHTML = `
      <!-- FOOTAGE 1: PRE-ACARA -->
      <div style="width: ${preWidth}px;" class="h-10 bg-emerald-950/70 border-y border-r border-emerald-600/40 flex items-center px-3 gap-2 filmstrip-border relative group cursor-pointer hover:bg-emerald-900/60 transition" onclick="window.focusPhase('pre')">
        <span class="text-xs font-bold text-emerald-400 flex items-center gap-1.5 truncate">
          <i class="fa-solid fa-film"></i> FOOTAGE 1: PRE-ACARA (PERSIAPAN & SYIAR)
        </span>
        <span class="text-[10px] bg-emerald-800/60 text-emerald-200 px-1.5 py-0.5 rounded font-mono flex-shrink-0">${preDays} Hari</span>
      </div>

      <!-- TRANSITION BLOCK: D-DAY MOMENT (Multi-Day Support) -->
      <div style="width: ${dDayWidth}px;" class="h-10 transition-block relative flex flex-col items-center justify-center cursor-pointer group hover:scale-[1.02] transition-all z-20" onclick="window.openDDayModal()">
        <div class="absolute -top-3 bg-rose-600 text-white text-[9px] font-black px-2 py-0.2 rounded shadow uppercase tracking-wider animate-pulse flex items-center gap-1">
          <span>D-DAY</span>
          ${dDayDur > 1 ? `<span class="bg-black/40 px-1 rounded text-[8px]">${dDayDur} HARI</span>` : ''}
        </div>
        <div class="text-amber-300 group-hover:text-amber-100 transition flex items-center gap-1">
          <i class="fa-solid fa-bolt text-xs"></i>
        </div>
        <span class="text-[9px] font-black text-white text-center leading-tight truncate px-1">
          ${dDayDur > 1 ? `EKSEKUSI D1 - D${dDayDur}` : 'DISSOLVE'}
        </span>
        <div class="absolute -bottom-5 opacity-0 group-hover:opacity-100 transition bg-slate-900 text-amber-300 text-[10px] px-2 py-0.5 rounded border border-amber-500/40 whitespace-nowrap shadow-xl z-50 pointer-events-none">
          Klik untuk Runway Checklist Hari-H ${dDayDur > 1 ? `(${dDayDur} Hari Acara)` : ''}
        </div>
      </div>

      <!-- FOOTAGE 2: PASCA-ACARA -->
      <div style="width: ${postWidth}px;" class="h-10 bg-indigo-950/70 border-y border-l border-indigo-600/40 flex items-center px-3 gap-2 filmstrip-border relative group cursor-pointer hover:bg-indigo-900/60 transition" onclick="window.focusPhase('post')">
        <span class="text-xs font-bold text-indigo-400 flex items-center gap-1.5 truncate">
          <i class="fa-solid fa-film"></i> FOOTAGE 2: PASCA-ACARA (LPJ & EVALUASI)
        </span>
        <span class="text-[10px] bg-indigo-800/60 text-indigo-200 px-1.5 py-0.5 rounded font-mono flex-shrink-0">${postDays} Hari</span>
      </div>
    `;
  }

  // --- 7. TIME RULER & PLAYHEAD ---
  function renderTimelineHeader() {
    const proj = getCurrentProject();
    const ruler = document.getElementById('timelineRuler');
    if (!ruler || !proj) return;

    const totalDays = getDaysDifference(proj.startDate, proj.endDate) + 1;
    const timelineWidth = totalDays * state.zoom;
    ruler.style.width = `${timelineWidth}px`;

    let html = '';
    for (let i = 0; i < totalDays; i++) {
      const curDate = addDays(proj.startDate, i);
      const isDDay = isDateInDDay(curDate, proj);
      const relLabel = getRelativeDDayLabel(curDate, proj);
      const dayName = formatDayName(curDate);
      const displayDate = formatDisplayDate(curDate);

      html += `
        <div style="width: ${state.zoom}px;" class="h-full flex-shrink-0 border-r border-amber-500/15 flex flex-col justify-between py-1 px-1 select-none ${isDDay ? 'bg-rose-950/40 border-rose-500/60' : (i % 2 === 0 ? 'bg-slate-900/40' : '')}" onclick="window.seekPlayhead(${i})">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-mono font-bold ${isDDay ? 'text-rose-400' : 'text-slate-400'}">${dayName}</span>
            <span class="text-[9px] font-mono px-1 rounded ${isDDay ? 'bg-rose-600 text-white font-bold' : 'text-amber-300/80 bg-amber-950/40'}">${relLabel}</span>
          </div>
          <div class="text-[11px] font-bold ${isDDay ? 'text-rose-300 font-extrabold' : 'text-slate-300'} text-center">${displayDate}</div>
        </div>
      `;
    }

    ruler.innerHTML = html;
  }

  function updateTimecodeHUD() {
    const proj = getCurrentProject();
    if (!proj) return;

    const curDate = addDays(proj.startDate, state.playheadDayIndex);
    const rel = getRelativeDDayLabel(curDate, proj);
    const hud = document.getElementById('timecodeDisplay');
    if (hud) {
      hud.innerHTML = `
        <span class="text-amber-400 font-black">${rel}</span>
        <span class="text-slate-500 mx-1">|</span>
        <span class="text-slate-300">${formatDate(parseDate(curDate))} (${formatDayName(curDate)})</span>
      `;
    }

    // Position playhead vertical line
    const playhead = document.getElementById('playheadContainer');
    if (playhead) {
      const posX = (state.playheadDayIndex * state.zoom) + (state.zoom / 2);
      playhead.style.left = `${posX}px`;
    }
  }
  // --- 8. TRACK HEADERS (LEFT SIDEBAR) ---
  function getActiveTracks() {
    if (state.viewMode === 'all') {
      return state.divisions.map(d => ({
        id: d.id,
        title: d.name,
        subtitle: `Divisi ${d.name}`,
        badge: "Divisi",
        icon: d.icon,
        color: d.color,
        isDivision: true
      }));
    } else {
      const divMembers = state.members.filter(m => m.divisionId === state.activeDivisionId);
      return divMembers.map((m, idx) => ({
        id: m.id,
        title: m.nama,
        subtitle: m.role,
        badge: m.isKadiv ? "KADIV (V1)" : `STAFF (V${idx + 1})`,
        icon: m.isKadiv ? "fa-star" : "fa-user",
        color: m.isKadiv ? "#C59B27" : "#10B981",
        isKadiv: m.isKadiv,
        isDivision: false
      }));
    }
  }

  function renderTrackHeaders() {
    const container = document.getElementById('trackHeadersContainer');
    if (!container) return;

    const tracks = getActiveTracks();
    const proj = getCurrentProject();
    const projTasks = state.tasks.filter(t => t.projectId === proj.id);

    let html = '';
    tracks.forEach(track => {
      const isSolo = state.soloTrackId === track.id;
      const isMuted = state.mutedTrackIds.has(track.id);
      const isLocked = state.lockedTrackIds.has(track.id);

      // Count tasks & detect overload
      let activeJobsCount = 0;
      if (track.isDivision) {
        activeJobsCount = projTasks.filter(t => t.divisionId === track.id).length;
      } else {
        activeJobsCount = projTasks.filter(t => t.memberId === track.id).length;
      }

      const isOverload = !track.isDivision && activeJobsCount >= 3;

      html += `
        <div class="timeline-track-row member-drag-card flex items-center justify-between px-3 relative border-r border-amber-500/20 ${isMuted ? 'opacity-40 bg-slate-900/60' : ''} ${isSolo ? 'bg-amber-950/30' : ''}" data-track-id="${track.id}" draggable="true" ondragstart="window.handleMemberDragStart(event, '${track.id}')" title="Tarik nama ini ke timeline untuk membuat tugas baru!">
          <!-- Track Info -->
          <div class="flex items-center gap-2 min-w-0 pr-2">
            <i class="fa-solid fa-grip-vertical text-[11px] text-slate-500 hover:text-amber-400 cursor-grab flex-shrink-0" title="Tarik ke timeline"></i>
            <div class="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shadow-md flex-shrink-0" style="background-color: ${track.color}25; color: ${track.color}; border: 1px solid ${track.color}50;">
              <i class="fa-solid ${track.icon}"></i>
            </div>
            <div class="truncate">
              <div class="flex items-center gap-1.5">
                <span class="text-xs font-bold text-slate-200 truncate hover:text-amber-300 transition cursor-default" title="${track.title}">${track.title}</span>
                ${isOverload ? '<span class="text-[9px] bg-rose-900/80 text-rose-300 border border-rose-500/50 px-1 py-0.2 rounded font-mono font-bold animate-pulse">⚠️ OVERLOAD</span>' : ''}
              </div>
              <div class="text-[10px] text-slate-400 truncate flex items-center gap-1">
                <span class="text-amber-400/80 font-mono">${track.badge}</span>
                <span>•</span>
                <span>${activeJobsCount} Task</span>
              </div>
            </div>
          </div>

          <!-- NLE Track Controls (Solo, Mute, Lock) -->
          <div class="flex items-center gap-1 flex-shrink-0">
            <button onclick="window.toggleMuteTrack('${track.id}')" title="Mute/Sembunyikan Track" class="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold transition ${isMuted ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'}">
              M
            </button>
            <button onclick="window.toggleSoloTrack('${track.id}')" title="Solo Track" class="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold transition ${isSolo ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'}">
              S
            </button>
            <button onclick="window.toggleLockTrack('${track.id}')" title="Kunci Track" class="w-6 h-6 rounded flex items-center justify-center text-[10px] transition ${isLocked ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'}">
              <i class="fa-solid ${isLocked ? 'fa-lock' : 'fa-lock-open'}"></i>
            </button>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  // --- 9. TIMELINE TRACK CANVAS & CLIPS ---
  function renderTimeline() {
    const proj = getCurrentProject();
    const container = document.getElementById('timelineCanvas');
    if (!container || !proj) return;

    const totalDays = getDaysDifference(proj.startDate, proj.endDate) + 1;
    const timelineWidth = totalDays * state.zoom;
    container.style.width = `${timelineWidth}px`;

    const tracks = getActiveTracks();
    const projTasks = state.tasks.filter(t => t.projectId === proj.id);

    let html = '';

    tracks.forEach(track => {
      const isMuted = state.mutedTrackIds.has(track.id);
      const isLocked = state.lockedTrackIds.has(track.id);

      // Filter tasks for this track
      let trackTasks = [];
      if (track.isDivision) {
        trackTasks = projTasks.filter(t => t.divisionId === track.id);
      } else {
        trackTasks = projTasks.filter(t => t.memberId === track.id);
      }

      // Check if hidden by Solo
      if (state.soloTrackId && state.soloTrackId !== track.id) {
        html += `<div class="timeline-track-row relative opacity-10 bg-black/50" style="width: ${timelineWidth}px;"></div>`;
        return;
      }

      html += `
        <div class="timeline-track-row relative ${isMuted ? 'opacity-20 pointer-events-none' : ''}" style="width: ${timelineWidth}px;" data-track-id="${track.id}" ondragover="window.handleTrackDragOver(event)" ondragleave="window.handleTrackDragLeave(event)" ondrop="window.handleTrackDrop(event, '${track.id}')" ondblclick="window.handleTrackDoubleClick(event, '${track.id}')">
          <div class="absolute inset-0 flex pointer-events-none">
            ${Array.from({ length: totalDays }).map((_, i) => {
              const curDate = addDays(proj.startDate, i);
              const isDDay = isDateInDDay(curDate, proj);
              return `<div style="width: ${state.zoom}px;" class="h-full border-r border-amber-500/10 ${isDDay ? 'bg-rose-950/20' : ''}"></div>`;
            }).join('')}
          </div>

          <!-- Task Clips Container -->
          <div class="absolute inset-0">
            ${trackTasks.map(task => renderTaskClip(task, proj, isLocked)).join('')}
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  function renderTaskClip(task, proj, isLocked) {
    const dayOffset = getDaysDifference(proj.startDate, task.startDate);
    const left = dayOffset * state.zoom;
    const width = task.duration * state.zoom;
    const isSelected = state.selectedTaskId === task.id;

    // Detect member clash in division mode
    const isClash = detectTaskClash(task, proj);

    const statusPill = {
      'completed': 'bg-emerald-800 text-emerald-200 border-emerald-500/50',
      'in_progress': 'bg-amber-800 text-amber-200 border-amber-500/50',
      'todo': 'bg-slate-700 text-slate-300 border-slate-500/50'
    }[task.status] || 'bg-slate-700 text-slate-300';

    return `
      <div 
        id="clip_${task.id}"
        class="nle-clip ${isSelected ? 'selected' : ''} ${isClash ? 'clash-warning-stripes' : ''}" 
        style="left: ${left}px; width: ${width}px; background-color: ${task.color || '#1B4D3E'};"
        data-task-id="${task.id}"
        onmousedown="window.handleClipMouseDown(event, '${task.id}')"
        onclick="window.handleClipClick(event, '${task.id}')"
        ondblclick="window.openInspectorModal('${task.id}')"
      >
        <!-- Top Colored Progress Ribbon -->
        <div class="h-1.5 w-full bg-black/30 relative">
          <div class="h-full bg-amber-400" style="width: ${task.progress || 0}%;"></div>
        </div>

        <!-- Content Area -->
        <div class="px-2.5 py-1 flex items-center justify-between text-white relative z-10">
          <div class="truncate mr-2">
            <div class="text-[11px] font-bold leading-tight truncate drop-shadow">${task.title}</div>
            <div class="text-[9px] text-white/75 font-mono truncate">${task.duration} Hari | ${task.progress}%</div>
          </div>
          <span class="text-[9px] px-1 py-0.2 rounded border font-mono uppercase font-bold flex-shrink-0 ${statusPill}">
            ${task.status === 'in_progress' ? 'Running' : task.status}
          </span>
        </div>

        <!-- Trim Handles (Interactive in Editor Mode) -->
        ${state.isEditorUnlocked && !isLocked ? `
          <div class="trim-handle trim-handle-left" onmousedown="window.handleTrimMouseDown(event, '${task.id}', 'left')"></div>
          <div class="trim-handle trim-handle-right" onmousedown="window.handleTrimMouseDown(event, '${task.id}', 'right')"></div>
        ` : ''}
      </div>
    `;
  }

  function detectTaskClash(task, proj) {
    if (state.viewMode === 'all') return false;
    const sameMemberTasks = state.tasks.filter(t => t.projectId === proj.id && t.memberId === task.memberId && t.id !== task.id);
    const start1 = parseDate(task.startDate);
    const end1 = parseDate(addDays(task.startDate, task.duration));

    for (let other of sameMemberTasks) {
      const start2 = parseDate(other.startDate);
      const end2 = parseDate(addDays(other.startDate, other.duration));
      if (start1 < end2 && end1 > start2) {
        return true; // Overlap detected!
      }
    }
    return false;
  }

  // --- 10. INTERACTION ENGINE: DRAG, TRIM, RAZOR, QUICK ADD ---
  window.handleClipMouseDown = function (e, taskId) {
    if (!state.isEditorUnlocked) return;
    if (e.target.classList.contains('trim-handle')) return; // handled separately

    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    if (state.activeTool === 'razor') {
      // Split task on click!
      handleRazorSplit(e, task);
      return;
    }

    if (state.activeTool === 'select') {
      const wrapper = document.getElementById('timelineScrollWrapper');
      state.draggedClip = task;
      state.dragAction = 'move';
      state.dragStartX = e.clientX;
      state.dragStartY = e.clientY;
      state.dragStartScrollLeft = wrapper ? wrapper.scrollLeft : 0;
      state.dragInitialStartDate = task.startDate;
      state.dragInitialMemberId = task.memberId;
      state.dragInitialDuration = task.duration;

      updateDragGhost(e, task, task.startDate, null);

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
  };

  window.handleTrimMouseDown = function (e, taskId, handleSide) {
    e.stopPropagation();
    if (!state.isEditorUnlocked) return;

    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const wrapper = document.getElementById('timelineScrollWrapper');
    state.draggedClip = task;
    state.dragAction = handleSide === 'left' ? 'trim-left' : 'trim-right';
    state.dragStartX = e.clientX;
    state.dragStartScrollLeft = wrapper ? wrapper.scrollLeft : 0;
    state.dragInitialStartDate = task.startDate;
    state.dragInitialDuration = task.duration;

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  let autoScrollTimer = null;
  let autoScrollSpeed = 0;
  let lastDragMouseEvent = null;

  function updateAutoScroll(e) {
    lastDragMouseEvent = e;
    const wrapper = document.getElementById('timelineScrollWrapper');
    if (!wrapper || !state.draggedClip) {
      stopAutoScroll();
      return;
    }

    const rect = wrapper.getBoundingClientRect();
    const threshold = 70; // px from edge

    if (e.clientX > rect.right - threshold) {
      const ratio = Math.max(0.1, (e.clientX - (rect.right - threshold)) / threshold);
      autoScrollSpeed = Math.max(8, Math.min(36, Math.round(ratio * 36)));
      startAutoScroll(wrapper);
    } else if (e.clientX < rect.left + threshold) {
      const ratio = Math.max(0.1, ((rect.left + threshold) - e.clientX) / threshold);
      autoScrollSpeed = -Math.max(8, Math.min(36, Math.round(ratio * 36)));
      startAutoScroll(wrapper);
    } else {
      stopAutoScroll();
    }
  }

  function startAutoScroll(wrapper) {
    if (autoScrollTimer) return;
    autoScrollTimer = setInterval(() => {
      if (!state.draggedClip) {
        stopAutoScroll();
        return;
      }
      wrapper.scrollLeft += autoScrollSpeed;
      if (lastDragMouseEvent) {
        onMouseMove(lastDragMouseEvent);
      }
    }, 25);
  }

  function stopAutoScroll() {
    clearInterval(autoScrollTimer);
    autoScrollTimer = null;
    autoScrollSpeed = 0;
  }

  function updateDragGhost(e, task, targetDateStr, targetMemberName) {
    const ghost = document.getElementById('dragGhostBadge');
    if (!ghost) return;

    if (!state.draggedClip) {
      ghost.classList.add('hidden');
      return;
    }

    ghost.classList.remove('hidden');
    ghost.style.left = (e.clientX + 16) + 'px';
    ghost.style.top = (e.clientY + 16) + 'px';

    const titleEl = document.getElementById('dragGhostTitle');
    const subEl = document.getElementById('dragGhostSubtitle');
    if (titleEl) titleEl.innerText = task.title || 'Tugas';
    if (subEl) {
      const dateLabel = targetDateStr ? formatDisplayDate(targetDateStr) : '';
      subEl.innerHTML = `<span class="text-amber-300 font-bold">${task.duration} Hari</span> • <span>${dateLabel}</span> ${targetMemberName ? `• <span class="text-emerald-300 font-bold">${targetMemberName}</span>` : ''}`;
    }
  }

  function hideDragGhost() {
    const ghost = document.getElementById('dragGhostBadge');
    if (ghost) ghost.classList.add('hidden');
  }

  function onMouseMove(e) {
    if (!state.draggedClip || !state.dragAction) return;

    updateAutoScroll(e);

    const wrapper = document.getElementById('timelineScrollWrapper');
    const scrollDelta = wrapper ? (wrapper.scrollLeft - (state.dragStartScrollLeft || 0)) : 0;
    const deltaX = (e.clientX - state.dragStartX) + scrollDelta;
    const deltaDays = Math.round(deltaX / state.zoom);

    if (state.dragAction === 'move') {
      const newStartDate = addDays(state.dragInitialStartDate, deltaDays);
      state.draggedClip.startDate = newStartDate;

      // Detect vertical track row under cursor (lempar tugas ke anggota/track lain)
      const elBelow = document.elementFromPoint(e.clientX, e.clientY);
      const trackRow = elBelow ? elBelow.closest('.timeline-track-row') : null;
      document.querySelectorAll('.timeline-track-row').forEach(r => r.classList.remove('drag-over-active'));
      let targetName = null;
      if (trackRow) {
        trackRow.classList.add('drag-over-active');
        state.dragTargetTrackId = trackRow.getAttribute('data-track-id');
        if (state.viewMode === 'division') {
          targetName = state.members.find(m => m.id === state.dragTargetTrackId)?.nama;
        } else {
          targetName = state.divisions.find(d => d.id === state.dragTargetTrackId)?.name;
        }
      } else {
        state.dragTargetTrackId = null;
      }
      updateDragGhost(e, state.draggedClip, newStartDate, targetName);
      renderTimeline();
    } else if (state.dragAction === 'trim-right') {
      const newDuration = Math.max(1, state.dragInitialDuration + deltaDays);
      state.draggedClip.duration = newDuration;
      updateDragGhost(e, state.draggedClip, state.draggedClip.startDate, null);
      renderTimeline();
    } else if (state.dragAction === 'trim-left') {
      const newDuration = Math.max(1, state.dragInitialDuration - deltaDays);
      const newStartDate = addDays(state.dragInitialStartDate, deltaDays);
      state.draggedClip.startDate = newStartDate;
      state.draggedClip.duration = newDuration;
      updateDragGhost(e, state.draggedClip, newStartDate, null);
      renderTimeline();
    }
  }

  function onMouseUp() {
    stopAutoScroll();
    hideDragGhost();
    if (state.draggedClip) {
      if (state.dragAction === 'move' && state.dragTargetTrackId) {
        if (state.viewMode === 'all') {
          state.draggedClip.divisionId = state.dragTargetTrackId;
        } else {
          state.draggedClip.memberId = state.dragTargetTrackId;
          const member = state.members.find(m => m.id === state.dragTargetTrackId);
          if (member) state.draggedClip.divisionId = member.divisionId;
        }
      }
      document.querySelectorAll('.timeline-track-row').forEach(r => r.classList.remove('drag-over-active'));
      persistData();
      state.draggedClip = null;
      state.dragAction = null;
      state.dragTargetTrackId = null;
      renderAll();
    }
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  function handleRazorSplit(e, task) {
    const proj = getCurrentProject();
    const clipEl = document.getElementById(`clip_${task.id}`);
    if (!clipEl) return;

    const rect = clipEl.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const splitDayOffset = Math.floor(clickX / state.zoom);

    if (splitDayOffset <= 0 || splitDayOffset >= task.duration) {
      showToastNotification("⚠️ Klik di tengah tugas untuk membelahnya!");
      return;
    }

    const firstDuration = splitDayOffset;
    const secondDuration = task.duration - splitDayOffset;
    const secondStartDate = addDays(task.startDate, splitDayOffset);

    // Update first task
    task.duration = firstDuration;

    // Create second split task
    const newTask = {
      ...JSON.parse(JSON.stringify(task)),
      id: "task_" + Date.now(),
      title: `${task.title} (Fase 2)`,
      startDate: secondStartDate,
      duration: secondDuration,
      progress: 0,
      status: 'todo'
    };

    state.tasks.push(newTask);
    persistData();
    renderAll();

    // Visual Cut Flash
    clipEl.classList.add('ring-4', 'ring-rose-500');
    setTimeout(() => {
      clipEl.classList.remove('ring-4', 'ring-rose-500');
    }, 300);
  }

  window.handleTrackDoubleClick = function (e, trackId) {
    if (!state.isEditorUnlocked) {
      window.openEditorPasscodeModal();
      return;
    }

    const proj = getCurrentProject();
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const dayIndex = Math.max(0, Math.floor(clickX / state.zoom));
    const startDate = addDays(proj.startDate, dayIndex);

    // Create new quick clip
    let divisionId = state.activeDivisionId;
    let memberId = trackId;

    if (state.viewMode === 'all') {
      divisionId = trackId;
      const divFirstMember = state.members.find(m => m.divisionId === divisionId);
      memberId = divFirstMember ? divFirstMember.id : state.members[0].id;
    }

    const newTask = {
      id: "task_" + Date.now(),
      projectId: proj.id,
      divisionId: divisionId,
      memberId: memberId,
      title: "Tugas Baru",
      phase: dayIndex < getDaysDifference(proj.startDate, proj.dDayDate) ? "pre" : "post",
      startDate: startDate,
      duration: 4,
      progress: 0,
      color: "#1B4D3E",
      status: "todo"
    };

    state.tasks.push(newTask);
    persistData();
    renderAll();
    window.openInspectorModal(newTask.id);
  };

  // --- 11. PLAYHEAD SCRUBBER ---
  window.seekPlayhead = function (dayIndex) {
    state.playheadDayIndex = dayIndex;
    updateTimecodeHUD();
  };

  // --- 12. TRACK CONTROLS (MUTE, SOLO, LOCK) ---
  window.toggleMuteTrack = function (trackId) {
    if (state.mutedTrackIds.has(trackId)) {
      state.mutedTrackIds.delete(trackId);
    } else {
      state.mutedTrackIds.add(trackId);
    }
    renderTrackHeaders();
    renderTimeline();
  };

  window.toggleSoloTrack = function (trackId) {
    state.soloTrackId = state.soloTrackId === trackId ? null : trackId;
    renderTrackHeaders();
    renderTimeline();
  };

  window.toggleLockTrack = function (trackId) {
    if (state.lockedTrackIds.has(trackId)) {
      state.lockedTrackIds.delete(trackId);
    } else {
      state.lockedTrackIds.add(trackId);
    }
    renderTrackHeaders();
    renderTimeline();
  };

  // --- 13. PASSCODE & EDITOR UNLOCK GATE ---
  window.openEditorPasscodeModal = function () {
    const modal = document.getElementById('passcodeModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
      modal.style.zIndex = '99999';
      const input = document.getElementById('passcodeInput');
      if (input) {
        input.value = '';
        input.focus();
      }
    }
  };

  window.closeEditorPasscodeModal = function () {
    const modal = document.getElementById('passcodeModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  };

  window.submitEditorPasscode = function () {
    const input = document.getElementById('passcodeInput');
    const pass = (input ? input.value : '').trim().toLowerCase();

    // Check Master Superadmin PIN/Pass
    if (pass === 'bph2026' || pass === '123456') {
      state.isEditorUnlocked = true;
      state.editorRole = 'bph';
      state.editorDivisionId = 'all';
      state.editorName = 'Badan Pengurus Harian';
      window.closeEditorPasscodeModal();
      renderAll();
      showToastNotification("✅ Akses Editor Terbuka: Master BPH (Akses Penuh)");
      return;
    }

    // Check Division Passcodes
    const matchedDiv = state.divisions.find(d => d.pass && d.pass.toLowerCase() === pass);
    if (matchedDiv) {
      state.isEditorUnlocked = true;
      state.editorRole = 'kadiv';
      state.editorDivisionId = matchedDiv.id;
      // Find kadiv name
      const kadiv = state.members.find(m => m.divisionId === matchedDiv.id && m.isKadiv);
      state.editorName = kadiv ? kadiv.nama : matchedDiv.name;
      state.viewMode = 'division';
      state.activeDivisionId = matchedDiv.id;

      window.closeEditorPasscodeModal();
      populateDivisionSelector();
      renderAll();
      showToastNotification(`✅ Akses Editor Terbuka: ${matchedDiv.name} (${state.editorName})`);
      return;
    }

    showToastNotification("❌ Password / PIN salah! (Tips BPH: bph2026 / 123456)");
  };

  window.lockEditor = function () {
    state.isEditorUnlocked = false;
    state.editorRole = 'guest';
    state.editorDivisionId = null;
    state.editorName = null;
    renderAll();
  };

  // --- 14. CLIP INSPECTOR MODAL ---
  window.openInspectorModal = function (taskId) {
    state.selectedTaskId = taskId;
    renderTimeline(); // update selection outline

    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const modal = document.getElementById('inspectorModal');
    if (!modal) return;

    // Fill form fields
    document.getElementById('editTaskId').value = task.id;
    document.getElementById('editTaskTitle').value = task.title;
    document.getElementById('editTaskStatus').value = task.status;
    document.getElementById('editTaskProgress').value = task.progress || 0;
    document.getElementById('editTaskProgressDisplay').innerText = `${task.progress || 0}%`;
    document.getElementById('editTaskStartDate').value = task.startDate;
    document.getElementById('editTaskDuration').value = task.duration;
    document.getElementById('editTaskColor').value = task.color || '#1B4D3E';

    // Populate Member dropdown with 109 pengurus
    const memberSelect = document.getElementById('editTaskMember');
    if (memberSelect) {
      memberSelect.innerHTML = state.members.map(m => {
        const isSel = m.id === task.memberId;
        const divObj = state.divisions.find(d => d.id === m.divisionId);
        const divName = divObj ? divObj.name : m.divisionId;
        return `<option value="${m.id}" ${isSel ? 'selected' : ''}>${m.nama} — [${divName} - ${m.role}]</option>`;
      }).join('');
    }

    // Toggle save button based on editor lock
    const saveBtn = document.getElementById('inspectorSaveBtn');
    const delBtn = document.getElementById('inspectorDeleteBtn');
    if (saveBtn) saveBtn.disabled = !state.isEditorUnlocked;
    if (delBtn) delBtn.disabled = !state.isEditorUnlocked;

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    modal.style.zIndex = '99999';
  };

  window.closeInspectorModal = function () {
    const modal = document.getElementById('inspectorModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  };

  window.saveTaskInspector = function () {
    if (!state.isEditorUnlocked) {
      showToastNotification("🔒 Buka gembok editor terlebih dahulu untuk menyimpan.");
      return;
    }

    const taskId = document.getElementById('editTaskId').value;
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.title = document.getElementById('editTaskTitle').value;
    task.status = document.getElementById('editTaskStatus').value;
    task.progress = parseInt(document.getElementById('editTaskProgress').value, 10) || 0;
    task.startDate = document.getElementById('editTaskStartDate').value;
    task.duration = parseInt(document.getElementById('editTaskDuration').value, 10) || 1;
    task.color = document.getElementById('editTaskColor').value;
    task.memberId = document.getElementById('editTaskMember').value;

    // Update divisionId based on selected member
    const member = state.members.find(m => m.id === task.memberId);
    if (member) {
      task.divisionId = member.divisionId;
    }

    persistData();
    window.closeInspectorModal();
    renderAll();
  };

  window.deleteTaskInspector = function () {
    if (!state.isEditorUnlocked) return;
    const taskId = document.getElementById('editTaskId').value;
    if (confirm("Hapus tugas ini dari timeline?")) {
      state.tasks = state.tasks.filter(t => t.id !== taskId);
      persistData();
      window.closeInspectorModal();
      renderAll();
    }
  };

  // --- 15. D-DAY TRANSITION RUNWAY CHECKLIST MODAL ---
  window.openDDayModal = function (selectedDayOffset = 0) {
    const proj = getCurrentProject();
    const modal = document.getElementById('dDayChecklistModal');
    if (!modal || !proj) return;

    const dur = getProjectDDayDuration(proj);
    const tabsContainer = document.getElementById('dDayModalDaysTabs');

    if (tabsContainer) {
      if (dur > 1) {
        tabsContainer.classList.remove('hidden');
        let tabsHtml = '';
        for (let i = 0; i < dur; i++) {
          const dStr = addDays(proj.dDayDate, i);
          const isActive = i === selectedDayOffset;
          tabsHtml += `
            <button onclick="window.openDDayModal(${i})" class="px-3 py-1 rounded-lg text-xs font-bold font-mono transition ${isActive ? 'bg-rose-600 text-white shadow-md' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">
              Day ${i + 1} (${formatDisplayDate(dStr)})
            </button>
          `;
        }
        tabsContainer.innerHTML = tabsHtml;
      } else {
        tabsContainer.classList.add('hidden');
        tabsContainer.innerHTML = '';
      }
    }

    const currentSelectedDate = addDays(proj.dDayDate, selectedDayOffset);
    document.getElementById('dDayModalDateLabel').innerText = `${formatDate(parseDate(currentSelectedDate))} (${formatDayName(currentSelectedDate)}) ${dur > 1 ? `[Hari ke-${selectedDayOffset + 1} dari ${dur} Hari Acara]` : ''}`;
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    modal.style.zIndex = '99999';
  };

  window.closeDDayModal = function () {
    const modal = document.getElementById('dDayChecklistModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  };

  // --- 16. EVENT LISTENERS & SHORTCUTS ---
  function setupEventListeners() {
    // Project switcher
    const projSel = document.getElementById('projectSelector');
    if (projSel) {
      projSel.addEventListener('change', (e) => {
        state.currentProjectId = e.target.value;
        renderAll();
      });
    }

    // Division switcher
    const divSel = document.getElementById('divisionSelector');
    if (divSel) {
      divSel.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'all') {
          state.viewMode = 'all';
        } else {
          state.viewMode = 'division';
          state.activeDivisionId = val;
        }
        renderAll();
      });
    }

    // Zoom slider
    const zoomSlider = document.getElementById('zoomSlider');
    if (zoomSlider) {
      zoomSlider.value = state.zoom;
      zoomSlider.addEventListener('input', (e) => {
        state.zoom = parseInt(e.target.value, 10);
        renderTimelineHeader();
        renderMasterSequenceBar();
        renderTimeline();
        updateTimecodeHUD();
      });
    }

    // Tool selectors
    const toolBtns = document.querySelectorAll('[data-tool]');
    toolBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.getAttribute('data-tool');
        setActiveTool(tool);
      });
    });

    // Inspector Progress slider text update
    const progSlider = document.getElementById('editTaskProgress');
    if (progSlider) {
      progSlider.addEventListener('input', (e) => {
        document.getElementById('editTaskProgressDisplay').innerText = `${e.target.value}%`;
      });
    }

    // Explicit click listeners for Event Baru & Kalender Event buttons
    const btnNewProj = document.getElementById('btnOpenNewProject');
    if (btnNewProj) {
      btnNewProj.onclick = (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        window.openNewProjectModal();
      };
    }

    const btnCal = document.getElementById('btnOpenCalendar');
    if (btnCal) {
      btnCal.onclick = (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        window.openEventCalendarModal();
      };
    }
  }

  function setActiveTool(tool) {
    state.activeTool = tool;
    const toolBtns = document.querySelectorAll('[data-tool]');
    toolBtns.forEach(btn => {
      if (btn.getAttribute('data-tool') === tool) {
        btn.classList.add('bg-amber-500', 'text-black', 'font-black');
        btn.classList.remove('bg-slate-800', 'text-slate-300');
      } else {
        btn.classList.remove('bg-amber-500', 'text-black', 'font-black');
        btn.classList.add('bg-slate-800', 'text-slate-300');
      }
    });

    // Apply cursor styling
    const canvas = document.getElementById('timelineCanvas');
    if (canvas) {
      if (tool === 'razor') {
        canvas.classList.add('cursor-razor');
      } else {
        canvas.classList.remove('cursor-razor');
      }
    }
  }

  function setupToolKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Ignore if typing in input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      // Spacebar: Playhead lompat ke tanggal Hari Ini
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        window.jumpPlayheadToToday();
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'v') setActiveTool('select');
      if (key === 't') setActiveTool('trim');
      if (key === 'c') setActiveTool('razor');
      if (key === 'm') {
        state.snapping = !state.snapping;
        showToastNotification(`🧲 Snapping: ${state.snapping ? 'AKTIF' : 'NONAKTIF'}`);
      }
      if (key === 'l' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        window.openEditorPasscodeModal();
      }
    });
  }

  window.jumpPlayheadToToday = function () {
    const proj = getCurrentProject();
    if (!proj) return;

    const today = new Date();
    const todayStr = formatDate(today);
    const totalDays = getDaysDifference(proj.startDate, proj.endDate) + 1;
    let dayIndex = getDaysDifference(proj.startDate, todayStr);

    let isOutOfRange = false;
    if (dayIndex < 0) {
      dayIndex = 0;
      isOutOfRange = true;
    } else if (dayIndex >= totalDays) {
      dayIndex = totalDays - 1;
      isOutOfRange = true;
    }

    state.playheadDayIndex = dayIndex;
    updateTimecodeHUD();

    // Smoothly scroll wrapper to center on playhead
    const wrapper = document.getElementById('timelineScrollWrapper');
    if (wrapper) {
      const posX = (dayIndex * state.zoom) + (state.zoom / 2);
      const targetScroll = Math.max(0, posX - (wrapper.clientWidth / 2));
      wrapper.scrollTo({ left: targetScroll, behavior: 'smooth' });
    }

    // Visual toast feedback
    showToastNotification(isOutOfRange ? 
      `📍 Hari ini (${formatDisplayDate(todayStr)}) di luar rentang proker. Playhead diarahkan ke tanggal terdekat.` : 
      `📍 Playhead melompat ke Hari Ini: ${formatDisplayDate(todayStr)}`
    );
  };

  // Focus on Pre/Post phase
  window.focusPhase = function (phase) {
    const proj = getCurrentProject();
    if (!proj) return;
    if (phase === 'pre') {
      window.seekPlayhead(0);
    } else {
      const dDayOffset = getDaysDifference(proj.startDate, proj.dDayDate);
      window.seekPlayhead(dDayOffset + 1);
    }
  };

  // Export / Import Data
  window.exportGanttData = function () {
    const payload = {
      projects: state.projects,
      tasks: state.tasks
    };
    const str = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
    const a = document.createElement('a');
    a.setAttribute("href", str);
    a.setAttribute("download", `rijal-dakwah-gantt-backup-${Date.now()}.json`);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  window.resetSampleData = function () {
    if (confirm("Reset ulang semua data ke contoh proker default?")) {
      localStorage.removeItem('rd_gantt_projects');
      localStorage.removeItem('rd_gantt_tasks');
      loadData();
      renderAll();
      showToastNotification("✅ Data berhasil di-reset!");
    }
  };

  // --- 17. MEMBER DRAG TO TIMELINE (CREATION ENGINE) ---
  window.handleMemberDragStart = function (e, trackId) {
    if (!state.isEditorUnlocked) {
      e.preventDefault();
      window.openEditorPasscodeModal();
      return;
    }
    e.dataTransfer.setData('text/plain', trackId);
    e.dataTransfer.setData('memberId', trackId);
    e.dataTransfer.effectAllowed = 'copy';
  };

  window.handleTrackDragOver = function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const row = e.currentTarget;
    if (row) row.classList.add('drag-over-active');
  };

  window.handleTrackDragLeave = function (e) {
    const row = e.currentTarget;
    if (row) row.classList.remove('drag-over-active');
  };

  window.handleTrackDrop = function (e, trackId) {
    e.preventDefault();
    const row = e.currentTarget;
    if (row) row.classList.remove('drag-over-active');

    const draggedMemberId = e.dataTransfer.getData('memberId') || e.dataTransfer.getData('text/plain');
    if (!draggedMemberId) return;

    const proj = getCurrentProject();
    const rect = row.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const dayIndex = Math.max(0, Math.floor(clickX / state.zoom));
    const startDate = addDays(proj.startDate, dayIndex);

    let targetMemberId = state.viewMode === 'division' ? trackId : draggedMemberId;
    let targetDivisionId = state.activeDivisionId;

    const member = state.members.find(m => m.id === targetMemberId);
    if (member) {
      targetDivisionId = member.divisionId;
    }

    const dDayOffset = getDaysDifference(proj.startDate, proj.dDayDate);
    const phase = dayIndex < dDayOffset ? 'pre' : (dayIndex === dDayOffset ? 'dday' : 'post');

    const newTask = {
      id: "task_" + Date.now(),
      projectId: proj.id,
      divisionId: targetDivisionId,
      memberId: targetMemberId,
      title: `Tugas Baru - ${member ? member.nama.split(' ')[0] : 'Anggota'}`,
      phase: phase,
      startDate: startDate,
      duration: 4,
      progress: 0,
      color: "#1B4D3E",
      status: "todo"
    };

    state.tasks.push(newTask);
    persistData();
    renderAll();
    window.openInspectorModal(newTask.id);
  };

  // --- 18. CUSTOM CONTEXT MENU (WINDOWS 11 / NLE STYLE) ---
  let contextMenuTargetData = null;

  let _lastContextMenuTime = 0;

  function setupContextMenu() {
    const menuEl = document.getElementById('customContextMenu');
    if (!menuEl) return;

    window.addEventListener('contextmenu', (e) => {
      if (e.shiftKey) return;
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      e.preventDefault();
      e.stopPropagation();

      const clipEl = e.target && e.target.closest ? e.target.closest('.nle-clip') : null;
      const trackHeader = e.target && e.target.closest ? e.target.closest('#trackHeadersContainer .timeline-track-row') : null;
      const trackRow = e.target && e.target.closest ? e.target.closest('#timelineCanvas .timeline-track-row') : null;

      _lastContextMenuTime = Date.now();
      showContextMenu(e, clipEl, trackRow, trackHeader);
    }, true);

    window.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return; // NEVER close on right click!
      if (e.target && e.target.closest && e.target.closest('#customContextMenu')) return;
      if (Date.now() - _lastContextMenuTime < 250) return; // Touchpad bounce guard

      hideContextMenu();
    }, true);
  }

  function showContextMenu(e, clipEl, trackRow, trackHeader) {
    const menuEl = document.getElementById('customContextMenu');
    if (!menuEl) return;

    const proj = getCurrentProject();
    let html = '';

    if (clipEl) {
      const taskId = clipEl.getAttribute('data-task-id');
      const task = state.tasks.find(t => t.id === taskId);
      contextMenuTargetData = { type: 'clip', task, event: e };

      html = `
        <div class="px-2 py-1 text-[11px] font-bold text-amber-300 truncate border-b border-[#C59B27]/25 mb-1">
          🎬 ${task ? task.title : 'Clip Tugas'}
        </div>
        <div class="win11-item" onclick="window.contextMenuAction('inspect')">
          <i class="fa-solid fa-sliders text-xs text-amber-400"></i>
          <span>Inspect / Detail Tugas (Double Click)</span>
        </div>
        <div class="win11-item" onclick="window.contextMenuAction('razor')">
          <i class="fa-solid fa-scissors text-xs text-rose-400"></i>
          <span>Potong / Split Clip di Posisi Ini (C)</span>
        </div>
        <div class="win11-item" onclick="window.contextMenuAction('duplicate')">
          <i class="fa-solid fa-copy text-xs text-blue-400"></i>
          <span>Duplikasi Tugas (Copy Clip)</span>
        </div>
        <div class="h-px bg-[#C59B27]/15 my-1"></div>
        <div class="px-2 py-0.5 text-[10px] text-slate-400 font-bold uppercase">Ubah Status Cepat:</div>
        <div class="grid grid-cols-3 gap-1 px-1 py-1">
          <button onclick="window.contextMenuSetStatus('todo')" class="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 hover:bg-slate-700">Todo</button>
          <button onclick="window.contextMenuSetStatus('in_progress')" class="px-1.5 py-0.5 rounded text-[10px] bg-amber-900/80 text-amber-200 hover:bg-amber-800">Running</button>
          <button onclick="window.contextMenuSetStatus('completed')" class="px-1.5 py-0.5 rounded text-[10px] bg-emerald-900/80 text-emerald-200 hover:bg-emerald-800">Done</button>
        </div>
        <div class="h-px bg-[#C59B27]/15 my-1"></div>
        <div class="win11-item danger text-rose-300" onclick="window.contextMenuAction('delete')">
          <i class="fa-solid fa-trash-can text-xs text-rose-400"></i>
          <span>Hapus Tugas (Ripple Delete)</span>
        </div>
      `;
    } else if (trackHeader) {
      const trackId = trackHeader.getAttribute('data-track-id');
      const track = getActiveTracks().find(t => t.id === trackId);
      contextMenuTargetData = { type: 'header', trackId, track };

      html = `
        <div class="px-2 py-1 text-[11px] font-bold text-amber-300 truncate border-b border-[#C59B27]/25 mb-1">
          👤 ${track ? track.title : 'Track Header'}
        </div>
        <div class="win11-item" onclick="window.contextMenuAction('add_for_member')">
          <i class="fa-solid fa-plus text-xs text-emerald-400"></i>
          <span>Beri Tugas Baru untuk Anggota Ini</span>
        </div>
        <div class="win11-item" onclick="window.toggleMuteTrack('${trackId}'); window.hideContextMenu();">
          <i class="fa-solid fa-eye-slash text-xs text-amber-400"></i>
          <span>Toggle Mute / Sembunyikan Track</span>
        </div>
        <div class="win11-item" onclick="window.toggleSoloTrack('${trackId}'); window.hideContextMenu();">
          <i class="fa-solid fa-star text-xs text-amber-400"></i>
          <span>Solo Track Ini</span>
        </div>
        <div class="win11-item" onclick="window.toggleLockTrack('${trackId}'); window.hideContextMenu();">
          <i class="fa-solid fa-lock text-xs text-slate-400"></i>
          <span>Kunci / Buka Gembok Track</span>
        </div>
      `;
    } else if (trackRow) {
      const trackId = trackRow.getAttribute('data-track-id');
      const rect = trackRow.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const dayIndex = Math.max(0, Math.floor(clickX / state.zoom));
      const targetDate = addDays(proj.startDate, dayIndex);
      contextMenuTargetData = { type: 'track', trackId, dayIndex, targetDate, event: e };

      html = `
        <div class="px-2 py-1 text-[11px] font-bold text-amber-300 truncate border-b border-[#C59B27]/25 mb-1">
          📅 ${formatDisplayDate(targetDate)} (${getRelativeDDayLabel(targetDate, proj)})
        </div>
        <div class="win11-item" onclick="window.contextMenuAction('add_task_here')">
          <i class="fa-solid fa-plus text-xs text-emerald-400"></i>
          <span>Tambah Tugas Baru di Tanggal Ini</span>
        </div>
        <div class="win11-item" onclick="window.seekPlayhead(${dayIndex}); window.hideContextMenu();">
          <i class="fa-solid fa-location-dot text-xs text-rose-400"></i>
          <span>Pindahkan Playhead ke Sini</span>
        </div>
        <div class="win11-item" onclick="state.snapping = !state.snapping; window.hideContextMenu(); showToastNotification('Magnet Snap: ' + (state.snapping ? 'AKTIF' : 'NONAKTIF'));">
          <i class="fa-solid fa-magnet text-xs text-amber-400"></i>
          <span>Toggle Magnet Snap (${state.snapping ? 'Aktif' : 'Mati'})</span>
        </div>
      `;
    }

    // If clicking on empty workspace/background inside timeline
    if (!html) {
      contextMenuTargetData = { type: 'workspace', event: e };
      html = `
        <div class="px-2 py-1 text-[11px] font-bold text-amber-300 truncate border-b border-[#C59B27]/25 mb-1">
          🎬 Workspace Timeline
        </div>
        <div class="win11-item" onclick="window.openNewProjectModal(); window.hideContextMenu();">
          <i class="fa-solid fa-plus text-xs text-emerald-400"></i>
          <span>Tambah Event / Proker Baru</span>
        </div>
        <div class="win11-item" onclick="window.openEventCalendarModal(); window.hideContextMenu();">
          <i class="fa-solid fa-calendar-days text-xs text-amber-400"></i>
          <span>Buka Kalender Event</span>
        </div>
        <div class="win11-item" onclick="window.jumpPlayheadToToday(); window.hideContextMenu();">
          <i class="fa-solid fa-location-dot text-xs text-rose-400"></i>
          <span>Lompat Playhead ke Hari Ini (Spasi)</span>
        </div>
        <div class="win11-item" onclick="state.snapping = !state.snapping; window.hideContextMenu(); showToastNotification('Magnet Snap: ' + (state.snapping ? 'AKTIF' : 'NONAKTIF'));">
          <i class="fa-solid fa-magnet text-xs text-amber-400"></i>
          <span>Toggle Magnet Snap (${state.snapping ? 'Aktif' : 'Mati'})</span>
        </div>
      `;
    }

    // Windows 11 Bottom Browser Options Item
    html += `
      <div class="h-px bg-[#C59B27]/20 my-1"></div>
      <div class="win11-item text-slate-400 hover:text-slate-200" onclick="window.showBrowserDefaultMenu(event)">
        <i class="fa-solid fa-globe text-xs text-slate-400"></i>
        <span>Pilihan Browser (Menu Asli)</span>
      </div>
    `;

    menuEl.innerHTML = html;
    menuEl.classList.remove('hidden');
    menuEl.style.display = 'block';
    menuEl.style.opacity = '1';
    menuEl.style.visibility = 'visible';

    // Positioning with boundary checking
    const menuWidth = 240;
    const menuHeight = menuEl.offsetHeight || 280;
    let posX = (e && typeof e.clientX === 'number') ? e.clientX : 200;
    let posY = (e && typeof e.clientY === 'number') ? e.clientY : 200;

    if (posX + menuWidth > window.innerWidth) {
      posX = Math.max(10, window.innerWidth - menuWidth - 15);
    }
    if (posY + menuHeight > window.innerHeight) {
      posY = Math.max(10, window.innerHeight - menuHeight - 15);
    }

    menuEl.style.left = `${posX}px`;
    menuEl.style.top = `${posY}px`;
    menuEl.style.zIndex = '999999';
  }

  function hideContextMenu() {
    const menuEl = document.getElementById('customContextMenu');
    if (menuEl) {
      menuEl.classList.add('hidden');
      menuEl.style.display = 'none';
    }
    contextMenuTargetData = null;
  }
  window.hideContextMenu = hideContextMenu;
  window.showBrowserDefaultMenu = function (e) {
    hideContextMenu();
    showToastNotification("💡 Tahan tombol 'Shift' lalu klik kanan untuk menu asli browser.");
  };

  window.contextMenuAction = function (action) {
    if (!contextMenuTargetData) return;
    const data = contextMenuTargetData;
    hideContextMenu();

    if (action === 'inspect' && data.task) {
      window.openInspectorModal(data.task.id);
    } else if (action === 'razor' && data.task) {
      if (!state.isEditorUnlocked) { window.openEditorPasscodeModal(); return; }
      handleRazorSplit(data.event, data.task);
    } else if (action === 'duplicate' && data.task) {
      if (!state.isEditorUnlocked) { window.openEditorPasscodeModal(); return; }
      const newTask = {
        ...JSON.parse(JSON.stringify(data.task)),
        id: "task_" + Date.now(),
        title: `${data.task.title} (Copy)`,
        startDate: addDays(data.task.startDate, 1)
      };
      state.tasks.push(newTask);
      persistData();
      renderAll();
    } else if (action === 'delete' && data.task) {
      if (!state.isEditorUnlocked) { window.openEditorPasscodeModal(); return; }
      if (confirm(`Hapus tugas "${data.task.title}"?`)) {
        state.tasks = state.tasks.filter(t => t.id !== data.task.id);
        persistData();
        renderAll();
      }
    } else if (action === 'add_task_here' && data.trackId) {
      if (!state.isEditorUnlocked) { window.openEditorPasscodeModal(); return; }
      window.handleTrackDoubleClick({ clientX: data.event.clientX, currentTarget: data.event.target.closest('.timeline-track-row') }, data.trackId);
    } else if (action === 'add_for_member' && data.trackId) {
      if (!state.isEditorUnlocked) { window.openEditorPasscodeModal(); return; }
      const proj = getCurrentProject();
      const newTask = {
        id: "task_" + Date.now(),
        projectId: proj.id,
        divisionId: state.activeDivisionId,
        memberId: data.trackId,
        title: "Tugas Baru",
        phase: "pre",
        startDate: proj.startDate,
        duration: 5,
        progress: 0,
        color: "#1B4D3E",
        status: "todo"
      };
      state.tasks.push(newTask);
      persistData();
      renderAll();
      window.openInspectorModal(newTask.id);
    }
  };

  window.contextMenuSetStatus = function (status) {
    if (!contextMenuTargetData || !contextMenuTargetData.task) return;
    if (!state.isEditorUnlocked) { window.openEditorPasscodeModal(); return; }
    contextMenuTargetData.task.status = status;
    if (status === 'completed') contextMenuTargetData.task.progress = 100;
    persistData();
    hideContextMenu();
    renderAll();
  };

  // --- 19. EVENT / PROKER CREATION MODAL (RELATIVE DAYS & MULTI-DAY D-DAY) ---
  window.openNewProjectModal = function () {
    const modal = document.getElementById('newProjectModal');
    if (!modal) return;
    try {
      const today = formatDate(new Date());
      const titleInput = document.getElementById('newEventTitle');
      const descInput = document.getElementById('newEventDesc');
      if (titleInput) titleInput.value = '';
      if (descInput) descInput.value = '';

      const defaultDDay = addDays(today, 20);
      const dDayInput = document.getElementById('newEventDDay');
      const dDayDurInput = document.getElementById('newEventDDayDuration');
      const preInput = document.getElementById('newEventPreDays');
      const postInput = document.getElementById('newEventPostDays');

      if (dDayInput) dDayInput.value = defaultDDay;
      if (dDayDurInput) dDayDurInput.value = 1;
      if (preInput) preInput.value = 20;
      if (postInput) postInput.value = 7;

      if (typeof window.updateNewProjectDatePreviews === 'function') {
        window.updateNewProjectDatePreviews();
      }
    } catch (err) {
      console.warn("openNewProjectModal error:", err);
    }
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    modal.style.zIndex = '99999';
  };

  window.closeNewProjectModal = function () {
    const modal = document.getElementById('newProjectModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  };

  window.updateNewProjectDatePreviews = function () {
    const dDayInput = document.getElementById('newEventDDay');
    const dDayDurInput = document.getElementById('newEventDDayDuration');
    const preInput = document.getElementById('newEventPreDays');
    const postInput = document.getElementById('newEventPostDays');

    if (!dDayInput) return;

    const dDayStr = dDayInput.value;
    const dDayDur = Math.max(1, parseInt(dDayDurInput ? dDayDurInput.value : 1, 10) || 1);
    const preDays = Math.max(1, parseInt(preInput ? preInput.value : 20, 10) || 20);
    const postDays = Math.max(1, parseInt(postInput ? postInput.value : 7, 10) || 7);

    if (!dDayStr) return;

    const dDayEndStr = addDays(dDayStr, dDayDur - 1);
    const rangePreview = document.getElementById('newEventDDayRangePreview');
    if (rangePreview) {
      if (dDayDur === 1) {
        rangePreview.innerText = "1 Hari Acara";
      } else {
        rangePreview.innerText = `${dDayDur} Hari (${formatDisplayDate(dDayStr)} - ${formatDisplayDate(dDayEndStr)})`;
      }
    }

    const startDate = addDays(dDayStr, -preDays);
    const prePreview = document.getElementById('newEventPrePreview');
    if (prePreview) {
      prePreview.innerText = `Mulai: ${formatDisplayDate(startDate)} (H-${preDays})`;
    }

    const endDate = addDays(dDayEndStr, postDays);
    const postPreview = document.getElementById('newEventPostPreview');
    if (postPreview) {
      postPreview.innerText = `Selesai: ${formatDisplayDate(endDate)} (H+${postDays})`;
    }
  };

  window.submitNewProject = function () {
    const title = (document.getElementById('newEventTitle').value || '').trim();
    const desc = (document.getElementById('newEventDesc').value || '').trim();
    const dDayDate = document.getElementById('newEventDDay').value;
    const dDayDur = Math.max(1, parseInt(document.getElementById('newEventDDayDuration').value, 10) || 1);
    const preDays = Math.max(1, parseInt(document.getElementById('newEventPreDays').value, 10) || 20);
    const postDays = Math.max(1, parseInt(document.getElementById('newEventPostDays').value, 10) || 7);
    if (!title || !dDayDate) {
      showToastNotification("⚠️ Harap masukkan nama event dan tanggal Hari-H!");
      return;
    }

    // If editor is locked, prompt for PIN before saving
    if (!state.isEditorUnlocked) {
      const pin = prompt("🔒 Masukkan PIN/Passcode Kadiv atau BPH untuk menyimpan event baru ini:\n(Contoh: bph2026 atau 123456)");
      if (!pin) return;
      if (pin.trim().toLowerCase() === 'bph2026' || pin.trim() === '123456') {
        state.isEditorUnlocked = true;
        state.editorRole = 'bph';
        state.editorDivisionId = 'all';
        state.editorName = 'Badan Pengurus Harian';
      } else {
        const matchedDiv = state.divisions.find(d => d.pass && d.pass.toLowerCase() === pin.trim().toLowerCase());
        if (matchedDiv) {
          state.isEditorUnlocked = true;
          state.editorRole = 'kadiv';
          state.editorDivisionId = matchedDiv.id;
          const kadiv = state.members.find(m => m.divisionId === matchedDiv.id && m.isKadiv);
          state.editorName = kadiv ? kadiv.nama : matchedDiv.name;
        } else {
          showToastNotification("❌ PIN salah! Event baru tidak disimpan.");
          return;
        }
      }
    }
    const startDate = addDays(dDayDate, -preDays);
    const dDayEndDate = addDays(dDayDate, dDayDur - 1);
    const endDate = addDays(dDayEndDate, postDays);

    const newProjId = "proker_" + Date.now();
    const newProject = {
      id: newProjId,
      title: title,
      description: desc,
      startDate: startDate,
      dDayDate: dDayDate,
      dDayDuration: dDayDur,
      endDate: endDate,
      status: "in_progress",
      phases: {
        pre: { label: "Pre-Acara (Persiapan)", start: startDate, end: addDays(dDayDate, -1) },
        dday: { label: dDayDur > 1 ? `Hari-H (${dDayDur} Hari)` : "Hari-H", date: dDayDate, duration: dDayDur },
        post: { label: "Pasca-Acara (LPJ & Evaluasi)", start: addDays(dDayEndDate, 1), end: endDate }
      }
    };

    state.projects.push(newProject);
    state.currentProjectId = newProjId;
    persistData();
    populateProjectSelector();
    window.closeNewProjectModal();
    renderAll();
    showToastNotification(`✅ Event "${title}" (${dDayDur} Hari Acara) berhasil dibuat!`);
  };

  // --- 20. EVENT CALENDAR & MILESTONES ---
  window.openEventCalendarModal = function () {
    const modal = document.getElementById('eventCalendarModal');
    if (!modal) return;
    try {
      const curProj = getCurrentProject();
      if (curProj && curProj.dDayDate) {
        state.calendarCurrentDate = parseDate(curProj.dDayDate);
        state.calendarCurrentDate.setDate(1);
      }
      renderCalendarGrid();
      renderCalendarEventList();
    } catch (err) {
      console.warn("openEventCalendarModal error:", err);
    }
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    modal.style.zIndex = '99999';
  };

  window.closeEventCalendarModal = function () {
    const modal = document.getElementById('eventCalendarModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  };

  window.prevCalendarMonth = function () {
    state.calendarCurrentDate.setMonth(state.calendarCurrentDate.getMonth() - 1);
    renderCalendarGrid();
  };

  window.nextCalendarMonth = function () {
    state.calendarCurrentDate.setMonth(state.calendarCurrentDate.getMonth() + 1);
    renderCalendarGrid();
  };

  function renderCalendarGrid() {
    const grid = document.getElementById('calendarDaysGrid');
    const titleEl = document.getElementById('calendarMonthTitle');
    if (!grid || !titleEl) return;

    const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    const year = state.calendarCurrentDate.getFullYear();
    const month = state.calendarCurrentDate.getMonth();
    titleEl.innerText = `${months[month]} ${year}`;

    const firstDay = new Date(year, month, 1).getDay();
    const totalDaysInMonth = new Date(year, month + 1, 0).getDate();

    let html = '';
    // Empty slots before 1st day
    for (let i = 0; i < firstDay; i++) {
      html += `<div class="h-14 p-1 rounded-lg bg-black/20 border border-slate-800/40 opacity-30"></div>`;
    }

    for (let day = 1; day <= totalDaysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      
      // Check if D-Day (Single or Multi-day)
      const dDayProjects = state.projects.filter(p => isDateInDDay(dateStr, p));
      const activeProjects = state.projects.filter(p => dateStr >= p.startDate && dateStr <= p.endDate);

      const hasDDay = dDayProjects.length > 0;
      const isActive = activeProjects.length > 0;

      html += `
        <div class="h-14 p-1 rounded-lg border flex flex-col justify-between transition cursor-pointer ${hasDDay ? 'bg-rose-950/60 border-rose-500 shadow-md shadow-rose-900/30 ring-1 ring-rose-400/50' : (isActive ? 'bg-[#0F2F24]/60 border-amber-500/30 hover:border-amber-400' : 'bg-[#0A221A]/40 border-slate-800/60 hover:bg-[#0A221A]')}" onclick="window.calendarDayClick('${dateStr}')">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-bold font-mono ${hasDDay ? 'text-rose-300 font-extrabold' : 'text-slate-300'}">${day}</span>
            ${hasDDay ? '<span class="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>' : ''}
          </div>
          <div class="overflow-hidden">
            ${dDayProjects.map(p => `
              <div class="text-[8px] font-bold bg-rose-600 text-white px-1 py-0.2 rounded truncate leading-tight mb-0.5" title="${p.title}">
                ⚡ HARI-H
              </div>
            `).join('')}
            ${!hasDDay && isActive ? `
              <div class="text-[8px] text-amber-300/80 truncate font-mono">
                ${activeProjects[0].title.split(' ')[0]}...
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }

    grid.innerHTML = html;
  }

  function renderCalendarEventList() {
    const listEl = document.getElementById('calendarEventList');
    if (!listEl) return;

    const todayStr = formatDate(new Date());

    let html = '';
    state.projects.forEach(p => {
      const dur = getProjectDDayDuration(p);
      const relDDay = getRelativeDDayLabel(todayStr, p);
      const isCurrent = p.id === state.currentProjectId;
      const dDayEndStr = getProjectDDayEndDate(p);
      const dDayLabel = dur > 1 ? 
        `${formatDisplayDate(p.dDayDate)} - ${formatDisplayDate(dDayEndStr)} (${dur} Hari Acara)` : 
        `${formatDate(parseDate(p.dDayDate))} (${formatDayName(p.dDayDate)})`;

      html += `
        <div class="p-3 rounded-xl border bg-[#061611] transition ${isCurrent ? 'border-amber-400/80 shadow-lg shadow-amber-950/40' : 'border-[#C59B27]/20 hover:border-amber-500/40'}">
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs font-bold text-amber-300 truncate">${p.title}</span>
            <span class="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-rose-600 text-white">${relDDay}</span>
          </div>
          <div class="text-[11px] text-slate-400 space-y-0.5 mb-2 font-mono">
            <div>⚡ <strong>Hari-H:</strong> ${dDayLabel}</div>
            <div>⏳ <strong>Rentang:</strong> ${formatDisplayDate(p.startDate)} - ${formatDisplayDate(p.endDate)}</div>
          </div>
          <button onclick="window.jumpToEvent('${p.id}', '${p.dDayDate}')" class="w-full py-1 text-xs font-bold rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 transition flex items-center justify-center gap-1">
            <i class="fa-solid fa-crosshairs"></i> Buka di Timeline
          </button>
        </div>
      `;
    });

    listEl.innerHTML = html;
  }

  window.calendarDayClick = function (dateStr) {
    const matchedProj = state.projects.find(p => isDateInDDay(dateStr, p) || (dateStr >= p.startDate && dateStr <= p.endDate));
    if (matchedProj) {
      window.jumpToEvent(matchedProj.id, dateStr);
    }
  };

  window.jumpToEvent = function (projId, dateStr) {
    state.currentProjectId = projId;
    const proj = getCurrentProject();
    if (proj) {
      const dayOffset = Math.max(0, getDaysDifference(proj.startDate, dateStr || proj.dDayDate));
      state.playheadDayIndex = dayOffset;
    }
    populateProjectSelector();
    window.closeEventCalendarModal();
    renderAll();
  };

  // Start on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
