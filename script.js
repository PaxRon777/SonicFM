/* ═══════════════════════════════════════════
   Sonic Radio Streaming App — Logic
   ═══════════════════════════════════════════ */

// ── API & State ──
const API_BASE = 'https://de1.api.radio-browser.info/json';
let allStations = [];          // full loaded dataset (paginated)
let displayStations = [];      // what's actually rendered after filtering
let currentPage = 0;
const PAGE_SIZE = 36;
let favourites = JSON.parse(localStorage.getItem('sonic_favourites') || '[]');

// Filter state — tracks active filters so we can clear them
let currentFilter = null;      // { type: 'country', value: 'Germany' } or null

// ── DOM Refs ──
const audioPlayer = document.getElementById('audioPlayer');
const stationGrid = document.getElementById('stationGrid');
const favGrid = document.getElementById('favGrid');
const countryGrid = document.getElementById('countryGrid');
const searchInput = document.getElementById('searchInput');
const countrySearchInput = document.getElementById('countrySearchInput');
const sortBySelect = document.getElementById('sortBy');
const loadMoreBtn = document.getElementById('loadMoreBtn');
const playBtn = document.getElementById('playBtn');
const miniPlayBtn = document.getElementById('miniPlayBtn');
const favBtn = document.getElementById('favBtn');
const volumeSlider = document.getElementById('volumeSlider');
const playerStationName = document.getElementById('playerStationName');
const playerMeta = document.getElementById('playerMeta');
const artworkPlaceholder = document.getElementById('artworkPlaceholder');
const miniPlayer = document.getElementById('miniPlayer');
const miniStationName = document.getElementById('miniStationName');
const miniCountryCode = document.getElementById('miniCountryCode');
const playerStatus = document.getElementById('statusText');
const statusDot = document.querySelector('.status-dot');

let currentStation = null;
let isPlaying = false;

// ── Plexus Background ──
(function initPlexus() {
  const canvas = document.getElementById('plexus');
  const ctx = canvas.getContext('2d');
  let w, h, particles = [];
  const PARTICLE_COUNT = 60;
  const CONNECTION_DIST = 150;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }

  class Particle {
    constructor() { this.reset(); }
    reset() {
      this.x = Math.random() * w;
      this.y = Math.random() * h;
      this.vx = (Math.random() - 0.5) * 0.4;
      this.vy = (Math.random() - 0.5) * 0.4;
      this.r = Math.random() * 2 + 1;
    }
    update(mx, my) {
      const dx = this.x - mx, dy = this.y - my;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 180 && dist > 0) {
        const force = (180 - dist) / 180 * 0.02;
        this.vx += dx / dist * force;
        this.vy += dy / dist * force;
      }
      this.x += this.vx;
      this.y += this.vy;
      this.vx *= 0.99;
      this.vy *= 0.99;
      if (this.x < -50) this.x = w + 50;
      if (this.x > w + 50) this.x = -50;
      if (this.y < -50) this.y = h + 50;
      if (this.y > h + 50) this.y = -50;
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(134, 193, 213, 0.6)';
      ctx.fill();
    }
  }

  for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle());

  let mouseX = -999, mouseY = -999;
  window.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
  window.addEventListener('mouseleave', () => { mouseX = -999; mouseY = -999; });
  window.addEventListener('resize', resize);
  resize();

  function animate() {
    ctx.clearRect(0, 0, w, h);
    particles.forEach(p => p.update(mouseX, mouseY));
    // Connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONNECTION_DIST) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(134, 193, 213, ${0.15 * (1 - dist / CONNECTION_DIST)})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    }
    particles.forEach(p => p.draw());
    requestAnimationFrame(animate);
  }
  animate();
})();

// ── Navigation ──
document.querySelectorAll('.nav-links li').forEach(li => {
  li.addEventListener('click', () => {
    document.querySelectorAll('.nav-links li').forEach(l => l.classList.remove('active'));
    li.classList.add('active');
    const target = li.querySelector('a').getAttribute('href').replace('#', '');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(target).classList.add('active');

    if (target === 'favourites') renderFavourites();
    if (target === 'countries') loadCountries();
    if (target === 'discover') {
      // Re-render stations when returning to Discover to update heart icons
      renderStations();
    }
  });
});

