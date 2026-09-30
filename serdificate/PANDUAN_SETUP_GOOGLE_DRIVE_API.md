# 📂 Panduan Google Drive Bridge v2.0 — SeRDificate
**UKM Rijal Dakwah • Lembaga Dakwah Kampus STDIIS**  
*Otomasi Folder Agenda & Sinkronisasi Sertifikat Digital*

---

## 🎯 Fitur Bridge v2.0 (Google Apps Script)

1. **Auto-Create Folder Agenda:** Saat BPH membuat kartu kegiatan baru di Dashboard, sistem dapat secara otomatis membuatkan subfolder baru di Google Drive UKM Rijal Dakwah.
2. **Auto-Delete (Trash) Folder:** Saat kartu kegiatan dihapus dari Dashboard, folder Google Drive agenda tersebut otomatis dipindahkan ke Sampah (Trash) agar penyimpanan 5 TB organisasi tetap rapi.
3. **Upload & Replace (Anti-Duplikasi):** Mengunggah berkas PDF secara paralel (4x concurrency) dengan opsi menimpa versi lama jika ada revisi nama/gelar.
4. **Jalur Langsung Peserta:** Peserta dapat langsung diarahkan ke tautan folder publik Google Drive untuk mengunduh sertifikat mereka.

---

## ⚡ Kode Google Apps Script (`Code.gs`)

Deploy kode berikut di [script.google.com](https://script.google.com/) sebagai **Web app** (*Execute as: Me*, *Who has access: Anyone*):

```javascript
// SeRDificate — Google Drive Bridge v2.0 (UKM Rijal Dakwah)
var SECRET_KEY = "RD_CERT_2026_AMAN";

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: "Tidak ada data yang dikirim." })).setMimeType(ContentService.MimeType.JSON);
    }
    var data = JSON.parse(e.postData.contents);
    if (data.authKey !== SECRET_KEY) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: "Akses ditolak: Token autentikasi SeRDificate tidak cocok." })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 1. ACTION: BUAT SUBFOLDER BARU UNTUK KARTU KEGIATAN
    if (data.action === "createFolder") {
      // Folder Induk Resmi RD: 2026 = 1eeP-N4FlNPtJ9SYx4aAW_cnXWTY0dSas | 2027 = 1pQtnBpGvs4KKHmyBGmACzSEuqTL68tTj
      var parentId = data.parentFolderId || "1eeP-N4FlNPtJ9SYx4aAW_cnXWTY0dSas";
      var parent = DriveApp.getFolderById(parentId);
      var newFolder = parent.createFolder(data.folderName);
      newFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        folderId: newFolder.getId(),
        folderUrl: newFolder.getUrl()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. ACTION: HAPUS FOLDER KE TRASH SAAT KARTU DIHAPUS
    if (data.action === "deleteFolder") {
      if (data.folderId && data.folderId !== "root" && data.folderId.length > 5) {
        var folderToDelete = DriveApp.getFolderById(data.folderId);
        folderToDelete.setTrashed(true);
        return ContentService.createTextOutput(JSON.stringify({
          success: true,
          trashed: true
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // 3. ACTION DEFAULT: UPLOAD SERTIFIKAT (DENGAN FITUR TIMPA / REPLACE)
    var targetFolderId = data.folderId || "1eeP-N4FlNPtJ9SYx4aAW_cnXWTY0dSas";
    var folder = DriveApp.getFolderById(targetFolderId);
    
    if (data.replace === true || data.replace === "true") {
      var existing = folder.getFilesByName(data.fileName);
      while (existing.hasNext()) {
        var oldFile = existing.next();
        oldFile.setTrashed(true);
      }
    }
    
    var bytes = Utilities.base64Decode(data.base64Data);
    var blob = Utilities.newBlob(bytes, data.mimeType || "application/pdf", data.fileName);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      fileId: file.getId(),
      name: file.getName(),
      webViewLink: file.getUrl()
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: "Apps Script Error: " + err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "online",
    service: "SeRDificate Google Drive Apps Script Bridge v2.0",
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}
```
