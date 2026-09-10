/* Gestor PRO - Adaptador de Plataforma
   Etapa 3
*/
(function(){
  function detectPlatform(){
    try{
      if(window.gestorProPlatform) return window.gestorProPlatform;

      // Electron/preload
      if(window.api && (
        typeof window.api.startWhatsapp === 'function' ||
        typeof window.api.getVersion === 'function' ||
        typeof window.api.openExternal === 'function'
      )){
        return 'pc';
      }

      // Capacitor
      if(window.Capacitor || document.documentElement.classList.contains('android-app')){
        return 'android';
      }

      return 'web';
    }catch(_){
      return 'web';
    }
  }

  const platform = detectPlatform();
  window.GestorProPlatform = {
    name: platform,
    isPC: platform === 'pc',
    isAndroid: platform === 'android',
    isWeb: platform === 'web',
    hasNativeWhatsappAutomation: platform === 'pc',
    hasElectronUpdater: platform === 'pc',
    hasCapacitor: platform === 'android',
    hasNativeShare: platform === 'android',
    hasNativeAndroidUpdater: platform === 'android',
    canOpenExternal: true
  };

  document.documentElement.dataset.gestorProPlatform = platform;
  document.documentElement.classList.add('gp-platform-' + platform);

  window.gpPlatform = platform;
})();
