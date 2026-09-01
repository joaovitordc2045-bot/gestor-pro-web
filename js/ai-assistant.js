(function(){
  const $=id=>document.getElementById(id);
  const chat=$('gpAiChat'),form=$('gpAiForm'),input=$('gpAiInput'),send=$('gpAiSend'),counter=$('gpAiCounter'),status=$('gpAiStatus');
  if(!chat||!form||!input)return;
  const history=[];
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function msg(role,text){
    const row=document.createElement('div'); row.className='gp-ai-msg '+role;
    row.innerHTML=`<div class="gp-ai-avatar">${role==='assistant'?'✦':'EU'}</div><div class="gp-ai-bubble"><strong>${role==='assistant'?'Assistente IA':'Você'}</strong><p>${esc(text)}</p></div>`;
    chat.appendChild(row); chat.scrollTop=chat.scrollHeight; return row;
  }
  function setBusy(v){send.disabled=v;input.disabled=v;send.textContent=v?'Pensando...':'Enviar ✦'}
  function setStatus(ok,text){if(!status)return;status.classList.toggle('error',!ok);status.innerHTML=`<span></span> ${esc(text)}`}
  function buildPrompt(latest){
    const recent=history.slice(-4).map(m=>`${m.role==='user'?'Usuário':'Assistente'}: ${m.text}`).join('\n');
    return recent?`Contexto recente da conversa:\n${recent}\n\nNova pergunta do usuário:\n${latest}`:latest;
  }
  let aiSupabaseClient=null;

  async function getSupabaseClient(){
    if(window.gpSupabaseClient) return window.gpSupabaseClient;
    if(aiSupabaseClient) return aiSupabaseClient;

    // Em alguns carregamentos o módulo da IA fica pronto antes do app-core
    // expor o cliente global. Nesse caso, reutilizamos a biblioteca Supabase
    // já carregada na página e criamos um cliente com a MESMA URL/chave pública.
    // Como a sessão é persistida no mesmo localStorage, o usuário continua logado.
    if(window.supabase?.createClient){
      aiSupabaseClient=window.supabase.createClient(
        'https://lauedzvwxhncdcabwarl.supabase.co',
        'sb_publishable_0Mha1TIugXDxzdD4_zx-lw_3g0TPoXI',
        {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}
      );
      return aiSupabaseClient;
    }

    // Última tentativa curta: aguarda o app-core terminar de inicializar.
    for(let i=0;i<20;i++){
      await new Promise(r=>setTimeout(r,150));
      if(window.gpSupabaseClient) return window.gpSupabaseClient;
    }

    throw new Error('Não foi possível iniciar a conexão segura com o Supabase.');
  }

  async function ask(text){
    const client=await getSupabaseClient();
    const {data:{session},error:sessionError}=await client.auth.getSession();
    if(sessionError) throw new Error(sessionError.message || 'Falha ao ler sua sessão.');
    if(!session?.access_token) throw new Error('Sua sessão expirou. Entre novamente.');

    let lastError=null;

    for(let attempt=1; attempt<=2; attempt++){
      const {data,error}=await client.functions.invoke('gestor-pro-ai',{
        body:{prompt:buildPrompt(text)}
      });

      if(!error && data?.ok){
        return String(data.resposta || '').trim();
      }

      let message=data?.error || error?.message || 'Não foi possível consultar a IA.';
      let retryable=false;

      try{
        if(error?.context){
          const body=await error.context.json();
          message=body?.error || message;
          const status=error.context.status;
          retryable=status===429 || status===502 || status===503 || status===504;
        }
      }catch(_){}

      if(/429|limite|temporar|timeout|demorou|503|504|502/i.test(message)){
        retryable=true;
      }

      lastError=new Error(message);

      if(!retryable || attempt===2) break;

      // Pequena espera antes de uma segunda tentativa automática.
      await new Promise(r=>setTimeout(r,700));
    }

    throw lastError || new Error('Não foi possível consultar a IA.');
  }
  form.addEventListener('submit',async e=>{
    e.preventDefault(); const text=input.value.trim(); if(!text||send.disabled)return;
    msg('user',text); input.value=''; counter.textContent='0/4000'; setBusy(true); setStatus(true,'Conectando à IA...');
    const wait=msg('assistant','Pensando...');
    try{
      const answer=await ask(text); wait.remove(); msg('assistant',answer); setStatus(true,'Gemini conectado');
      history.push({role:'user',text},{role:'assistant',text:answer});
    }catch(err){wait.remove();msg('assistant','Não consegui responder agora: '+(err?.message||'erro desconhecido'));setStatus(false,'Falha temporária — tente novamente')}
    finally{setBusy(false);input.focus()}
  });
  input.addEventListener('input',()=>counter.textContent=`${input.value.length}/4000`);
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit()}});
  $('gpAiClear')?.addEventListener('click',()=>{history.length=0;chat.innerHTML='';msg('assistant','Conversa limpa. Como posso ajudar?')});
  document.querySelectorAll('[data-ai-prompt]').forEach(b=>b.addEventListener('click',()=>{input.value=b.dataset.aiPrompt||'';counter.textContent=`${input.value.length}/4000`;input.focus()}));
})();