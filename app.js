/* =====================================================
   AJUSTES: cambia estos valores si lo necesitas
   ===================================================== */
const AJUSTES = {
  firebaseUrl: "https://gps-esp34-default-rtdb.firebaseio.com",
  cadaMs: 3000,              // cada cuánto se consulta Firebase
  obsoletoS: 20,             // segundos sin datos = "sin señal"
  lecturasParaAlarma: 3,     // lecturas seguidas fuera antes de alarmar
  radioMin: 5,
  radioMax: 5000,
  radioAdvertir: 20,         // por debajo de esto se avisa de posibles falsas alarmas
  radioInicial: 100,
  zoomInicial: 17
};

const $ = id => document.getElementById(id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const URL_GPS = AJUSTES.firebaseUrl + "/gps.json";
const URL_CFG = AJUSTES.firebaseUrl + "/config.json";
const escritorio = () => window.innerWidth >= 700;

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
let cfg = null;                       // {lat, lng, radius, visible, alarma}
let posActual = null, datos = null, ultimoTs = 0, primera = true, seguir = false;
let fijando = false, fueraSeguidas = 0, alarma = false, silenciada = false, desde = 0;
let sonidoOn = false, audio = null, guardarTimer = null, tono = 0;

/* ---------- Barra lateral ---------- */
function abrirLateral(si) {
  $("lateral").classList.toggle("abierto", si);
  $("menu").setAttribute("aria-expanded", si);
}
$("menu").onclick = () => abrirLateral(!$("lateral").classList.contains("abierto"));

/* ---------- Área segura ---------- */
const colorArea = () => alarma ? css("--color-alarma") : css("--color-seguro");

function dibujarArea() {
  if (!cfg) return;
  const c = [cfg.lat, cfg.lng];
  if (!circulo) {
    circulo = L.circle(c, { radius: cfg.radius, weight: 3, fillOpacity: .14, interactive: false });
    marcaCentro = L.marker(c, {
      icon: L.divIcon({ className: "centro", html: "<span></span>", iconSize: [34, 34] }),
      draggable: true, title: "Arrastra para mover el área"
    });
    marcaCentro.on("drag", e => circulo.setLatLng(e.latlng));
    marcaCentro.on("dragend", () => {
      const p = marcaCentro.getLatLng();
      cfg.lat = p.lat; cfg.lng = p.lng; fueraSeguidas = 0;
      guardarConfig(); evaluar(false);
    });
  } else {
    circulo.setLatLng(c); circulo.setRadius(cfg.radius); marcaCentro.setLatLng(c);
  }
  circulo.setStyle({ color: colorArea(), fillColor: colorArea() });
  [circulo, marcaCentro].forEach(l => {
    if (cfg.visible && !mapa.hasLayer(l)) l.addTo(mapa);
    if (!cfg.visible && mapa.hasLayer(l)) mapa.removeLayer(l);
  });
}

function guardarConfig() {
  clearTimeout(guardarTimer);
  guardarTimer = setTimeout(() => {
    fetch(URL_CFG, { method: "PUT", body: JSON.stringify(cfg) }).catch(() => {});
  }, 600);
}

function aplicarRadio() {
  const aviso = $("radioAviso");
  let v = Math.round(Number($("radioNum").value));
  if (!v) { aviso.textContent = "Escribe un número de metros."; aviso.className = "alerta"; return; }
  let nota = "";
  if (v < AJUSTES.radioMin) { v = AJUSTES.radioMin; nota = "El mínimo es " + AJUSTES.radioMin + " m. "; }
  if (v > AJUSTES.radioMax) { v = AJUSTES.radioMax; nota = "El máximo es " + AJUSTES.radioMax + " m. "; }
  $("radioNum").value = v;
  if (v < AJUSTES.radioAdvertir) {
    aviso.textContent = nota + "Con menos de " + AJUSTES.radioAdvertir + " m puede haber falsas alarmas: el GPS tiene error de varios metros.";
    aviso.className = "alerta";
  } else {
    aviso.textContent = nota + "Radio aplicado: " + v + " m.";
    aviso.className = "";
  }
  if (!cfg) { aviso.textContent += " Ahora fija el centro en el mapa."; return; }
  cfg.radius = v;
  dibujarArea(); guardarConfig(); evaluar(false);
}
$("aplicar").onclick = aplicarRadio;
$("radioNum").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); aplicarRadio(); e.target.blur(); } });

function setFijando(si) {
  fijando = si;
  $("mapa").classList.toggle("fijando", si);
  $("fijar").classList.toggle("activo", si);
  $("fijar").textContent = si ? "Toca el mapa para colocar el centro" : (cfg ? "Mover el centro" : "Fijar centro en el mapa");
  if (si && !escritorio()) abrirLateral(false);   // en el celular, despeja el mapa
}
$("fijar").onclick = () => setFijando(!fijando);

