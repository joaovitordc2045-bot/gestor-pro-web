// Gestor PRO - ponte Web -> servidor WhatsApp
(function(){
  const base=()=>String(window.GESTOR_PRO_WHATSAPP_SERVER_URL||'http://localhost:8787').replace(/\/+$/,'');
  const listeners={qr:[],status:[],log:[],clients:[]};
  let pollTimer=null;

  async function token(){
    const sb=window.gpSupabaseClient;
    if(!sb) return '';
    const {data}=await sb.auth.getSession();
    return data?.session?.access_token||'';
  }
  async function req(path, options={}){
    const t=await token();
    if(!t) throw new Error('Sessão do Gestor PRO não encontrada.');
    const headers={...(options.headers||{}),Authorization:`Bearer ${t}`};
    if(options.body && !headers['Content-Type']) headers['Content-Type']='application/json';
    const r=await fetch(base()+path,{...options,headers});
    const data=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data.error||`Erro HTTP ${r.status}`);
    return data;
  }
  function emit(type,value){ (listeners[type]||[]).forEach(fn=>{try{fn(value)}catch(_){}}); }
  async function poll(){
    try{
      const s=await req('/api/status');
      emit('status',s.status||'disconnected');
      if(s.qrDataUrl) emit('qr',s.qrDataUrl);
      (s.logs||[]).reverse().forEach(x=>emit('log',x));
    }catch(e){
      emit('status','error');
    }
  }
  function ensurePoll(){
    if(pollTimer) return;
    poll();
    pollTimer=setInterval(poll,4000);
  }

  window.api={
    async loadClients(){ return []; },
    async saveClients(clients){
      return req('/api/sync/clients',{method:'POST',body:JSON.stringify({clients:clients||[]})});
    },
    async loadSettings(){
      try{
        const remote=await req('/api/settings');
        return remote.settings||{};
      }catch(_){
        try{return JSON.parse(localStorage.getItem('gestor_pro_web_auto_settings')||'{}')}catch(e){return{}}
      }
    },
    async saveSettings(settings){
      localStorage.setItem('gestor_pro_web_auto_settings',JSON.stringify(settings||{}));
      return req('/api/settings',{method:'POST',body:JSON.stringify({settings:settings||{}})});
    },
    async startWhatsapp(){
      ensurePoll();
      emit('status','connecting');
      try{ await req('/api/connect',{method:'POST'}); await poll(); }
      catch(e){ emit('log',{time:new Date().toISOString(),msg:e.message}); emit('status','error'); }
    },
    async logoutWhatsapp(){
      try{ await req('/api/disconnect',{method:'POST'}); }finally{ emit('status','disconnected'); }
    },
    onQr(fn){ listeners.qr.push(fn); ensurePoll(); },
    onStatus(fn){ listeners.status.push(fn); ensurePoll(); },
    onLog(fn){ listeners.log.push(fn); ensurePoll(); },
    onClientsUpdated(fn){ listeners.clients.push(fn); }
  };
})();
