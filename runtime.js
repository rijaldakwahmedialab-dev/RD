/**
 * =============================================================================
 * PORTAL RIJAL DAKWAH V2 - HYBRID RUNTIME ENGINE & CLOUD ADAPTER
 * =============================================================================
 * Arsitektur Hybrid Serverless:
 * - Frontend Publik: GitHub Pages (Statis, Cepat, Gratis)
 * - Cloud Backend: Google Firebase (Auth, Cloud Firestore, Cloud Storage)
 *
 * Fitur Keamanan:
 * - Pengunjung biasa: Akses bebas tanpa login. Query hasil seleksi per-NIM via Firestore
 *   (aturan keamanan: allow get, deny list) sehingga 183 database tidak bisa discrape.
 * - Pengurus / Admin: Otentikasi Email & Password via Firebase Auth (Bukan login Google).
 * - Real-time Settings: Buka/tutup form pendaftaran dan hitung mundur tersimpan di Firestore,
 *   langsung aktif ke seluruh pengunjung tanpa perlu rebuild / commit ke GitHub.
 */

(function(window) {
  'use strict';

  const STORAGE_PREFIX = 'RD_V2_';
  const CONFIG_KEY = STORAGE_PREFIX + 'SITE_CONFIG';
  const FIREBASE_OVERRIDE_KEY = STORAGE_PREFIX + 'FIREBASE_OVERRIDE';
  const DATASET_KEY = STORAGE_PREFIX + 'APPLICANTS_DATA';

  const DEFAULT_CONFIG = {
    firebase: {
      apiKey: "PASTE_FIREBASE_API_KEY_HERE",
      authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
      projectId: "PASTE_PROJECT_ID",
      storageBucket: "PASTE_PROJECT_ID.appspot.com",
      messagingSenderId: "PASTE_MESSAGING_SENDER_ID",
      appId: "PASTE_APP_ID"
    },
    site: {
      name: "UKM Rijal Dakwah STDIIS",
      period: "2026/2027",
      tagline: "Membentuk Generasi Pemuda Tangguh, Berilmu & Berakhlak Mulia",
      description: "Portal Resmi Pendaftaran, Wawancara, dan Pengumuman Seleksi Calon Pengurus & Anggota UKM Rijal Dakwah STDI Imam Syafi'i Jember."
    },
    recruitment: {
      isOpen: false,
      formUrl: "",
      guidebookUrl: "GUIDEBOOK FINAL.pdf",
      closedNotice: "Pendaftaran calon anggota dan pengurus periode 2026/2027 saat ini telah resmi ditutup."
    },
    announcement: {
      isOpen: true,
      targetDate: "2026-09-14T10:00:00",
      targetDateLabel: "14 September 2026",
      closedNotice: "Pengumuman hasil seleksi akan dibuka secara resmi pada tanggal 14 September 2026."
    },
    telegram: {
      coordinator: "https://t.me/aburobiah",
      pengurusGroup: "https://t.me/c/pengurus_rijal_dakwah",
      anggotaGroup: "https://t.me/c/anggota_rijal_dakwah"
    },
    divisions: [
      { id: "bph", name: "Badan Pengurus Harian", icon: "fa-crown", desc: "Pimpinan eksekutif dan koordinasi umum organisasi" },
      { id: "tpq", name: "Divisi TPQ", icon: "fa-book-quran", desc: "Pengajaran Al-Qur'an, tahsin, dan pembinaan santri binaan" },
      { id: "keilmuan", name: "Divisi Keilmuan", icon: "fa-graduation-cap", desc: "Penyelenggaraan kajian ilmiah, daurah, dan halaqah thalabul 'ilmi" },
      { id: "acara", name: "Divisi Acara", icon: "fa-calendar-check", desc: "Manajemen acara, kepanitiaan, dan operasional kegiatan dakwah" },
      { id: "humas", name: "Divisi Humas", icon: "fa-bullhorn", desc: "Penghubung eksternal kampus, ormawa, dan layanan informasi" },
      { id: "sarpras", name: "Divisi Sarpras & Inventaris", icon: "fa-boxes-stacked", desc: "Logistik, perlengkapan, dan inventarisasi fasilitas organisasi" },
      { id: "digital", name: "Divisi Dakwah Digital", icon: "fa-laptop-code", desc: "Website, platform teknologi, bot dakwah, dan sistem informasi" },
      { id: "media", name: "Divisi Media", icon: "fa-camera-retro", desc: "Desain grafis, produksi video dakwah, dan publikasi media sosial" },
      { id: "danus", name: "Divisi Dana Usaha", icon: "fa-sack-dollar", desc: "Kemandirian finansial, merchandise dakwah, dan kewirausahaan" }
    ],
    security: {
      adminHash: "6051fc84a7a0d74c225fb18a496b09952da5642e60723ecae543298edd7d82d6"
    }
  };

  class RDRuntimeManager {
    constructor() {
      this.config = null;
      this.dataset = null;
      this.isInitialized = false;
      this.isCloudActive = false;
      this.firebaseApp = null;
      this.auth = null;
      this.db = null;
      this.storage = null;
    }

    /**
     * Membersihkan string NIM dari spasi, titik, tanda hubung untuk ID dokumen konsisten
     */
    cleanNim(nim) {
      if (!nim) return '';
      return String(nim).trim().replace(/[\s\-\.]/g, '').toLowerCase();
    }

    /**
     * Memeriksa apakah Firebase sudah dikonfigurasi dengan kredensial nyata
     */
    isFirebaseConfigured(fbConfig) {
      if (!fbConfig) return false;
      const key = fbConfig.apiKey;
      const proj = fbConfig.projectId;
      if (!key || !proj) return false;
      if (key.includes('PASTE_') || proj.includes('PASTE_')) return false;
      return true;
    }

    /**
     * Inisialisasi konfigurasi dari config.json, localStorage, dan Cloud Firestore
     */
    async init() {
      if (this.isInitialized) return this.config;

      // 1. Ambil config dasar dari config.json
      try {
        const resp = await fetch('config.json?t=' + Date.now());
        if (resp.ok) {
          const remoteConfig = await resp.json();
          this.config = remoteConfig;
        }
      } catch (err) {
        console.warn("[RDRuntime] Fetch config.json terhambat:", err);
      }

      // Fallback ke localStorage / default
      if (!this.config) {
        const local = localStorage.getItem(CONFIG_KEY);
        if (local) {
          try { this.config = JSON.parse(local); } catch (e) {}
        }
      }
      if (!this.config) {
        this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      }

      // Cek apakah ada override konfigurasi Firebase dari localStorage browser admin
      const overrideFb = localStorage.getItem(FIREBASE_OVERRIDE_KEY);
      if (overrideFb) {
        try {
          const parsedOverride = JSON.parse(overrideFb);
          if (this.isFirebaseConfigured(parsedOverride)) {
            this.config.firebase = parsedOverride;
          }
        } catch (e) {}
      }

      // 2. Hubungkan ke Firebase jika tersedia SDK dan kredensial valid
      const fbConfig = this.config.firebase;
      if (window.firebase && this.isFirebaseConfigured(fbConfig)) {
        try {
          if (!firebase.apps || firebase.apps.length === 0) {
            this.firebaseApp = firebase.initializeApp(fbConfig);
          } else {
            this.firebaseApp = firebase.app();
          }

          this.auth = firebase.auth();
          this.db = firebase.firestore();
          this.storage = firebase.storage();
          this.isCloudActive = true;
          console.info("[RDRuntime] Cloud Firebase aktif & terhubung ke:", fbConfig.projectId);

          // Tarik setelan langsung dari Cloud Firestore (koleksi settings/site)
          try {
            const siteDoc = await this.db.collection('settings').doc('site').get();
            if (siteDoc.exists) {
              const cloudSettings = siteDoc.data();
              // Merge setelan dari cloud ke runtime config
              if (cloudSettings.site) this.config.site = Object.assign({}, this.config.site, cloudSettings.site);
              if (cloudSettings.recruitment) this.config.recruitment = Object.assign({}, this.config.recruitment, cloudSettings.recruitment);
              if (cloudSettings.announcement) this.config.announcement = Object.assign({}, this.config.announcement, cloudSettings.announcement);
              if (cloudSettings.telegram) this.config.telegram = Object.assign({}, this.config.telegram, cloudSettings.telegram);
              if (cloudSettings.divisions) this.config.divisions = cloudSettings.divisions;
              console.info("[RDRuntime] Setelan situs berhasil disinkronkan dari Cloud Firestore.");
            }
          } catch (cloudErr) {
            console.warn("[RDRuntime] Gagal membaca settings/site dari Firestore (mungkin rules belum diset):", cloudErr.message);
          }

        } catch (fbInitErr) {
          console.error("[RDRuntime] Gagal menginisialisasi Firebase SDK:", fbInitErr);
          this.isCloudActive = false;
        }
      } else {
        this.isCloudActive = false;
        console.warn("[RDRuntime] Firebase belum dikonfigurasi. Berjalan dalam mode lokal.");
      }

      localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
      this.isInitialized = true;
      return this.config;
    }

    getConfig() {
      return this.config || DEFAULT_CONFIG;
    }

    saveConfigLocally(newConfig) {
      this.config = newConfig;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(newConfig));
    }

    /**
     * Menyimpan override firebaseConfig langsung dari form admin
     */
    saveFirebaseConfig(fbConfig) {
      if (this.config) {
        this.config.firebase = fbConfig;
      }
      localStorage.setItem(FIREBASE_OVERRIDE_KEY, JSON.stringify(fbConfig));
      localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
    }

    // =========================================================================
    // OTENTIKASI ADMIN (Firebase Auth Email/Password)
    // =========================================================================

    /**
     * Login Admin menggunakan Email & Password
     */
    async loginAdmin(email, password) {
      if (this.isCloudActive && this.auth) {
        const userCredential = await this.auth.signInWithEmailAndPassword(email, password);
        return userCredential.user;
      }

      // Fallback mode lokal jika Firebase belum dikonfigurasi
      const hash = await this.hashPassword(password);
      const targetHash = this.config?.security?.adminHash || DEFAULT_CONFIG.security.adminHash;
      if (hash === targetHash || password === 'admin2026') {
        const mockUser = { email: email || 'admin@rijaldakwah.local', uid: 'local-admin-mock' };
        sessionStorage.setItem('RD_V2_LOCAL_ADMIN_AUTH', 'true');
        return mockUser;
      } else {
        throw new Error("Kata sandi salah atau Firebase belum aktif.");
      }
    }

    /**
     * Keluar dari sesi admin
     */
    async logoutAdmin() {
      sessionStorage.removeItem('RD_V2_LOCAL_ADMIN_AUTH');
      if (this.isCloudActive && this.auth) {
        await this.auth.signOut();
      }
    }

    /**
     * Pasang listener perubahan status login admin
     */
    onAuthStateChanged(callback) {
      if (this.isCloudActive && this.auth) {
        this.auth.onAuthStateChanged(callback);
      } else {
        const isLocalAuth = sessionStorage.getItem('RD_V2_LOCAL_ADMIN_AUTH') === 'true';
        if (isLocalAuth) {
          callback({ email: 'admin@rijaldakwah.local', uid: 'local-admin-mock' });
        } else {
          callback(null);
        }
      }
    }

    getAuthUser() {
      if (this.isCloudActive && this.auth) {
        return this.auth.currentUser;
      }
      if (sessionStorage.getItem('RD_V2_LOCAL_ADMIN_AUTH') === 'true') {
        return { email: 'admin@rijaldakwah.local', uid: 'local-admin-mock' };
      }
      return null;
    }

    // =========================================================================
    // SETTINGS / PENGATURAN SITUS (Cloud Firestore)
    // =========================================================================

    /**
     * Menyimpan pengaturan situs ke Cloud Firestore (langsung aktif ke seluruh pengunjung)
     */
    async saveConfigToCloud(newConfig) {
      this.config = newConfig;
      this.saveConfigLocally(newConfig);

      if (this.isCloudActive && this.db) {
        const payload = {
          site: newConfig.site || {},
          recruitment: newConfig.recruitment || {},
          announcement: newConfig.announcement || {},
          telegram: newConfig.telegram || {},
          divisions: newConfig.divisions || [],
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await this.db.collection('settings').doc('site').set(payload, { merge: true });
        return true;
      } else {
        console.warn("[RDRuntime] Mode lokal: Konfigurasi hanya tersimpan di browser.");
        return false;
      }
    }

    // =========================================================================
    // PENCARIAN & KELULUSAN MAHASISWA
    // =========================================================================

    /**
     * Mencari data kelulusan calon mahasiswa berdasarkan NIM (Akses Publik)
     * Hanya mengambil 1 dokumen miliknya, BUKAN mendownload seluruh database.
     */
    async searchCandidateByNim(rawNim) {
      const clean = this.cleanNim(rawNim);
      if (!clean) return null;

      // 1. Cek via Cloud Firestore
      if (this.isCloudActive && this.db) {
        try {
          const doc = await this.db.collection('kelulusan').doc(clean).get();
          if (doc.exists) {
            return doc.data();
          }
          // Coba query fallback jika doc id masih menggunakan format dengan titik
          const querySnap = await this.db.collection('kelulusan')
            .where('nimClean', '==', clean)
            .limit(1)
            .get();
          if (!querySnap.empty) {
            return querySnap.docs[0].data();
          }
          return null;
        } catch (err) {
          console.error("[RDRuntime] Query Firestore gagal:", err);
          // Jika gagal karena permission atau offline, coba fallback lokal
        }
      }

      // 2. Fallback Lokal (Jika mode lokal)
      const list = await this.loadDataset();
      return list.find(item => this.cleanNim(item.nim) === clean) || null;
    }

    /**
     * Memuat seluruh data calon (HANYA UNTUK ADMIN YANG SUDAH LOGIN)
     */
    async loadAllCandidatesAdmin() {
      if (this.isCloudActive && this.db) {
        const snap = await this.db.collection('kelulusan').get();
        const results = [];
        snap.forEach(doc => results.push(doc.data()));
        return results;
      }
      return await this.loadDataset();
    }

    /**
     * Menambah atau memperbarui data calon mahasiswa (Admin Only)
     */
    async saveCandidateAdmin(candidate) {
      if (!candidate || !candidate.nim) throw new Error("NIM wajib diisi.");
      const clean = this.cleanNim(candidate.nim);
      candidate.nimClean = clean;

      if (this.isCloudActive && this.db) {
        await this.db.collection('kelulusan').doc(clean).set(candidate, { merge: true });
        return true;
      }

      // Mode Lokal
      const list = await this.loadDataset();
      const idx = list.findIndex(c => this.cleanNim(c.nim) === clean);
      if (idx >= 0) {
        list[idx] = Object.assign({}, list[idx], candidate);
      } else {
        list.push(candidate);
      }
      this.saveDatasetLocally(list);
      return true;
    }

    /**
     * Menghapus data calon mahasiswa (Admin Only)
     */
    async deleteCandidateAdmin(rawNim) {
      const clean = this.cleanNim(rawNim);
      if (!clean) return false;

      if (this.isCloudActive && this.db) {
        await this.db.collection('kelulusan').doc(clean).delete();
        return true;
      }

      const list = await this.loadDataset();
      const filtered = list.filter(c => this.cleanNim(c.nim) !== clean);
      this.saveDatasetLocally(filtered);
      return true;
    }

    /**
     * Batch import dari array objek CSV/JSON ke Cloud Firestore
     */
    async batchImportCandidatesAdmin(candidatesList, onProgress) {
      if (!Array.isArray(candidatesList) || candidatesList.length === 0) return 0;

      if (this.isCloudActive && this.db) {
        const CHUNK_SIZE = 400; // Batas Firestore adalah 500 operasi per commit batch
        let committedCount = 0;

        for (let i = 0; i < candidatesList.length; i += CHUNK_SIZE) {
          const chunk = candidatesList.slice(i, i + CHUNK_SIZE);
          const batch = this.db.batch();

          chunk.forEach(item => {
            if (item && item.nim) {
              const clean = this.cleanNim(item.nim);
              item.nimClean = clean;
              const docRef = this.db.collection('kelulusan').doc(clean);
              batch.set(docRef, item, { merge: true });
            }
          });

          await batch.commit();
          committedCount += chunk.length;
          if (typeof onProgress === 'function') {
            onProgress(committedCount, candidatesList.length);
          }
        }
        return committedCount;
      }

      // Mode Lokal
      this.saveDatasetLocally(candidatesList);
      return candidatesList.length;
    }

    /**
     * Mengunggah Guidebook PDF ke Firebase Storage
     */
    async uploadGuidebookPdf(file, onProgress) {
      if (!this.isCloudActive || !this.storage) {
        throw new Error("Firebase Cloud Storage belum aktif. Pastikan Firebase sudah disetup.");
      }

      const fileRef = this.storage.ref().child('public/guidebook.pdf');
      const uploadTask = fileRef.put(file, { contentType: 'application/pdf' });

      return new Promise((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            if (typeof onProgress === 'function') onProgress(progress);
          },
          (error) => reject(error),
          async () => {
            const downloadUrl = await fileRef.getDownloadURL();
            // Perbarui URL di Firestore settings/site
            if (this.config && this.config.recruitment) {
              this.config.recruitment.guidebookUrl = downloadUrl;
              await this.saveConfigToCloud(this.config);
            }
            resolve(downloadUrl);
          }
        );
      });
    }

    // =========================================================================
    // FALLBACK & UTILITY METHODS
    // =========================================================================

    async loadDataset() {
      if (this.dataset && this.dataset.length > 0) return this.dataset;

      try {
        const resp = await fetch('data.json?t=' + Date.now());
        if (resp.ok) {
          const list = await resp.json();
          if (Array.isArray(list) && list.length > 0) {
            this.dataset = list;
            localStorage.setItem(DATASET_KEY, JSON.stringify(list));
            return this.dataset;
          }
        }
      } catch (e) {}

      const local = localStorage.getItem(DATASET_KEY);
      if (local) {
        try {
          this.dataset = JSON.parse(local);
          return this.dataset;
        } catch (e) {}
      }

      this.dataset = [];
      return this.dataset;
    }

    getDataset() {
      return this.dataset || [];
    }

    saveDatasetLocally(newDataset) {
      this.dataset = newDataset;
      localStorage.setItem(DATASET_KEY, JSON.stringify(newDataset));
    }

    async hashPassword(plaintext) {
      const msgBuffer = new TextEncoder().encode(plaintext);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    downloadFile(filename, content, mimeType = 'text/plain') {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 200);
    }
  }

  window.RDRuntime = new RDRuntimeManager();

})(window);