// ── API Functions ──
async function fetchStations(params = {}) {
  const qs = new URLSearchParams({ ...params, reverse: 'true' });
  try {
    const res = await fetch(`${API_BASE}/stations/search?${qs}`);
    if (!res.ok) throw new Error('API error');
    return await res.json();
  } catch (e) {
    console.error('Fetch stations failed:', e);
    return [];
  }
}

async function loadStations(reset = true) {
  if (reset) { currentPage = 0; stationGrid.innerHTML = ''; allStations = []; displayStations = []; }
  
  const limit = PAGE_SIZE;
  const offset = reset ? 0 : currentPage * PAGE_SIZE;
  const sortVal = sortBySelect.value;
  const orderMap = { votes: 'votes', name: 'name', clickcount: 'clickcount' };
  const sortOrder = orderMap[sortVal] || 'votes';

  loadMoreBtn.disabled = true;
  loadMoreBtn.textContent = 'Loading...';

  // Build API params — include search term if present, use order (not sort_by)
  const apiParams = { limit, offset };
  
  // Add active country filter to every request
  if (currentFilter && currentFilter.type === 'country') {
    apiParams.countrycode = currentFilter.value;
  }
  
  const search = searchInput?.value?.toLowerCase().trim();
  if (search) apiParams.name = search;
  apiParams.order = sortOrder;

  const stations = await fetchStations(apiParams);
  if (stations.length === 0) {
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = 'No more stations';
    return;
  }

  // Deduplicate by stationuuid before adding to allStations
  const newStations = stations.filter(s => !allStations.find(existing => existing.stationuuid === s.stationuuid));
  
  if (newStations.length > 0) {
    allStations.push(...newStations);
    currentPage++;
    displayStations = [...allStations];
    renderStations();
  } else {
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = 'No more stations';
  }
  
  loadMoreBtn.disabled = false;
  loadMoreBtn.textContent = 'Load More Stations';
}

// ── Render Station Cards ──
function createStationCard(station) {
  // Consistent key name for all favourite operations
  const uuid = station.stationuuid;
  const isFaved = favourites.some(f => f.uuid === uuid);
  const tags = station.tags ? station.tags.split(',').slice(0, 2).join(', ') : '';

  const card = document.createElement('div');
  card.className = 'station-card' + (currentStation?.stationuuid === station.stationuuid && isPlaying ? ' playing' : '');
  card.dataset.uuid = uuid;

  card.innerHTML = `
    <div class="station-favicon">${station.favicon ? `<img src="${station.favicon}" alt="" loading="lazy" onerror="this.parentElement.textContent='📻'" />` : '📻'}</div>
    <div class="station-name" title="${escapeHtml(station.name)}">${escapeHtml(station.name)}</div>
    ${tags ? `<div class="station-tags">${escapeHtml(tags)}</div>` : ''}
    <div class="station-meta">
      <span>${station.countrycode || '—'} · ${(station.bitrate / 1000).toFixed(1)}k</span>
      <button class="station-fav-btn ${isFaved ? 'faved' : ''}" data-uuid="${uuid}" title="${isFaved ? 'Remove from favourites' : 'Add to favourites'}">
        ${isFaved ? '♥' : '♡'}
      </button>
    </div>
  `;

  card.addEventListener('click', (e) => {
    if (e.target.classList.contains('station-fav-btn')) return;
    playStation(station);
  });

  const favBtn = card.querySelector('.station-fav-btn');
  favBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavourite(uuid, station.name, station.url_resolved || station.url, station.countrycode || '', station.favicon || '');
    renderStations();
  });

  return card;
}

function renderStations() {
  const search = searchInput.value.toLowerCase().trim();

  // If there's a country filter active, use it as the primary filter instead of text search
  let filtered;
  if (currentFilter && currentFilter.type === 'country') {
    filtered = allStations.filter(s => s.countrycode?.toLowerCase() === currentFilter.value.toLowerCase());
  } else if (search) {
    // Text search across name, tags, country code
    filtered = displayStations.filter(s =>
      s.name.toLowerCase().includes(search) ||
      (s.tags && s.tags.toLowerCase().includes(search)) ||
      (s.countrycode && s.countrycode.toLowerCase().includes(search))
    );
  } else {
    // No filter — show all loaded stations
    filtered = displayStations;
  }

  stationGrid.innerHTML = '';
  filtered.forEach(st => stationGrid.appendChild(createStationCard(st)));
}

