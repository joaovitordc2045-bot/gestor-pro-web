// Gestor PRO Web bootstrap
window.gestorProPlatform='web';

// Servidor da automação WhatsApp.
// Em produção, troque por HTTPS do servidor permanente do Gestor PRO.
window.GESTOR_PRO_WHATSAPP_SERVER_URL =
  localStorage.getItem('gestor_pro_whatsapp_server_url') ||
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:8787'
    : 'http://localhost:8787');
