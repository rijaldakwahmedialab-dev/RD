# 🚀 Panduan Setup Firebase & GitHub Pages (Arsitektur Hybrid)
## *Portal UKM Rijal Dakwah STDIIS v2.0*

Dokumen ini berisi panduan lengkap langkah demi langkah untuk mengaktifkan **Cloud Backend Firebase (Gratis / Spark Plan)** dan menghubungkannya dengan repositori publik **GitHub Pages** (`https://github.com/rijaldakwahmedialab-dev/RD.git`).

---

## 📋 Ringkasan Arsitektur
1. **GitHub Pages (Publik):** Menampung frontend web statis (`index.html`, `pengumuman.html`, `manager.html`, `runtime.js`). Tidak ada file CSV / `data.json` rahasia di git history.
2. **Firebase Auth:** Sistem login admin menggunakan **Email & Password** (bukan login Google, tanpa registrasi publik).
3. **Cloud Firestore:** Database realtime untuk status buka/tutup pendaftaran, hitung mundur pengumuman, dan data 183 calon mahasiswa diterima (diproteksi aturan `allow get: if true; allow list: if admin`).
4. **Firebase Cloud Storage:** Tempat penyimpanan berkas PDF Guidebook resmi.

---

## 🛠️ Langkah 1: Buat Proyek Firebase (1 Menit)
1. Buka [console.firebase.google.com](https://console.firebase.google.com/) dan login menggunakan akun Google Anda/UKM.
2. Klik tombol **"Add project"** (atau "Buat Proyek").
3. Beri nama proyek, contoh: `rijal-dakwah-portal`.
4. Matikan *Google Analytics* (opsional, agar setup lebih cepat dan bersih), lalu klik **"Create project"**.
5. Tunggu hingga proyek selesai dibuat, lalu klik **"Continue"**.

---

## 🔐 Langkah 2: Aktifkan Firebase Authentication (Email/Password)
1. Di menu bilah samping (sidebar) kiri, klik **Build** $\rightarrow$ **Authentication**.
2. Klik tombol **"Get started"**.
3. Pada tab **Sign-in method**, pilih **"Email/Password"**.
4. Aktifkan sakelar **"Email/Password"** menjadi **Enabled** (biarkan opsi *Email link (passwordless)* nonaktif).
5. Klik **"Save"**.
6. Pindah ke tab **Users** di samping tab *Sign-in method*, lalu klik **"Add user"**:
   - Masukkan Email Admin, misal: `admin@rijaldakwah.com`
   - Masukkan Kata Sandi yang kuat.
   - Klik **"Add user"**.
   *(Catatan: Akun inilah yang akan Anda gunakan untuk login di `manager.html`)*.

---

## 🗄️ Langkah 3: Aktifkan Cloud Firestore & Aturan Keamanan
1. Di bilah samping kiri, klik **Build** $\rightarrow$ **Firestore Database**.
2. Klik **"Create database"**.
3. Pilih lokasi server terdekat: **`asia-southeast2 (Jakarta)`** atau `asia-southeast1 (Singapore)`.
4. Pada pilihan Security rules, pilih **"Start in production mode"**, lalu klik **"Create"**.
5. Setelah database terbentuk, klik tab **Rules** di bagian atas.
6. Hapus seluruh kode aturan yang ada, lalu ganti dengan aturan resmi berikut:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // 1. Pengaturan Situs (Status form, countdown, kontak telegram)
    // Pengunjung umum BISA membaca, hanya admin terotentikasi yang BISA mengubah
    match /settings/{document} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    
    // 2. Data Hasil Kelulusan Calon Mahasiswa
    // PENTING: Pengunjung HANYA bisa get (cari 1 NIM miliknya).
    // DILARANG list (mengunduh seluruh 183 data sekaligus).
    match /kelulusan/{nim} {
      allow get: if true;
      allow list: if request.auth != null;
      allow write: if request.auth != null;
    }
    
  }
}
```
7. Klik **"Publish"**.

---

## 📦 Langkah 4: Aktifkan Cloud Storage (Untuk Guidebook PDF)
1. Di bilah samping kiri, klik **Build** $\rightarrow$ **Storage**.
2. Klik **"Get started"**, pilih **"Start in production mode"**, lalu klik **"Done"**.
3. Masuk ke tab **Rules**, lalu ganti aturannya menjadi:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Guidebook publik bisa diunduh semua pengunjung, upload khusus admin
    match /public/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```
