"""Capa de acceso a datos (SQLite) para la Búsqueda del tesoro.

Tablas:
  - equipos: datos de registro y constancia del consentimiento (Ley 25.326).
  - avance:  pistas completadas por cada equipo con su marca de tiempo.
"""
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("TESORO_DB", os.path.join(BASE_DIR, "tesoro.db"))


def ahora_iso():
    """Fecha/hora UTC en ISO 8601 (ordenable como texto)."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def conexion():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with conexion() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS equipos (
                id                    INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre_equipo         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
                integrantes           TEXT    NOT NULL,
                email_contacto        TEXT    NOT NULL,
                consentimiento        INTEGER NOT NULL CHECK (consentimiento = 1),
                fecha_consentimiento  TEXT    NOT NULL,
                clave                 TEXT    NOT NULL,
                fecha_registro        TEXT    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS avance (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                equipo_id     INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
                pista_orden   INTEGER NOT NULL,
                completada_en TEXT    NOT NULL,
                metodo        TEXT    NOT NULL CHECK (metodo IN ('qr', 'manual')),
                simulado      INTEGER NOT NULL DEFAULT 0,
                distancia_m   REAL,
                UNIQUE (equipo_id, pista_orden)
            );

            CREATE INDEX IF NOT EXISTS idx_avance_equipo ON avance(equipo_id);
            """
        )


def crear_equipo(nombre, integrantes, email):
    """Inserta un equipo con consentimiento explícito.

    Devuelve (equipo_id, clave_de_sesion). Lanza sqlite3.IntegrityError si el
    nombre ya existe.
    """
    clave = secrets.token_urlsafe(24)
    ahora = ahora_iso()
    with conexion() as conn:
        cur = conn.execute(
            """INSERT INTO equipos
               (nombre_equipo, integrantes, email_contacto, consentimiento,
                fecha_consentimiento, clave, fecha_registro)
               VALUES (?, ?, ?, 1, ?, ?, ?)""",
            (nombre, integrantes, email, ahora, clave, ahora),
        )
        return cur.lastrowid, clave


def obtener_equipo(equipo_id):
    with conexion() as conn:
        return conn.execute(
            "SELECT id, nombre_equipo, clave FROM equipos WHERE id = ?", (equipo_id,)
        ).fetchone()


def listar_avance(equipo_id):
    with conexion() as conn:
        return conn.execute(
            "SELECT pista_orden, completada_en FROM avance "
            "WHERE equipo_id = ? ORDER BY pista_orden",
            (equipo_id,),
        ).fetchall()


def registrar_avance(equipo_id, pista_orden, metodo, simulado, distancia_m):
    """Registra una pista completada. Lanza IntegrityError si ya existía."""
    with conexion() as conn:
        conn.execute(
            """INSERT INTO avance
               (equipo_id, pista_orden, completada_en, metodo, simulado, distancia_m)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (equipo_id, pista_orden, ahora_iso(), metodo, 1 if simulado else 0,
             round(distancia_m, 2)),
        )


def resumen_para_ranking():
    """Datos NO personales para el ranking (nunca integrantes ni email)."""
    with conexion() as conn:
        return conn.execute(
            """SELECT e.nombre_equipo        AS equipo,
                      e.fecha_registro       AS registro,
                      COUNT(a.id)            AS pistas,
                      MAX(a.completada_en)   AS ultima,
                      COALESCE(SUM(a.simulado), 0) AS simuladas
               FROM equipos e
               LEFT JOIN avance a ON a.equipo_id = e.id
               GROUP BY e.id"""
        ).fetchall()


def reset_partida():
    """Borra equipos (datos personales incluidos) y avance."""
    with conexion() as conn:
        conn.execute("DELETE FROM avance")
        conn.execute("DELETE FROM equipos")
        conn.execute("DELETE FROM sqlite_sequence WHERE name IN ('equipos', 'avance')")