(function(){
  let adminPartnerRows=[];
  let adminWithdrawalRows=[];

  const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmtDate=v=>{
    if(!v)return '—';
    const d=new Date(v);
    return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  };

  async function loadAdminPartners(){
    if(!supabaseClient || currentProfile?.role!=='admin') return;
    const btn=document.getElementById('adminPartnersRefreshBtn');
    if(btn){btn.disabled=true;btn.textContent='Atualizando...';}
    try{
      const [{data:partners,error:pErr},{data:withdrawals,error:wErr}]=await Promise.all([
        supabaseClient.rpc('admin_partner_dashboard'),
        supabaseClient.rpc('admin_partner_withdrawals')
      ]);
      if(pErr) throw pErr;
      if(wErr) throw wErr;
      adminPartnerRows=Array.isArray(partners)?partners:[];
      adminWithdrawalRows=Array.isArray(withdrawals)?withdrawals:[];
      renderAdminPartners();
    }catch(err){
      console.error('Erro ao carregar Central de Parceiros:',err);
      const box=document.getElementById('adminPartnersList');
      if(box) box.innerHTML=`<div class="admin-partner-empty">Não foi possível carregar os parceiros.<br>${esc(err?.message||err)}</div>`;
    }finally{
      if(btn){btn.disabled=false;btn.textContent='Atualizar parceiros';}
    }
  }

  function renderAdminPartners(){
    document.getElementById('adminPartnersCount').textContent=String(adminPartnerRows.length);
    document.getElementById('adminPartnersReferrals').textContent=String(adminPartnerRows.reduce((s,r)=>s+Number(r.referrals_count||0),0));
    document.getElementById('adminPartnersPending').textContent=money(adminPartnerRows.reduce((s,r)=>s+Number(r.pending_amount||0),0));
    document.getElementById('adminPartnersWithdrawals').textContent=String(adminWithdrawalRows.filter(r=>r.status==='requested').length);

    const pbox=document.getElementById('adminPartnersList');
    if(pbox){
      pbox.innerHTML=adminPartnerRows.length?adminPartnerRows.map(r=>`
        <div class="admin-partner-row">
          <div class="admin-partner-main"><b>${esc(r.partner_code||'Parceiro')}</b><span>${esc(r.user_id||'')}</span></div>
          <div class="admin-partner-cell"><span>Indicados</span><b>${Number(r.referrals_count||0)}</b></div>
          <div class="admin-partner-cell"><span>Ativos</span><b>${Number(r.active_referrals_count||0)}</b></div>
          <div class="admin-partner-cell"><span>Pendente</span><b>${money(r.pending_amount)}</b></div>
          <div class="admin-partner-cell"><span>Disponível</span><b>${money(r.available_amount)}</b></div>
          <div class="admin-partner-cell"><span>Em saque</span><b>${money(r.processing_amount)}</b></div>
        </div>`).join(''):'<div class="admin-partner-empty">Nenhum parceiro cadastrado ainda.</div>';
    }

    const wbox=document.getElementById('adminWithdrawalsList');
    if(wbox){
      wbox.innerHTML=adminWithdrawalRows.length?adminWithdrawalRows.map(r=>`
        <div class="admin-withdrawal-row">
          <div class="admin-partner-main"><b>${esc(r.partner_code||'Parceiro')}</b><span>${fmtDate(r.requested_at)}</span></div>
          <div class="admin-partner-cell"><span>Valor</span><b>${money(r.amount)}</b></div>
          <div class="admin-partner-cell"><span>Chave Pix</span><b style="overflow-wrap:anywhere">${esc(r.pix_key||'—')}</b></div>
          <div class="admin-partner-cell"><span>Status</span><b>${esc(({
            requested:'AGUARDANDO',
            paid:'PAGO',
            rejected:'REJEITADO',
            canceled:'CANCELADO'
          })[r.status] || String(r.status||'—').toUpperCase())}</b></div>
          <div class="admin-withdrawal-actions">${r.status==='requested'?`
            <button class="btn btn-accent" type="button" data-pay-withdrawal="${esc(r.withdrawal_id)}">Marcar pago</button>
            <button class="btn btn-ghost" type="button" data-reject-withdrawal="${esc(r.withdrawal_id)}">Rejeitar</button>`:''}
          </div>
        </div>`).join(''):'<div class="admin-partner-empty">Nenhuma solicitação de saque.</div>';
    }
  }

  document.querySelectorAll('[data-admin-partner-tab]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('[data-admin-partner-tab]').forEach(b=>b.classList.toggle('active',b===btn));
      const tab=btn.dataset.adminPartnerTab;
      document.getElementById('adminPartnersList').style.display=tab==='partners'?'grid':'none';
      document.getElementById('adminWithdrawalsList').style.display=tab==='withdrawals'?'grid':'none';
    });
  });

  document.getElementById('adminPartnersRefreshBtn')?.addEventListener('click',loadAdminPartners);

  document.getElementById('adminWithdrawalsList')?.addEventListener('click',async e=>{
    const pay=e.target.closest('[data-pay-withdrawal]');
    if(pay){
      if(!(await appConfirm('Confirma que você realizou o Pix deste saque?','Marcar saque como pago',{confirmText:'Confirmar pagamento'})))return;
      const {data,error}=await supabaseClient.rpc('admin_pay_partner_withdrawal',{p_withdrawal_id:pay.dataset.payWithdrawal});
      if(error){await appAlert(String(error.message||error),'Erro no saque');return;}
      await appAlert(`Saque marcado como pago no valor de ${money(data?.amount)}.`,'Pagamento confirmado');
      await loadAdminPartners();
      return;
    }

    const reject=e.target.closest('[data-reject-withdrawal]');
    if(reject){
      if(!(await appConfirm('Rejeitar este pedido e devolver o valor ao saldo disponível do parceiro?','Rejeitar saque',{confirmText:'Rejeitar'})))return;
      const {error}=await supabaseClient.rpc('admin_reject_partner_withdrawal',{
        p_withdrawal_id:reject.dataset.rejectWithdrawal,
        p_note:'Rejeitado pelo proprietário no painel do Gestor PRO.'
      });
      if(error){await appAlert(String(error.message||error),'Erro no saque');return;}
      await appAlert('Pedido rejeitado. O saldo voltou a ficar disponível para o parceiro.','Saque rejeitado');
      await loadAdminPartners();
    }
  });

  document.getElementById('adminRefreshBtn')?.addEventListener('click',()=>setTimeout(loadAdminPartners,100));
  setTimeout(()=>{if(currentProfile?.role==='admin')loadAdminPartners();},1500);
  window.loadAdminPartners=loadAdminPartners;
})();
