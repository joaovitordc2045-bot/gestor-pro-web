/* ===== Parceiros · Histórico financeiro ===== */
(function(){
  const commissionBox=document.getElementById('partnerCommissionHistory');
  const withdrawalBox=document.getElementById('partnerWithdrawalHistory');

  const histMoney=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const histDate=v=>{
    if(!v)return '—';
    const d=new Date(v);
    return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  };
  const histEsc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const commissionStatusLabel=s=>({
    pending:'PENDENTE',
    available:'DISPONÍVEL',
    processing:'EM SAQUE',
    paid:'PAGO',
    reversed:'ESTORNADO'
  })[s]||String(s||'—').toUpperCase();
  const withdrawalStatusLabel=s=>({
    requested:'AGUARDANDO',
    paid:'PAGO',
    rejected:'REJEITADO',
    canceled:'CANCELADO'
  })[s]||String(s||'—').toUpperCase();

  async function loadPartnerHistory(){
    if(!supabaseClient || !currentAuthUser) return;

    try{
      const [{data:commissions,error:cErr},{data:withdrawals,error:wErr}] = await Promise.all([
        supabaseClient.rpc('get_my_partner_commissions'),
        supabaseClient.rpc('get_my_partner_withdrawals')
      ]);

      if(cErr) throw cErr;
      if(wErr) throw wErr;

      if(commissionBox){
        const rows=Array.isArray(commissions)?commissions:[];
        commissionBox.innerHTML=rows.length?rows.map(r=>`
          <div class="partner-history-row">
            <div class="partner-history-main">
              <b>${histEsc(String(r.plan_cycle||'Plano').toUpperCase())}</b>
              <small>${histDate(r.created_at)}</small>
            </div>
            <div class="partner-history-cell"><span>Pagamento</span><b>${histMoney(r.payment_amount)}</b></div>
            <div class="partner-history-cell"><span>Comissão</span><b>${histMoney(r.commission_amount)}</b></div>
            <div><span class="partner-history-badge ${histEsc(r.status||'')}">${histEsc(commissionStatusLabel(r.status))}</span></div>
          </div>
        `).join(''):'<div class="partner-history-empty">Nenhuma comissão registrada ainda.</div>';
      }

      if(withdrawalBox){
        const rows=Array.isArray(withdrawals)?withdrawals:[];
        withdrawalBox.innerHTML=rows.length?rows.map(r=>`
          <div class="partner-history-row">
            <div class="partner-history-main">
              <b>Saque via Pix</b>
              <small>${histDate(r.requested_at)}</small>
            </div>
            <div class="partner-history-cell"><span>Valor</span><b>${histMoney(r.amount)}</b></div>
            <div class="partner-history-cell"><span>Pix</span><b style="overflow-wrap:anywhere">${histEsc(r.pix_key||'—')}</b></div>
            <div><span class="partner-history-badge ${r.status==='requested'?'pending':histEsc(r.status||'')}">${histEsc(withdrawalStatusLabel(r.status))}</span></div>
          </div>
        `).join(''):'<div class="partner-history-empty">Nenhum saque solicitado ainda.</div>';
      }
    }catch(err){
      console.warn('Histórico de parceiros indisponível:',err);
      if(commissionBox) commissionBox.innerHTML='<div class="partner-history-empty">Execute o SQL da Etapa 6 no Supabase para habilitar o histórico de comissões.</div>';
    }
  }

  document.querySelectorAll('[data-partner-history-tab]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('[data-partner-history-tab]').forEach(b=>b.classList.toggle('active',b===btn));
      const tab=btn.dataset.partnerHistoryTab;
      if(commissionBox) commissionBox.style.display=tab==='commissions'?'grid':'none';
      if(withdrawalBox) withdrawalBox.style.display=tab==='withdrawals'?'grid':'none';
    });
  });

  const partnerNav=document.getElementById('partnersNavBtn');
  partnerNav?.addEventListener('click',()=>setTimeout(loadPartnerHistory,120));

  // Atualiza histórico quando o dashboard de parceiro for atualizado.
  const originalLoad=window.loadPartnerDashboard;
  if(typeof originalLoad==='function' && !originalLoad.__historyWrapped){
    window.loadPartnerDashboard=async function(){
      const result=await originalLoad.apply(this,arguments);
      await loadPartnerHistory();
      return result;
    };
    window.loadPartnerDashboard.__historyWrapped=true;
  }

  setTimeout(loadPartnerHistory,1600);
  window.loadPartnerHistory=loadPartnerHistory;
})();