// ── Favourites ──
function toggleFavourite(uuid, name = '', url = '', countrycode = '', favicon = '') {
  const existing = favourites.find(f => f.uuid === uuid);
  if (existing) {
    // Remove from favourites — just pass the uuid
    favourites = favourites.filter(f => f.uuid !== uuid);
  } else {
    // Add to favourites with all data
    favourites.push({ uuid, name, url, countrycode, favicon });
  }
  localStorage.setItem('sonic_favourites', JSON.stringify(favourites));
}

function renderFavourites() {
  favGrid.innerHTML = '';
  document.getElementById('favEmpty').style.display = favourites.length ? 'none' : 'block';

  if (favourites.length === 0) return;

  favourites.forEach(f => {
    const card = document.createElement('div');
    card.className = 'station-card' + (currentStation?.uuid === f.uuid && isPlaying ? ' playing' : '');
    card.innerHTML = `
      <div class="station-favicon">${f.favicon ? `<img src="${f.favicon}" alt="" loading="lazy" onerror="this.parentElement.textContent='📻'" />` : '📻'}</div>
      <div class="station-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
      <div class="station-meta">
        <span>${f.countrycode || '—'}</span>
        <button class="station-fav-btn faved" data-uuid="${f.uuid}" title="Remove from favourites">♥</button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('station-fav-btn')) return;
      playStation({ stationuuid: f.uuid, name: f.name, url_resolved: f.url, countrycode: f.countrycode });
    });

    const favBtn = card.querySelector('.station-fav-btn');
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavourite(f.uuid); // Single arg — now works because params are optional
      renderFavourites(); // Re-render favourites list immediately
    });

    favGrid.appendChild(card);
  });
}

// ── Countries ──
let allCountries = [];

async function loadCountries() {
  if (allCountries.length > 0) return; // cached
  try {
    const res = await fetch(`${API_BASE}/countries`);
    if (!res.ok) throw new Error('API error');
    allCountries = await res.json();
    renderCountries();
  } catch (e) { console.error('Load countries failed:', e); }
}

function renderCountries() {
  const search = countrySearchInput.value.toLowerCase().trim();
  const filtered = allCountries.filter(c => !search || c.name.toLowerCase().includes(search));
  countryGrid.innerHTML = '';

  // Sort by station count descending, show top countries
  const sorted = [...filtered].sort((a, b) => b.stationcount - a.stationcount);

  sorted.forEach(c => {
    const card = document.createElement('div');
    card.className = 'country-card';
    card.innerHTML = `
      <span class="country-flag">${getFlagEmoji(c.iso_3166_1_alpha2 || '')}</span>
      <span class="country-name">${escapeHtml(c.name)}</span>
      <span class="country-count">${c.stationcount.toLocaleString()}</span>
    `;

    card.addEventListener('click', () => filterByCountry(c.name));
    countryGrid.appendChild(card);
  });
}

function getFlagEmoji(code) {
  if (!code || code.length !== 2) return '🌍';
  const offset = 127397;
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => c.charCodeAt() + offset));
}

async function filterByCountry(countryName) {
  // Switch to discover view and load stations for this country
  document.querySelectorAll('.nav-links li').forEach(l => l.classList.remove('active'));
  document.querySelector('.nav-links li:first-child').classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('discover').classList.add('active');

  // Clear old filter and data immediately so pending renders don't show stale results
  currentFilter = null;
  allStations = [];
  displayStations = [];
  currentPage = 0;
  stationGrid.innerHTML = '';

  loadMoreBtn.textContent = 'Loading...';
  loadMoreBtn.disabled = true;

  // Map country name to ISO code using the countries API data we already loaded
  const countryData = allCountries.find(c => c.name === countryName);
  const isoCode = countryData?.iso_3166_1 || null;

  console.log('Filtering by:', countryName, '->', isoCode);

  if (!isoCode) {
    console.error('Country not found in allCountries:', countryName);
    loadMoreBtn.disabled = false;
    loadMoreBtn.textContent = 'Load More Stations';
    return;
  }

  // Radio Browser API expects countrycode (ISO code), not country name
  const stations = await fetchStations({ countrycode: isoCode, limit: PAGE_SIZE });
  
  console.log('Fetched', stations.length, 'stations for', isoCode);
  
  if (!stations || stations.length === 0) {
    loadMoreBtn.disabled = false;
    loadMoreBtn.textContent = 'Load More Stations';
    return;
  }

  allStations = stations;
  displayStations = [...allStations];
  currentPage = 1;
  currentFilter = { type: 'country', value: isoCode };

  console.log('Current filter:', currentFilter);
  renderStations();

  loadMoreBtn.disabled = false;
  loadMoreBtn.textContent = 'Load More Stations';
}

// ── Audio Player ──
function playStation(station) {
  currentStation = station;
  audioPlayer.src = station.url_resolved || station.url;
  audioPlayer.play().then(() => {
    isPlaying = true;
    updatePlayerUI();
    renderStations();
    if (favourites.length > 0) renderFavourites();
  }).catch(err => {
    console.error('Playback failed:', err);
    setStatus('Error', 'error');
  });
}

function togglePlay() {
  if (!currentStation) return;
  if (isPlaying) {
    audioPlayer.pause();
    isPlaying = false;
  } else {
    audioPlayer.play().then(() => {
      isPlaying = true;
      updatePlayerUI();
    });
  }
}

function updatePlayerUI() {
  const name = currentStation?.name || 'No station selected';
  playerStationName.textContent = name;
  playerMeta.textContent = `${currentStation?.countrycode || ''} · ${(currentStation?.bitrate / 1000).toFixed(1)}k`;

  // Mini player
  miniPlayer.style.display = currentStation ? 'flex' : 'none';
  miniStationName.textContent = name;
  miniCountryCode.textContent = currentStation?.countrycode || '';

  // Play button state
  playBtn.textContent = isPlaying ? '⏸' : '▶';
  miniPlayBtn.textContent = isPlaying ? '⏸' : '▶';

  // Favourite button — normalize uuid from stationuuid to uuid for consistency
  const uuid = currentStation?.stationuuid || '';
  const isFaved = favourites.some(f => f.uuid === uuid);
  favBtn.textContent = isFaved ? '♥' : '♡';
  favBtn.classList.toggle('faved', isFaved);

  setStatus(isPlaying ? 'Streaming' : 'Paused', isPlaying ? 'connected' : '');
}

function setStatus(text, state) {
  playerStatus.textContent = text;
  statusDot.className = 'status-dot' + (state ? ` ${state}` : '');
}

// ── Events ──
playBtn.addEventListener('click', togglePlay);
miniPlayBtn.addEventListener('click', togglePlay);

favBtn.addEventListener('click', () => {
  if (!currentStation) return;
  const uuid = currentStation.stationuuid;
  const isFaved = favourites.some(f => f.uuid === uuid);
  if (isFaved) {
    // Remove from favourites — use the unified toggle function
    toggleFavourite(uuid);
  } else {
    // Add to favourites with all data
    toggleFavourite(uuid, currentStation.name, currentStation.url_resolved || currentStation.url, currentStation.countrycode || '', currentStation.favicon || '');
  }
  updatePlayerUI();
});

volumeSlider.addEventListener('input', () => { audioPlayer.volume = volumeSlider.value / 100; });

let searchDebounce = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => loadStations(true), 400); // debounce to avoid excessive API calls
});
countrySearchInput.addEventListener('input', renderCountries);
sortBySelect.addEventListener('change', () => loadStations(true));
loadMoreBtn.addEventListener('click', () => loadStations(false));

audioPlayer.addEventListener('playing', () => setStatus('Streaming', 'connected'));
audioPlayer.addEventListener('pause', () => setStatus('Paused', ''));
audioPlayer.addEventListener('error', () => { setStatus('Error — stream unavailable', 'error'); isPlaying = false; updatePlayerUI(); });
audioPlayer.addEventListener('waiting', () => setStatus('Buffering...', ''));

// ── Utility ──
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ── Init ──
loadStations();
