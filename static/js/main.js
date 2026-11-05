/* Cliente de la Búsqueda del tesoro. Consume exclusivamente la API REST de Flask.
   Una sola base de código para /  (jugador) y /admin (organizador). */
(() => {
  "use strict";

  const LS_KEY = "tesoro_equipo_v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- utilidades comunes ---------- */
  async function api(path, options = {}) {
    try {
      const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
      let data = {};
      try { data = await res.json(); } catch (_) { /* respuesta sin JSON */ }
      return { ok: res.ok, status: res.status, data };
    } catch (_) {
      return { ok: false, status: 0, data: { error: "No hay conexión con el servidor." } };
    }
  }

  let msgTimer = null;
  function mostrarMensaje(texto, tipo = "info") {
    const el = $("mensaje");
    if (!el) return;
    el.className = "msg msg-" + tipo;
    el.textContent = texto;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => el.classList.add("hidden"), 8000);
  }

  function fmtTiempo(s) {
    if (s === null || s === undefined) return "—";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + "h " : "") + m + "m " + String(x).padStart(2, "0") + "s";
  }

  async function cargarRanking(modoAdmin) {
    const r = await api("/api/ranking");
    const tbody = $("tbody-ranking");
    if (!r.ok || !tbody) return null;
    const cols = modoAdmin ? 5 : 4;
    const filas = r.data.ranking;
    if (!filas.length) {
      tbody.innerHTML = `<tr><td colspan="${cols}" class="text-slate-500">Todavía no hay equipos registrados.</td></tr>`;
      return r.data;
    }
    tbody.innerHTML = filas.map((f) => {
      const ens = f.usa_ensayo ? ' <span title="Usó Modo Ensayo">⚠</span>' : "";
      const base = `<td>${f.posicion}</td><td>${esc(f.equipo)}${ens}</td><td>${f.pistas}/${f.total}</td><td>${fmtTiempo(f.tiempo_segundos)}</td>`;
      return "<tr>" + base + (modoAdmin ? `<td>${f.finalizado ? "🏁 Finalizó" : "En juego"}</td>` : "") + "</tr>";
    }).join("");
    return r.data;
  }

  /* =====================================================================
     PANEL DEL ORGANIZADOR
     ===================================================================== */
  function initAdmin() {
    async function refrescar() {
      const d = await cargarRanking(true);
      if (!d) return;
      $("stat-equipos").textContent = d.ranking.length;
      $("stat-fin").textContent = d.ranking.filter((f) => f.finalizado).length;
      $("stat-hora").textContent = new Date().toLocaleTimeString("es-AR");
    }

    $("btn-reset").addEventListener("click", async () => {
      const clave = $("admin-clave").value;
      if (!clave) return mostrarMensaje("Ingresá la clave del organizador.", "error");
      if (!confirm("¿Seguro? Se borrarán todos los equipos y el avance.")) return;
      const r = await api("/api/admin/reset", { method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Key": clave } });
      mostrarMensaje(r.ok ? r.data.mensaje : (r.data.error || "No se pudo reiniciar."), r.ok ? "ok" : "error");
      if (r.ok) { $("admin-clave").value = ""; refrescar(); }
    });

    refrescar();
    setInterval(refrescar, 5000);
  }

  /* =====================================================================
     UI DEL JUGADOR
     ===================================================================== */
  const S = {
    config: null, equipo: null, estado: null,
    mapa: null, capa: null, marcadorUsuario: null, circuloGeocerca: null,
    posReal: null, posSim: null, ensayo: false,
    qr: null, escaneando: false, ultimoQR: 0, gpsId: null,
  };

  const posActual = () => (S.ensayo ? S.posSim : S.posReal);

  function mostrarRegistro() {
    $("panel-juego").classList.add("hidden");
    $("panel-registro").classList.remove("hidden");
  }

  async function initJugador() {
    const r = await api("/api/config");
    if (!r.ok) return mostrarMensaje("No se pudo cargar la configuración del juego.", "error");
    S.config = r.data;
    $("titulo-plaza").textContent = S.config.plaza.nombre;
    document.title = S.config.titulo || document.title;

    const dp = S.config.datos_personales;
    $("consent-detalle").innerHTML =
      `<p><b>Responsable:</b> ${esc(dp.responsable)}</p>` +
      `<p><b>Finalidad:</b> ${esc(dp.finalidad)}</p>` +
      `<p><b>Contacto:</b> ${esc(dp.contacto)}</p>` +
      "<p>Podés ejercer tus derechos de acceso, rectificación y supresión (arts. 14 a 16 de la Ley 25.326) escribiendo al contacto indicado. " +
      "La Agencia de Acceso a la Información Pública es el órgano de control de la ley.</p>";

    conectarEventos();

    try { S.equipo = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (_) { S.equipo = null; }
    if (S.equipo && (await cargarEstado())) await entrarAlJuego();
    else mostrarRegistro();

    cargarRanking(false);
    setInterval(() => cargarRanking(false), 10000);
  }

  function conectarEventos() {
    $("form-registro").addEventListener("submit", async (e) => {
      e.preventDefault();
      const cuerpo = {
        nombre_equipo: $("reg-nombre").value.trim(),
        integrantes: $("reg-integrantes").value.trim(),
        email: $("reg-email").value.trim(),
        consentimiento: $("reg-consent").checked,
      };
      const r = await api("/api/registrar", { method: "POST", body: JSON.stringify(cuerpo) });
      if (!r.ok) return mostrarMensaje(r.data.error || "No se pudo registrar el equipo.", "error");
      S.equipo = { id: r.data.equipo_id, clave: r.data.clave, nombre: r.data.nombre_equipo };
      localStorage.setItem(LS_KEY, JSON.stringify(S.equipo));
      $("form-registro").reset();
      if (await cargarEstado()) await entrarAlJuego();
      cargarRanking(false);
    });

    $("btn-salir").addEventListener("click", () => {
      if (!confirm("¿Cambiar de equipo? Perderás el acceso a esta sesión.")) return;
      localStorage.removeItem(LS_KEY);
      location.reload();
    });

    $("btn-qr-iniciar").addEventListener("click", iniciarQR);
    $("btn-qr-detener").addEventListener("click", detenerQR);
    $("btn-codigo").addEventListener("click", () => {
      const v = $("input-codigo").value.trim();
      if (!v) return mostrarMensaje("Ingresá el código de 4 dígitos.", "error");
      enviarValidacion("manual", v);
    });
    $("input-codigo").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-codigo").click(); });

    // Modo Ensayo
    if (S.config.modo_ensayo_habilitado) {
      $("bloque-ensayo").classList.remove("hidden");
      $("sel-pista-ensayo").innerHTML = S.config.pistas
        .map((p) => `<option value="${p.orden}">${p.orden}. ${esc(p.nombre)}</option>`).join("");
    }
    $("chk-ensayo").addEventListener("change", (e) => alternarEnsayo(e.target.checked));
    $("btn-teletransportar").addEventListener("click", () => {
      const p = S.config.pistas.find((x) => String(x.orden) === $("sel-pista-ensayo").value);
      if (p) teletransportar(p.lat, p.lng);
    });
    $("btn-autocodigo").addEventListener("click", () => {
      const act = S.estado && S.estado.pista_actual;
      const p = act && S.config.pistas.find((x) => x.orden === act.orden);
      if (p && p.codigo_manual) $("input-codigo").value = p.codigo_manual;
    });
  }

  async function cargarEstado() {
    const q = new URLSearchParams({ equipo_id: S.equipo.id, clave: S.equipo.clave });
    const r = await api("/api/estado?" + q.toString());
    if (!r.ok) {
      if (r.status === 401) {
        localStorage.removeItem(LS_KEY);
        S.equipo = null;
        mostrarMensaje("Tu sesión ya no es válida (¿se reinició la partida?). Registrá al equipo nuevamente.", "info");
      }
      return false;
    }
    S.estado = r.data;
    return true;
  }

  async function entrarAlJuego() {
    $("panel-registro").classList.add("hidden");
    $("panel-juego").classList.remove("hidden");
    $("nombre-equipo").textContent = S.equipo.nombre;
    iniciarMapa();
    iniciarGPS();
    renderEstado();
  }

  /* ---------- estado / progreso ---------- */
  function renderEstado() {
    const e = S.estado;
    if (!e) return;
    const pct = Math.round((e.completadas / e.total) * 100);
    $("progreso-barra").style.width = pct + "%";
    $("progreso-pct").textContent = pct + "%";
    $("progreso-texto").textContent = e.finalizado
      ? `Completaste las ${e.total} pistas`
      : `Pista ${e.pista_actual.orden} de ${e.total}`;

    $("bloque-acertijo").classList.toggle("hidden", e.finalizado);
    $("bloque-validar").classList.toggle("hidden", e.finalizado);
    $("bloque-final").classList.toggle("hidden", !e.finalizado);
    if (!e.finalizado) $("acertijo").textContent = e.pista_actual.acertijo;
    if (e.finalizado) detenerQR();
    renderMapa();
  }

  /* ---------- mapa (Leaflet + OpenStreetMap) ---------- */
  function iniciarMapa() {
    if (S.mapa) { setTimeout(() => S.mapa.invalidateSize(), 100); return; }
    const c = S.config.plaza.centro;
    S.mapa = L.map("map").setView([c.lat, c.lng], S.config.plaza.zoom || 17);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(S.mapa);
    S.capa = L.layerGroup().addTo(S.mapa);

    S.mapa.on("click", (ev) => { if (S.ensayo) teletransportar(ev.latlng.lat, ev.latlng.lng); });
    setTimeout(() => S.mapa.invalidateSize(), 150);
  }

  function renderMapa() {
    if (!S.mapa) return;
    S.capa.clearLayers();

    // Pistas ya superadas (el servidor entrega sus coordenadas).
    (S.estado.historial || []).forEach((h) => {
      L.circleMarker([h.lat, h.lng], { radius: 8, color: "#a3e635", fillColor: "#a3e635", fillOpacity: 0.8 })
        .bindTooltip(`✔ ${h.orden}. ${h.nombre}`).addTo(S.capa);
    });

    // En Modo Ensayo se muestran todas las pistas y la geocerca de la activa.
    if (S.ensayo) {
      const act = S.estado.pista_actual ? S.estado.pista_actual.orden : null;
      S.config.pistas.forEach((p) => {
        if (p.lat === undefined) return;
        const activa = p.orden === act;
        L.circleMarker([p.lat, p.lng], {
          radius: activa ? 9 : 5, color: activa ? "#e879f9" : "#64748b",
          fillColor: activa ? "#e879f9" : "#64748b", fillOpacity: 0.7,
        }).bindTooltip(`${p.orden}. ${p.nombre}`).addTo(S.capa);
        if (activa) {
          L.circle([p.lat, p.lng], { radius: p.radio_m, color: "#e879f9", weight: 1, fillOpacity: 0.1 }).addTo(S.capa);
        }
      });
    }
    actualizarMarcadorUsuario();
  }

  function actualizarMarcadorUsuario() {
    if (!S.mapa) return;
    const p = posActual();
    const txt = $("pos-texto");
    if (!p) {
      if (S.marcadorUsuario) { S.mapa.removeLayer(S.marcadorUsuario); S.marcadorUsuario = null; }
      txt.textContent = "Esperando posición GPS… (permití el acceso a tu ubicación)";
      return;
    }
    const color = S.ensayo ? "#e879f9" : "#22d3ee";
    if (!S.marcadorUsuario) {
      S.marcadorUsuario = L.circleMarker([p.lat, p.lng], { radius: 9, color, fillColor: color, fillOpacity: 0.9, weight: 3 }).addTo(S.mapa);
    } else {
      S.marcadorUsuario.setLatLng([p.lat, p.lng]);
      S.marcadorUsuario.setStyle({ color, fillColor: color });
    }
    txt.textContent = `${S.ensayo ? "📍 Posición SIMULADA" : "📡 GPS real"}: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` +
      (!S.ensayo && p.acc ? ` (±${Math.round(p.acc)} m)` : "");
  }

  /* ---------- GPS real y Modo Ensayo ---------- */
  function iniciarGPS() {
    if (S.gpsId !== null) return;
    if (!("geolocation" in navigator)) {
      return mostrarMensaje("Tu navegador no soporta geolocalización. Usá el Modo Ensayo o el código manual.", "error");
    }
    S.gpsId = navigator.geolocation.watchPosition(
      (pos) => {
        S.posReal = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
        if (!S.ensayo) {
          const primera = !S.marcadorUsuario;
          actualizarMarcadorUsuario();
          if (primera && S.mapa) S.mapa.setView([S.posReal.lat, S.posReal.lng], S.mapa.getZoom());
        }
      },
      (err) => {
        const m = err.code === 1
          ? "Permiso de ubicación denegado. Habilitalo en el navegador (requiere HTTPS) o usá el Modo Ensayo."
          : "No se pudo obtener la ubicación GPS.";
        mostrarMensaje(m, "error");
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
    );
  }

  function alternarEnsayo(activo) {
    S.ensayo = activo && S.config.modo_ensayo_habilitado;
    $("ensayo-controles").classList.toggle("hidden", !S.ensayo);
    if (S.ensayo && !S.posSim) {
      const base = S.posReal || S.config.plaza.centro;
      S.posSim = { lat: base.lat, lng: base.lng };
    }
    renderMapa();
  }

  function teletransportar(lat, lng) {
    S.posSim = { lat, lng };
    actualizarMarcadorUsuario();
    if (S.mapa) S.mapa.setView([lat, lng], Math.max(S.mapa.getZoom(), 17));
  }

  /* ---------- lector QR ---------- */
  async function iniciarQR() {
    if (S.escaneando) return;
    if (typeof Html5Qrcode === "undefined") return mostrarMensaje("No se pudo cargar el lector QR. Usá el código manual.", "error");
    $("qr-reader").classList.remove("hidden");
    S.qr = S.qr || new Html5Qrcode("qr-reader");
    try {
      await S.qr.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 220, height: 220 } }, onQR, () => {});
      S.escaneando = true;
      $("btn-qr-iniciar").classList.add("hidden");
      $("btn-qr-detener").classList.remove("hidden");
    } catch (_) {
      $("qr-reader").classList.add("hidden");
      mostrarMensaje("No se pudo acceder a la cámara. Usá el código manual de respaldo.", "error");
    }
  }

  async function detenerQR() {
    if (S.qr && S.escaneando) {
      try { await S.qr.stop(); } catch (_) { /* ya detenido */ }
    }
    S.escaneando = false;
    const box = $("qr-reader");
    if (box) box.classList.add("hidden");
    $("btn-qr-iniciar").classList.remove("hidden");
    $("btn-qr-detener").classList.add("hidden");
  }

  async function onQR(texto) {
    const ahora = Date.now();
    if (ahora - S.ultimoQR < 3000) return;
    S.ultimoQR = ahora;
    await detenerQR();
    await enviarValidacion("qr", String(texto).trim());
  }

  /* ---------- validación contra el servidor ---------- */
  async function enviarValidacion(metodo, valor) {
    const p = posActual();
    if (!p) return mostrarMensaje("Aún no hay posición. Activá el GPS o usá el Modo Ensayo.", "error");

    const r = await api("/api/validar_pista", {
      method: "POST",
      body: JSON.stringify({
        equipo_id: S.equipo.id, clave: S.equipo.clave,
        lat: p.lat, lng: p.lng, metodo, valor, simulado: S.ensayo,
      }),
    });

    if (r.ok) {
      S.estado = r.data.estado;
      $("input-codigo").value = "";
      mostrarMensaje(r.data.mensaje, "ok");
      renderEstado();
      cargarRanking(false);
      return;
    }
    if (r.data.codigo === "FUERA_DE_RADIO") {
      mostrarMensaje(`Estás a ${r.data.distancia_m} m de la pista (se requiere estar a ${r.data.radio_m} m o menos).`, "error");
    } else {
      mostrarMensaje(r.data.error || "No se pudo validar la pista.", "error");
    }
    if (r.status === 401) { localStorage.removeItem(LS_KEY); mostrarRegistro(); }
  }

  /* ---------- arranque ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    const pagina = document.body.dataset.page;
    if (pagina === "admin") initAdmin();
    else initJugador();
  });
})();