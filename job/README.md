# 📊 Rijal Dakwah Professional Gantt & Resource Studio v3.0

Sistem Web Manajemen Program Kerja, Visualisasi Gantt WBS (*Work Breakdown Structure*), dan Penyeimbangan Beban SDM Resmi 109 Pengurus SK Rijal Dakwah Periode 2026-2027.

---

## 🌟 Fitur Utama v3.0 PRO

1. **Clean Dark Design System (Zinc / Slate Modern)**
   - Desain profesional dengan kontras tinggi, palet warna elegan khas dashboard modern (tanpa nuansa kehijauan/murky).
   - Tipografi presisi dengan *Inter* & *JetBrains Mono*.

2. **Dual-Pane Gantt Architecture (Industry Standard)**
   - **Bilah Kiri (Hierarchical Data Grid):** Struktur WBS berjenjang (Program Kerja $\rightarrow$ Sub-tugas & Milestone), status badge, PIC penanggung jawab, tanggal, dan durasi. Dapat diperlebar/dipersempit dengan *Draggable Splitter*.
   - **Bilah Kanan (Interactive SVG Timeline Canvas):**
     - Skala multi-level: **Hari**, **Minggu**, dan **Bulan**.
     - Garis relasi ketergantungan dinamis (*Finish-to-Start dependency curves*) menggunakan kurva Bézier SVG.
     - Penanda Titik Kunci (*Milestone Diamond* $\diamond$) untuk Hari-H acara.
     - Penanda garis glowing real-time **Hari Ini**.
     - Interaksi langsung: geser tanggal (*Drag-to-move*) dan tarik ujung batang (*Drag-to-resize duration*).

3. **Master Kalender Kegiatan RD 2026-2027 (40 Agenda Penuh)**
   - Memuat 40 agenda resmi dari September 2026 hingga Juni 2027:
     - **September 2026:** Muktamar (22), Akademi Arabi 1 (25).
     - **Oktober 2026:** Akademi Dai 1 (1), Mulazamah 1 (3), Workshop TPQ 1 (6), Kelas Media 1 (9), Webinar Dakwah 1 (11), Mulazamah 2 (17), Webinar Dakwah 2 (18), Akademi Arabi 2 (23), Mulazamah 3 (31).
     - **November 2026:** Webinar Dakwah 3 (1), Mulazamah 4 (7), Webinar Dakwah 4 (8), Mulazamah 5 (14), Festival TPQ 1 (15), Workshop TPQ 2 (17), Akademi Dai 2 (21), Mulazamah 6 (28), Webinar Dakwah 5 (29).
     - **Desember 2026:** Mulazamah 7 (5), Webinar Dakwah 6 (6), Akademi Dai 3 (10), Kelas Media 2 (11), FAS - Festival Anak Sholeh (13), Workshop Bendahara & Danus (15), Mulazamah 8 (19).
     - **Februari 2027:** Akademi Dai + Bukber (19 - Postponed).
     - **Maret 2027:** Musyawarah Calon Ketum (27).
     - **April 2027:** Acara Alvi Syahrin (4), Kelas Media 3 (9), Mulazamah 9 (10), Akademi Arabi 3 (16), Workshop Dakwah Digital (20), Mulazamah 10 (24).
     - **Mei 2027:** Festival TPQ 2 (2), Kelas Media 4 (7), Makrab + Akademi Dai (21), Mulazamah 11 (29).
     - **Juni 2027:** Sertijab Pengurus 2026-2027 (15).

4. **Resource Management & Clash / Overload Detection (109 Pengurus SK)**
   - Visualisasi pemetaan 109 pengurus ke 9 divisi (BPH, TPQ, Keilmuan, Acara, Humas, Sarpras, Dakwah Digital, Media, Danus).
   - Pengukur kapasitas kerja harian dan deteksi bentrok visual (`⚠️ OVERLOAD`) jika personil memiliki tugas bertumpuk pada rentang tanggal yang sama.

5. **Multi-View Modes**
   - **Timeline Gantt:** Tampilan dual-pane utama.
   - **Kalender Kegiatan:** Kalender bulanan interaktif dengan navigasi bulan.
   - **Beban Tugas (SDM):** Analisis statistik personil dan tabel roster 109 pengurus.
   - **Board Status (Kanban):** Alur kerja 4 kolom (*Terjadwal*, *Sedang Berjalan*, *Selesai*, *Ditunda*).

6. **Sistem Keamanan Akses (Password Lock)**
   - **Mode Publik (Default):** Bebas membaca seluruh timeline, filter divisi, search, dan melihat rincian tanpa risiko mengubah data.
   - **Mode Editor (Dilindungi Sandi):**
     - Passcode Master BPH: `bph2026` atau `123456`.
     - Passcode per-Divisi: `tpq2026`, `ilmu2026`, `acara2026`, `humas2026`, `sarpras2026`, `digital2026`, `media2026`, `danus2026`.
     - Saat mode editor aktif, izin *drag-drop*, *resize*, tambah event, dan edit data terbuka penuh.

7. **Responsif & Mobile Friendly**
   - Di layar ponsel / tablet, tersedia toggle instan `[Tabel | Gantt]` dengan layout yang ramah sentuhan.

8. **Cadangan & Interoperabilitas**
   - Penyimpanan otomatis ke `LocalStorage`.
   - Unduh & Pulihkan berkas cadangan JSON.
   - Fitur Cetak / Simpan PDF rapi landscape.
   - Opsi Reset ke Kalender Resmi 40 agenda.

---

## 🚀 Cara Menjalankan

1. **Langsung di Browser (Zero-Build):**
   Cukup klik ganda berkas `index.html`.
2. **Atau melalui Web Server Lokal:**
   ```bash
   python -m http.server 3333
   # Buka http://localhost:3333
   ```