4. Klik **"Publish"**.

---

## 🔑 Langkah 5: Salin Kredensial Firebase Web App
1. Di bilah samping kiri paling atas, klik ikon **Gerigi (Project settings)** $\rightarrow$ **General**.
2. Gulir ke bawah ke bagian **"Your apps"**, lalu klik ikon Web **`</>`**.
3. Beri nama aplikasi web, misal: `Portal Web RD`, lalu klik **"Register app"** (tidak perlu centang *Firebase Hosting*).
4. Anda akan melihat blok konfigurasi JavaScript seperti ini:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyD-xxxxxxxxxxxxxxxxxxxx",
  authDomain: "rijal-dakwah-portal.firebaseapp.com",
  projectId: "rijal-dakwah-portal",
  storageBucket: "rijal-dakwah-portal.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456"
};
```
5. Salin nilai-nilai tersebut ke dalam file **`config.json`** pada bagian `"firebase"`:

```json
  "firebase": {
    "apiKey": "AIzaSyD-xxxxxxxxxxxxxxxxxxxx",
    "authDomain": "rijal-dakwah-portal.firebaseapp.com",
    "projectId": "rijal-dakwah-portal",
    "storageBucket": "rijal-dakwah-portal.appspot.com",
    "messagingSenderId": "123456789012",
    "appId": "1:123456789012:web:abcdef123456"
  }
```
*(Atau Anda bisa langsung paste kredensial ini di browser melalui tab **"Cloud & Firebase"** di `manager.html`)*.

---

## ⚡ Langkah 6: Masuk Panel Admin & 1-Click Migrasi Data
1. Buka file **`manager.html`** di browser Anda.
2. Masukkan Email dan Password admin yang tadi dibuat di Langkah 2.
3. Status di bagian atas akan berubah menjadi **`🟢 Cloud Aktif: [project-id]`**.
4. Buka tab **"Basis Data"**, lalu klik tombol emas **"Sync Lokal ke Cloud"**.
5. Konfirmasi dialog $\rightarrow$ Sistem akan otomatis mengunggah seluruh 183 data calon mahasiswa ke Cloud Firestore dalam waktu 2 detik!
6. Buka tab **"Pengaturan Situs"**, atur tanggal dan status pendaftaran, lalu klik **"Simpan Pengaturan"** (otomatis tersimpan ke Cloud Firestore).

---

## 🌐 Langkah 7: Deploy ke GitHub Pages
Karena kode sudah 100% statis dan kredensial aman:
1. Inisialisasi git dan push ke repository Anda:
   ```bash
   git add .
   git commit -m "feat: setup hybrid portal v2 with firebase cloud backend"
   git branch -M main
   git remote add origin https://github.com/rijaldakwahmedialab-dev/RD.git
   git push -u origin main
   ```
2. Buka repository Anda di browser: `https://github.com/rijaldakwahmedialab-dev/RD`
3. Masuk ke **Settings** $\rightarrow$ **Pages** (di bilah kiri).
4. Pada bagian **Build and deployment** $\rightarrow$ **Branch**:
   - Pilih Branch: **`main`**
   - Folder: **`/ (root)`**
   - Klik **Save**.
5. Dalam 1–2 menit, website resmi Anda sudah aktif di internet:  
   `https://rijaldakwahmedialab-dev.github.io/RD/`
