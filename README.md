# APIBayar Test App

Test harness internal untuk mencoba alur **API Bayar** (payment link / widget / QRIS)
tanpa harus kirim file ke sana sini. Pure HTML + CSS + JavaScript, **tanpa build step
dan tanpa dependency** — cukup buka `index.html` di browser.

## Isi repo

```
apibayar-test-app/
├── index.html          # input bearer token + daftar tool
├── payment-link.html   # generate widget token, buka payment widget
├── qr-generator.html   # ubah string/response API jadi QR code
├── assets/
│   ├── app.js          # helper: token storage, env config, api fetch
│   └── theme.css       # tema hitam-putih bersama
├── serve.ps1           # static server opsional
├── README.md
└── .gitignore
```

## Cara pakai

1. Buka `index.html` (double click) atau jalankan server statis:

   ```powershell
   ./serve.ps1              # default port 5173
   ./serve.ps1 -Port 8080   # custom port
   ```

2. Di halaman **index**, isi field **Bearer Token** dengan secret token merchant
   (Base64 `API_KEY:API_SECRET`).

3. Pilih **Environment**:

   | Environment | API base | Widget script |
   |---|---|---|
   | Development | `https://dev.apibayar.com` | `https://dev-client.apibayar.com/widget/widget.min.js` |
   | Production  | `https://prd.apibayar.com`  | `https://client.apibayar.com/widget/widget.min.js` |

   Frontend environment **harus cocok** dengan token yang dipakai (dev token → dev widget).

4. (Opsional) atur masa aktif token, lalu klik **Simpan Token**. Tombol
   **Test Koneksi API** memanggil `POST /payment/v1/widget/token/server` untuk
   memastikan token + env benar sebelum lanjut ke tool.

5. Klik tool yang mau dites.

## Penyimpanan token

| Mekanisme | Perilaku |
|---|---|
| `sessionStorage` (default) | Hilang saat tab ditutup |
| Masa aktif (TTL) | Default 1 jam, bisa 15 menit s/d tanpa expiry |
| Reload halaman | Token **dibuang** saat reload, kecuali centang "Ingat di browser" |
| "Ingat di browser" | Disimpan di `localStorage`, bertahan lintas reload |

Token tidak pernah disimpan di repo, dan request hanya dikirim ke host API Bayar
yang dipilih. Jangan commit token asli ke git.

## payment-link.html

- Generate reference ID otomatis (`TRX<ddmmyy><6 digit epoch>`).
- Request `POST /payment/v1/widget/token/server` memakai bearer token dari index.
- Buka payment widget sesuai environment aktif (`sandbox: true` untuk dev).
- Response API ditampilkan penuh, plus QR langsung kalau response punya `data.qrCode`.
- Tombol **Buka di QR Generator** meneruskan payload QR ke halaman berikutnya.

## qr-generator.html

- Input bisa berupa **string QR** apa adanya atau **response JSON API**.
- Tombol **Ambil dari JSON** mencari field QR secara rekursif
  (`qrCode`, `qr_string`, `qrContent`, `payload`, dan key umum lainnya).
- Atur ukuran, error correction (L/M/Q/H), dan margin QR.
- Bisa copy string payload dan download PNG.
- Tekan `Enter` (tanpa Shift) untuk generate.

## Menambah tool baru

1. Buat `nama-tool.html`, load `assets/theme.css` + `assets/app.js`.
2. Panggil `App.requireToken()` di awal — user otomatis dikembalikan ke index
   kalau token belum ada / kedaluwarsa.
3. Pakai `App.apiFetch(path, { method, body })` supaya header Authorization dan
   base URL environment ikut benar.
4. Daftarkan kartu tool-nya di `index.html` (`<div class="tool-grid">`).

## Catatan keamanan

- Hanya untuk testing internal dengan credential sandbox.
- Secret token merchant bersifatENC — whoever punya repo ini bisa melakukan request
  atas nama merchant tersebut. Jangan fork ke publik.
- Kalau token pernah bocor, regenerate/rotasi secret di dashboard API Bayar.