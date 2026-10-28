/* =====================================================
   AJUSTES: cambia estos valores si lo necesitas
   ===================================================== */
const AJUSTES = {
  firebaseUrl: "https://gps-esp34-default-rtdb.firebaseio.com",
  cadaMs: 3000,              // cada cuánto se consulta Firebase
  obsoletoS: 20,             // segundos sin datos = "sin señal"
  lecturasParaAlarma: 3,     // lecturas seguidas fuera antes de alarmar
  radioMin: 20,              // el GPS tiene error de varios metros
  radioMax: 1000,
  radioInicial: 100,
  zoomInicial: 17
};

const $ = id => document.getElementById(id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const URL_GPS = AJUSTES.firebaseUrl + "/gps.json";
const URL_CFG = AJUSTES.firebaseUrl + "/config.json";

/* ---------- Mapa ---------- */
const mapa = L.map("mapa", { zoomControl: false }).setView([-16.52, -68.208], AJUSTES.zoomInicial);
L.control.zoom({ position: "topright" }).addTo(mapa);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  referrerPolicy: "strict-origin-when-cross-origin",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(mapa);

const yo = L.marker([0, 0], { icon: L.divIcon({ className: "yo", html: "<span></span>", iconSize: [26, 26] }), interactive: false, keyboard: false });
const ruta = L.polyline([], { color: css("--color-primario"), weight: 4, opacity: .7 }).addTo(mapa);
let circulo = null, marcaCentro = null;

/* ---------- Estado ---------- */
let cfg = null;                       // {lat, lng, radius}
let posActual = null, ultimoTs = 0, primera = true, seguir = false;
let fijando = false, fueraSeguidas = 0, alarma = false, silenciada = false, desde = 0;
let sonidoOn = false, audio = null, guardarTimer = null, tono = 0;

/* ---------- Área segura ---------- */
function colorArea() { return alarma ? css("--color-alarma") : css("--color-seguro"); }

function dibujarArea() {
  if (!cfg) return;
  const c = [cfg.lat, cfg.lng];
  if (!circulo) {
    circulo = L.circle(c, { radius: cfg.radius, weight: 3, fillOpacity: .14, interactive: false }).addTo(mapa);
    marcaCentro = L.marker(c, { icon: L.divIcon({ className: "centro", html: "<span></span>", iconSize: [26, 26] }), interactive: false, keyboard: false }).addTo(mapa);
  } else {
    circulo.setLatLng(c); circulo.setRadius(cfg.radius); marcaCentro.setLatLng(c);
  }
  circulo.setStyle({ color: colorArea(), fillColor: colorArea() });
}

function mostrarRadio(v) {
  $("radioTxt").textContent = v;
  $("radio").value = v;
  document.querySelectorAll("#presets button").forEach(b => b.classList.toggle("activo", Number(b.dataset.m) === v));
  resumen();
}

function resumen() {
  $("resumen").textContent = cfg ? cfg.radius + " m de radio" : "Sin definir";
}

function guardarConfig() {
  clearTimeout(guardarTimer);
  guardarTimer = setTimeout(() => {
    fetch(URL_CFG, { method: "PUT", body: JSON.stringify(cfg) }).catch(() => {});
  }, 600);
}

function setRadio(v) {
  v = Math.round(Math.max(AJUSTES.radioMin, Math.min(AJUSTES.radioMax, Number(v) || AJUSTES.radioMin)));
  mostrarRadio(v);
  if (!cfg) return;
  cfg.radius = v;
  dibujarArea(); guardarConfig(); evaluar(false);
}

function setFijando(si) {
  fijando = si;
  $("mapa").classList.toggle("fijando", si);
  $("fijar").classList.toggle("activo", si);
  $("fijar").textContent = si ? "Toca el mapa para colocar el centro" : (cfg ? "Mover el centro" : "Fijar centro en el mapa");
}

mapa.on("click", e => {
  if (!fijando) return;
  desbloquearAudio();
  const radio = cfg ? cfg.radius : AJUSTES.radioInicial;
  cfg = { lat: e.latlng.lat, lng: e.latlng.lng, radius: radio };
  fueraSeguidas = 0;
  mostrarRadio(radio); dibujarArea(); guardarConfig(); evaluar(false);
  setFijando(false);
});

$("radio").min = AJUSTES.radioMin; $("radio").max = AJUSTES.radioMax; $("radio").step = 5;
$("radio").oninput = e => setRadio(e.target.value);
$("menos").onclick = () => setRadio((cfg ? cfg.radius : AJUSTES.radioInicial) - 10);
$("mas").onclick = () => setRadio((cfg ? cfg.radius : AJUSTES.radioInicial) + 10);
$("presets").onclick = e => { if (e.target.dataset.m) setRadio(e.target.dataset.m); };
$("fijar").onclick = () => setFijando(!fijando);
$("verArea").onclick = () => { if (circulo) mapa.fitBounds(circulo.getBounds(), { padding: [40, 40] }); };
$("seguir").onclick = () => { seguir = !seguir; $("seguir").setAttribute("aria-pressed", seguir); };
$("panelBtn").onclick = () => {
  const abierto = $("panelBtn").getAttribute("aria-expanded") === "true";
  $("panelBtn").setAttribute("aria-expanded", !abierto);
  $("panelCuerpo").hidden = abierto;
};

/* ---------- Alarma ---------- */
function evaluar(lecturaNueva) {
  if (!cfg || !posActual) return;
  const dist = L.latLng(posActual).distanceTo([cfg.lat, cfg.lng]);
  const fuera = dist > cfg.radius;
  const dd = $("dist");
  dd.textContent = Math.round(dist) + " m";
  dd.className = fuera ? "fuera" : "dentro";

  if (lecturaNueva) fueraSeguidas = fuera ? fueraSeguidas + 1 : 0;
  else if (!fuera) fueraSeguidas = 0;

  const nueva = fueraSeguidas >= AJUSTES.lecturasParaAlarma;
  if (nueva !== alarma) {
    alarma = nueva;
    document.body.classList.toggle("alarma-activa", alarma);
    $("alarma").hidden = !alarma;
    if (alarma) {
      desde = Date.now(); silenciada = false;
      $("silenciar").disabled = false; $("silenciar").textContent = "Silenciar";
      if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
    } else {
      document.title = "Rastreo GPS · Área segura";
    }
    if (circulo) circulo.setStyle({ color: colorArea(), fillColor: colorArea() });
  }
  detalleAlarma(dist);
}

function detalleAlarma(dist) {
  if (!alarma || !cfg || !posActual) return;
  if (dist == null) dist = L.latLng(posActual).distanceTo([cfg.lat, cfg.lng]);
  const seg = Math.round((Date.now() - desde) / 1000);
  $("alarmaDetalle").textContent = Math.round(dist) + " m del centro · " + Math.max(0, Math.round(dist - cfg.radius)) + " m fuera del radio · " + seg + " s";
}

$("silenciar").onclick = () => { silenciada = true; $("silenciar").disabled = true; $("silenciar").textContent = "Silenciada"; };

function desbloquearAudio() {
  if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (audio && audio.state === "suspended") audio.resume();
}
$("sonido").onclick = () => {
  desbloquearAudio();
  sonidoOn = !sonidoOn;
  $("sonido").setAttribute("aria-pressed", sonidoOn);
  $("sonido").textContent = "Sonido: " + (sonidoOn ? "sí" : "no");
};

// Sirena de dos tonos + título parpadeante mientras dure la alarma
setInterval(() => {
  if (!alarma) return;
  tono = 1 - tono;
  document.title = tono ? "⚠ FUERA DEL ÁREA" : "Rastreo GPS";
  if (sonidoOn && !silenciada && audio) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = "square"; o.frequency.value = tono ? 880 : 660; g.gain.value = .15;
    o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + .3);
  }
}, 450);
setInterval(() => detalleAlarma(), 1000);

