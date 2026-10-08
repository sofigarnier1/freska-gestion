// Solo se pueden abrir afuera de la app los links de WhatsApp y de Google Maps.
const HOSTS_WHATSAPP = new Set(['wa.me', 'api.whatsapp.com']);
const HOSTS_GOOGLE = new Set(['www.google.com', 'google.com']);

function enlacePermitido(texto) {
  let url;
  try {
    url = new URL(String(texto));
  } catch (err) {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (HOSTS_WHATSAPP.has(url.hostname)) return true;
  return HOSTS_GOOGLE.has(url.hostname) && (url.pathname === '/maps' || url.pathname.startsWith('/maps/'));
}

module.exports = { enlacePermitido };
