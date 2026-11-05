# Búsqueda del tesoro geolocalizada con QR

**Trabajo Práctico – Universidad del Salvador (USAL)**

Aplicación web de juego de pistas en espacios públicos. Los equipos se registran, resuelven acertijos, se desplazan hasta cada punto de interés y validan su llegada con un código QR (o un código manual de respaldo). La posición se verifica **en el servidor** mediante la fórmula de Haversine.

## 👤 Integrantes

| Apellido y nombre | Legajo / DNI |
| **Vargas Francisco** | 95284297 |

- **Materia / cátedra:** Paradigmas de Programación
- **Docente:** Antonio Martínez
- **Facultad:** Universidad del Salvador (USAL)

---

## 📋 Cumplimiento de la consigna

| Requisito | Implementación |
| **Backend Python 3 + Flask + SQLite** | `app.py` (rutas y lógica) y `database.py` (persistencia y tablas). |
| **Portabilidad total** | La **Plaza Rodríguez Peña** y sus 10 pistas viven exclusivamente en `config.json`; el código fuente no contiene coordenadas ni textos del juego. |
| **Ley 25.326 (Protección de Datos)** | Casilla de consentimiento explícita (desmarcada por defecto). Los datos personales residen solo en SQLite (`tesoro.db`), aislados del ranking y del `config.json` público. |
| **QR + código manual** | Lectura con `html5-qrcode` en el navegador + código de respaldo de 4 dígitos para zonas con baja precisión GPS. |
| **Modo Ensayo / Simulador GPS** | Selector de pista y teletransporte en mapa para realizar pruebas |
| **Panel `/admin`** | Ranking en vivo calculado en el servidor y botón de reseteo completo de partida protegido por clave. |

---

## 🛠️ Instalación y ejecución

**Requisitos:** Python 3.9 o superior.

```bash
# 1. Clonar el repositorio
git clone https://github.com/Francisco-code81/busqueda-tesoro-usal.git
cd tesoro-qr

# 2. Crear y activar el entorno virtual
# En Windows:
py -m venv venv
.\venv\Scripts\activate

# 3. Instalar dependencias
pip install -r requirements.txt

# 4. Inicializar BD y ejecutar aplicación
py database.py
py app.py
```

---

## ⚙️ Variables de entorno opcionales

| Variable      | Descripción                                 | Valor por defecto          |
| ------------- | ------------------------------------------- | -------------------------- |
| `ADMIN_KEY`   | Clave para reiniciar la partida en `/admin` | `admin123` (**cambiarla**) |
| `PORT`        | Puerto de escucha del servidor              | `5000`                     |
| `TESORO_DB`   | Ruta del archivo SQLite                     | `./tesoro.db`              |
| `FLASK_DEBUG` | `1` para modo depuración                    | desactivado                |

---

## 📍 Cómo cambiar de plaza (portabilidad)

1. Editar **únicamente** `config.json`: sección `plaza` (nombre, centro y zoom) y la lista `pistas` (coordenadas, acertijo, `token_qr`, `codigo_manual`).
2. Guardar. El servidor detecta el cambio de archivo y lo recarga dinámicamente.

---

## 📷 Códigos QR

Cada QR contiene como texto plano el `token_qr` de su pista (por ejemplo `QR_RODRIGUEZ_PENA_01`).

Para generar las imágenes PNG de forma automática para imprimir, ejecutar:

```bash
py generar_qrs.py
```

Los archivos se guardarán en la carpeta `/qrs_imprimir`.

---

## 📁 Estructura del proyecto

```text
tesoro-qr/
├── app.py              # Rutas Flask, fórmula Haversine y validación de reglas
├── database.py         # SQLite: tablas de equipos y avance de la partida
├── config.json         # Plaza Rodríguez Peña + pistas (única fuente de datos)
├── generar_qrs.py      # Script utilitario para generar los QR comprimidos
├── requirements.txt    # Dependencias del proyecto (Flask, Flask-CORS, gunicorn)
├── templates/
│   ├── index.html      # Interfaz de jugador y lector QR con html5-qrcode
│   └── admin.html      # Panel del organizador y ranking en tiempo real
└── static/
    ├── css/
    │   └── style.css   # Estilos CSS de la interfaz
    └── js/
        └── main.js     # Consumo de API REST, Leaflet.js y eventos DOM
```

---

## 📡 API REST

| Método | Ruta                 | Descripción                                                   |
| ------ | -------------------- | ------------------------------------------------------------- |
| `GET`  | `/api/config`        | Configuración pública del juego (sin los tokens QR)           |
| `POST` | `/api/registrar`     | Registro de equipo con consentimiento explícito de Ley 25.326 |
| `GET`  | `/api/estado`        | Progreso y acertijo actual del equipo registrado              |
| `POST` | `/api/validar_pista` | Valida distancia con Haversine y token QR o código manual     |
| `GET`  | `/api/ranking`       | Ranking en tiempo real sin exposición de datos personales     |
| `POST` | `/api/admin/reset`   | Reinicia la partida borrando tablas (requiere clave admin)    |

---

## 🏗️ Decisiones de arquitectura

1. **Validación en el servidor:** El cliente solo informa su posición GPS; la distancia se calcula en Python con la fórmula Haversine y el servidor aprueba la llegada.
2. **Secuencialidad y acertijos bajo demanda:** El servidor deduce la pista activa según el avance. El acertijo se entrega secuencialmente y `token_qr` nunca se expone en la API pública.
3. **Configuración única:** `config.json` centraliza el 100% de los datos del recorrido.
4. **Código manual de respaldo:** Se ofrece ante imprecisiones del GPS o fallos de cámara.
5. **Modo Ensayo:** Permite simular ubicaciones en el mapa para pruebas de laboratorio.
6. **Protección de Datos (Ley 25.326):** Los datos personales (nombres, mails) se guardan aislados en SQLite `tesoro.db` (excluida del Git con `.gitignore`) y jamás se muestran en el ranking público.
