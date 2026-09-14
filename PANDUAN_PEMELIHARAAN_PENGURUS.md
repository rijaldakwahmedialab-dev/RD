# 📖 Panduan Pemeliharaan Portal Web UKM Rijal Dakwah STDIIS
## *Edisi Khusus Pengurus & Generasi Penerus (Zero-Code Maintenance)*

Dokumen ini ditulis secara khusus agar **siapa pun pengurus yang memegang amanah di masa mendatang—meskipun tidak memiliki latar belakang IT atau pemrograman—dapat merawat, memperbarui, dan mengoperasikan website ini secara mandiri 100% langsung dari peramban (browser).**

---

## 🌟 1. Filosofi Arsitektur Baru (V2)

Website ini dirancang dengan konsep **Frontend-Managed CMS**:
* **Tidak Perlu Buka Terminal / CMD.**
* **Tidak Perlu Menulis Baris Kode.**
* **Tidak Perlu Server Backend yang Rumit.**
* Seluruh kendali website (buka/tutup pendaftaran, hitung mundur pengumuman, ubah tautan Telegram, hingga manajemen 183 basis data kelulusan) dapat diatur langsung melalui satu halaman kendali: **`manager.html`**.

---

## 🔑 2. Cara Mengakses Cockpit Pengelola (`manager.html`)

1. Buka berkas **`manager.html`** di browser Anda (atau via domain GitHub Pages Anda, contoh: `https://[nama-web]/manager.html`).
2. Masukkan kata sandi pengurus:
   * **Kata Sandi Default:** `admin2026`
3. Klik tombol **"Buka Akses Panel Pengelola"**.

---

## ⚙️ 3. Mengatur Fitur Website (Tab "Pengaturan Situs")

Di tab ini, Anda dapat mengatur seluruh parameter tampilan tanpa coding:

### A. Membuka / Menutup Pendaftaran
* Pada dropdown **Status Pendaftaran Calon Anggota**:
  * Pilih `🟢 Buka Pendaftaran` jika pendaftaran sedang berjalan.
  * Pilih `🔴 Pendaftaran Ditutup` jika masa pendaftaran telah berakhir.
* Tombol di halaman beranda (`index.html`) akan otomatis berubah menjadi aktif (emas berdenyut) atau abu-abu dengan pesan penutupan resmi.

### B. Mengatur Link Google Form Pendaftaran
* Masukkan URL Google Form terbaru pada kolom **Tautan Google Form Pendaftaran**.

### C. Mengunggah & Mengganti Guidebook PDF Resmi
Di bagian **"Pengelolaan & Unggah Guidebook PDF"**:
1. **Pilih Berkas**: Klik area kotak putus-putus atau seret file PDF baru (misal: `GUIDEBOOK_BARU_2027.pdf`).
2. **Unggah Langsung ke GitHub**:
   * Jika token GitHub PAT sudah diisi di tab *Deploy*, klik tombol emas **"Upload ke GitHub"**.
   * Berkas PDF fisik akan langsung ter-upload ke repositori GitHub Pages dan tombol Guidebook di halaman beranda otomatis mengarahkan pengunjung ke PDF baru tersebut.
3. **Pratinjau**: Anda dapat mengklik tombol **"Lihat PDF Saat Ini"** untuk memverifikasi dokumen yang sedang aktif.

### D. Mengatur Tanggal Pengumuman & Hitung Mundur (Countdown)
* Pilih tanggal dan jam pengumuman menggunakan kalender pemilih waktu.
* Masukkan teks tampilan (contoh: `14 September 2026`).
* Hitung mundur jam-menit-detik di beranda akan otomatis menghitung waktu mundur secara *real-time*.

### E. Mengatur Link Grup Telegram Resmi
* **Telegram Koordinator**: Tautan narahubung panitia jika calon butuh bantuan.
* **Grup Telegram Pengurus**: Otomatis muncul pada kartu hasil kelulusan calon yang dinyatakan diterima sebagai **Pengurus**.
* **Grup Telegram Anggota**: Otomatis muncul pada kartu hasil kelulusan calon yang dinyatakan diterima sebagai **Anggota Biasa**.

