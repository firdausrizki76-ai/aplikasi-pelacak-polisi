# 🛡️ Cyber Tracker - Online Scam Location Trap & Police Report Generator

Aplikasi web intelijen & investigasi cyber sederhana berbasis HTML5 Geolocation, Leaflet.js, OpenStreetMap, dan PeerJS / BroadcastChannel untuk melacak lokasi terkini dari penipu online serta membantu pembuatan format laporan bukti digital kepolisian.

---

## 🌐 Struktur URL Saat Dihosting di Vercel

Setelah aplikasi dihosting di **Vercel** (misalnya alamat aplikasi Anda `https://konfirmasipembayaran.vercel.app`), struktur halamannya telah dikonfigurasi secara otomatis via **`vercel.json`**:

| Pengguna | Alamat URL yang Dibuka | Apa yang Ditampilkan? |
|---|---|---|
| **User 1 (Target / Penipu)** | **`https://konfirmasipembayaran.vercel.app/`** | **100% Halaman "Konfirmasi Pembayaran" Bersih.** Tanpa embel-embel `?room=` ataupun `?mode=`. Sangat rapi dan meyakinkan! |
| **User 2 (Investigator / Polisi)** | **`https://konfirmasipembayaran.vercel.app/user2`** | **Dashboard Investigasi & Peta Radar Tracker.** Menampilkan lokasi target secara realtime, forensik digital, serta generator laporan polisi. |

> [!TIP]
> **Mengapa Tanpa `?room=` Sangat Bagus?**
> Karena sistem sekarang **secara otomatis menggunakan ruangan default yang terenkripsi di dalam kode**, sehingga Anda (User 2) **tidak perlu lagi menambahkan parameter `?room=...` yang ribet dan mencurigakan**! Target cukup membuka domain utama (`https://domain.vercel.app/`), sedangkan Anda cukup mengetik **`/user2`** di belakang domain Anda untuk memantaunya secara langsung.

---

## 🚀 Panduan Upload ke Git (GitHub) & Vercel

### Langkah 1: Upload ke GitHub (melalui Terminal / Git)
Buka terminal di dalam folder proyek ini (`e:\Kerjaan Abi\aplikasi location sender`) dan jalankan perintah berikut:

```bash
# 1. Inisialisasi git repository
git init

# 2. Tambahkan semua file ke dalam commit
git add .

# 3. Buat commit pertama
git commit -m "feat: release cyber tracker location sender app"

# 4. Hubungkan ke repository GitHub Anda (ganti URL dengan repo Anda)
git remote add origin https://github.com/USERNAME/NAMAREPO.git

# 5. Push ke GitHub
git branch -M main
git push -u origin main
```

### Langkah 2: Hosting Gratis di Vercel
1. Buka situs [https://vercel.com](https://vercel.com) dan login menggunakan akun GitHub Anda.
2. Klik tombol **"Add New..."** -> **"Project"**.
3. Pilih repository GitHub yang baru saja Anda upload (`NAMAREPO`), lalu klik **"Import"**.
4. Biarkan pengaturan default (Framework Preset: *Other/Static*), lalu klik **"Deploy"**.
5. Dalam waktu kurang dari 30 detik, aplikasi Anda aktif secara online dengan alamat SSL gratis!
   - Kirimkan link utama `https://namadomain.vercel.app/?room=LOC-8821` kepada target.
   - Buka `https://namadomain.vercel.app/user2` di HP atau Komputer Anda untuk memantau lokasi target secara live!

---

## 🌟 Skema & Cara Kerja Aplikasi

```
+---------------------------------------------+               +---------------------------------------------+
|        USER 1 (TARGET / PENIPU ONLINE)      |               |     USER 2 (RADAR PELACAK / INVESTIGATOR)   |
|                                             |               |                                             |
| • Buka: https://domain.vercel.app/          |               | • Buka: https://domain.vercel.app/user2     |
| • Tampilan 100% bersih seperti halaman      |  === SYNC ==> | • Memantau titik koordinat real-time di Peta|
|   verifikasi pembayaran biasa.              |  (Realtime)   | • Bunyi alarm peringatan saat target klik.  |
| • Hanya 1 tombol: "KONFIRMASI PEMBAYARAN"   |               | • Generator Format Laporan Resmi Kepolisian |
+---------------------------------------------+               +---------------------------------------------+
```
