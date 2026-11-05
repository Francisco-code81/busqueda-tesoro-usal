"""Backend Flask - Búsqueda del tesoro geolocalizada con QR."""
import hmac
import json
import math
import os
import re
import sqlite3
import time
from datetime import datetime

from flask import Flask, jsonify, render_template, request
from flask_cors import CORS

import database

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
ADMIN_KEY = os.environ.get("ADMIN_KEY", "admin123")

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# ---------------------------------------------------------------------------
# Configuración (única fuente de verdad: config.json)
# ---------------------------------------------------------------------------
_cache = {"mtime": None, "data": None}


def validar_config(cfg):
    for clave in ("plaza", "juego", "datos_personales", "pistas"):
        if clave not in cfg:
            raise ValueError(f"config.json: falta la sección '{clave}'")
    campos = ("orden", "nombre", "lat", "lng", "acertijo", "token_qr", "codigo_manual")
    ordenes = []
    for p in cfg["pistas"]:
        for campo in campos:
            if campo not in p:
                raise ValueError(f"config.json: una pista no tiene el campo '{campo}'")
        ordenes.append(p["orden"])
    if sorted(ordenes) != list(range(1, len(ordenes) + 1)):
        raise ValueError("config.json: las pistas deben numerarse 1..N sin repetir")


def cargar_config():
    """Lee config.json y lo recarga solo si el archivo cambió."""
    mtime = os.path.getmtime(CONFIG_PATH)
    if _cache["mtime"] != mtime:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = json.load(f)
        validar_config(cfg)
        _cache.update(mtime=mtime, data=cfg)
    return _cache["data"]


def pistas_ordenadas(cfg):
    return sorted(cfg["pistas"], key=lambda p: p["orden"])


def radio_de(pista, cfg):
    return float(pista.get("radio_m", cfg["juego"]["radio_geocerca_m"]))


def config_publica(cfg):
    """Versión pública: NUNCA incluye token_qr; el código manual y las
    coordenadas solo se publican si el Modo Ensayo está habilitado."""
    ensayo = bool(cfg["juego"].get("modo_ensayo_habilitado", False))
    pistas = []
    for p in pistas_ordenadas(cfg):
        item = {"orden": p["orden"]}
        if ensayo:
            item.update(
                nombre=p["nombre"], lat=p["lat"], lng=p["lng"],
                radio_m=radio_de(p, cfg), codigo_manual=p["codigo_manual"],
            )
        pistas.append(item)
    return {
        "titulo": cfg["juego"].get("titulo", ""),
        "plaza": cfg["plaza"],
        "radio_geocerca_m": cfg["juego"]["radio_geocerca_m"],
        "modo_ensayo_habilitado": ensayo,
        "datos_personales": cfg["datos_personales"],
        "total_pistas": len(pistas),
        "pistas": pistas,
    }


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
def haversine_m(lat1, lon1, lat2, lon2):
    """Distancia en metros entre dos coordenadas (fórmula de Haversine)."""
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def error(mensaje, status, **extra):
    return jsonify({"ok": False, "error": mensaje, **extra}), status


def autenticar(equipo_id, clave):
    try:
        equipo = database.obtener_equipo(int(equipo_id))
    except (TypeError, ValueError):
        return None
    if not equipo or not hmac.compare_digest(equipo["clave"], str(clave or "")):
        return None
    return equipo


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Freno básico contra adivinar códigos: 5 fallos por minuto y por equipo.
_fallos = {}
MAX_FALLOS, VENTANA_S = 5, 60


def demasiados_fallos(equipo_id):
    ahora = time.time()
    recientes = [t for t in _fallos.get(equipo_id, []) if ahora - t < VENTANA_S]
    _fallos[equipo_id] = recientes
    return len(recientes) >= MAX_FALLOS


def registrar_fallo(equipo_id):
    _fallos.setdefault(equipo_id, []).append(time.time())


def construir_estado(cfg, equipo_id):
    pistas = pistas_ordenadas(cfg)
    hechas = database.listar_avance(equipo_id)
    n = len(hechas)
    historial = []
    for a in hechas:
        p = pistas[a["pista_orden"] - 1]
        historial.append({
            "orden": p["orden"], "nombre": p["nombre"],
            "lat": p["lat"], "lng": p["lng"],
            "completada_en": a["completada_en"],
        })
    finalizado = n >= len(pistas)
    actual = None if finalizado else {"orden": n + 1, "acertijo": pistas[n]["acertijo"]}
    return {
        "ok": True, "completadas": n, "total": len(pistas),
        "finalizado": finalizado, "pista_actual": actual, "historial": historial,
    }


# ---------------------------------------------------------------------------
# Vistas
# ---------------------------------------------------------------------------
@app.get("/")
def index():
    return render_template("index.html")


@app.get("/admin")
def admin():
    return render_template("admin.html")


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
@app.get("/api/config")
def api_config():
    return jsonify(config_publica(cargar_config()))


