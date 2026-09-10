/* Gestor PRO - Bridge compartilhada
   Etapa 6: PC + Android + Web usando a mesma interface.
*/
(function(){
  const P = window.GestorProPlatform || {name:'web',isPC:false,isAndroid:false,isWeb:true};

  function capacitorPlugin(name){
    try{
      const cap=window.Capacitor;
      if(!cap) return null;
      if(cap.Plugins?.[name]) return cap.Plugins[name];
      if(cap.isPluginAvailable?.(name) && cap.registerPlugin){
        return cap.registerPlugin(name);
      }
    }catch(err){
      console.warn(`Gestor PRO: plugin ${name} indisponível`,err);
    }
    return null;
  }

  function browserKey(suffix){
    return `gestor_pro_${P.name}_${suffix}`;
  }

  const bridge = {
    platform:P.name,
    capacitorPlugin,

    async openExternal(url){
      if(P.isPC && window.api?.openExternal){
        return window.api.openExternal(url);
      }
      try{
        // Em Capacitor, location.href funciona melhor para esquemas externos
        // e links HTTPS continuam abrindo normalmente.
        if(P.isAndroid){
          window.location.href=String(url);
        }else{
          window.open(url,'_blank','noopener,noreferrer');
        }
        return {ok:true};
      }catch(err){
        return {ok:false,error:String(err?.message||err)};
      }
    },

    async loadLocalSettings(){
      if(P.isPC && window.api?.loadSettings){
        return (await window.api.loadSettings()) || {};
      }
      try{
        return JSON.parse(localStorage.getItem(browserKey('settings'))||'{}');
      }catch(_){
        return {};
      }
    },

    async saveLocalSettings(data){
      if(P.isPC && window.api?.saveSettings){
        return window.api.saveSettings(data||{});
      }
      localStorage.setItem(browserKey('settings'),JSON.stringify(data||{}));
      return true;
    },

    async getInstallationId(){
      if(P.isAndroid){
        const Device=capacitorPlugin('Device');
        if(Device?.getId){
          const result=await Device.getId();
          const id=String(result?.identifier||'').trim();
          if(id) return `android:${id}`;
        }
      }
      return null;
    },

    async shareTextFile(content,filename,mime='text/plain'){
      if(!P.isAndroid) return {ok:false,unsupported:true};

      const Filesystem=capacitorPlugin('Filesystem');
      const Share=capacitorPlugin('Share');
      if(!Filesystem || !Share){
        return {ok:false,error:'Plugins Filesystem/Share não disponíveis.'};
      }

      try{
        const result=await Filesystem.writeFile({
          path:String(filename),
          data:String(content),
          directory:'CACHE',
          encoding:'utf8',
          recursive:true
        });
        const uri=result?.uri;
        if(!uri) throw new Error('O Android não retornou o arquivo criado.');

        await Share.share({
          title:'Gestor PRO',
          text:'Arquivo exportado pelo Gestor PRO',
          url:uri,
          dialogTitle:'Salvar ou compartilhar arquivo'
        });
        return {ok:true,uri};
      }catch(err){
        return {ok:false,error:String(err?.message||err)};
      }
    },

    async installAndroidUpdate(url,sha256=''){
      if(!P.isAndroid) return {ok:false,unsupported:true};
      const Updater=capacitorPlugin('GestorUpdater');
      if(!Updater?.downloadAndInstall){
        return {ok:false,error:'Atualizador nativo do Android não está disponível.'};
      }
      try{
        const result=await Updater.downloadAndInstall({
          url:String(url||''),
          sha256:String(sha256||'')
        });
        return {ok:true,...(result||{})};
      }catch(err){
        return {ok:false,error:String(err?.message||err)};
      }
    },

    whatsappAutomationAvailable(){
      return P.isPC;
    },

    connectWhatsapp(){
      if(P.isPC && window.api?.startWhatsapp){
        window.api.startWhatsapp();
        return {ok:true};
      }
      return {
        ok:false,
        unsupported:true,
        message:'A automação automática do WhatsApp está disponível na versão PC.'
      };
    },

    logoutWhatsapp(){
      if(P.isPC && window.api?.logoutWhatsapp){
        window.api.logoutWhatsapp();
        return {ok:true};
      }
      return {ok:false,unsupported:true};
    }
  };

  window.GestorProBridge=bridge;

  // Compatibilidade com o código compartilhado atual.
  // No Android/Web criamos apenas os métodos locais que o app espera,
  // sem fingir que existe a automação do Electron.
  if(!window.api && (P.isAndroid || P.isWeb)){
    const noop=()=>{};
    window.api={
      async loadClients(){ return []; },
      async saveClients(){ return true; },
      async loadSettings(){ return bridge.loadLocalSettings(); },
      async saveSettings(data){ return bridge.saveLocalSettings(data); },
      startWhatsapp(){
        if(typeof window.appAlert==='function'){
          window.appAlert(
            'A automação automática do WhatsApp está disponível na versão PC do Gestor PRO.',
            P.isAndroid?'Versão Android':'Versão Web'
          );
        }
      },
      logoutWhatsapp:noop,
      onQr:noop,
      onStatus:noop,
      onLog:noop,
      onClientsUpdated:noop,
      onRecoveryLink:noop,
      onUpdateStatus:noop,
      async getAppVersion(){ return null; }
    };
  }
})();