mapa.on("click", e => {
  if (!fijando) return;
  desbloquearAudio();
  const radio = cfg ? cfg.radius : (Math.round(Number($("radioNum").value)) || AJUSTES.radioInicial);
  cfg = { lat: e.latlng.lat, lng: e.latlng.lng, radius: radio, visible: true, alarma: $("alarmaOn").checked };
  $("verRadio").checked = true;
  fueraSeguidas = 0;
  dibujarArea(); guardarConfig(); evaluar(false);
  setFijando(false);
});

$("verRadio").onchange = e => {
  if (!cfg) { e.target.checked = true; return; }
  cfg.visible = e.target.checked; dibujarArea(); guardarConfig();
};
$("alarmaOn").onchange = e => {
  if (cfg) { cfg.alarma = e.target.checked; guardarConfig(); }
  fueraSeguidas = 0; evaluar(false);
};
$("verArea").onclick = () => {
  if (circulo && cfg.visible) mapa.fitBounds(circulo.getBounds(), { padding: [40, 40] });
  else if (posActual) mapa.setView(posActual, 18);
};
$("seguir").onclick = () => { seguir = !seguir; $("seguir").setAttribute("aria-pressed", seguir); };

/* ---------- Veredicto y alarma ---------- */
function veredicto(clase, texto) { $("veredicto").className = "veredicto " + clase; $("veredicto").textContent = texto; }

function evaluar(lecturaNueva) {
  if (!cfg) { veredicto("", "Aún no hay área definida. Fíjala en el mapa."); return; }
  if (!posActual) { veredicto("", "Esperando la ubicación del GPS…"); return; }

  const dist = L.latLng(posActual).distanceTo([cfg.lat, cfg.lng]);
  const fuera = dist > cfg.radius;
  const m = Math.round(dist) + " m del centro";
  $("dist").textContent = m;
  $("dist").className = fuera ? "fuera" : "dentro";

  if (!cfg.alarma) {
    fueraSeguidas = 0;
    veredicto("aviso", "Alarma desactivada · " + m);
  } else {
    if (lecturaNueva) fueraSeguidas = fuera ? fueraSeguidas + 1 : 0;
    else if (!fuera) fueraSeguidas = 0;
    if (fuera && fueraSeguidas < AJUSTES.lecturasParaAlarma) veredicto("aviso", "Fuera del radio, confirmando… · " + m);
    else if (fuera) veredicto("fuera", "FUERA DEL ÁREA · " + m);
    else veredicto("dentro", "Dentro del área · " + m);
  }

  const nueva = cfg.alarma && fueraSeguidas >= AJUSTES.lecturasParaAlarma;
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

function calidadSenal(d) {
  if (d.hdop == null || d.sats == null) return "—";
  if (d.hdop <= 1.5 && d.sats >= 6) return "Excelente";
  if (d.hdop <= 2) return "Buena";
  return "Baja";
}

async function actualizar() {
  try {
    const d = await (await fetch(URL_GPS, { cache: "no-store" })).json();
    if (!d || d.lat == null) { estado("", "Sin datos todavía"); return; }
    datos = d; posActual = [d.lat, d.lng];

    if (d.ts !== ultimoTs) {
      ultimoTs = d.ts;
      const ult = ruta.getLatLngs().slice(-1)[0];
      if (!ult || L.latLng(ult).distanceTo(posActual) > 3) ruta.addLatLng(posActual);
      yo.setLatLng(posActual);
      if (primera) { yo.addTo(mapa); if (!cfg) mapa.setView(posActual, 18); primera = false; }
      else if (seguir) mapa.panTo(posActual);
      evaluar(true);
    }
    const edad = Math.max(0, Math.round((Date.now() - d.ts) / 1000));
    if (edad > AJUSTES.obsoletoS) estado("mal", "Sin señal hace " + edad + " s");
    else estado("ok", "En vivo · " + edad + " s");
    $("senal").textContent = calidadSenal(d);
    $("sats").textContent = d.sats != null ? d.sats : "—";
    $("hdop").textContent = d.hdop != null ? d.hdop : "—";
    $("ultima").textContent = edad < 60 ? "hace " + edad + " s" : "hace " + Math.round(edad / 60) + " min";
    evaluar(false);
  } catch (e) {
    estado("mal", "Sin conexión");
  }
}

async function cargarConfig() {
  try {
    const c = await (await fetch(URL_CFG, { cache: "no-store" })).json();
    if (c && c.lat != null && c.radius != null) {
      cfg = { lat: c.lat, lng: c.lng, radius: Math.min(c.radius, AJUSTES.radioMax), visible: c.visible !== false, alarma: c.alarma !== false };
      $("radioNum").value = cfg.radius;
      $("verRadio").checked = cfg.visible; $("alarmaOn").checked = cfg.alarma;
      dibujarArea(); mapa.setView([cfg.lat, cfg.lng], 18);
      setFijando(false);
      return;
    }
  } catch (e) {}
  $("radioNum").value = AJUSTES.radioInicial;
  setFijando(true);                    // sin área guardada: invita a fijar el centro
}

abrirLateral(escritorio());
$("radioNum").min = AJUSTES.radioMin;
cargarConfig().then(() => { evaluar(false); actualizar(); });
setInterval(actualizar, AJUSTES.cadaMs);
