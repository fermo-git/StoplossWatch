// 10.0.2.2 es el "localhost" de tu PC visto desde el emulador de Android.
// En un teléfono físico usa la IP de tu PC en la red local, p. ej. http://192.168.1.50:8080
export const BASE_URL = "http://10.0.2.2:8080";
export const WS_URL = BASE_URL.replace(/^http/, "ws") + "/ws";
