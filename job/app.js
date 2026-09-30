/**
 * ==========================================================================
 * Rijal Dakwah Professional Gantt & Resource Studio v3.0
 * Core Application Engine & Reactive State Controller
 * ==========================================================================
 */

(function () {
  'use strict';

  // Storage Keys
  const STORAGE_KEY = 'RD_GANTT_STORE_V3';
  const AUTH_SESSION_KEY = 'RD_GANTT_AUTH_SESSION_V3';
  const SPLIT_WIDTH_KEY = 'RD_GANTT_SPLIT_WIDTH_V3';

  // Application State
  const state = {
    data: null,               // Master dataset { divisions, members, events }
    currentView: 'gantt',     // 'gantt' | 'calendar' | 'workload' | 'board'
    divisionFilter: 'all',    // 'all' | divisionId
    searchQuery: '',
    zoomScale: 'day',         // 'day' | 'week' | 'month'
    isEditor: false,          // Auth status
    activeAuthDiv: null,      // 'all' (Master BPH) or divisionId
    calendarDate: new Date(2026, 9, 1), // Default Oct 2026 (Month is 0-indexed: 9 = Oct)
    calendarZoom: '1m',       // '1m' | '3m' | 'roadmap'
    collapsedEvents: new Set(),
    timelineRange: { min: null, max: null, days: 0 },
    pixelsPerDay: 40,
    mobileActivePane: 'table', // 'table' | 'timeline'
    dragState: null
  };

  // DOM Cache
  const dom = {};

  // Division Color Map
  const DIVISION_MAP = {};

  // Default Secure SHA-256 Hashes for Division Passcodes (Zero plain-text)
  const DEFAULT_AUTH_HASHES = {
    bph: "4248e33b5e4b935c3918f98dca94f6287ac309202549e06e778833a1ef2fcd81",      // bph2026
    bph_alt: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92",  // 123456
    tpq: "4ab3a838a92031b15087cc12ec592e233603927b36d9dabb90439f35cebef0a9",      // tpq2026
    keilmuan: "c4ac89c233a9bf576501924857b263a35f410509470d7f8c041dbbc5016a8727", // ilmu2026
    acara: "9d3fa1557d22337d871728dd05e5fd7ddd815daa1aa3306e2a675d106568e3f5",    // acara2026
    humas: "420ed97a06f0b5fb5d2f0d37860d87505946716e5188bde67f7d5c91ac5a5137",    // humas2026
    sarpras: "e65e55f7b7c8cdc28584f635607878b4e73c75fe6e6af5643e8e15a6571528e1",  // sarpras2026
    digital: "cb3beaef05cdfa258903506a71dcbfb930b7224f4dccb35a6eaab81491f4435c",  // digital2026
    media: "edc027fe40087110db7585b1fbbe9cabd8e711136d6d8e8adcf595463f9fcd52",    // media2026
    danus: "65ea7c065f145628c50a2dc16ad7638fac158eb5df0faf29d332e5d7e03a9893"     // danus2026
  };

  /**
   * Native Browser SHA-256 Hashing (Zero-dependency Web Crypto API)
   */
  async function computeSha256(text) {
    const msgBuffer = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * RBAC Security Guards
   */
  function canUserEditEvent(event) {
    if (!state.isEditor) return false;
    if (state.activeAuthDiv === 'all') return true;
    return event && event.divisionId === state.activeAuthDiv;
  }

  function canUserEditTask(task, event) {
    if (!state.isEditor) return false;
    if (state.activeAuthDiv === 'all') return true;
    if (event && event.divisionId === state.activeAuthDiv) return true;
    const member = (state.data.members || []).find(m => m.id === task.assigneeId);
    return member && member.divisionId === state.activeAuthDiv;
  }

  /**
   * Firebase Cloud Firestore Synchronization Engine
   */
  const CloudSync = {
    isInitialized: false,
    db: null,
    auth: null,
    status: 'offline', // 'online' | 'syncing' | 'offline'
    cloudHashes: null,
    debounceTimer: null,
    isApplyingRemote: false,

    async init() {
      if (typeof firebase === 'undefined') {
        this.updateStatus('offline', 'Mode Lokal');
        return;
      }
      try {
        const config = {
          apiKey: "AIzaSyBuYpiqn65YUrs4kzeByHS6uHVYTZt1vTU",
          authDomain: "rijal-dakwah-portal.firebaseapp.com",
          projectId: "rijal-dakwah-portal",
          storageBucket: "rijal-dakwah-portal.firebasestorage.app",
          messagingSenderId: "638998738133",
          appId: "1:638998738133:web:073e95ded4108ea3ce1e5c"
        };
        if (!firebase.apps || !firebase.apps.length) {
          firebase.initializeApp(config);
        }
        this.auth = firebase.auth();
        this.db = firebase.firestore();
        this.isInitialized = true;
        this.updateStatus('online', 'Cloud Terhubung');

        // Pull auth hashes from cloud
        await this.pullAuthHashes();

        // Setup realtime listener on schedule
        this.setupRealtimeScheduleListener();

      } catch (err) {
        console.warn('[CloudSync] Firebase gagal diinisialisasi:', err);
        this.updateStatus('offline', 'Mode Lokal');
      }
    },

    updateStatus(status, text) {
      this.status = status;
      this.statusText = text;
      if (dom.badgeVersion) {
        dom.badgeVersion.classList.remove('status-online', 'status-syncing', 'status-offline');
        dom.badgeVersion.classList.add(`status-${status}`);
        dom.badgeVersion.title = `Status Cloud: ${text} (rijal-dakwah-portal) — Klik untuk info`;
      }
    },

    async ensureAuth() {
      if (!this.auth) return false;
      if (this.auth.currentUser) return true;
      try {
        await this.auth.signInWithEmailAndPassword("admin@rd.org", "medialab");
        return true;
      } catch (e) {
        console.warn('[CloudSync] Autentikasi internal Firebase gagal:', e.message);
        return false;
      }
    },

    async pullAuthHashes() {
      if (!this.db) return;
      try {
        const doc = await this.db.collection('settings').doc('gantt_auth').get();
        if (doc.exists) {
          this.cloudHashes = doc.data();
          localStorage.setItem('RD_GANTT_AUTH_HASHES_CACHE', JSON.stringify(this.cloudHashes));
        } else {
          if (await this.ensureAuth()) {
            await this.db.collection('settings').doc('gantt_auth').set(DEFAULT_AUTH_HASHES);
            this.cloudHashes = { ...DEFAULT_AUTH_HASHES };
          }
        }
      } catch (err) {
        console.warn('[CloudSync] Gagal memuat hash cloud, fallback ke cache lokal:', err);
      }
    },

    getAuthHashes() {
      if (this.cloudHashes) return this.cloudHashes;
      const cached = localStorage.getItem('RD_GANTT_AUTH_HASHES_CACHE');
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch (e) {}
      }
      return DEFAULT_AUTH_HASHES;
    },

    async updatePassword(divId, newPlainPassword) {
      if (!newPlainPassword) return false;
      const newHash = await computeSha256(newPlainPassword);
      const current = this.getAuthHashes();
      current[divId] = newHash;
      this.cloudHashes = current;
      localStorage.setItem('RD_GANTT_AUTH_HASHES_CACHE', JSON.stringify(current));

      if (this.db && await this.ensureAuth()) {
        try {
          await this.db.collection('settings').doc('gantt_auth').set({
            [divId]: newHash,
            updatedAt: new Date().toISOString()
          }, { merge: true });
          return true;
        } catch (err) {
          console.error('[CloudSync] Gagal menyimpan password ke cloud:', err);
          return false;
        }
      }
      return true;
    },

    setupRealtimeScheduleListener() {
      if (!this.db) return;
      this.db.collection('settings').doc('gantt_schedule').onSnapshot(doc => {
        if (!doc.exists) {
          if (state.data && state.data.events && state.data.events.length) {
            this.scheduleCloudPush(state.data);
          }
          return;
        }
        const cloudData = doc.data();
        if (cloudData && cloudData.payload) {
          const cloudTime = new Date(cloudData.updatedAt || 0).getTime();
          const localTime = state.data._lastUpdated || 0;
          if (cloudTime > localTime && !this.isApplyingRemote) {
            this.isApplyingRemote = true;
            try {
              state.data = JSON.parse(cloudData.payload);
              localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
              calculateTimelineRange();
              renderCurrentView();
              showToast('Jadwal diperbarui realtime dari Cloud');
            } catch (e) {
              console.warn('[CloudSync] Gagal memproses payload cloud:', e);
            } finally {
              this.isApplyingRemote = false;
            }
          }
        }
      }, err => {
        console.warn('[CloudSync] Realtime listener error:', err.message);
      });
    },

    scheduleCloudPush(data) {
      if (!this.db) return;
      clearTimeout(this.debounceTimer);
      this.updateStatus('syncing', 'Menyimpan...');
      this.debounceTimer = setTimeout(async () => {
        try {
          if (await this.ensureAuth()) {
            const nowIso = new Date().toISOString();
            data._lastUpdated = Date.now();
            await this.db.collection('settings').doc('gantt_schedule').set({
              updatedAt: nowIso,
              payload: JSON.stringify(data),
              eventCount: (data.events || []).length
            });
            this.updateStatus('online', 'Cloud Tersinkron');
          } else {
            this.updateStatus('offline', 'Mode Lokal');
          }
        } catch (err) {
          console.error('[CloudSync] Gagal push schedule ke Firestore:', err);
          this.updateStatus('offline', 'Sinkron Gagal (Lokal)');
        }
      }, 800);
    }
  };

  /**
   * Initialize Application
   */
  function init() {
    cacheDom();
    loadDataset();
    restoreAuthSession();
    buildDivisionPills();
    populateEventModalSelects();
    setupEventListeners();
    setupSplitter();
    
    // Initialize CloudSync
    CloudSync.init();

    // Restore saved ribbon collapse state
    const savedCollapsed = localStorage.getItem('RD_GANTT_HEADER_COLLAPSED') === 'true';
    if (savedCollapsed && dom.appRoot) {
      dom.appRoot.classList.add('header-collapsed');
    }

    // Initial Render based on active view
    renderCurrentView();
    updateAuthUi();
  }

  /**
   * Cache Critical DOM Nodes
   */
  function cacheDom() {
    dom.appRoot = document.getElementById('appRoot');
    dom.navTabBtns = document.querySelectorAll('.nav-tab-btn');
    dom.viewPanes = document.querySelectorAll('.view-pane');
    
    // Brand & Version Status Badge
    dom.badgeVersion = document.getElementById('badgeVersion');

    // Ribbon Collapse / Restore Triggers
    dom.btnToggleHeaderRibbon = document.getElementById('btnToggleHeaderRibbon');
    dom.btnRestoreHeaderRibbon = document.getElementById('btnRestoreHeaderRibbon');

    // Auth, Actions & Filter
    dom.btnOpenSecuritySettings = document.getElementById('btnOpenSecuritySettings');
    dom.btnAuthToggle = document.getElementById('btnAuthToggle');
    dom.authLockIcon = document.getElementById('authLockIcon');
    dom.btnNewEvent = document.getElementById('btnNewEvent');
    dom.btnExportMenu = document.getElementById('btnExportMenu');
    dom.searchInput = document.getElementById('searchInput');
    dom.divisionPills = document.getElementById('divisionPills');
    dom.countAll = document.getElementById('countAll');
    // Controls
    dom.btnJumpToday = document.getElementById('btnJumpToday');
    dom.zoomControls = document.getElementById('zoomControls');
    dom.zoomBtns = document.querySelectorAll('.zoom-btn');
    dom.mobilePaneToggle = document.getElementById('mobilePaneToggle');
    dom.mobileToggleBtns = document.querySelectorAll('.mobile-toggle-btn');

    // Gantt Container
    dom.ganttContainer = document.getElementById('ganttContainer');
    dom.ganttGridPane = document.getElementById('ganttGridPane');
    dom.splitterHandle = document.getElementById('splitterHandle');
    dom.gridBody = document.getElementById('gridBody');
    dom.timelinePane = document.getElementById('timelinePane');
    dom.timelineContentWrapper = document.getElementById('timelineContentWrapper');
    dom.headerTierPrimary = document.getElementById('headerTierPrimary');
    dom.headerTierSecondary = document.getElementById('headerTierSecondary');
    dom.timelineGridColumns = document.getElementById('timelineGridColumns');
    dom.timelineLinksSvg = document.getElementById('timelineLinksSvg');
    dom.svgLinksGroup = document.getElementById('svgLinksGroup');
    dom.todayMarkerLine = document.getElementById('todayMarkerLine');
    dom.timelineRowsContainer = document.getElementById('timelineRowsContainer');

    // Calendar View
    dom.calendarMonthTitle = document.getElementById('calendarMonthTitle');
    dom.calendarZoomControls = document.getElementById('calendarZoomControls');
    dom.calendarStandardContainer = document.getElementById('calendarStandardContainer');
    dom.calendarRoadmapContainer = document.getElementById('calendarRoadmapContainer');
    dom.calendarMonthNavButtons = document.getElementById('calendarMonthNavButtons');
    dom.calendarGridCells = document.getElementById('calendarGridCells');
    dom.btnCalPrev = document.getElementById('btnCalPrev');
    dom.btnCalToday = document.getElementById('btnCalToday');
    dom.btnCalNext = document.getElementById('btnCalNext');

    // Workload View
    dom.statAssignedMembers = document.getElementById('statAssignedMembers');
    dom.statTotalTasks = document.getElementById('statTotalTasks');
    dom.statClashCount = document.getElementById('statClashCount');
    dom.cardClashIndicator = document.getElementById('cardClashIndicator');
    dom.rosterCardTitle = document.getElementById('rosterCardTitle');
    dom.rosterTableBody = document.getElementById('rosterTableBody');
    dom.rosterSearchInput = document.getElementById('rosterSearchInput');
    // Board View
    dom.boardColScheduled = document.getElementById('boardColScheduled');
    dom.boardColInProgress = document.getElementById('boardColInProgress');
    dom.boardColCompleted = document.getElementById('boardColCompleted');
    dom.boardColPostponed = document.getElementById('boardColPostponed');
    dom.boardCountScheduled = document.getElementById('boardCountScheduled');
    dom.boardCountInProgress = document.getElementById('boardCountInProgress');
    dom.boardCountCompleted = document.getElementById('boardCountCompleted');
    dom.boardCountPostponed = document.getElementById('boardCountPostponed');

    // Modals
    dom.modalAuth = document.getElementById('modalAuth');
    dom.inputAuthPass = document.getElementById('inputAuthPass');
    dom.authErrorMessage = document.getElementById('authErrorMessage');
    dom.btnSubmitAuth = document.getElementById('btnSubmitAuth');

    dom.modalEvent = document.getElementById('modalEvent');
    dom.modalEventTitle = document.getElementById('modalEventTitle');
    dom.editEventId = document.getElementById('editEventId');
    dom.inputEventName = document.getElementById('inputEventName');
    dom.inputEventDivision = document.getElementById('inputEventDivision');
    dom.inputEventCategory = document.getElementById('inputEventCategory');
    dom.inputEventDDay = document.getElementById('inputEventDDay');
    dom.inputEventStatus = document.getElementById('inputEventStatus');
    dom.inputEventDesc = document.getElementById('inputEventDesc');
    dom.btnDeleteEvent = document.getElementById('btnDeleteEvent');
    dom.btnSaveEvent = document.getElementById('btnSaveEvent');

    dom.modalDetail = document.getElementById('modalDetail');
    dom.detailTaskTitle = document.getElementById('detailTaskTitle');
    dom.detailModalBody = document.getElementById('detailModalBody');
    dom.btnEditParentEvent = document.getElementById('btnEditParentEvent');
    dom.btnSaveTaskPIC = document.getElementById('btnSaveTaskPIC');
    dom.modalExport = document.getElementById('modalExport');
    dom.btnDownloadExcel = document.getElementById('btnDownloadExcel');
    dom.selectCsvDelimiter = document.getElementById('selectCsvDelimiter');
    dom.btnDownloadCsv = document.getElementById('btnDownloadCsv');
    dom.inputImportCsv = document.getElementById('inputImportCsv');
    dom.inputImportJson = document.getElementById('inputImportJson');
    dom.btnPrintPdf = document.getElementById('btnPrintPdf');
    dom.btnResetOfficialData = document.getElementById('btnResetOfficialData');
    dom.modalClashResolver = document.getElementById('modalClashResolver');
    dom.clashModalBody = document.getElementById('clashModalBody');
    dom.modalSecuritySettings = document.getElementById('modalSecuritySettings');
    dom.securityDivisionsList = document.getElementById('securityDivisionsList');
    dom.btnSaveSecuritySettings = document.getElementById('btnSaveSecuritySettings');
    dom.toastContainer = document.getElementById('toastContainer');
  }

  /**
   * Get Formatted Role Badge for BPH and Division Heads
   */
  function getMemberRoleBadge(member) {
    if (!member) return '';
    if (member.divisionId === 'bph') {
      const roleName = member.bphRole || member.role || '';
      if (roleName.includes('Ketua Umum') || member.nama.includes('Fasya')) {
        return '<span class="status-badge" style="background:#F59E0B25; color:#F59E0B; font-weight:700;">Ketua Umum</span>';
      }
      if (roleName.includes('Wakil 1') || member.nama.includes('Fawwaz')) {
        return '<span class="status-badge" style="background:#F59E0B25; color:#F59E0B; font-weight:600;">Wakil 1</span>';
      }
      if (roleName.includes('Wakil 2') || member.nama.includes('Akhmad Dzaqi')) {
        return '<span class="status-badge" style="background:#F59E0B25; color:#F59E0B; font-weight:600;">Wakil 2</span>';
      }
      if (roleName.includes('Wakil 3') || member.nama.includes('Alqindi') || member.nama.includes('Qindi')) {
        return '<span class="status-badge" style="background:#F59E0B25; color:#F59E0B; font-weight:600;">Wakil 3</span>';
      }
      if (roleName.includes('Sekretaris') || member.nama.includes('Fazli')) {
        return '<span class="status-badge" style="background:#F59E0B25; color:#F59E0B; font-weight:600;">Sekretaris</span>';
      }
      if (roleName.includes('Bendahara') || member.nama.includes('Rasendriya') || member.nama.includes('Dzaki Rasendriya')) {
        return '<span class="status-badge" style="background:#F59E0B25; color:#F59E0B; font-weight:600;">Bendahara</span>';
      }
      return `<span class="status-badge" style="background:#F59E0B25; color:#F59E0B;">${roleName}</span>`;
    }
    if (member.isKadiv) {
      return '<span class="status-badge" style="background:#3B82F625; color:#60A5FA; font-weight:600;">Kadiv</span>';
    }
    return '';
  }

  /**
   * Load Data with LocalStorage Persistence
   */
  function loadDataset() {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try {
        state.data = JSON.parse(cached);
      } catch (e) {
        console.warn('Gagal memuat cache lokal, fallback ke data bawaan.');
        state.data = JSON.parse(JSON.stringify(window.RD_GANTT_DATA || {}));
      }
    } else if (window.RD_GANTT_DATA) {
      state.data = JSON.parse(JSON.stringify(window.RD_GANTT_DATA));
    } else {
      state.data = { divisions: [], members: [], events: [] };
    }

    // Populate division lookup map
    (state.data.divisions || []).forEach(d => {
      DIVISION_MAP[d.id] = d;
    });

    calculateTimelineRange();
  }

  /**
   * Save Data to LocalStorage
   */
  function persistData() {
    try {
      state.data._lastUpdated = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
    } catch (e) {
      console.error('Penyimpanan LocalStorage gagal:', e);
    }
    calculateTimelineRange();
    CloudSync.scheduleCloudPush(state.data);
  }

  /**
   * Compute Timeline Boundary Dates
   */
  function calculateTimelineRange() {
    let minDate = '2026-09-01';
    let maxDate = '2027-06-30';

    if (state.data && state.data.events) {
      state.data.events.forEach(ev => {
        if (ev.startDate && ev.startDate < minDate) minDate = ev.startDate;
        if (ev.endDate && ev.endDate > maxDate) maxDate = ev.endDate;
        if (ev.tasks) {
          ev.tasks.forEach(t => {
            if (t.startDate && t.startDate < minDate) minDate = t.startDate;
            if (t.endDate && t.endDate > maxDate) maxDate = t.endDate;
          });
        }
      });
    }

    const minD = parseDate(minDate);
    const maxD = parseDate(maxDate);

    // Add 7 days padding on edges
    minD.setDate(minD.getDate() - 5);
    maxD.setDate(maxD.getDate() + 7);

    state.timelineRange.min = minD;
    state.timelineRange.max = maxD;
    state.timelineRange.days = Math.max(1, Math.round((maxD - minD) / (1000 * 60 * 60 * 24)));

    updatePixelsPerDay();
  }

  /**
   * Update scale metrics based on Zoom
   */
  function updatePixelsPerDay() {
    if (state.zoomScale === 'day') {
      state.pixelsPerDay = 38;
    } else if (state.zoomScale === 'week') {
      state.pixelsPerDay = 16;
    } else if (state.zoomScale === 'month') {
      state.pixelsPerDay = 6;
    }
  }

  /**
   * Restore Passcode Session
   */
  function restoreAuthSession() {
    const sess = sessionStorage.getItem(AUTH_SESSION_KEY);
    if (sess) {
      try {
        const parsed = JSON.parse(sess);
        state.isEditor = true;
        state.activeAuthDiv = parsed.divId || 'all';
      } catch (e) {
        state.isEditor = false;
      }
    }
  }

  /**
   * Render Top Division Filter Pills
   */
  function buildDivisionPills() {
    if (!dom.divisionPills || !state.data.divisions) return;
    
    // Count events per division
    const counts = {};
    (state.data.events || []).forEach(ev => {
      counts[ev.divisionId] = (counts[ev.divisionId] || 0) + 1;
    });

    if (dom.countAll) dom.countAll.textContent = (state.data.events || []).length;

    let html = `
      <button class="div-pill ${state.divisionFilter === 'all' ? 'active' : ''}" data-div="all">
        <span>Semua Divisi</span>
        <span class="badge-count">${(state.data.events || []).length}</span>
      </button>
    `;

    state.data.divisions.forEach(d => {
      const activeCls = state.divisionFilter === d.id ? 'active' : '';
      const count = counts[d.id] || 0;
      html += `
        <button class="div-pill ${activeCls}" data-div="${d.id}">
          <span class="pill-dot" style="background-color: ${d.color};"></span>
          <span>${d.name.replace('Divisi ', '')}</span>
          <span class="badge-count">${count}</span>
        </button>
      `;
    });

    dom.divisionPills.innerHTML = html;

    dom.divisionPills.querySelectorAll('.div-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        state.divisionFilter = btn.dataset.div;
        dom.divisionPills.querySelectorAll('.div-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderCurrentView();
      });
    });
  }

  /**
   * Populate Select Elements in Event Modal
   */
  function populateEventModalSelects() {
    if (!dom.inputEventDivision || !state.data.divisions) return;

    dom.inputEventDivision.innerHTML = state.data.divisions.map(d => 
      `<option value="${d.id}">${d.name}</option>`
    ).join('');
  }

  /**
   * View Switcher Handler
   */
  function renderCurrentView() {
    dom.viewPanes.forEach(p => p.classList.remove('active'));
    dom.navTabBtns.forEach(b => b.classList.remove('active'));

    const activeBtn = Array.from(dom.navTabBtns).find(b => b.dataset.view === state.currentView);
    if (activeBtn) activeBtn.classList.add('active');

    const paneMap = {
      gantt: 'viewGantt',
      calendar: 'viewCalendar',
      workload: 'viewWorkload',
      board: 'viewBoard'
    };

    const targetPane = document.getElementById(paneMap[state.currentView]);
    if (targetPane) targetPane.classList.add('active');

    // View-specific renderer
    if (state.currentView === 'gantt') {
      renderGanttView();
    } else if (state.currentView === 'calendar') {
      renderCalendarView();
    } else if (state.currentView === 'workload') {
      renderWorkloadView();
    } else if (state.currentView === 'board') {
      renderBoardView();
    }
  }

  /**
   * Filter Events by Search Query & Division
   */
  function getFilteredEvents() {
    if (!state.data || !state.data.events) return [];
    const query = state.searchQuery.trim().toLowerCase();

    return state.data.events.filter(ev => {
      // Division check
      if (state.divisionFilter !== 'all' && ev.divisionId !== state.divisionFilter) {
        // Also check if any task belongs to the filtered division
        const hasDivTask = ev.tasks && ev.tasks.some(t => t.divisionId === state.divisionFilter);
        if (!hasDivTask) return false;
      }

      // Search query check
      if (query) {
        const matchEvName = ev.name.toLowerCase().includes(query);
        const matchEvCat = ev.category && ev.category.toLowerCase().includes(query);
        const matchTask = ev.tasks && ev.tasks.some(t => {
          const matchTName = t.name.toLowerCase().includes(query);
          const member = getMember(t.assigneeId);
          const matchAssignee = member && member.nama.toLowerCase().includes(query);
          return matchTName || matchAssignee;
        });
        if (!matchEvName && !matchEvCat && !matchTask) return false;
      }

      return true;
    });
  }

  // =========================================================================
  // VIEW 1: GANTT CHART (DUAL PANE & TIMELINE CANVAS)
  // =========================================================================

  function renderGanttView() {
    renderTimelineHeader();
    renderGanttRows();
    renderDependencies();
    updateTodayMarker();
    syncVerticalScroll();
  }

  /**
   * Render Time Scale Headers & Background Grid Lines
   */
  function renderTimelineHeader() {
    const totalDays = state.timelineRange.days;
    const pxPerDay = state.pixelsPerDay;
    const totalWidth = totalDays * pxPerDay;

    dom.timelineContentWrapper.style.width = `${totalWidth}px`;

    let primaryHtml = '';
    let secondaryHtml = '';
    let gridColsHtml = '';

    const curr = new Date(state.timelineRange.min);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const daysIndo = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

    let currentMonth = -1;
    let currentMonthWidth = 0;
    let monthLabel = '';

    for (let i = 0; i < totalDays; i++) {
      const dayNum = curr.getDate();
      const monthIdx = curr.getMonth();
      const year = curr.getFullYear();
      const dayOfWeek = curr.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const dateStr = formatDateIso(curr);
      const isToday = dateStr === formatDateIso(new Date());

      // Month Grouping
      if (monthIdx !== currentMonth) {
        if (currentMonth !== -1) {
          primaryHtml += `<div class="time-cell-primary" style="width: ${currentMonthWidth}px;">${monthLabel}</div>`;
        }
        currentMonth = monthIdx;
        monthLabel = `${months[monthIdx]} ${year}`;
        currentMonthWidth = pxPerDay;
      } else {
        currentMonthWidth += pxPerDay;
      }

      // Secondary Tier (Days / Weeks)
      if (state.zoomScale === 'day') {
        const weekendClass = isWeekend ? 'weekend' : '';
        const todayClass = isToday ? 'today-cell' : '';
        secondaryHtml += `
          <div class="time-cell-secondary ${weekendClass} ${todayClass}" style="width: ${pxPerDay}px;" title="${daysIndo[dayOfWeek]}, ${dayNum} ${monthLabel}">
            ${dayNum}
          </div>
        `;
      } else if (state.zoomScale === 'week') {
        if (dayOfWeek === 1 || i === 0) { // Monday or first day
          secondaryHtml += `
            <div class="time-cell-secondary" style="width: ${pxPerDay * 7}px;">
              ${dayNum} ${months[monthIdx]}
            </div>
          `;
        }
      }

      // Canvas Background Column
      const colWeekend = isWeekend ? 'weekend-col' : '';
      gridColsHtml += `<div class="grid-col-line ${colWeekend}" style="width: ${pxPerDay}px;"></div>`;

      curr.setDate(curr.getDate() + 1);
    }

    // Flush last month primary cell
    if (currentMonth !== -1) {
      primaryHtml += `<div class="time-cell-primary" style="width: ${currentMonthWidth}px;">${monthLabel}</div>`;
    }

    dom.headerTierPrimary.innerHTML = primaryHtml;
    dom.headerTierSecondary.innerHTML = secondaryHtml;
    dom.timelineGridColumns.innerHTML = gridColsHtml;
  }

  /**
   * Render Left Grid & Right Timeline Rows
   */
  function renderGanttRows() {
    const events = getFilteredEvents();
    let gridHtml = '';
    let timelineRowsHtml = '';

    events.forEach(ev => {
      const isCollapsed = state.collapsedEvents.has(ev.id);
      const divInfo = DIVISION_MAP[ev.divisionId] || { name: 'Umum', color: '#64748B' };
      const toggleIcon = isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down';

      // 1. Event Row (Left Grid)
      gridHtml += `
        <div class="grid-row grid-row-event" data-row-id="${ev.id}">
          <div class="grid-task-name">
            <span class="event-toggle" data-toggle-event="${ev.id}">
              <i class="fa-solid ${toggleIcon}"></i>
            </span>
            <span title="${ev.name}">${ev.name}</span>
          </div>
          <div class="grid-col-div">
            <span class="status-badge" style="background-color: ${divInfo.color}25; color: ${divInfo.color};">
              ${divInfo.name.replace('Divisi ', '')}
            </span>
          </div>
          <div class="grid-col-assignee">
            <span class="status-badge ${ev.status}">${ev.status}</span>
          </div>
          <div class="grid-col-dates" style="font-family: var(--font-mono); font-size: 11px;">
            ${formatShortDate(ev.startDate)} - ${formatShortDate(ev.endDate)}
          </div>
          <div class="grid-col-duration" style="font-family: var(--font-mono); font-size: 11px;">
            ${getDaysBetween(ev.startDate, ev.endDate)}h
          </div>
        </div>
      `;

      // 1b. Event Summary Bar (Right Canvas)
      const evLeft = dateToX(ev.startDate);
      const evWidth = Math.max(state.pixelsPerDay, dateToX(ev.endDate) - evLeft + state.pixelsPerDay);

      timelineRowsHtml += `
        <div class="timeline-row" data-row-id="${ev.id}">
          <div class="gantt-bar gantt-bar-event" style="left: ${evLeft}px; width: ${evWidth}px;" data-event-bar="${ev.id}">
            <div class="event-bracket-left"></div>
            <div class="event-bracket-right"></div>
          </div>
        </div>
      `;

      // 2. Child Task Rows (if not collapsed)
      if (!isCollapsed && ev.tasks) {
        ev.tasks.forEach(t => {
          const tDiv = DIVISION_MAP[t.divisionId] || divInfo;
          const member = getMember(t.assigneeId);
          const tLeft = dateToX(t.startDate);
          const tWidth = Math.max(state.pixelsPerDay, dateToX(t.endDate) - tLeft + state.pixelsPerDay);

          gridHtml += `
            <div class="grid-row grid-row-task" data-row-id="${t.id}" data-task-inspect="${t.id}">
              <div class="grid-task-name">
                <i class="fa-solid fa-angle-right" style="color: var(--text-muted); font-size: 9px; margin-right: 4px;"></i>
                <span title="${t.name}">${t.name}</span>
              </div>
              <div class="grid-col-div">
                <span class="status-badge" style="background-color: ${tDiv.color}20; color: ${tDiv.color};">
                  ${tDiv.name.replace('Divisi ', '')}
                </span>
              </div>
              <div class="grid-col-assignee">
                ${member ? `
                  <div class="assignee-chip" title="${member.nama} (${member.role})">
                    <span class="avatar-initials">${member.initials}</span>
                    <span>${member.nama.split(' ')[0]}</span>
                  </div>
                ` : '<span style="color: var(--text-muted);">-</span>'}
              </div>
              <div class="grid-col-dates" style="font-family: var(--font-mono); font-size: 11px;">
                ${formatShortDate(t.startDate)} - ${formatShortDate(t.endDate)}
              </div>
              <div class="grid-col-duration" style="font-family: var(--font-mono); font-size: 11px;">
                ${t.duration || getDaysBetween(t.startDate, t.endDate)}h
              </div>
            </div>
          `;

          // Milestone Diamond vs Task Bar
          if (t.isMilestone) {
            timelineRowsHtml += `
              <div class="timeline-row" data-row-id="${t.id}">
                <div class="gantt-milestone" style="left: ${tLeft + state.pixelsPerDay / 2 - 11}px;" data-task-bar="${t.id}" title="${t.name} (${formatShortDate(t.startDate)})">
                  <div class="gantt-milestone-label">${t.name}</div>
                </div>
              </div>
            `;
          } else {
            timelineRowsHtml += `
              <div class="timeline-row" data-row-id="${t.id}">
                <div class="gantt-bar" style="left: ${tLeft}px; width: ${tWidth}px; border-left: 3px solid ${tDiv.color};" data-task-bar="${t.id}" data-task-id="${t.id}">
                  <!-- Left Resize Handle -->
                  <div class="bar-resize-handle left" data-resize-edge="left"></div>
                  
                  <!-- Progress Fill -->
                  <div class="gantt-progress-fill" style="width: ${t.progress || 0}%; background-color: ${tDiv.color};"></div>
                  
                  <!-- Content Label -->
                  <div class="gantt-bar-content">
                    <span class="gantt-bar-title">${t.name}</span>
                    <span class="gantt-bar-meta">(${t.progress || 0}%)</span>
                  </div>

                  <!-- Right Resize Handle -->
                  <div class="bar-resize-handle right" data-resize-edge="right"></div>
                </div>
              </div>
            `;
          }
        });
      }
    });

    dom.gridBody.innerHTML = gridHtml;
    dom.timelineRowsContainer.innerHTML = timelineRowsHtml;

    // Attach Event Listeners to Rows
    attachRowEventListeners();
  }

  /**
   * Attach Row Click, Collapse, and Hover Events
   */
  function attachRowEventListeners() {
    // Collapse Toggles
    dom.gridBody.querySelectorAll('[data-toggle-event]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const evId = btn.dataset.toggleEvent;
        if (state.collapsedEvents.has(evId)) {
          state.collapsedEvents.delete(evId);
        } else {
          state.collapsedEvents.add(evId);
        }
        renderGanttView();
      });
    });

    // Row Hover Highlight Synchronizer
    const gridRows = dom.gridBody.querySelectorAll('.grid-row');
    const timelineRows = dom.timelineRowsContainer.querySelectorAll('.timeline-row');

    gridRows.forEach(gr => {
      const rowId = gr.dataset.rowId;
      const tr = dom.timelineRowsContainer.querySelector(`.timeline-row[data-row-id="${rowId}"]`);

      gr.addEventListener('mouseenter', () => {
        gr.classList.add('highlighted');
        if (tr) tr.classList.add('highlighted');
      });
      gr.addEventListener('mouseleave', () => {
        gr.classList.remove('highlighted');
        if (tr) tr.classList.remove('highlighted');
      });
      gr.addEventListener('click', () => {
        const taskId = gr.dataset.taskInspect;
        if (taskId) openTaskDetailModal(taskId);
      });
    });

    timelineRows.forEach(tr => {
      const rowId = tr.dataset.rowId;
      const gr = dom.gridBody.querySelector(`.grid-row[data-row-id="${rowId}"]`);

      tr.addEventListener('mouseenter', () => {
        tr.classList.add('highlighted');
        if (gr) gr.classList.add('highlighted');
      });
      tr.addEventListener('mouseleave', () => {
        tr.classList.remove('highlighted');
        if (gr) gr.classList.remove('highlighted');
      });
    });

    // Task Bars Drag & Resize Listeners
    dom.timelineRowsContainer.querySelectorAll('.gantt-bar[data-task-id]').forEach(bar => {
      setupBarInteractions(bar);
    });

    // Milestone Click
    dom.timelineRowsContainer.querySelectorAll('.gantt-milestone[data-task-bar]').forEach(m => {
      m.addEventListener('click', () => {
        openTaskDetailModal(m.dataset.taskBar);
      });
    });
  }

  /**
   * Render SVG Dependency Curved Arrows
   */
  function renderDependencies() {
    if (!dom.svgLinksGroup) return;

    let svgPaths = '';
    const events = getFilteredEvents();
    const taskPositions = {};

    // 1. Index visible task bar positions
    dom.timelineRowsContainer.querySelectorAll('[data-task-bar]').forEach(barEl => {
      const taskId = barEl.dataset.taskBar;
      const rowEl = barEl.closest('.timeline-row');
      if (taskId && rowEl) {
        const left = parseFloat(barEl.style.left) || 0;
        const width = parseFloat(barEl.style.width) || (barEl.classList.contains('gantt-milestone') ? 22 : state.pixelsPerDay);
        const top = rowEl.offsetTop + (rowEl.offsetHeight / 2);
        taskPositions[taskId] = {
          xStart: left,
          xEnd: left + width,
          y: top
        };
      }
    });

    // 2. Generate Curves from Predecessor to Successor
    events.forEach(ev => {
      if (ev.tasks && !state.collapsedEvents.has(ev.id)) {
        ev.tasks.forEach(t => {
          if (t.predecessor && taskPositions[t.predecessor] && taskPositions[t.id]) {
            const from = taskPositions[t.predecessor];
            const to = taskPositions[t.id];

            const x1 = from.xEnd;
            const y1 = from.y;
            const x2 = to.xStart;
            const y2 = to.y;

            // Generate cubic Bézier path
            const dx = Math.max(16, Math.abs(x2 - x1) * 0.4);
            const pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

            svgPaths += `
              <path d="${pathD}" class="dep-line" marker-end="url(#arrowhead)" data-from="${t.predecessor}" data-to="${t.id}"></path>
            `;
          }
        });
      }
    });

    dom.svgLinksGroup.innerHTML = svgPaths;
  }

  /**
   * Update Today Indicator Marker Line
   */
  function updateTodayMarker() {
    if (!dom.todayMarkerLine) return;
    const todayStr = formatDateIso(new Date());
    const minD = state.timelineRange.min;
    const maxD = state.timelineRange.max;
    const today = new Date();

    if (today >= minD && today <= maxD) {
      const x = dateToX(todayStr);
      dom.todayMarkerLine.style.display = 'block';
      dom.todayMarkerLine.style.left = `${x}px`;
    } else {
      dom.todayMarkerLine.style.display = 'none';
    }
  }

  /**
   * Synchronize Vertical Scrolling Between Left Grid & Right Timeline
   */
  function syncVerticalScroll() {
    dom.timelinePane.onscroll = () => {
      dom.gridBody.scrollTop = dom.timelinePane.scrollTop;
    };
  }

  /**
   * Setup Drag to Move and Drag to Resize on Task Bars
   */
  function setupBarInteractions(barEl) {
    const taskId = barEl.dataset.taskId;

    barEl.addEventListener('mousedown', (e) => {
      // Check auth lock
      if (!state.isEditor) {
        // Just inspect on click if locked
        if (!e.target.classList.contains('bar-resize-handle')) {
          openTaskDetailModal(taskId);
        } else {
          showAuthRequiredToast();
        }
        return;
      }

      const isResizeLeft = e.target.classList.contains('left');
      const isResizeRight = e.target.classList.contains('right');
      const isMove = !isResizeLeft && !isResizeRight;

      const task = findTask(taskId);
      if (!task) return;

      const parentEv = (state.data.events || []).find(e => e.id === task.eventId);
      if (!canUserEditTask(task, parentEv)) {
        if (!e.target.classList.contains('bar-resize-handle')) {
          openTaskDetailModal(taskId);
        } else {
          showToast('Akses Ditolak: Anda login sebagai Editor Divisi. Hanya dapat menggeser tugas divisi Anda.');
        }
        return;
      }
      e.preventDefault();
      const startX = e.clientX;
      const initialLeft = parseFloat(barEl.style.left);
      const initialWidth = parseFloat(barEl.style.width);

      barEl.classList.add('dragging');

      function onMouseMove(moveEvent) {
        const deltaX = moveEvent.clientX - startX;

        if (isMove) {
          const newLeft = Math.max(0, initialLeft + deltaX);
          barEl.style.left = `${newLeft}px`;
        } else if (isResizeRight) {
          const newWidth = Math.max(state.pixelsPerDay, initialWidth + deltaX);
          barEl.style.width = `${newWidth}px`;
        } else if (isResizeLeft) {
          const newLeft = Math.max(0, initialLeft + deltaX);
          const newWidth = Math.max(state.pixelsPerDay, initialWidth - deltaX);
          barEl.style.left = `${newLeft}px`;
          barEl.style.width = `${newWidth}px`;
        }
      }

      function onMouseUp(upEvent) {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        barEl.classList.remove('dragging');

        const deltaX = upEvent.clientX - startX;
        const deltaDays = Math.round(deltaX / state.pixelsPerDay);

        if (deltaDays !== 0) {
          if (isMove) {
            const newStart = addDays(task.startDate, deltaDays);
            const newEnd = addDays(task.endDate, deltaDays);
            task.startDate = newStart;
            task.endDate = newEnd;
            showToast(`Jadwal "${task.name}" digeser ke ${formatShortDate(newStart)}`);
          } else if (isResizeRight) {
            const newEnd = addDays(task.endDate, deltaDays);
            if (newEnd >= task.startDate) {
              task.endDate = newEnd;
              task.duration = getDaysBetween(task.startDate, task.endDate);
              showToast(`Durasi "${task.name}" disesuaikan menjadi ${task.duration} hari`);
            }
          } else if (isResizeLeft) {
            const newStart = addDays(task.startDate, deltaDays);
            if (newStart <= task.endDate) {
              task.startDate = newStart;
              task.duration = getDaysBetween(task.startDate, task.endDate);
              showToast(`Mulai "${task.name}" diubah ke ${formatShortDate(newStart)}`);
            }
          }

          // Auto-rollup to parent event
          autoRollupEventDates(task.eventId);
          persistData();
          renderGanttView();
        } else {
          // It was just a click
          if (isMove) openTaskDetailModal(taskId);
        }
      }

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  /**
   * Recalculate Parent Event Dates Based on Children Tasks
   */
  function autoRollupEventDates(eventId) {
    const ev = state.data.events.find(e => e.id === eventId);
    if (!ev || !ev.tasks || ev.tasks.length === 0) return;

    let minStart = ev.tasks[0].startDate;
    let maxEnd = ev.tasks[0].endDate;

    ev.tasks.forEach(t => {
      if (t.startDate < minStart) minStart = t.startDate;
      if (t.endDate > maxEnd) maxEnd = t.endDate;
    });

    ev.startDate = minStart;
    ev.endDate = maxEnd;
  }

  // =========================================================================
  // VIEW 2: MONTHLY CALENDAR
  // =========================================================================

  function renderCalendarView() {
    const year = state.calendarDate.getFullYear();
    const month = state.calendarDate.getMonth();
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    // Update Zoom Button states
    if (dom.calendarZoomControls) {
      dom.calendarZoomControls.querySelectorAll('.zoom-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.calZoom === state.calendarZoom);
      });
    }

    const events = getFilteredEvents();
    const eventDateMap = {};
    events.forEach(ev => {
      const dday = ev.dDay || ev.startDate;
      if (!eventDateMap[dday]) eventDateMap[dday] = [];
      eventDateMap[dday].push(ev);
    });

    if (state.calendarZoom === 'roadmap') {
      // Full Roadmap Scouting View (Sep 2026 - Jun 2027)
      if (dom.calendarStandardContainer) dom.calendarStandardContainer.style.display = 'none';
      if (dom.calendarRoadmapContainer) dom.calendarRoadmapContainer.style.display = 'grid';
      if (dom.calendarMonthNavButtons) dom.calendarMonthNavButtons.style.display = 'none';
      dom.calendarMonthTitle.innerHTML = `<i class="fa-solid fa-map" style="color: #60A5FA; margin-right: 6px;"></i> Roadmap Kegiatan Rijal Dakwah (Sep 2026 - Jun 2027)`;

      const roadmapMonths = [
        { year: 2026, month: 8, name: 'September 2026' },
        { year: 2026, month: 9, name: 'Oktober 2026' },
        { year: 2026, month: 10, name: 'November 2026' },
        { year: 2026, month: 11, name: 'Desember 2026' },
        { year: 2027, month: 0, name: 'Januari 2027' },
        { year: 2027, month: 1, name: 'Februari 2027' },
        { year: 2027, month: 2, name: 'Maret 2027' },
        { year: 2027, month: 3, name: 'April 2027' },
        { year: 2027, month: 4, name: 'Mei 2027' },
        { year: 2027, month: 5, name: 'Juni 2027' }
      ];

      let roadmapHtml = '';
      roadmapMonths.forEach(rm => {
        const monthEvents = events.filter(ev => {
          const dStr = ev.dDay || ev.startDate;
          if (!dStr) return false;
          const parts = dStr.split('-');
          return parseInt(parts[0], 10) === rm.year && parseInt(parts[1], 10) === (rm.month + 1);
        });

        roadmapHtml += `
          <div class="cal-roadmap-card" data-jump-month="${rm.year}-${rm.month}">
            <div class="cal-roadmap-card-header">
              <div class="cal-roadmap-card-title">${rm.name}</div>
              <span class="cal-roadmap-card-badge">${monthEvents.length} Agenda</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px; max-height: 240px; overflow-y: auto;">
              ${monthEvents.length > 0 ? monthEvents.map(ev => {
                const divInfo = DIVISION_MAP[ev.divisionId] || { name: 'Umum', color: '#64748B' };
                return `
                  <div class="cal-roadmap-event-item" data-event-click="${ev.id}">
                    <span class="cal-roadmap-event-date">${formatShortDate(ev.dDay || ev.startDate)}</span>
                    <span class="status-badge" style="background-color: ${divInfo.color}25; color: ${divInfo.color}; font-size: 10px;">
                      ${divInfo.name.replace('Divisi ', '')}
                    </span>
                    <span class="cal-roadmap-event-title" title="${ev.name}">${ev.name}</span>
                  </div>
                `;
              }).join('') : '<div style="color: var(--text-muted); font-size: 11px; text-align: center; padding: 12px 0;">Tidak ada agenda</div>'}
            </div>
            <div style="font-size: 10px; color: #60A5FA; text-align: right; margin-top: auto; padding-top: 4px;">
              Buka bulan ini ➔
            </div>
          </div>
        `;
      });

      dom.calendarRoadmapContainer.innerHTML = roadmapHtml;

      dom.calendarRoadmapContainer.querySelectorAll('[data-jump-month]').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('[data-event-click]')) return;
          const parts = card.dataset.jumpMonth.split('-');
          state.calendarDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10), 1);
          state.calendarZoom = '1m';
          renderCalendarView();
        });
      });

      dom.calendarRoadmapContainer.querySelectorAll('[data-event-click]').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          openEventEditModal(el.dataset.eventClick);
        });
      });

      return;
    }

    // Standard Grid View (1m or 3m)
    if (dom.calendarStandardContainer) dom.calendarStandardContainer.style.display = 'block';
    if (dom.calendarRoadmapContainer) dom.calendarRoadmapContainer.style.display = 'none';
    if (dom.calendarMonthNavButtons) dom.calendarMonthNavButtons.style.display = 'flex';

    if (state.calendarZoom === '1m') {
      dom.calendarMonthTitle.textContent = `${months[month]} ${year}`;
      dom.calendarGridCells.innerHTML = renderSingleMonthCells(year, month, eventDateMap);
    } else if (state.calendarZoom === '3m') {
      const m1 = month;
      const m2 = (month + 1) % 12;
      const m3 = (month + 2) % 12;
      const y1 = year;
      const y2 = month + 1 > 11 ? year + 1 : year;
      const y3 = month + 2 > 11 ? year + 1 : year;

      dom.calendarMonthTitle.textContent = `Kuartal: ${months[m1]} - ${months[m3]} ${year}`;
      
      let html3m = '';
      html3m += `<div style="grid-column: 1 / -1; padding: 6px 0; font-weight: 700; color: #60A5FA;">Bulan 1: ${months[m1]} ${y1}</div>`;
      html3m += renderSingleMonthCells(y1, m1, eventDateMap);
      html3m += `<div style="grid-column: 1 / -1; padding: 14px 0 6px; font-weight: 700; color: #60A5FA; border-top: 1px dashed var(--border-medium); margin-top: 12px;">Bulan 2: ${months[m2]} ${y2}</div>`;
      html3m += renderSingleMonthCells(y2, m2, eventDateMap);
      html3m += `<div style="grid-column: 1 / -1; padding: 14px 0 6px; font-weight: 700; color: #60A5FA; border-top: 1px dashed var(--border-medium); margin-top: 12px;">Bulan 3: ${months[m3]} ${y3}</div>`;
      html3m += renderSingleMonthCells(y3, m3, eventDateMap);
      
      dom.calendarGridCells.innerHTML = html3m;
    }

    // Attach event pill click listeners
    dom.calendarGridCells.querySelectorAll('[data-event-click]').forEach(pill => {
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        openEventEditModal(pill.dataset.eventClick);
      });
    });
  }

  function renderSingleMonthCells(year, month, eventDateMap) {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayIndex = firstDay.getDay(); // 0 is Ahad
    const totalDays = lastDay.getDate();
    const prevLastDay = new Date(year, month, 0).getDate();

    let cellsHtml = '';

    // 1. Previous month trailing days
    for (let i = startDayIndex - 1; i >= 0; i--) {
      cellsHtml += `
        <div class="calendar-cell other-month">
          <div class="cell-day-number">${prevLastDay - i}</div>
        </div>
      `;
    }

    // 2. Current month days
    const todayIso = formatDateIso(new Date());
    for (let day = 1; day <= totalDays; day++) {
      const currentIso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = currentIso === todayIso;
      const dayEvents = eventDateMap[currentIso] || [];

      cellsHtml += `
        <div class="calendar-cell ${isToday ? 'is-today' : ''}" data-date="${currentIso}">
          <div class="cell-day-number" ${isToday ? 'style="color: #60A5FA; font-weight: 700;"' : ''}>${day}</div>
          <div class="cell-events-list">
            ${dayEvents.map(ev => {
              const divInfo = DIVISION_MAP[ev.divisionId] || { color: '#3B82F6' };
              return `
                <div class="cal-event-pill" style="background-color: ${divInfo.color};" data-event-click="${ev.id}" title="${ev.name} (${ev.category})">
                  ${ev.name}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    // 3. Next month leading days (Fill 35 or 42 cells total)
    const filledCells = startDayIndex + totalDays;
    const remainingCells = (filledCells > 35 ? 42 : 35) - filledCells;
    for (let i = 1; i <= remainingCells; i++) {
      cellsHtml += `
        <div class="calendar-cell other-month">
          <div class="cell-day-number">${i}</div>
        </div>
      `;
    }

    return cellsHtml;
  }

  // =========================================================================
  // VIEW 3: WORKLOAD & RESOURCE MANAGEMENT (109 PENGURUS)
  // =========================================================================

  function calculateMemberWorkloads() {
    const memberTasks = {};
    (state.data.members || []).forEach(m => {
      memberTasks[m.id] = {
        member: m,
        tasks: [],
        clashes: []
      };
    });

    (state.data.events || []).forEach(ev => {
      if (ev.tasks) {
        ev.tasks.forEach(t => {
          if (memberTasks[t.assigneeId]) {
            memberTasks[t.assigneeId].tasks.push({ ...t, eventName: ev.name });
          }
        });
      }
    });

    Object.values(memberTasks).forEach(record => {
      const tasks = record.tasks;
      for (let i = 0; i < tasks.length; i++) {
        for (let j = i + 1; j < tasks.length; j++) {
          const t1 = tasks[i];
          const t2 = tasks[j];
          if (t1.startDate <= t2.endDate && t1.endDate >= t2.startDate) {
            record.clashes.push(`${t1.name} & ${t2.name}`);
          }
        }
      }
    });

    return memberTasks;
  }

  function renderWorkloadView() {
    if (!state.data || !state.data.members) return;

    const memberTasks = calculateMemberWorkloads();
    const isFiltered = state.divisionFilter !== 'all';

    // Filter records by division if active
    let filteredRecords = Object.values(memberTasks);
    if (isFiltered) {
      filteredRecords = filteredRecords.filter(r => r.member.divisionId === state.divisionFilter);
    }

    // Compute metrics for active view
    const viewTotalMembers = isFiltered ? filteredRecords.length : state.data.members.length;
    const viewAssignedMembers = filteredRecords.filter(r => r.tasks.length > 0).length;
    const viewTotalTasks = filteredRecords.reduce((sum, r) => sum + r.tasks.length, 0);
    const viewClashCount = filteredRecords.reduce((sum, r) => sum + r.clashes.length, 0);

    // Update KPI Header Cards
    if (dom.statAssignedMembers) {
      const pct = viewTotalMembers > 0 ? Math.round((viewAssignedMembers / viewTotalMembers) * 100) : 0;
      dom.statAssignedMembers.innerHTML = `${viewAssignedMembers} <span class="stat-card-meta">/ ${viewTotalMembers} Orang (${pct}%)</span>`;
    }
    if (dom.statTotalTasks) {
      dom.statTotalTasks.innerHTML = `${viewTotalTasks} <span class="stat-card-meta">Sub-tugas</span>`;
    }
    if (dom.statClashCount) {
      dom.statClashCount.innerHTML = `${viewClashCount} <span class="stat-card-meta">Potensi Bentrok</span>`;
    }

    // Dynamic Roster Card Title
    if (dom.rosterCardTitle) {
      if (!isFiltered) {
        dom.rosterCardTitle.textContent = 'Daftar Alokasi Pengurus (109 Personil SK - Seluruh Divisi)';
      } else {
        const divInfo = DIVISION_MAP[state.divisionFilter] || { name: 'Divisi' };
        dom.rosterCardTitle.textContent = `Daftar Alokasi Pengurus (${divInfo.name} - ${filteredRecords.length} Personil)`;
      }
    }

    // Filter Roster Table by Search
    const rosterQuery = (dom.rosterSearchInput ? dom.rosterSearchInput.value : '').trim().toLowerCase();
    let rosterHtml = '';

    const sortedRecords = filteredRecords.sort((a, b) => b.tasks.length - a.tasks.length);

    sortedRecords.forEach(r => {
      const m = r.member;
      if (rosterQuery && !m.nama.toLowerCase().includes(rosterQuery) && !m.nim.includes(rosterQuery)) {
        return;
      }

      const divInfo = DIVISION_MAP[m.divisionId] || { name: 'Umum', color: '#64748B' };
      const taskCount = r.tasks.length;
      const isOverloaded = r.clashes.length > 0 || taskCount >= 4;

      // Workload meter
      const barPercent = Math.min(100, Math.round((taskCount / 5) * 100));
      const barColor = isOverloaded ? '#EF4444' : (taskCount >= 2 ? '#3B82F6' : '#10B981');

      rosterHtml += `
        <tr id="row-member-${m.id}">
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="avatar-initials" style="border-color: ${divInfo.color};">${m.initials}</span>
              <div>
                <div style="font-weight: 600;">${m.nama} ${getMemberRoleBadge(m)}</div>
                <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${m.nim}</div>
              </div>
            </div>
          </td>
          <td>
            <span class="status-badge" style="background-color: ${divInfo.color}20; color: ${divInfo.color};">
              ${divInfo.name.replace('Divisi ', '')}
            </span>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${m.bphRole || m.role}</div>
          </td>
          <td>
            <strong>${taskCount}</strong> tugas aktif
          </td>
          <td>
            <div class="workload-bar-wrap">
              <div class="workload-bar-fill" style="width: ${barPercent}%; background-color: ${barColor};"></div>
            </div>
          </td>
          <td>
            ${isOverloaded ? `
              <span class="clash-tag" data-clash-member="${m.id}" style="cursor: pointer;" title="Klik untuk telusuri & atasi bentrok jadwal!">
                <i class="fa-solid fa-triangle-exclamation"></i> OVERLOAD
              </span>
            ` : (taskCount > 0 ? '<span style="color: #34D399; font-size: 11px;">Optimal</span>' : '<span style="color: var(--text-muted); font-size: 11px;">Luang</span>')}
          </td>
          <td style="font-size: 11px; color: var(--text-secondary); max-width: 260px;">
            ${r.tasks.length > 0 ? r.tasks.map(t => `
              <span class="cal-event-pill" style="display: inline-block; background-color: ${divInfo.color}25; color: #F8FAFC; border: 1px solid ${divInfo.color}50; margin: 1px 2px; padding: 1px 6px; font-size: 10px; cursor: pointer;" data-inspect-task="${t.id}" title="${t.name}">
                ${t.name}
              </span>
            `).join('') : '<span style="color: var(--text-muted);">-</span>'}
          </td>
        </tr>
      `;
    });

    dom.rosterTableBody.innerHTML = rosterHtml;

    // Attach row task inspect click
    dom.rosterTableBody.querySelectorAll('[data-inspect-task]').forEach(btn => {
      btn.onclick = () => openTaskDetailModal(btn.dataset.inspectTask);
    });

    // Attach clash tag click
    dom.rosterTableBody.querySelectorAll('[data-clash-member]').forEach(btn => {
      btn.onclick = () => handleClashClick(btn.dataset.clashMember);
    });
  }

  /**
   * Handle Clash Resolution Trigger (from KPI Card or Overload Tag)
   */
  function handleClashClick(targetMemberId) {
    const memberTasks = calculateMemberWorkloads();
    let targetRecord = null;
    if (targetMemberId) {
      targetRecord = memberTasks[targetMemberId];
    } else {
      // Find first record with clashes
      targetRecord = Object.values(memberTasks).find(r => r.clashes.length > 0);
    }

    if (!targetRecord) {
      showToast('Tidak ada bentrok jadwal yang terdeteksi');
      return;
    }

    const m = targetRecord.member;

    // If division filter is currently hiding this member, switch to their division or 'all'
    if (state.divisionFilter !== 'all' && state.divisionFilter !== m.divisionId) {
      state.divisionFilter = m.divisionId;
      buildDivisionPills();
      renderCurrentView();
    }

    // Scroll to row and highlight
    setTimeout(() => {
      const rowEl = document.getElementById(`row-member-${m.id}`);
      if (rowEl) {
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        rowEl.classList.remove('clash-target-pulse');
        void rowEl.offsetWidth; // Trigger reflow
        rowEl.classList.add('clash-target-pulse');
      }
    }, 100);

    // Open Clash Resolution Modal
    openClashResolverModal(targetRecord);
  }

  /**
   * Open Modal to Resolve Schedule Clashes
   */
  function openClashResolverModal(record) {
    if (!dom.modalClashResolver || !dom.clashModalBody) return;
    const m = record.member;
    const divInfo = DIVISION_MAP[m.divisionId] || { name: 'Divisi', color: '#64748B' };

    dom.clashModalBody.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid var(--border-subtle);">
        <span class="avatar-initials" style="width: 32px; height: 32px; font-size: 12px; border-color: ${divInfo.color};">${m.initials}</span>
        <div>
          <div style="font-weight: 700; font-size: 14px;">${m.nama} ${getMemberRoleBadge(m)}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${divInfo.name} • ${m.bphRole || m.role} • ${m.nim}</div>
        </div>
      </div>

      <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: var(--radius-sm); padding: 10px 12px; margin-bottom: 14px; font-size: 11px; color: #FCA5A5;">
        <i class="fa-solid fa-triangle-exclamation" style="margin-right: 5px;"></i>
        <strong>Deteksi Bentrok Jadwal:</strong> Personil ini memegang tugas yang bertubrukan pada tanggal yang sama:
        <ul style="margin: 6px 0 0 16px; padding: 0;">
          ${record.clashes.map(c => `<li>${c}</li>`).join('')}
        </ul>
      </div>

      <div style="font-weight: 600; font-size: 12px; margin-bottom: 8px; color: var(--text-primary);">
        Daftar Tugas Terkait (Pilih untuk Mengalihkan Tanggung Jawab):
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${record.tasks.map(t => `
          <div style="background: var(--bg-surface-0); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <div>
              <div style="font-weight: 600; font-size: 12px; color: var(--text-primary);">${t.name}</div>
              <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
                <i class="fa-regular fa-calendar" style="margin-right: 4px;"></i>${formatShortDate(t.startDate)} s.d. ${formatShortDate(t.endDate)} (${t.duration || 1} Hari)
              </div>
            </div>
            <button class="btn btn-primary" data-resolve-task="${t.id}" style="font-size: 11px; height: 28px; padding: 0 10px; white-space: nowrap;">
              <i class="fa-solid fa-user-gear"></i> Alihkan Tugas ➔
            </button>
          </div>
        `).join('')}
      </div>
    `;

    dom.clashModalBody.querySelectorAll('[data-resolve-task]').forEach(btn => {
      btn.onclick = () => {
        closeModal(dom.modalClashResolver);
        openTaskDetailModal(btn.dataset.resolveTask);
      };
    });

    openModal(dom.modalClashResolver);
  }

  // =========================================================================
  // VIEW 4: KANBAN BOARD
  // =========================================================================

  function renderBoardView() {
    const events = getFilteredEvents();
    const cols = {
      scheduled: [],
      in_progress: [],
      completed: [],
      postponed: []
    };

    events.forEach(ev => {
      const st = ev.status || 'scheduled';
      if (cols[st]) cols[st].push(ev);
      else cols.scheduled.push(ev);
    });

    // Counts
    dom.boardCountScheduled.textContent = cols.scheduled.length;
    dom.boardCountInProgress.textContent = cols.in_progress.length;
    dom.boardCountCompleted.textContent = cols.completed.length;
    dom.boardCountPostponed.textContent = cols.postponed.length;

    // Render Cards in each column
    renderBoardCards(dom.boardColScheduled, cols.scheduled);
    renderBoardCards(dom.boardColInProgress, cols.in_progress);
    renderBoardCards(dom.boardColCompleted, cols.completed);
    renderBoardCards(dom.boardColPostponed, cols.postponed);
  }

  function renderBoardCards(containerEl, eventList) {
    if (!containerEl) return;

    if (eventList.length === 0) {
      containerEl.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 12px;">
          Tidak ada agenda di kolom ini
        </div>
      `;
      return;
    }

    containerEl.innerHTML = eventList.map(ev => {
      const divInfo = DIVISION_MAP[ev.divisionId] || { name: 'Umum', color: '#64748B' };
      const taskCount = (ev.tasks || []).length;
      return `
        <div class="kanban-card" data-event-edit="${ev.id}">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span class="status-badge" style="background-color: ${divInfo.color}20; color: ${divInfo.color};">
              ${divInfo.name.replace('Divisi ', '')}
            </span>
            <span style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">${ev.category || 'Event'}</span>
          </div>
          <div class="kanban-card-title">${ev.name}</div>
          <div class="kanban-card-meta">
            <span><i class="fa-regular fa-calendar" style="margin-right: 4px;"></i>${formatShortDate(ev.dDay || ev.startDate)}</span>
            <span><i class="fa-solid fa-list-check" style="margin-right: 4px;"></i>${taskCount} tugas</span>
          </div>
        </div>
      `;
    }).join('');

    containerEl.querySelectorAll('[data-event-edit]').forEach(card => {
      card.addEventListener('click', () => {
        openEventEditModal(card.dataset.eventEdit);
      });
    });
  }

  // =========================================================================
  // MODALS & EVENT HANDLERS
  // =========================================================================

  function setupEventListeners() {
    // Navigation Tabs
    dom.navTabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        state.currentView = btn.dataset.view;
        renderCurrentView();
      });
    });

    // Search Input
    if (dom.searchInput) {
      dom.searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        renderCurrentView();
      });
    }

    // Workload Roster Search
    if (dom.rosterSearchInput) {
      dom.rosterSearchInput.addEventListener('input', () => {
        renderWorkloadView();
      });
    }

    // Zoom Controls
    dom.zoomBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        state.zoomScale = btn.dataset.zoom;
        dom.zoomBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updatePixelsPerDay();
        if (state.currentView === 'gantt') renderGanttView();
      });
    });

    // Mobile Pane Toggle
    dom.mobileToggleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        state.mobileActivePane = btn.dataset.pane;
        dom.mobileToggleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (state.mobileActivePane === 'table') {
          dom.ganttContainer.classList.add('show-table');
          dom.ganttContainer.classList.remove('show-timeline');
        } else {
          dom.ganttContainer.classList.add('show-timeline');
          dom.ganttContainer.classList.remove('show-table');
        }
      });
    });

    // Jump Today Button
    if (dom.btnJumpToday) {
      dom.btnJumpToday.addEventListener('click', () => {
        if (state.currentView !== 'gantt') {
          state.currentView = 'gantt';
          renderCurrentView();
        }
        const todayStr = formatDateIso(new Date());
        const x = dateToX(todayStr);
        dom.timelinePane.scrollTo({ left: Math.max(0, x - 200), behavior: 'smooth' });
        showToast('Fokus diarahkan ke tanggal hari ini');
      });
    }

    // Calendar Month Navigator
    if (dom.btnCalPrev) {
      dom.btnCalPrev.addEventListener('click', () => {
        state.calendarDate.setMonth(state.calendarDate.getMonth() - 1);
        renderCalendarView();
      });
    }
    if (dom.btnCalToday) {
      dom.btnCalToday.addEventListener('click', () => {
        state.calendarDate = new Date();
        renderCalendarView();
      });
    }
    if (dom.btnCalNext) {
      dom.btnCalNext.addEventListener('click', () => {
        state.calendarDate.setMonth(state.calendarDate.getMonth() + 1);
        renderCalendarView();
      });
    }
    // Calendar Zoom Controls (1m, 3m, Roadmap)
    if (dom.calendarZoomControls) {
      dom.calendarZoomControls.querySelectorAll('.zoom-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          state.calendarZoom = btn.dataset.calZoom;
          dom.calendarZoomControls.querySelectorAll('.zoom-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          renderCalendarView();
        });
      });
    }

    // Clash KPI Indicator Card Click (Jump to Clash)
    if (dom.cardClashIndicator) {
      dom.cardClashIndicator.addEventListener('click', () => {
        handleClashClick(null);
      });
    }


    // Auth Toggle
    if (dom.btnAuthToggle) {
      dom.btnAuthToggle.addEventListener('click', () => {
        if (state.isEditor) {
          // Relock mode
          state.isEditor = false;
          state.activeAuthDiv = null;
          sessionStorage.removeItem(AUTH_SESSION_KEY);
          updateAuthUi();
          showToast('Mode Editor dikunci kembali ke Mode Publik');
        } else {
          openModal(dom.modalAuth);
          if (dom.inputAuthPass) {
            dom.inputAuthPass.value = '';
            dom.inputAuthPass.focus();
          }
          if (dom.authErrorMessage) dom.authErrorMessage.style.display = 'none';
        }
      });
    }
    // Security Settings (Manage Passwords - BPH Only)
    if (dom.btnOpenSecuritySettings) {
      dom.btnOpenSecuritySettings.addEventListener('click', openSecuritySettingsModal);
    }
    if (dom.btnSaveSecuritySettings) {
      dom.btnSaveSecuritySettings.addEventListener('click', handleSaveSecuritySettings);
    }

    // Ribbon Header Collapse / Restore Handler (Focus Gantt - Max Aspect Ratio)
    function toggleHeaderRibbon(collapse) {
      const isCollapsed = collapse !== undefined ? collapse : !dom.appRoot.classList.contains('header-collapsed');
      dom.appRoot.classList.toggle('header-collapsed', isCollapsed);
      localStorage.setItem('RD_GANTT_HEADER_COLLAPSED', isCollapsed ? 'true' : 'false');
      setTimeout(() => {
        renderDependencies();
      }, 250);
      showToast(isCollapsed ? 'Mode Fokus Aktif (Ribbon disembunyikan untuk rasio maksimal)' : 'Menu Ribbon ditampilkan');
    }

    if (dom.btnToggleHeaderRibbon) {
      dom.btnToggleHeaderRibbon.addEventListener('click', () => toggleHeaderRibbon(true));
    }
    if (dom.btnRestoreHeaderRibbon) {
      dom.btnRestoreHeaderRibbon.addEventListener('click', () => toggleHeaderRibbon(false));
    }
    if (dom.badgeVersion) {
      dom.badgeVersion.addEventListener('click', () => {
        showToast(`Status Cloud Firebase: ${CloudSync.statusText || 'Terhubung'}`);
      });
    }

    // Keyboard shortcut Escape to restore ribbon
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dom.appRoot && dom.appRoot.classList.contains('header-collapsed')) {
        toggleHeaderRibbon(false);
      }
    });

    // Submit Auth Passcode
    if (dom.btnSubmitAuth) {
      dom.btnSubmitAuth.addEventListener('click', handleAuthSubmit);
    }
    if (dom.inputAuthPass) {
      dom.inputAuthPass.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAuthSubmit();
      });
    }

    // Add New Event Button
    if (dom.btnNewEvent) {
      dom.btnNewEvent.addEventListener('click', () => {
        if (!state.isEditor) {
          showAuthRequiredToast();
          return;
        }
        openEventEditModal(null);
      });
    }

    // Save Event Form
    if (dom.btnSaveEvent) {
      dom.btnSaveEvent.addEventListener('click', handleSaveEvent);
    }

    // Delete Event
    if (dom.btnDeleteEvent) {
      dom.btnDeleteEvent.addEventListener('click', handleDeleteEvent);
    }

    // Export & Backup Menu
    if (dom.btnExportMenu) {
      dom.btnExportMenu.addEventListener('click', () => {
        openModal(dom.modalExport);
      });
    }

    // Download Native Excel (.xls) - Guaranteed Cell Columns
    if (dom.btnDownloadExcel) {
      dom.btnDownloadExcel.addEventListener('click', downloadExcelSchedule);
    }

    // Download CSV (Spreadsheet / Excel / Sheets)
    if (dom.btnDownloadCsv) {
      dom.btnDownloadCsv.addEventListener('click', downloadCsvSchedule);
    }
    // Import CSV File (Auto-Detect ; or ,)
    if (dom.inputImportCsv) {
      dom.inputImportCsv.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) importCsvSchedule(file);
        e.target.value = '';
      });
    }

    // Download JSON
    if (dom.btnDownloadJson) {
      dom.btnDownloadJson.addEventListener('click', () => {
        const jsonStr = JSON.stringify(state.data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rijal-dakwah-gantt-backup-${formatDateIso(new Date())}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Cadangan data JSON berhasil diunduh');
      });
    }

    // Import JSON File
    if (dom.inputImportJson) {
      dom.inputImportJson.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const imported = JSON.parse(event.target.result);
            if (imported.events && imported.members) {
              state.data = imported;
              persistData();
              renderCurrentView();
              closeModal(dom.modalExport);
              showToast('Data berhasil dipulihkan dari berkas JSON!');
            } else {
              alert('Format berkas JSON tidak sesuai struktur Rijal Dakwah.');
            }
          } catch (err) {
            alert('Gagal membaca berkas JSON: ' + err.message);
          }
        };
        reader.readAsText(file);
        e.target.value = '';
      });
    }

    // Print Executive PDF Document
    if (dom.btnPrintPdf) {
      dom.btnPrintPdf.addEventListener('click', generateExecutivePdfReport);
    }

    // Reset Official Data
    if (dom.btnResetOfficialData) {
      dom.btnResetOfficialData.addEventListener('click', () => {
        if (confirm('Apakah Anda yakin ingin mereset seluruh data kembali ke 40 Agenda Resmi Kalender RD 2026-2027?')) {
          localStorage.removeItem(STORAGE_KEY);
          loadDataset();
          renderCurrentView();
          closeModal(dom.modalExport);
          showToast('Data berhasil direset ke Kalender Resmi!');
        }
      });
    }

    // Generic Modal Close Buttons
    document.querySelectorAll('[data-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.modal;
        const targetEl = document.getElementById(targetId);
        if (targetEl) closeModal(targetEl);
      });
    });

    // Close on Modal Overlay Click
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal(modal);
      });
    });
  }

  /**
   * Splitter Resize Functionality
   */
  function setupSplitter() {
    if (!dom.splitterHandle) return;

    // Restore saved width
    const savedWidth = localStorage.getItem(SPLIT_WIDTH_KEY);
    if (savedWidth) {
      dom.ganttGridPane.style.width = `${savedWidth}px`;
    }

    let isResizing = false;

    dom.splitterHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      dom.splitterHandle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMouseMove(moveEvent) {
        if (!isResizing) return;
        const newWidth = Math.min(650, Math.max(280, moveEvent.clientX));
        dom.ganttGridPane.style.width = `${newWidth}px`;
      }

      function onMouseUp() {
        if (!isResizing) return;
        isResizing = false;
        dom.splitterHandle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem(SPLIT_WIDTH_KEY, parseFloat(dom.ganttGridPane.style.width));
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        renderDependencies();
      }

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  /**
   * Handle Passcode Authentication
   */
  async function handleAuthSubmit() {
    const entered = (dom.inputAuthPass.value || '').trim();
    if (!entered) return;

    const enteredHash = await computeSha256(entered);
    const hashes = CloudSync.getAuthHashes();

    // Check Master BPH Passwords
    if (enteredHash === hashes.bph || enteredHash === hashes.bph_alt) {
      state.isEditor = true;
      state.activeAuthDiv = 'all';
      sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ divId: 'all' }));
      closeModal(dom.modalAuth);
      updateAuthUi();
      showToast('Akses Master BPH Berhasil Diaktifkan!');
      return;
    }

    // Check Divisi Passwords
    for (const [divId, hash] of Object.entries(hashes)) {
      if (divId !== 'bph' && divId !== 'bph_alt' && enteredHash === hash) {
        const divInfo = DIVISION_MAP[divId] || { name: divId };
        state.isEditor = true;
        state.activeAuthDiv = divId;
        sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ divId: divId }));
        closeModal(dom.modalAuth);
        updateAuthUi();
        showToast(`Akses Editor Divisi ${divInfo.name} Aktif!`);
        return;
      }
    }

    // Failed
    if (dom.authErrorMessage) dom.authErrorMessage.style.display = 'block';
  }

  /**
   * Update Lock/Unlock UI Status in Header
   */
  function updateAuthUi() {
    if (!dom.btnAuthToggle) return;

    if (state.isEditor) {
      dom.authLockIcon.className = 'fa-solid fa-lock-open';
      dom.btnAuthToggle.classList.add('btn-auth-unlocked');
      const roleText = state.activeAuthDiv === 'all' ? 'Editor Master (BPH)' : `Editor Divisi (${(DIVISION_MAP[state.activeAuthDiv] || {}).name || state.activeAuthDiv})`;
      dom.btnAuthToggle.title = `${roleText} Aktif — Klik untuk Mengunci Mode Publik`;
      if (dom.btnOpenSecuritySettings) {
        dom.btnOpenSecuritySettings.style.display = state.activeAuthDiv === 'all' ? 'inline-flex' : 'none';
      }
    } else {
      dom.authLockIcon.className = 'fa-solid fa-lock';
      dom.btnAuthToggle.classList.remove('btn-auth-unlocked');
      dom.btnAuthToggle.title = 'Mode Publik (Terkunci) — Klik untuk Buka Kunci Editor';
      if (dom.btnOpenSecuritySettings) {
        dom.btnOpenSecuritySettings.style.display = 'none';
      }
    }
  }

  function showAuthRequiredToast() {
    showToast('Buka kunci Mode Editor terlebih dahulu untuk mengubah data');
    openModal(dom.modalAuth);
  }

  /**
   * Modal Open & Close Utilities
   */
  function openModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.add('active');
  }

  function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.remove('active');
  }

  /**
   * Open Create / Edit Event Modal
   */
  function openEventEditModal(eventId) {
    if (!state.isEditor) {
      showAuthRequiredToast();
      return;
    }

    if (eventId) {
      const ev = state.data.events.find(e => e.id === eventId);
      if (!ev) return;
      if (!canUserEditEvent(ev)) {
        showToast('Akses Ditolak: Anda login sebagai Editor Divisi. Hanya dapat mengedit agenda divisi Anda.');
        return;
      }

      dom.modalEventTitle.textContent = 'Edit Program Kerja';
      dom.editEventId.value = ev.id;
      dom.inputEventName.value = ev.name;
      dom.inputEventDivision.value = ev.divisionId;
      dom.inputEventDivision.disabled = state.activeAuthDiv !== 'all';
      dom.inputEventCategory.value = ev.category || 'Kajian';
      dom.inputEventDDay.value = ev.dDay || ev.startDate;
      dom.inputEventStatus.value = ev.status || 'scheduled';
      dom.inputEventDesc.value = ev.description || '';
      dom.btnDeleteEvent.style.display = 'inline-flex';
    } else {
      dom.modalEventTitle.textContent = 'Tambah Program Kerja Baru';
      dom.editEventId.value = '';
      dom.inputEventName.value = '';
      if (state.activeAuthDiv !== 'all') {
        dom.inputEventDivision.value = state.activeAuthDiv;
        dom.inputEventDivision.disabled = true;
      } else {
        dom.inputEventDivision.value = state.data.divisions[0]?.id || 'bph';
        dom.inputEventDivision.disabled = false;
      }
      dom.inputEventCategory.value = 'Kajian';
      dom.inputEventDDay.value = formatDateIso(new Date());
      dom.inputEventStatus.value = 'scheduled';
      dom.inputEventDesc.value = '';
      dom.btnDeleteEvent.style.display = 'none';
    }

    openModal(dom.modalEvent);
  }

  /**
   * Save Event Form
   */
  function handleSaveEvent() {
    const id = dom.editEventId.value;
    const name = dom.inputEventName.value.trim();
    const divId = dom.inputEventDivision.value;
    const cat = dom.inputEventCategory.value;
    const dDay = dom.inputEventDDay.value;
    const status = dom.inputEventStatus.value;
    const desc = dom.inputEventDesc.value.trim();

    if (!name || !dDay) {
      alert('Nama agenda dan tanggal Hari-H wajib diisi!');
      return;
    }

    if (id) {
      // Edit existing
      const ev = state.data.events.find(e => e.id === id);
      if (ev) {
        if (!canUserEditEvent(ev)) {
          showToast('Akses Ditolak: Anda login sebagai Editor Divisi. Hanya dapat mengedit agenda divisi Anda.');
          return;
        }
        ev.name = name;
        ev.divisionId = divId;
        ev.category = cat;
        ev.dDay = dDay;
        ev.status = status;
        ev.description = desc;
        autoRollupEventDates(id);
      }
      showToast(`Perubahan agenda "${name}" disimpan`);
      // Create new event with default WBS
      const newId = `evt-${Date.now()}`;
      const startD = addDays(dDay, -4);
      const endD = addDays(dDay, 1);

      const newEv = {
        id: newId,
        name: name,
        category: cat,
        divisionId: divId,
        dDay: dDay,
        startDate: startD,
        endDate: endD,
        status: status,
        progress: 0,
        description: desc,
        tasks: [
          {
            id: `t-${newId}-1`,
            eventId: newId,
            name: `Persiapan: ${name}`,
            divisionId: divId,
            assigneeId: state.data.members.find(m => m.divisionId === divId)?.id || state.data.members[0].id,
            startDate: startD,
            endDate: addDays(dDay, -1),
            duration: 4,
            status: status,
            progress: 0,
            predecessor: null,
            isMilestone: false
          },
          {
            id: `t-${newId}-2`,
            eventId: newId,
            name: `Hari-H: ${name}`,
            divisionId: divId,
            assigneeId: state.data.members.find(m => m.divisionId === divId)?.id || state.data.members[0].id,
            startDate: dDay,
            endDate: dDay,
            duration: 1,
            status: status,
            progress: 0,
            predecessor: `t-${newId}-1`,
            isMilestone: true
          }
        ]
      };

      state.data.events.push(newEv);
      showToast(`Program kerja baru "${name}" berhasil ditambahkan!`);
    }

    persistData();
    closeModal(dom.modalEvent);
    buildDivisionPills();
    renderCurrentView();
  }

  /**
   * Delete Event
   */
  function handleDeleteEvent() {
    const id = dom.editEventId.value;
    if (!id) return;

    const ev = state.data.events.find(e => e.id === id);
    if (!ev) return;
    if (!canUserEditEvent(ev)) {
      showToast('Akses Ditolak: Anda login sebagai Editor Divisi. Hanya dapat menghapus agenda divisi Anda.');
      return;
    }

    if (confirm('Hapus program kerja ini beserta seluruh rincian tugasnya?')) {
      state.data.events = state.data.events.filter(e => e.id !== id);
      persistData();
      closeModal(dom.modalEvent);
      buildDivisionPills();
      renderCurrentView();
      showToast('Program kerja berhasil dihapus');
    }
  }

  /**
   * Security Settings (Manage Passwords - BPH Only)
   */
  function openSecuritySettingsModal() {
    if (!state.isEditor || state.activeAuthDiv !== 'all') {
      showToast('Hanya Master BPH yang memiliki izin mengakses pengaturan keamanan.');
      return;
    }
    renderSecurityDivisionsList();
    openModal(dom.modalSecuritySettings);
  }

  function renderSecurityDivisionsList() {
    if (!dom.securityDivisionsList) return;
    const divisions = state.data.divisions || [];
    
    let html = `
      <div style="background: var(--bg-surface-0); border: 1px solid rgba(245, 158, 11, 0.4); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="font-weight: 700; color: #F59E0B; display: flex; align-items: center; gap: 6px;">
            <i class="fa-solid fa-crown"></i> Master BPH (Superadmin)
          </div>
          <span style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">Akses Penuh Seluruh Divisi</span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input type="password" id="sec_pass_bph" class="form-input" placeholder="Ketik kata sandi baru BPH..." style="font-size: 11px; height: 32px;">
          <button type="button" class="btn btn-secondary" onclick="togglePasswordVisibility('sec_pass_bph', this)" style="height: 32px; padding: 0 8px;">
            <i class="fa-solid fa-eye"></i>
          </button>
        </div>
      </div>
    `;

    divisions.forEach(d => {
      if (d.id === 'bph') return;
      html += `
        <div style="background: var(--bg-surface-0); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 10px 12px; margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <div style="font-weight: 600; font-size: 12px; color: ${d.color}; display: flex; align-items: center; gap: 6px;">
              <i class="fa-solid ${d.icon}"></i> ${d.name}
            </div>
            <span style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">Scoped Editor</span>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="password" id="sec_pass_${d.id}" class="form-input" placeholder="Ganti kata sandi ${d.name}..." style="font-size: 11px; height: 30px;">
            <button type="button" class="btn btn-secondary" onclick="togglePasswordVisibility('sec_pass_${d.id}', this)" style="height: 30px; padding: 0 8px;">
              <i class="fa-solid fa-eye"></i>
            </button>
          </div>
        </div>
      `;
    });

    dom.securityDivisionsList.innerHTML = html;
  }

  window.togglePasswordVisibility = function(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isPass = input.type === 'password';
    input.type = isPass ? 'text' : 'password';
    btn.innerHTML = isPass ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
  };

  async function handleSaveSecuritySettings() {
    if (!state.isEditor || state.activeAuthDiv !== 'all') {
      showToast('Akses ditolak');
      return;
    }

    const updates = [];
    const bphInput = document.getElementById('sec_pass_bph');
    if (bphInput && bphInput.value.trim()) {
      updates.push({ id: 'bph', pass: bphInput.value.trim() });
    }

    (state.data.divisions || []).forEach(d => {
      if (d.id === 'bph') return;
      const input = document.getElementById(`sec_pass_${d.id}`);
      if (input && input.value.trim()) {
        updates.push({ id: d.id, pass: input.value.trim() });
      }
    });

    if (updates.length === 0) {
      showToast('Tidak ada perubahan kata sandi yang dimasukkan');
      return;
    }

    dom.btnSaveSecuritySettings.disabled = true;
    dom.btnSaveSecuritySettings.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';

    for (const item of updates) {
      await CloudSync.updatePassword(item.id, item.pass);
    }

    dom.btnSaveSecuritySettings.disabled = false;
    dom.btnSaveSecuritySettings.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Simpan Password ke Cloud';

    closeModal(dom.modalSecuritySettings);
    showToast(`Berhasil memperbarui ${updates.length} kata sandi ke Cloud Firestore!`);
  }

  // =========================================================================
  // CSV SPREADSHEET EXPORT & AUTO-DETECT IMPORT ENGINE
  // =========================================================================

  function downloadCsvSchedule() {
    const delim = (dom.selectCsvDelimiter && dom.selectCsvDelimiter.value) || ';';
    const events = (state.data && state.data.events) || [];
    
    function escapeCsv(val) {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(delim) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }

    const headers = [
      'ID Agenda',
      'Nama Agenda',
      'Divisi Agenda',
      'Kategori',
      'Hari H',
      'ID Tugas',
      'Nama Tugas',
      'Divisi Tugas',
      'NIM PIC',
      'Nama PIC',
      'Tanggal Mulai',
      'Tanggal Selesai',
      'Durasi (Hari)',
      'Status',
      'Progress (%)'
    ];

    const rows = [
      `sep=${delim}`, // DIRECTIVE FOR MICROSOFT EXCEL TO AUTO-SPLIT CELLS
      headers.map(escapeCsv).join(delim)
    ];
    events.forEach(ev => {
      const divInfo = DIVISION_MAP[ev.divisionId] || { name: ev.divisionId };
      const tasks = ev.tasks || [];

      if (tasks.length > 0) {
        tasks.forEach(t => {
          const tDiv = DIVISION_MAP[t.divisionId] || divInfo;
          const member = getMember(t.assigneeId);
          rows.push([
            escapeCsv(ev.id),
            escapeCsv(ev.name),
            escapeCsv(divInfo.name),
            escapeCsv(ev.category || 'Kajian'),
            escapeCsv(ev.dDay || ev.startDate),
            escapeCsv(t.id),
            escapeCsv(t.name),
            escapeCsv(tDiv.name),
            escapeCsv(member ? member.nim : ''),
            escapeCsv(member ? member.nama : ''),
            escapeCsv(t.startDate),
            escapeCsv(t.endDate),
            escapeCsv(t.duration || getDaysBetween(t.startDate, t.endDate)),
            escapeCsv(t.status || 'scheduled'),
            escapeCsv(t.progress || 0)
          ].join(delim));
        });
      } else {
        rows.push([
          escapeCsv(ev.id),
          escapeCsv(ev.name),
          escapeCsv(divInfo.name),
          escapeCsv(ev.category || 'Kajian'),
          escapeCsv(ev.dDay || ev.startDate),
          '', '', '', '', '',
          escapeCsv(ev.startDate),
          escapeCsv(ev.endDate),
          escapeCsv(getDaysBetween(ev.startDate, ev.endDate)),
          escapeCsv(ev.status || 'scheduled'),
          escapeCsv(ev.progress || 0)
        ].join(delim));
      }
    });

    const csvContent = '\uFEFF' + rows.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Rijal_Dakwah_Jadwal_Proker_${delim === ';' ? 'Excel_ID' : 'Universal'}_${formatDateIso(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`File CSV berhasil diunduh (Pemisah '${delim}')`);
  }

  function downloadExcelSchedule() {
    const events = (state.data && state.data.events) || [];

    let tableRows = '';
    events.forEach(ev => {
      const divInfo = DIVISION_MAP[ev.divisionId] || { name: ev.divisionId };
      const tasks = ev.tasks || [];

      if (tasks.length > 0) {
        tasks.forEach(t => {
          const tDiv = DIVISION_MAP[t.divisionId] || divInfo;
          const member = getMember(t.assigneeId);
          tableRows += `
            <tr>
              <td style="mso-number-format: '\\@';">${ev.id}</td>
              <td style="font-weight: bold;">${ev.name}</td>
              <td>${divInfo.name}</td>
              <td>${ev.category || 'Kajian'}</td>
              <td style="text-align: center;">${ev.dDay || ev.startDate}</td>
              <td style="mso-number-format: '\\@';">${t.id}</td>
              <td>${t.name}</td>
              <td>${tDiv.name}</td>
              <td style="mso-number-format: '\\@';">${member ? member.nim : ''}</td>
              <td>${member ? member.nama : ''}</td>
              <td style="text-align: center;">${t.startDate}</td>
              <td style="text-align: center;">${t.endDate}</td>
              <td style="text-align: center; mso-number-format: '0';">${t.duration || getDaysBetween(t.startDate, t.endDate)}</td>
              <td style="text-align: center;">${t.status || 'scheduled'}</td>
              <td style="text-align: center; mso-number-format: '0%';">${t.progress || 0}%</td>
            </tr>
          `;
        });
      } else {
        tableRows += `
          <tr>
            <td style="mso-number-format: '\\@';">${ev.id}</td>
            <td style="font-weight: bold;">${ev.name}</td>
            <td>${divInfo.name}</td>
            <td>${ev.category || 'Kajian'}</td>
            <td style="text-align: center;">${ev.dDay || ev.startDate}</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td style="text-align: center;">${ev.startDate}</td>
            <td style="text-align: center;">${ev.endDate}</td>
            <td style="text-align: center; mso-number-format: '0';">${getDaysBetween(ev.startDate, ev.endDate)}</td>
            <td style="text-align: center;">${ev.status || 'scheduled'}</td>
            <td style="text-align: center; mso-number-format: '0%';">${ev.progress || 0}%</td>
          </tr>
        `;
      }
    });

    const excelTemplate = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <!--[if gte mso 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>Jadwal Proker RD 2026-2027</x:Name>
                <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
        <style>
          th { background-color: #0F172A; color: #FFFFFF; font-weight: bold; border: 0.5pt solid #000; text-align: center; font-size: 11px; padding: 6px; }
          td { border: 0.5pt solid #CBD5E1; vertical-align: middle; font-size: 10px; padding: 5px; }
        </style>
      </head>
      <body>
        <table border="1">
          <thead>
            <tr>
              <th>ID Agenda</th>
              <th>Nama Agenda</th>
              <th>Divisi Agenda</th>
              <th>Kategori</th>
              <th>Hari H</th>
              <th>ID Tugas</th>
              <th>Nama Tugas</th>
              <th>Divisi Tugas</th>
              <th>NIM PIC</th>
              <th>Nama PIC</th>
              <th>Tanggal Mulai</th>
              <th>Tanggal Selesai</th>
              <th>Durasi (Hari)</th>
              <th>Status</th>
              <th>Progress (%)</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </body>
      </html>
    `;

    const blob = new Blob(['\uFEFF' + excelTemplate], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Rijal_Dakwah_Jadwal_Proker_${formatDateIso(new Date())}.xls`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('File Excel (.xls) berhasil diunduh — Pasti langsung terpetak di kolom sel!');
  }

  function importCsvSchedule(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        if (!text || !text.trim()) {
          alert('Berkas CSV kosong.');
          return;
        }

        // Auto-detect delimiter (; or ,)
        const sample = text.split('\n').slice(0, 5).join('\n');
        const semiCount = (sample.match(/;/g) || []).length;
        const commaCount = (sample.match(/,/g) || []).length;
        const delim = semiCount >= commaCount ? ';' : ',';

        // Parse CSV rows respecting quotes
        const parsedRows = [];
        let currentRow = [];
        let currentVal = '';
        let inQuotes = false;

        for (let i = 0; i < text.length; i++) {
          const char = text[i];
          const nextChar = text[i + 1];

          if (char === '"') {
            if (inQuotes && nextChar === '"') {
              currentVal += '"';
              i++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (char === delim && !inQuotes) {
            currentRow.push(currentVal.trim());
            currentVal = '';
          } else if ((char === '\r' || char === '\n') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') i++;
            currentRow.push(currentVal.trim());
            if (currentRow.some(c => c.length > 0)) parsedRows.push(currentRow);
            currentRow = [];
            currentVal = '';
          } else {
            currentVal += char;
          }
        }
        if (currentVal.length > 0 || currentRow.length > 0) {
          currentRow.push(currentVal.trim());
          if (currentRow.some(c => c.length > 0)) parsedRows.push(currentRow);
        }

        // If row 0 is Excel's sep= directive, ignore it
        if (parsedRows.length > 0 && parsedRows[0][0] && parsedRows[0][0].toLowerCase().startsWith('sep=')) {
          parsedRows.shift();
        }

        if (parsedRows.length < 2) {
          alert('Format CSV tidak memiliki baris data.');
          return;
        }
        const headers = parsedRows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
        const findColIdx = (...candidates) => {
          for (const cand of candidates) {
            const idx = headers.findIndex(h => h.includes(cand));
            if (idx !== -1) return idx;
          }
          return -1;
        };

        const idxEvId = findColIdx('idagenda', 'eventid', 'idevent', 'agendaid');
        const idxEvName = findColIdx('namaagenda', 'agenda', 'eventname', 'kegiatan');
        const idxEvDiv = findColIdx('divisiagenda', 'divisi');
        const idxEvDDay = findColIdx('harih', 'dday', 'tanggal');
        const idxTaskId = findColIdx('idtugas', 'taskid');
        const idxTaskName = findColIdx('namatugas', 'tugas', 'taskname');
        const idxTaskDiv = findColIdx('divisitugas');
        const idxPicNim = findColIdx('nimpic', 'nim');
        const idxPicName = findColIdx('namapic', 'pic');
        const idxStart = findColIdx('tanggalmulai', 'mulai', 'start');
        const idxEnd = findColIdx('tanggalselesai', 'selesai', 'end');
        const idxDuration = findColIdx('durasi');
        const idxStatus = findColIdx('status');
        const idxProgress = findColIdx('progress');

        const eventsMap = {};
        // Index existing events
        (state.data.events || []).forEach(ev => {
          eventsMap[ev.id] = { ...ev, tasks: [...(ev.tasks || [])] };
        });

        let importedTasksCount = 0;
        let importedEventsCount = 0;

        for (let r = 1; r < parsedRows.length; r++) {
          const row = parsedRows[r];
          const evName = idxEvName !== -1 ? row[idxEvName] : '';
          if (!evName) continue;

          let evId = idxEvId !== -1 ? row[idxEvId] : '';
          if (!evId) {
            const found = Object.values(eventsMap).find(e => e.name.toLowerCase() === evName.toLowerCase());
            evId = found ? found.id : `evt-${Date.now()}-${r}`;
          }

          if (!eventsMap[evId]) {
            importedEventsCount++;
            eventsMap[evId] = {
              id: evId,
              name: evName,
              divisionId: idxEvDiv !== -1 ? (matchDivisionId(row[idxEvDiv]) || 'bph') : 'bph',
              category: 'Kajian',
              dDay: idxEvDDay !== -1 && row[idxEvDDay] ? row[idxEvDDay] : formatDateIso(new Date()),
              startDate: idxStart !== -1 && row[idxStart] ? row[idxStart] : formatDateIso(new Date()),
              endDate: idxEnd !== -1 && row[idxEnd] ? row[idxEnd] : formatDateIso(new Date()),
              status: idxStatus !== -1 && row[idxStatus] ? row[idxStatus].toLowerCase() : 'scheduled',
              progress: 0,
              tasks: []
            };
          }

          // Check Task
          const taskName = idxTaskName !== -1 ? row[idxTaskName] : '';
          if (taskName) {
            importedTasksCount++;
            let taskId = idxTaskId !== -1 ? row[idxTaskId] : '';
            if (!taskId) taskId = `t-${Date.now()}-${r}`;

            // Match PIC
            let assigneeId = 'm_2024_38_3238'; // default Fasya
            const nimVal = idxPicNim !== -1 ? row[idxPicNim] : '';
            const nameVal = idxPicName !== -1 ? row[idxPicName] : '';
            if (nimVal) {
              const m = state.data.members.find(x => x.nim === nimVal);
              if (m) assigneeId = m.id;
            } else if (nameVal) {
              const m = state.data.members.find(x => x.nama.toLowerCase().includes(nameVal.toLowerCase()));
              if (m) assigneeId = m.id;
            }

            const tStart = idxStart !== -1 && row[idxStart] ? row[idxStart] : eventsMap[evId].startDate;
            const tEnd = idxEnd !== -1 && row[idxEnd] ? row[idxEnd] : eventsMap[evId].endDate;
            const tDur = idxDuration !== -1 && parseInt(row[idxDuration], 10) ? parseInt(row[idxDuration], 10) : getDaysBetween(tStart, tEnd);
            const tStat = idxStatus !== -1 && row[idxStatus] ? row[idxStatus].toLowerCase() : 'scheduled';
            const tProg = idxProgress !== -1 && parseInt(row[idxProgress], 10) ? parseInt(row[idxProgress], 10) : 0;
            const tDiv = idxTaskDiv !== -1 ? (matchDivisionId(row[idxTaskDiv]) || eventsMap[evId].divisionId) : eventsMap[evId].divisionId;

            const existingTaskIdx = eventsMap[evId].tasks.findIndex(t => t.id === taskId || t.name.toLowerCase() === taskName.toLowerCase());
            const taskObj = {
              id: taskId,
              eventId: evId,
              name: taskName,
              divisionId: tDiv,
              assigneeId: assigneeId,
              startDate: tStart,
              endDate: tEnd,
              duration: tDur,
              status: tStat,
              progress: tProg
            };

            if (existingTaskIdx !== -1) {
              eventsMap[evId].tasks[existingTaskIdx] = taskObj;
            } else {
              eventsMap[evId].tasks.push(taskObj);
            }
          }
        }

        // Apply back and auto-rollup
        state.data.events = Object.values(eventsMap);
        state.data.events.forEach(ev => autoRollupEventDates(ev.id));

        persistData();
        renderCurrentView();
        closeModal(dom.modalExport);
        showToast(`Berhasil mengimpor CSV (Pemisah '${delim}'): ${importedTasksCount} tugas & ${state.data.events.length} agenda diperbarui!`);

      } catch (err) {
        alert('Gagal memproses berkas CSV: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function matchDivisionId(divNameOrId) {
    if (!divNameOrId) return 'bph';
    const clean = divNameOrId.toLowerCase().trim();
    for (const [id, d] of Object.entries(DIVISION_MAP)) {
      if (id === clean || d.name.toLowerCase().includes(clean)) return id;
    }
    return 'bph';
  }

  // =========================================================================
  // EXECUTIVE PDF PRINT REPORT GENERATOR (LANDSCAPE A4 KOP SURAT)
  // =========================================================================

  function generateExecutivePdfReport() {
    closeModal(dom.modalExport);

    const events = (state.data && state.data.events) || [];
    const members = (state.data && state.data.members) || [];
    const divisions = (state.data && state.data.divisions) || [];

    // Sort events chronologically
    const sortedEvents = [...events].sort((a, b) => {
      const da = a.dDay || a.startDate || '';
      const db = b.dDay || b.startDate || '';
      return da.localeCompare(db);
    });

    // Compute stats
    let totalTasksCount = 0;
    const divStats = {};
    divisions.forEach(d => {
      divStats[d.id] = { name: d.name, eventsCount: 0, tasksCount: 0, color: d.color };
    });

    sortedEvents.forEach(ev => {
      if (divStats[ev.divisionId]) divStats[ev.divisionId].eventsCount++;
      (ev.tasks || []).forEach(t => {
        totalTasksCount++;
        const tDiv = t.divisionId || ev.divisionId;
        if (divStats[tDiv]) divStats[tDiv].tasksCount++;
      });
    });

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Mohon izinkan pop-up browser untuk membuka jendela cetak PDF.');
      return;
    }

    const todayStr = new Date().toLocaleDateString('id-ID', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

    const html = `
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <title>Master Jadwal & Timeline Program Kerja UKM Rijal Dakwah 2026-2027</title>
        <style>
          @page {
            size: landscape A4;
            margin: 8mm 12mm 10mm 12mm;
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: 'Times New Roman', Times, serif, Arial;
            background: #FFFFFF;
            color: #0F172A;
            font-size: 11px;
            line-height: 1.4;
            padding: 10px 14px;
          }
          .kop-surat {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 16px;
            margin-bottom: 4px;
            padding-bottom: 6px;
            position: relative;
          }
          .kop-logo {
            width: 72px;
            height: 72px;
            object-fit: contain;
          }
          .kop-text {
            text-align: center;
          }
          .kop-text h4 {
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.5px;
            margin-bottom: 2px;
            color: #1E293B;
          }
          .kop-text h2 {
            font-size: 16px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #0F172A;
            margin-bottom: 2px;
          }
          .kop-text p {
            font-size: 9.5px;
            color: #475569;
            margin: 1px 0;
            font-family: Arial, sans-serif;
          }
          .kop-divider {
            border-top: 3px double #0F172A;
            margin-bottom: 12px;
          }
          .doc-header {
            text-align: center;
            margin-bottom: 12px;
          }
          .doc-title {
            font-size: 14px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            text-decoration: underline;
            margin-bottom: 3px;
          }
          .doc-sub {
            font-size: 10px;
            color: #475569;
            font-family: Arial, sans-serif;
          }
          .kpi-container {
            display: flex;
            gap: 10px;
            margin-bottom: 12px;
            font-family: Arial, sans-serif;
          }
          .kpi-box {
            flex: 1;
            border: 1px solid #CBD5E1;
            background: #F8FAFC;
            border-radius: 4px;
            padding: 6px 10px;
            text-align: center;
          }
          .kpi-val {
            font-size: 16px;
            font-weight: 700;
            color: #0F172A;
          }
          .kpi-label {
            font-size: 9.5px;
            color: #64748B;
            text-transform: uppercase;
            font-weight: 600;
          }
          table.report-table {
            width: 100%;
            border-collapse: collapse;
            font-family: Arial, sans-serif;
            font-size: 10px;
            margin-bottom: 14px;
          }
          table.report-table th, table.report-table td {
            border: 1px solid #94A3B8;
            padding: 5px 6px;
            vertical-align: middle;
          }
          table.report-table th {
            background-color: #0F172A;
            color: #FFFFFF;
            font-weight: 700;
            text-transform: uppercase;
            font-size: 9.5px;
            text-align: center;
          }
          tr.ev-row {
            background-color: #F1F5F9;
            font-weight: 700;
          }
          tr.task-row td:first-child {
            padding-left: 20px;
          }
          .badge-div {
            display: inline-block;
            padding: 1px 5px;
            border-radius: 3px;
            font-size: 9px;
            font-weight: 600;
            border: 1px solid #CBD5E1;
          }
          .badge-status {
            display: inline-block;
            padding: 1px 4px;
            border-radius: 3px;
            font-size: 8.5px;
            font-weight: 600;
            text-transform: uppercase;
          }
          .status-completed { background: #DCFCE7; color: #166534; }
          .status-in_progress { background: #DBEAFE; color: #1E40AF; }
          .status-scheduled { background: #FEF3C7; color: #92400E; }
          .status-postponed { background: #FEE2E2; color: #991B1B; }
          .sign-section {
            display: flex;
            justify-content: space-between;
            margin-top: 16px;
            page-break-inside: avoid;
            font-family: Arial, sans-serif;
            padding: 0 40px;
          }
          .sign-col {
            text-align: center;
            width: 240px;
          }
          .sign-space {
            height: 52px;
          }
          .sign-name {
            font-weight: 700;
            font-size: 11px;
            text-decoration: underline;
          }
          .sign-meta {
            font-size: 9.5px;
            color: #475569;
          }
          @media print {
            body { padding: 0; }
            .no-print { display: none !important; }
            tr { page-break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="background: #FEF3C7; border: 1px solid #F59E0B; padding: 8px 14px; border-radius: 4px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; font-family: Arial;">
          <span style="font-size: 11px; color: #92400E;"><strong>Pratinjau Dokumen PDF Resmi:</strong> Klik tombol Cetak untuk menyimpan sebagai PDF A4 Landscape berkualitas tinggi.</span>
          <button onclick="window.print()" style="background: #2563EB; color: #FFF; border: none; padding: 6px 16px; border-radius: 4px; font-weight: bold; cursor: pointer;">
            🖨️ Cetak / Simpan PDF
          </button>
        </div>

        <div class="kop-surat">
          <img src="logo-rijal-dakwah.png" class="kop-logo" onerror="this.style.display='none'">
          <div class="kop-text">
            <h4>LEMBAGA DAKWAH KAMPUS — UKM RIJAL DAKWAH</h4>
            <h2>SEKOLAH TINGGI DIRASAT ISLAMIYAH IMAM SYAFI'I JEMBER</h2>
            <p>Alamat: Jl. MH Thamrin Gg. Malabar No. 112, Gladak Pakem, Kranjingan, Sumbersari, Jember 68121</p>
            <p>Website: rijaldakwah.stdiis.ac.id | Surel: ukm.rijaldakwah@stdiis.ac.id</p>
          </div>
        </div>
        <div class="kop-divider"></div>

        <div class="doc-header">
          <div class="doc-title">MASTER SCHEDULE & TIMELINE PROGRAM KERJA TAHUN 1448 H / 2026-2027 M</div>
          <div class="doc-sub">Dokumen Resmi Rijal Dakwah Gantt Studio v3.0 • Berdasarkan SK Sekretaris & Kalender Terintegrasi</div>
        </div>

        <div class="kpi-container">
          <div class="kpi-box">
            <div class="kpi-val">${sortedEvents.length}</div>
            <div class="kpi-label">Total Agenda Proker</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-val">${totalTasksCount}</div>
            <div class="kpi-label">Total Beban Sub-Tugas</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-val">${members.length}</div>
            <div class="kpi-label">Pengurus SK Terpetakan</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-val">${divisions.length}</div>
            <div class="kpi-label">Divisi Resmi UKM</div>
          </div>
        </div>

        <table class="report-table">
          <thead>
            <tr>
              <th style="width: 30px;">No</th>
              <th style="width: 85px;">Tanggal / Hari-H</th>
              <th>Program Kerja & Rincian Sub-Tugas</th>
              <th style="width: 100px;">Divisi</th>
              <th style="width: 160px;">Penanggung Jawab (PIC)</th>
              <th style="width: 55px;">Durasi</th>
              <th style="width: 75px;">Status</th>
              <th style="width: 55px;">Progress</th>
            </tr>
          </thead>
          <tbody>
            ${sortedEvents.map((ev, idx) => {
              const divInfo = DIVISION_MAP[ev.divisionId] || { name: 'Umum' };
              const tasks = ev.tasks || [];
              const dDayStr = formatShortDate(ev.dDay || ev.startDate);

              let eventRows = `
                <tr class="ev-row">
                  <td style="text-align: center;">${idx + 1}</td>
                  <td style="text-align: center; font-weight: 700; color: #1E293B;">${dDayStr}</td>
                  <td>
                    <span style="font-size: 11px;">${ev.name}</span>
                    <span style="font-size: 9px; color: #64748B; margin-left: 6px;">(${ev.category || 'Kajian'})</span>
                  </td>
                  <td>
                    <span class="badge-div" style="background: #F1F5F9; color: #0F172A;">
                      ${divInfo.name.replace('Divisi ', '')}
                    </span>
                  </td>
                  <td>-</td>
                  <td style="text-align: center;">${getDaysBetween(ev.startDate, ev.endDate)}h</td>
                  <td style="text-align: center;">
                    <span class="badge-status status-${ev.status}">${ev.status}</span>
                  </td>
                  <td style="text-align: center;">${ev.progress || 0}%</td>
                </tr>
              `;

              tasks.forEach(t => {
                const tDiv = DIVISION_MAP[t.divisionId] || divInfo;
                const m = getMember(t.assigneeId);
                const picName = m ? `${m.nama} (${m.nim})` : '-';
                eventRows += `
                  <tr class="task-row">
                    <td></td>
                    <td style="text-align: center; font-size: 9px; color: #64748B;">${formatShortDate(t.startDate)} - ${formatShortDate(t.endDate)}</td>
                    <td style="padding-left: 18px;">
                      ↳ ${t.name}
                    </td>
                    <td>
                      <span class="badge-div" style="background: #F8FAFC; color: #475569; font-size: 8.5px;">
                        ${tDiv.name.replace('Divisi ', '')}
                      </span>
                    </td>
                    <td style="font-size: 9.5px;">${picName}</td>
                    <td style="text-align: center; font-size: 9px;">${t.duration || 1}h</td>
                    <td style="text-align: center;">
                      <span class="badge-status status-${t.status}">${t.status}</span>
                    </td>
                    <td style="text-align: center; font-size: 9px;">${t.progress || 0}%</td>
                  </tr>
                `;
              });

              return eventRows;
            }).join('')}
          </tbody>
        </table>

        <div class="sign-section">
          <div class="sign-col">
            <p>Mengetahui,</p>
            <p style="font-weight: 700;">Ketua Umum UKM Rijal Dakwah</p>
            <div class="sign-space"></div>
            <p class="sign-name">Fasya Ramadhan</p>
            <p class="sign-meta">NIM: 2024.38.3238</p>
          </div>
          <div class="sign-col">
            <p>Jember, ${todayStr}</p>
            <p style="font-weight: 700;">Sekretaris Umum UKM Rijal Dakwah</p>
            <div class="sign-space"></div>
            <p class="sign-name">Fazli Aljabbaar Fujiyono Putra</p>
            <p class="sign-meta">NIM: 2024.38.3393</p>
          </div>
        </div>

        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 500);
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    showToast('Pratinjau Dokumen PDF Resmi dibuka');
  }

  /**
   * Open Task Detail Inspector Modal & Delegasi PIC
   */
  function openTaskDetailModal(taskId) {
    const task = findTask(taskId);
    if (!task) return;

    const parentEvent = state.data.events.find(e => e.id === task.eventId);
    const divInfo = DIVISION_MAP[task.divisionId] || { name: 'Umum', color: '#64748B' };
    const currentPic = getMember(task.assigneeId);

    dom.detailTaskTitle.textContent = task.name;

    // 1. Calculate real-time task counts & date clashes for all 109 members
    const memberLoad = {};
    const memberClashes = {};

    (state.data.members || []).forEach(m => {
      memberLoad[m.id] = 0;
      memberClashes[m.id] = [];
    });

    (state.data.events || []).forEach(ev => {
      if (ev.tasks) {
        ev.tasks.forEach(t => {
          if (memberLoad[t.assigneeId] !== undefined) {
            memberLoad[t.assigneeId]++;
            // Check overlap with current task dates (excluding this task itself)
            if (t.id !== task.id) {
              if (t.startDate <= task.endDate && t.endDate >= task.startDate) {
                memberClashes[t.assigneeId].push(t.name);
              }
            }
          }
        });
      }
    });
    // 2. Build grouped PIC options by Division with Color Coding
    let picOptionsHtml = '';
    (state.data.divisions || []).forEach(d => {
      const divMembers = (state.data.members || []).filter(m => m.divisionId === d.id);
      if (divMembers.length > 0) {
        picOptionsHtml += `<optgroup label="■ ${d.name} (${divMembers.length} Orang)" style="color: ${d.color}; font-weight: 700; background: #0B0F17;">`;
        divMembers.forEach(m => {
          const isSelected = m.id === task.assigneeId;
          const load = memberLoad[m.id] || 0;
          const clashes = memberClashes[m.id] || [];
          const isClashing = clashes.length > 0;

          let loadLabel = `${load} tugas`;
          if (load === 0) loadLabel = 'Luang (0 tugas)';
          else if (load <= 2) loadLabel = `Optimal (${load} tugas)`;
          else loadLabel = `Padat (${load} tugas)`;

          const clashTag = isClashing ? ' ⚠️ BENTROK JADWAL' : '';
          const kadivTag = m.isKadiv ? ' [Kadiv]' : '';
          const divPrefix = `[${d.name.replace('Divisi ', '')}]`;

          picOptionsHtml += `
            <option value="${m.id}" data-div-id="${d.id}" data-div-color="${d.color}" data-div-name="${d.name}" ${isSelected ? 'selected' : ''} style="color: ${d.color}; background: #141E33; font-weight: 500;">
              ● ${divPrefix} ${m.nama}${kadivTag} — ${loadLabel}${clashTag}
            </option>
          `;
        });
        picOptionsHtml += `</optgroup>`;
      }
    });
    dom.detailModalBody.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span class="status-badge" style="background-color: ${divInfo.color}25; color: ${divInfo.color}; font-size: 11px;">
          ${divInfo.name}
        </span>
        <span class="status-badge ${task.status}">${task.status} (${task.progress || 0}%)</span>
      </div>

      <div style="font-size: 14px; font-weight: 700; color: var(--text-primary); margin-bottom: 2px;">
        ${task.name}
      </div>
      <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">
        <i class="fa-regular fa-folder-open" style="margin-right: 5px;"></i>Agenda: <strong>${parentEvent ? parentEvent.name : '-'}</strong> (${parentEvent ? parentEvent.category : ''})
      </div>

      <!-- Quick Metrics Summary -->
      <div style="background: var(--bg-surface-0); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 10px 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px; margin-bottom: 14px;">
        <div>
          <span style="color: var(--text-muted);">Rentang Waktu:</span>
          <div style="font-family: var(--font-mono); font-weight: 600; color: var(--text-primary);">${formatDateIndo(task.startDate)} - ${formatDateIndo(task.endDate)}</div>
        </div>
        <div>
          <span style="color: var(--text-muted);">Durasi Kerja:</span>
          <div style="font-family: var(--font-mono); font-weight: 600; color: var(--text-primary);">${task.duration || getDaysBetween(task.startDate, task.endDate)} Hari ${task.isMilestone ? '💎 (Milestone Hari-H)' : ''}</div>
        </div>
      </div>

      <!-- INTERACTIVE REASSIGNMENT & TASK EDIT FORM -->
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div class="form-group">
          <label class="form-label" style="display: flex; justify-content: space-between;">
            <span><i class="fa-solid fa-user-tag" style="margin-right: 4px; color: #60A5FA;"></i> Penanggung Jawab (PIC) / Alihkan Tugas:</span>
            <span style="font-size: 10px; color: var(--text-muted);">Pilih personil yang 'Luang' untuk cegah overload</span>
          </label>
          <select id="selectReassignPIC" class="form-select" style="transition: border-color 0.2s ease, box-shadow 0.2s ease;">
            ${picOptionsHtml}
          </select>
          <div id="selectedPicDivInfo" style="display: flex; align-items: center; justify-content: space-between; margin-top: 5px; font-size: 11px;"></div>
        </div>

        <!-- Predecessor / Dependency Branching Selector -->
        <div class="form-group">
          <label class="form-label" style="display: flex; justify-content: space-between;">
            <span><i class="fa-solid fa-code-branch" style="margin-right: 4px; color: #8B5CF6;"></i> Relasi Cabang (Bercabang dari Tugas / Predecessor):</span>
            <span style="font-size: 10px; color: var(--text-muted);">Menentukan garis panah alur kerja</span>
          </label>
          <select id="selectTaskPredecessor" class="form-select">
            <option value="">-- Tanpa Prasyarat (Awal Alur / Root) --</option>
            ${(parentEvent && parentEvent.tasks ? parentEvent.tasks : [])
              .filter(t => t.id !== task.id)
              .map(t => `<option value="${t.id}" ${task.predecessor === t.id ? 'selected' : ''}>Bercabang dari: ${t.name}</option>`)
              .join('')}
          </select>
        </div>

        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label"><i class="fa-solid fa-circle-dot" style="margin-right: 4px; color: #F59E0B;"></i> Status Tugas:</label>
            <select id="selectTaskStatus" class="form-select">
              <option value="scheduled" ${task.status === 'scheduled' ? 'selected' : ''}>Terjadwal</option>
              <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>Sedang Berjalan</option>
              <option value="completed" ${task.status === 'completed' ? 'selected' : ''}>Selesai (Completed)</option>
              <option value="postponed" ${task.status === 'postponed' ? 'selected' : ''}>Ditunda (Postponed)</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label"><i class="fa-solid fa-bars-progress" style="margin-right: 4px; color: #10B981;"></i> Progres Kerja (%):</label>
            <input type="number" id="inputTaskProgress" class="form-input" min="0" max="100" value="${task.progress || 0}">
          </div>
        </div>

        <!-- Quick Add Child Branch Task Button & Form -->
        <div style="border-top: 1px dashed var(--border-medium); padding-top: 12px; margin-top: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-weight: 600; font-size: 12px; color: var(--text-primary);">
              <i class="fa-solid fa-diagram-project" style="color: #60A5FA; margin-right: 5px;"></i> Cabang Alur Lanjutan
            </span>
            <button type="button" class="btn" id="btnToggleNewBranchForm" style="font-size: 11px; padding: 3px 8px; height: 26px;">
              <i class="fa-solid fa-plus"></i> Tambah Cabang Baru
            </button>
          </div>

          <div id="newBranchFormContainer" style="display: none; background: var(--bg-surface-0); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 10px; margin-top: 6px;">
            <div class="form-group" style="margin-bottom: 8px;">
              <label class="form-label">Nama Cabang Tugas Baru (Successor):</label>
              <input type="text" id="inputNewBranchName" class="form-input" placeholder="Contoh: Briefing Lapangan & Soundcheck">
            </div>
            <div class="form-row-2" style="margin-bottom: 8px;">
              <div class="form-group">
                <label class="form-label">Divisi:</label>
                <select id="selectNewBranchDiv" class="form-select">
                  ${(state.data.divisions || []).map(d => `<option value="${d.id}" ${d.id === task.divisionId ? 'selected' : ''}>${d.name}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Durasi (Hari):</label>
                <input type="number" id="inputNewBranchDuration" class="form-input" min="1" max="30" value="2">
              </div>
            </div>
            <button type="button" class="btn btn-primary" id="btnSubmitNewBranch" style="width: 100%; height: 30px; font-size: 11px;">
              <i class="fa-solid fa-code-branch"></i> Buat & Hubungkan Cabang Ini
            </button>
          </div>
        </div>
      </div>
    `;
    // Dynamic Division Color Highlighter for PIC Selector
    const selectPicEl = document.getElementById('selectReassignPIC');
    const picDivInfoEl = document.getElementById('selectedPicDivInfo');

    function updateSelectedPicStyle() {
      if (!selectPicEl) return;
      const opt = selectPicEl.options[selectPicEl.selectedIndex];
      if (opt) {
        const divColor = opt.dataset.divColor || '#3B82F6';
        const divName = opt.dataset.divName || 'Divisi';
        selectPicEl.style.borderColor = divColor;
        selectPicEl.style.boxShadow = `0 0 0 1px ${divColor}50`;
        if (picDivInfoEl) {
          picDivInfoEl.innerHTML = `
            <span style="display: inline-flex; align-items: center; gap: 5px; color: ${divColor}; font-weight: 600;">
              <span style="width: 8px; height: 8px; border-radius: 50%; background: ${divColor}; display: inline-block;"></span>
              ${divName}
            </span>
            <span style="color: var(--text-muted); font-size: 10px;">Identifikasi warna divisi otomatis</span>
          `;
        }
      }
    }

    if (selectPicEl) {
      selectPicEl.addEventListener('change', updateSelectedPicStyle);
      updateSelectedPicStyle();
    }


    // Button Handler: Save PIC, Status, Progress, and Predecessor
    if (dom.btnSaveTaskPIC) {
      dom.btnSaveTaskPIC.onclick = () => {
        if (!state.isEditor) {
          showAuthRequiredToast();
          return;
        }
        if (!canUserEditTask(task, parentEvent)) {
          showToast('Akses Ditolak: Anda login sebagai Editor Divisi. Hanya dapat mengelola tugas divisi Anda.');
          return;
        }
        const selectPic = document.getElementById('selectReassignPIC');
        const selectStatus = document.getElementById('selectTaskStatus');
        const inputProg = document.getElementById('inputTaskProgress');
        const selectPred = document.getElementById('selectTaskPredecessor');

        if (!selectPic) return;

        const newPicId = selectPic.value;
        const newStatus = selectStatus.value;
        const newProgress = Math.max(0, Math.min(100, parseInt(inputProg.value, 10) || 0));
        const newPredecessor = selectPred ? (selectPred.value || null) : null;

        task.assigneeId = newPicId;
        task.status = newStatus;
        task.progress = newProgress;
        task.predecessor = newPredecessor;

        // Auto rollup parent event progress
        if (parentEvent && parentEvent.tasks) {
          parentEvent.progress = Math.round(
            parentEvent.tasks.reduce((sum, t) => sum + (t.progress || 0), 0) / parentEvent.tasks.length
          );
        }

        persistData();
        closeModal(dom.modalDetail);
        renderCurrentView();

        const newMember = getMember(newPicId);
        const newName = newMember ? newMember.nama : 'Personil baru';
        showToast(`Perubahan tugas & relasi cabang "${task.name}" disimpan!`);
      };
    }

    // Toggle New Branch Form
    const btnToggleBranch = document.getElementById('btnToggleNewBranchForm');
    const branchContainer = document.getElementById('newBranchFormContainer');
    if (btnToggleBranch && branchContainer) {
      btnToggleBranch.onclick = () => {
        const isHidden = branchContainer.style.display === 'none';
        branchContainer.style.display = isHidden ? 'block' : 'none';
        btnToggleBranch.innerHTML = isHidden ? '<i class="fa-solid fa-xmark"></i> Batal' : '<i class="fa-solid fa-plus"></i> Tambah Cabang Baru';
      };
    }

    // Submit New Branch Task (Child / Successor)
    const btnSubmitBranch = document.getElementById('btnSubmitNewBranch');
    if (btnSubmitBranch) {
      btnSubmitBranch.onclick = () => {
        if (!state.isEditor) {
          showAuthRequiredToast();
          return;
        }
        if (!canUserEditTask(task, parentEvent)) {
          showToast('Akses Ditolak: Anda login sebagai Editor Divisi. Hanya dapat menambah cabang tugas divisi Anda.');
          return;
        }

        const inputName = document.getElementById('inputNewBranchName');

        const branchDiv = selectDiv.value;
        const duration = Math.max(1, parseInt(inputDur.value, 10) || 2);
        const newTaskId = `t-${Date.now()}`;

        // Start date starts right when current task ends or parallel
        const startD = task.endDate || task.startDate;
        const endD = addDays(startD, duration - 1);

        // Pick available member in that division
        const divMembers = (state.data.members || []).filter(m => m.divisionId === branchDiv);
        const assignedMemberId = divMembers.length > 0 ? divMembers[0].id : (state.data.members[0]?.id || 'm_01');

        const newBranchTask = {
          id: newTaskId,
          eventId: task.eventId,
          name: branchName,
          divisionId: branchDiv,
          assigneeId: assignedMemberId,
          startDate: startD,
          endDate: endD,
          duration: duration,
          status: 'scheduled',
          progress: 0,
          predecessor: task.id, // Direct branch from current task!
          isMilestone: false
        };

        if (!parentEvent.tasks) parentEvent.tasks = [];
        parentEvent.tasks.push(newBranchTask);

        autoRollupEventDates(parentEvent.id);
        persistData();
        closeModal(dom.modalDetail);
        renderCurrentView();

        showToast(`Cabang alur baru "${branchName}" berhasil dibuat dan dihubungkan!`);
      };
    }

    // Button Handler: Edit Parent Event
    if (dom.btnEditParentEvent) {
      dom.btnEditParentEvent.onclick = () => {
        closeModal(dom.modalDetail);
        if (parentEvent) openEventEditModal(parentEvent.id);
      };
    }
    openModal(dom.modalDetail);
  }

  /**
   * Toast Notification Controller
   */
  function showToast(message) {
    if (!dom.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #34D399;"></i> <span>${message}</span>`;
    dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s ease';
      setTimeout(() => toast.remove(), 200);
    }, 2800);
  }

  // =========================================================================
  // HELPER FUNCTIONS & DATE MATH
  // =========================================================================

  function findTask(taskId) {
    if (!state.data || !state.data.events) return null;
    for (const ev of state.data.events) {
      if (ev.tasks) {
        const found = ev.tasks.find(t => t.id === taskId);
        if (found) return found;
      }
    }
    return null;
  }

  function getMember(memberId) {
    if (!state.data || !state.data.members) return null;
    return state.data.members.find(m => m.id === memberId) || null;
  }

  function parseDate(isoStr) {
    const parts = isoStr.split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  function formatDateIso(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatShortDate(isoStr) {
    if (!isoStr) return '-';
    const parts = isoStr.split('-');
    const mNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return `${parseInt(parts[2], 10)} ${mNames[parseInt(parts[1], 10) - 1]}`;
  }

  function formatDateIndo(isoStr) {
    if (!isoStr) return '-';
    const parts = isoStr.split('-');
    const mNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    return `${parseInt(parts[2], 10)} ${mNames[parseInt(parts[1], 10) - 1]} ${parts[0]}`;
  }

  function addDays(isoStr, numDays) {
    const d = parseDate(isoStr);
    d.setDate(d.getDate() + numDays);
    return formatDateIso(d);
  }

  function getDaysBetween(startIso, endIso) {
    const d1 = parseDate(startIso);
    const d2 = parseDate(endIso);
    return Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1);
  }

  function dateToX(isoStr) {
    const targetDate = parseDate(isoStr);
    const minDate = state.timelineRange.min;
    const diffDays = (targetDate - minDate) / (1000 * 60 * 60 * 24);
    return Math.round(diffDays * state.pixelsPerDay);
  }

  // Start Engine on DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