/* ---------- Datos del GPS ---------- */
function estado(clase, texto) { $("chip").className = "chip " + clase; $("estado").textContent = texto; }

async function actualizar() {
  try {
    const d = await (await fetch(URL_GPS, { cache: "no-store" })).json();
    if (!d || d.lat == null) { estado("", "Sin datos todavía"); return; }
    posActual = [d.lat, d.lng];

    if (d.ts !== ultimoTs) {
      ultimoTs = d.ts;
      ruta.addLatLng(posActual);
      yo.setLatLng(posActual);
      if (primera) { yo.addTo(mapa); if (!cfg) mapa.setView(posActual, 18); primera = false; }
      else if (seguir) mapa.panTo(posActual);
      evaluar(true);
    }
    const edad = Math.max(0, Math.round((Date.now() - d.ts) / 1000));
    if (edad > AJUSTES.obsoletoS) estado("mal", "Sin señal hace " + edad + " s");
    else estado("ok", "En vivo · " + edad + " s");
    $("sats").textContent = d.sats != null ? d.sats : "—";
    $("hdop").textContent = d.hdop != null ? d.hdop : "—";
    $("ultima").textContent = edad < 60 ? "hace " + edad + " s" : "hace " + Math.round(edad / 60) + " min";
    if (cfg) evaluar(false);
  } catch (e) {
    estado("mal", "Sin conexión");
  }
}

async function cargarConfig() {
  try {
    const c = await (await fetch(URL_CFG, { cache: "no-store" })).json();
    if (c && c.lat != null && c.radius != null) {
      cfg = { lat: c.lat, lng: c.lng, radius: Math.min(c.radius, AJUSTES.radioMax) };
      mostrarRadio(cfg.radius); dibujarArea(); mapa.setView([cfg.lat, cfg.lng], 18);
      setFijando(false);
      return;
    }
  } catch (e) {}
  mostrarRadio(AJUSTES.radioInicial);
  setFijando(true);                    // sin área guardada: invita a fijar el centro
}

cargarConfig().then(actualizar);
setInterval(actualizar, AJUSTES.cadaMs);
