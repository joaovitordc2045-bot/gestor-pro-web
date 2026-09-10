/* Gestor PRO · Programa de Parceiros · Supabase Etapa 2 */
(function(){
  const nav=document.getElementById('partnersNavBtn');
  const sec=document.getElementById('partnersSection');
  const activate=document.getElementById('partnerActivateBtn');
  const copy=document.getElementById('partnerCopyBtn');
  const withdraw=document.getElementById('partnerWithdrawBtn');
  const withdrawModal=document.getElementById('partnerWithdrawModal');
  const withdrawCancel=document.getElementById('partnerWithdrawCancel');
  const withdrawConfirm=document.getElementById('partnerWithdrawConfirm');
  const pixInput=document.getElementById('partnerPixKey');
  let partnerDashboard=null;

  function openPartnerSuccessModal(code){
    const modal=document.getElementById('partnerSuccessModal');
    const codeEl=document.getElementById('partnerSuccessCode');
    if(codeEl) codeEl.textContent=code||'—';
    if(modal){
      modal.style.display='flex';
      modal.setAttribute('aria-hidden','false');
    }
  }
  function closePartnerSuccessModal(){
    const modal=document.getElementById('partnerSuccessModal');
    if(modal){
      modal.style.display='none';
      modal.setAttribute('aria-hidden','true');
    }
  }

  function pMoney(v){
    return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  }

  function setPartnerLoading(loading){
    if(activate) activate.disabled=loading;
    if(copy) copy.disabled=loading;
    if(withdraw && loading) withdraw.disabled=true;
  }

  function renderPartnerDashboard(data){
    partnerDashboard=data||null;
    const active=!!data?.active;
    const rate=Math.round(Number(data?.commission_rate||.20)*100);

    document.querySelector('.partner-rate strong')?.replaceChildren(document.createTextNode(rate+'%'));
    document.getElementById('partnerReferrals').textContent=String(Number(data?.referrals||0));
    document.getElementById('partnerActive').textContent=String(Number(data?.active_referrals||0));
    document.getElementById('partnerPending').textContent=pMoney(data?.pending);
    document.getElementById('partnerAvailable').textContent=pMoney(data?.available);

    const status=document.getElementById('partnerStatus');
    const code=document.getElementById('partnerCode');
    if(active){
      if(status){
        status.textContent=data?.status==='blocked'?'Bloqueado':'Ativo';
        status.style.color=data?.status==='blocked'?'var(--red)':'var(--green)';
        status.style.background=data?.status==='blocked'?'rgba(255,107,122,.1)':'rgba(66,230,164,.1)';
      }
      if(code) code.value=data?.code||'—';
      if(activate){
        activate.textContent='Perfil de parceiro ativo';
        activate.disabled=true;
      }
      if(withdraw) withdraw.disabled=!(Number(data?.available||0)>0) || data?.status==='blocked';
      if(pixInput && data?.pix_key) pixInput.value=data.pix_key;
    }else{
      if(status){status.textContent='Não ativado';status.style.color='var(--yellow)';status.style.background='rgba(245,196,81,.1)';}
      if(code) code.value='Ative seu perfil de parceiro';
      if(activate){activate.textContent='Quero ser parceiro';activate.disabled=false;}
      if(withdraw) withdraw.disabled=true;
    }
  }

  async function loadPartnerDashboard(){
    if(!supabaseClient || !currentAuthUser) return;
    try{
      const {data,error}=await supabaseClient.rpc('get_my_partner_dashboard');
      if(error) throw error;
      renderPartnerDashboard(data);
    }catch(err){
      console.warn('Programa de Parceiros ainda não configurado no Supabase:',err);
      renderPartnerDashboard(null);
    }
  }

  document.getElementById('partnerSuccessClose')?.addEventListener('click',closePartnerSuccessModal);
  document.getElementById('partnerSuccessOk')?.addEventListener('click',closePartnerSuccessModal);
  document.getElementById('partnerSuccessModal')?.addEventListener('click',e=>{
    if(e.target?.id==='partnerSuccessModal') closePartnerSuccessModal();
  });
  document.getElementById('partnerSuccessCopy')?.addEventListener('click',async()=>{
    const code=String(document.getElementById('partnerSuccessCode')?.textContent||'').trim();
    if(!code || code==='—') return;
    try{
      await navigator.clipboard.writeText(code);
      const btn=document.getElementById('partnerSuccessCopy');
      if(btn){
        const oldText=btn.textContent;
        btn.textContent='Copiado ✓';
        setTimeout(()=>btn.textContent=oldText,1400);
      }
    }catch(_e){}
  });

  nav?.addEventListener('click',()=>{
    sec?.scrollIntoView({behavior:'smooth',block:'start'});
    loadPartnerDashboard();
  });

  activate?.addEventListener('click',async()=>{
    if(!supabaseClient || !currentAuthUser){
      await appAlert('Entre na sua conta para ativar o Programa de Parceiros.','Parceiros');
      return;
    }
    setPartnerLoading(true);
    try{
      const {data,error}=await supabaseClient.rpc('activate_my_partner');
      if(error) throw error;
      await loadPartnerDashboard();
      openPartnerSuccessModal(data?.code||'');
    }catch(err){
      console.error(err);
      await appAlert(
        String(err?.message||'Não foi possível ativar o perfil de parceiro.')+
        '\n\nSe você ainda não executou o SQL da Etapa 2 no Supabase, faça isso primeiro.',
        'Programa de Parceiros'
      );
    }finally{
      setPartnerLoading(false);
      await loadPartnerDashboard();
    }
  });

  copy?.addEventListener('click',async()=>{
    const input=document.getElementById('partnerCode');
    if(!partnerDashboard?.active || !input?.value || input.value==='Ative seu perfil de parceiro'){
      await appAlert('Ative seu perfil de parceiro primeiro.','Código de indicação');
      return;
    }
    try{
      await navigator.clipboard.writeText(input.value);
      await appAlert('Código de indicação copiado.','Parceiros');
    }catch(_e){
      input.select();
      document.execCommand('copy');
      await appAlert('Código de indicação copiado.','Parceiros');
    }
  });

  withdraw?.addEventListener('click',()=>{
    if(!(Number(partnerDashboard?.available||0)>0)) return;
    if(withdrawModal) withdrawModal.style.display='flex';
    setTimeout(()=>pixInput?.focus(),60);
  });
  withdrawCancel?.addEventListener('click',()=>{if(withdrawModal)withdrawModal.style.display='none';});
  withdrawModal?.addEventListener('click',e=>{if(e.target===withdrawModal)withdrawModal.style.display='none';});

  withdrawConfirm?.addEventListener('click',async()=>{
    const pix=String(pixInput?.value||'').trim();
    if(!pix){
      await appAlert('Informe sua chave Pix.','Solicitar saque');
      return;
    }
    withdrawConfirm.disabled=true;
    withdrawConfirm.textContent='Solicitando...';
    try{
      const {data,error}=await supabaseClient.rpc('request_my_partner_withdrawal',{p_pix_key:pix});
      if(error) throw error;
      if(withdrawModal) withdrawModal.style.display='none';
      await loadPartnerDashboard();
      await appAlert(`Solicitação criada no valor de ${pMoney(data?.amount)}.\n\nO pagamento ficará aguardando aprovação na Administração do Gestor PRO.`,'Saque solicitado');
    }catch(err){
      console.error(err);
      await appAlert(String(err?.message||'Não foi possível solicitar o saque.'),'Solicitar saque');
    }finally{
      withdrawConfirm.disabled=false;
      withdrawConfirm.textContent='Solicitar saque';
    }
  });

  // Atualiza o painel do parceiro após o login / carregamento do app
  const oldInit=window.initApp;
  if(typeof oldInit==='function'){
    window.initApp=async function(){
      const result=await oldInit.apply(this,arguments);
      await loadPartnerDashboard();
      return result;
    };
  }
  setTimeout(loadPartnerDashboard,1200);
  window.loadPartnerDashboard=loadPartnerDashboard;
})();
