# Rijal Dakwah Gantt Studio v2.0 (NLE Timeline & Resource Management)

Website Gantt Chart interaktif turunan dari **Rijal Dakwah Portal v2** yang didesain khusus dengan ergonomi editing video Non-Linear Editor (**DaVinci Resolve, Premiere Pro, CapCut**) untuk mempermudah para Kepala Divisi (Kadiv) memetakan jadwal proyek dan alokasi tugas 109 pengurus resmi (SK Sekretaris).

---

## 🌟 Fitur Utama

1. **Database Resmi 109 Pengurus (SK Sekretaris 2026-2027)**
   - 9 Divisi lengkap: BPH (6), TPQ (18), Keilmuan (16), Acara (14), Humas (13), Sarpras (12), Dakwah Digital (11), Media (13), Dana Usaha (6).
   - Pengelompokan hirarki: Kepala Divisi (Kadiv V1) dan Anggota Staff (V2, V3, dst.).

2. **UI/UX NLE Timeline (DaVinci / Premiere Style)**
   - **Timecode & Scrubber Playhead:** Indikator hari real-time relatif terhadap Hari-H (`H-30`, `H-1`, `HARI-H`, `H+7`).
   - **Footage Pre-Acara & Pasca-Acara:** Jalur master sequence dengan frame strip untuk membedakan fase persiapan dan evaluasi.
   - **Transisi D-Day (Cross Dissolve Block):** Titik puncak acara yang dapat diklik untuk membuka **Runway Checklist Hari-H** (soundcheck, briefing, streaming, konsumsi).
   - **Clash / Overload Detection:** Peringatan visual bergaris hazard kuning-merah neon (`⚠️ OVERLOAD`) jika seorang anggota diberi lebih dari 2 tugas bertumpuk pada tanggal yang sama.

3. **Dual-View Hierarchy**
   - **🎛️ Master Sequence (Seluruh Divisi):** Tampilan helikopter seluruh 9 divisi untuk melihat ketergantungan antar-divisi.
   - **🎬 Divisi Individual Track:** Workspace per divisi tempat Kadiv mengatur track anggota secara presisi.

4. **Ergonomi Editing Cepat (Anti-Malas)**
   - **(V) Selection / Move Tool:** Geser clip horizontal untuk ubah tanggal, atau geser vertikal untuk transfer tugas ke anggota lain.
   - **(T) Trim Tool:** Tarik ujung kiri (In-Point) atau kanan (Out-Point) clip untuk mengubah durasi tugas langsung di timeline.
   - **(C) Razor Tool:** Klik di tengah clip tugas untuk membelahnya menjadi dua sub-tugas (Fase 1 & Fase 2).
   - **Double Click Track:** Klik ganda pada area kosong track anggota untuk instan membuat tugas baru.

5. **Akses Bertingkat (Public View vs Protected Editor)**
   - **Mode Publik (Default):** Siapapun dapat melihat timeline, zoom in/out, filter divisi, dan membaca rincian tugas tanpa risiko mengubah data.
   - **Mode Editor (PIN/Passcode Protected):**
     - **Master BPH (Akses Semua Divisi):** Passcode `bph2026` atau PIN `123456`.
     - **Kadiv Media:** `media2026`
     - **Kadiv Acara:** `acara2026`
     - **Kadiv Humas:** `humas2026`
     - **Kadiv Sarpras:** `sarpras2026`
     - **Kadiv TPQ:** `tpq2026`
     - **Kadiv Keilmuan:** `ilmu2026`
     - **Kadiv Dakwah Digital:** `digital2026`
     - **Kadiv Dana Usaha:** `danus2026`

6. **Firebase Real-Time Sync & LocalStorage Fallback**
   - Terhubung dengan konfigurasi Firebase Rijal Dakwah v2 (`rijal-dakwah-portal.firebaseapp.com`).
   - Dilengkapi fallback otomatis ke LocalStorage browser sehingga dapat dijalankan offline atau dibuka langsung lewat file lokal (`file:///...`).
   - Fitur Backup JSON dan Reset Sample Data bawaan.

---

## 📁 Struktur Berkas

```
rijal-dakwah-gantt-studio/
├── index.html         # Main App Shell & Modals
├── app.js             # NLE Timeline Engine, Interactions, & Sync
├── style.css          # Styling Rijal Dakwah Deep Green x Gold x NLE Theme
├── data.js            # Standalone Data Provider (109 Pengurus & Proker)
├── data-sk.json       # JSON Master 109 Pengurus dari SK Sekretaris
├── data-sample.json   # Sample Proker (Kajian Akbar 1448H & Daurah)
├── logo-rijal-dakwah.png
└── README.md
```

---

## 🚀 Cara Menjalankan

1. **Langsung Buka di Browser (Zero-Build):**
   - Klik ganda `index.html` (atau buka `file:///G:/MasterJangkir project/UKM/rijal-dakwah-gantt-studio/index.html`).
2. **Atau Melalui Local Web Server:**
   ```bash
   npx serve .
   # atau
   python -m http.server 3000
   ```