@app.post("/api/registrar")
def api_registrar():
    datos = request.get_json(silent=True) or {}
    nombre = str(datos.get("nombre_equipo", "")).strip()
    integrantes = str(datos.get("integrantes", "")).strip()
    email = str(datos.get("email", "")).strip()

    if datos.get("consentimiento") is not True:
        return error("Debés aceptar expresamente el consentimiento para participar.", 400)
    if not 3 <= len(nombre) <= 40:
        return error("El nombre del equipo debe tener entre 3 y 40 caracteres.", 400)
    if not 3 <= len(integrantes) <= 300:
        return error("Indicá los integrantes del equipo (hasta 300 caracteres).", 400)
    if len(email) > 120 or not EMAIL_RE.match(email):
        return error("Ingresá un email de contacto válido.", 400)

    try:
        equipo_id, clave = database.crear_equipo(nombre, integrantes, email)
    except sqlite3.IntegrityError:
        return error("Ya existe un equipo con ese nombre. Elegí otro.", 409)

    return jsonify({"ok": True, "equipo_id": equipo_id, "clave": clave,
                    "nombre_equipo": nombre}), 201


@app.get("/api/estado")
def api_estado():
    equipo = autenticar(request.args.get("equipo_id"), request.args.get("clave"))
    if not equipo:
        return error("Equipo no encontrado o sesión inválida.", 401)
    return jsonify(construir_estado(cargar_config(), equipo["id"]))


@app.post("/api/validar_pista")
def api_validar_pista():
    cfg = cargar_config()
    datos = request.get_json(silent=True) or {}

    equipo = autenticar(datos.get("equipo_id"), datos.get("clave"))
    if not equipo:
        return error("Equipo no encontrado o sesión inválida.", 401)

    metodo = datos.get("metodo")
    valor = str(datos.get("valor", "")).strip()
    simulado = datos.get("simulado") is True
    if metodo not in ("qr", "manual") or not valor:
        return error("Falta el código QR o el código manual.", 400)

    try:
        lat, lng = float(datos.get("lat")), float(datos.get("lng"))
    except (TypeError, ValueError):
        return error("Posición inválida.", 400)
    if not (math.isfinite(lat) and math.isfinite(lng)
            and -90 <= lat <= 90 and -180 <= lng <= 180):
        return error("Posición fuera de rango.", 400)

    if simulado and not cfg["juego"].get("modo_ensayo_habilitado", False):
        return error("El Modo Ensayo está deshabilitado.", 403)

    pistas = pistas_ordenadas(cfg)
    estado = construir_estado(cfg, equipo["id"])
    if estado["finalizado"]:
        return error("Tu equipo ya completó todas las pistas.", 409)
    pista = pistas[estado["completadas"]]

    if demasiados_fallos(equipo["id"]):
        return error("Demasiados intentos fallidos. Esperá un minuto.", 429)

    # 1) Geocerca con Haversine en el servidor (antes de mirar el código).
    distancia = haversine_m(lat, lng, pista["lat"], pista["lng"])
    radio = radio_de(pista, cfg)
    if metodo == "manual":  # respaldo por imprecisión de GPS: radio ampliado
        radio = max(radio, float(cfg["juego"].get("tolerancia_manual_m", radio)))
    if distancia > radio:
        return error("Todavía estás lejos de la pista.", 403,
                     codigo="FUERA_DE_RADIO",
                     distancia_m=round(distancia), radio_m=round(radio))

    # 2) Verificación del código (comparación en tiempo constante).
    esperado = pista["token_qr"] if metodo == "qr" else pista["codigo_manual"]
    if not hmac.compare_digest(valor.encode("utf-8"), str(esperado).encode("utf-8")):
        registrar_fallo(equipo["id"])
        return error("Código incorrecto para esta pista.", 400, codigo="CODIGO_INVALIDO")

    # 3) Registro del avance.
    try:
        database.registrar_avance(equipo["id"], pista["orden"], metodo, simulado, distancia)
    except sqlite3.IntegrityError:
        return error("Esta pista ya estaba registrada.", 409)

    nuevo = construir_estado(cfg, equipo["id"])
    return jsonify({
        "ok": True,
        "mensaje": f"¡Pista {pista['orden']} superada: {pista['nombre']}!",
        "distancia_m": round(distancia, 1),
        "estado": nuevo,
    })


@app.get("/api/ranking")
def api_ranking():
    cfg = cargar_config()
    total = len(cfg["pistas"])
    filas = sorted(
        database.resumen_para_ranking(),
        key=lambda f: (-f["pistas"], f["ultima"] or "9999"),
    )
    ranking = []
    for i, f in enumerate(filas, start=1):
        tiempo = None
        if f["pistas"] > 0 and f["ultima"]:
            t0 = datetime.fromisoformat(f["registro"])
            t1 = datetime.fromisoformat(f["ultima"])
            tiempo = max(0, int((t1 - t0).total_seconds()))
        ranking.append({
            "posicion": i, "equipo": f["equipo"], "pistas": f["pistas"],
            "total": total, "tiempo_segundos": tiempo,
            "finalizado": f["pistas"] >= total, "usa_ensayo": f["simuladas"] > 0,
        })
    return jsonify({"ok": True, "total_pistas": total, "ranking": ranking})


@app.post("/api/admin/reset")
def api_admin_reset():
    clave = request.headers.get("X-Admin-Key", "")
    if not hmac.compare_digest(clave.encode("utf-8"), ADMIN_KEY.encode("utf-8")):
        return error("Clave de organizador incorrecta.", 403)
    database.reset_partida()
    _fallos.clear()
    return jsonify({"ok": True, "mensaje": "Partida reiniciada. Se eliminaron equipos y avance."})


# ---------------------------------------------------------------------------
database.init_db()
cargar_config()  # falla rápido si config.json es inválido

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)),
            debug=os.environ.get("FLASK_DEBUG") == "1")