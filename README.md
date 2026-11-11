# StopLoss Wrist

Sistema de monitoreo de volatilidad crítica y alertas de mercado financiero con terminal móvil y sincronización en tiempo real para smartwatch Wear OS.

---

## Arquitectura del Proyecto

El sistema se compone de tres módulos integrados:

- **backend/**: Servicio en Node.js y TypeScript. Gestiona la conexión en vivo con Binance (WebSocket y REST), evaluación continua de volatilidad mediante indicadores estadísticos (Z-Score, ATR, Trailing Stop), motor de reglas antifatiga y ruteo de órdenes.
- **phone-app/**: Aplicación móvil en React Native con catálogo de más de 20 criptoactivos, módulo nativo en Kotlin para Google Play Services Wearable Data Layer, gestión de umbrales y terminal de portafolio.
- **wear-app/**: Aplicación nativa para Wear OS en Kotlin. Diseñada para pantallas circulares con vistas dedicadas de monitor de cotización, alertas críticas con botones de acción rápida (Comprar, Vender, Posponer, Descartar) y selector de límite stop-loss.

---

## Funcionalidades Principales

### 1. Conexión de Mercado en Tiempo Real
- Conexión directa a streams públicos de Binance sin requerir API keys privadas.
- Precarga automática de velas históricas al seleccionar un activo para activar el análisis técnico desde el primer segundo.
- Evaluación de ticks continuos (frecuencia de 1 segundo) para detectar rupturas de umbral de inmediato.

### 2. Catálogo Amplio de Criptoactivos y Gráficas Interactivas
- Monitoreo de 20 activos principales: BTC, ETH, SOL, BNB, XRP, DOGE, ADA, AVAX, LINK, SUI, NEAR, DOT, POL, LTC, UNI, PEPE, SHIB, APT, ARB y OP.
- **Gráfica interactiva en el activo seleccionado**: historial real de Binance con selector de horizonte (`1 día`, `1 semana`, `1 mes`, `1 año`), línea punteada del nivel de stop-loss configurado, rango mínimo/máximo, volumen 24h y cursor táctil para inspeccionar precios históricos.
- **Mini-gráficas (sparklines) en el catálogo**: cada moneda de la lista incluye su curva de tendencia de las últimas 24 horas junto con precio actual y variación porcentual.
- Buscador predictivo por nombre o símbolo y filtrado por categorías (Layer 1, Layer 2, DeFi, Pagos, Memecoins).
- Modo Observador ("Solo observando") y ejecución inmediata de órdenes preventivas.

### 3. Control Bidireccional de Stop-Loss (Teléfono y Reloj)
- Parámetro de tolerancia configurable con resolución de 0.5% (ej. 1.0%, 1.5%, 2.0%, 3.0%, 5.0%).
- La modificación del porcentaje desde el reloj se transmite de forma instantánea al teléfono y al servidor mediante Wearable Data Layer y HTTP.

### 4. Interfaz de Reloj Optimizada para Pantallas Circulares
- Arquitectura dividida en tres secciones limpias:
  1. **Monitor**: Cotización en tiempo real, símbolo y estado de servicio.
  2. **Alertas**: Notificación de caída con botones para comprar en soporte, vender por stop-loss, posponer o descartar.
  3. **Configuración**: Stepper interactivo para ajustar el porcentaje de tolerancia con márgenes seguros contra el bisel.

### 5. Modo de Producción y Menú de Desarrollador
- La interfaz principal mantiene una estética sobria e institucional sin referencias a pruebas o simulaciones visibles.
- Las herramientas de prueba (escenarios simulados y aviso de prueba) están ocultas: se abren manteniendo presionado el logo "StopLoss Wrist" durante un segundo.
- Los porcentajes sugeridos se adaptan a la volatilidad de cada moneda (BTC/ETH: 1.5-5%, altcoins: 3-8%, memecoins: 6-15%).

---

## Instrucciones de Ejecución

### 1. Iniciar el Servidor Backend
```powershell
cd backend
npm install
npm test
npm run dev
```
El servicio quedará disponible en `http://localhost:8080` (WebSocket en `ws://localhost:8080/ws`).

### 2. Iniciar la Terminal Móvil (React Native)
En una terminal:
```powershell
cd phone-app
npm install
npx react-native start
```

En Android Studio:
1. Abrir la carpeta `phone-app/android`.
2. Seleccionar el emulador de teléfono (Pixel con Google Play) o dispositivo físico.
3. Ejecutar ▶ Run 'app'.

### 3. Iniciar la App del Smartwatch (Wear OS)
En una ventana independiente de Android Studio:
1. Abrir la carpeta `wear-app`.
2. Seleccionar el emulador Wear OS (ej. Wear OS Small Round) o smartwatch físico.
3. Ejecutar ▶ Run 'app'.
4. Conceder el permiso de notificaciones al iniciar.

---

## Protocolo de Comunicación

- **Ruta de Alertas**: `/stoploss/alert` (Servidor -> Teléfono -> Reloj)
- **Ruta de Acciones**: `/stoploss/action` (Reloj -> Teléfono -> Servidor)
- **Ruta de Configuración**: `/stoploss/config` y `/stoploss/set_threshold` (Sincronización de umbral)
