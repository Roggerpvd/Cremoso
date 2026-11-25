// Configuración en tiempo de ejecución (sin recompilar).
// Déjalo vacío para usar las variables VITE_* del archivo .env en desarrollo,
// o completa estos dos valores al desplegar (Netlify/Cloudflare) o en la red local.
// La clave "anon"/"publishable" de Supabase es PÚBLICA por diseño (la seguridad la da RLS).
// NUNCA pongas aquí la clave "service_role".
window.__APP_CONFIG__ = {
  SUPABASE_URL: "https://otjzxrngtotzsrqonntp.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_14wUDUV4bKG2sD1xXuEZKg_lOvoWSlB",
  STAFF_EMAIL_DOMAIN: ""
};