> **Tips:** Setelah mengubah setelan, jangan lupa klik tombol emas **"Simpan Pengaturan"** di kanan atas!

---

## 👥 4. Mengelola Basis Data Mahasiswa (Tab "Basis Data")

Di tab ini, Anda memegang kendali penuh atas data kelulusan:

### A. Mencari & Memfilter Data
* Ketik NIM atau Nama pada kotak pencarian cepat.
* Gunakan filter **Jalur** (Pengurus / Anggota) dan filter **Divisi** untuk melihat daftar per bidang.

### B. Menambah Calon Baru Secara Manual
1. Klik tombol emas **"Tambah Calon"**.
2. Masukkan NIM, Nama Lengkap, Jalur (Pengurus/Anggota), dan Divisi Penempatan.
3. Klik **"Simpan Calon"**. Sistem akan otomatis mengurutkan nama sesuai abjad dan mencegah duplikasi NIM.

### C. Mengedit / Menghapus Calon
* Klik ikon **Pensil (Kuning)** pada baris mahasiswa untuk mengubah data.
* Klik ikon **Tempat Sampah (Merah)** untuk menghapus nama yang keliru.

### D. Mengimpor Data dari File Excel / CSV
1. Klik tombol hijau **"Impor Excel"**.
2. Pilih file Excel (`.xlsx`) atau CSV panitia.
3. Sistem otomatis mendeteksi kolom `NIM`, `Nama`, `Jalur`, dan `Divisi`.
4. Jika NIM sudah ada, data diperbarui; jika baru, otomatis ditambahkan.

### E. Mengekspor Rekap Resmi
* Klik tombol **"Ekspor Excel"** untuk mengunduh seluruh data dalam format spreadsheet resmi yang siap dicetak atau dilaporkan ke pimpinan/BPH.

---

## 🚀 5. Mem-publish Perubahan ke Website Publik (Tab "Deploy & Rilis")

Agar perubahan yang Anda lakukan di `manager.html` terlihat oleh seluruh pengunjung di internet:

### Metode Rekomendasi: Direct GitHub Push (1-Klik Tanpa Git)
1. Buat **GitHub Personal Access Token (PAT)**:
   * Buka GitHub $\rightarrow$ **Settings** $\rightarrow$ **Developer Settings** $\rightarrow$ **Personal Access Tokens (Tokens classic)**.
   * Buat token baru dengan izin mencentang kotak **`repo`**.
2. Salin token tersebut dan tempelkan pada kolom **GitHub Personal Access Token** di `manager.html`.
3. Masukkan nama repository (contoh: `rijaldakwahmedialab-dev/RijalDakwah`).
4. Klik tombol emas: **"Commit & Publish ke GitHub Pages"**.
5. Selesai! Dalam hitungan detik, file `config.json` dan `data.json` di GitHub akan terupdate dan website publik langsung menampilkan data terbaru.

### Metode Cadangan: Unduh Berkas Manual
1. Klik **"Unduh config.json"** dan **"Unduh data.json"**.
2. Seret (*drag & drop*) kedua berkas tersebut ke repositori GitHub via browser di github.com.

---

## 🛡️ 6. Cadangan & Pemulihan Sistem (Backup & Restore)

* **Cadangkan Sistem**: Klik tombol **"Cadangkan Sistem"** sebelum pergantian periode atau sebelum merombak data besar. Anda akan mendapatkan file `.json` berisi seluruh konfigurasi dan database.
* **Pulihkan Cadangan**: Jika terjadi kesalahan data, klik **"Pulihkan Cadangan"** dan pilih file backup sebelumnya untuk mengembalikan seluruh sistem ke kondisi prima seketika.

---

*“Barakallahu fiikum kepada seluruh pengurus UKM Rijal Dakwah STDIIS yang melanjutkan tongkat estafet dakwah ini. Semoga karya ini menjadi amal jariyah yang terus mengalir pahalanya.”*
