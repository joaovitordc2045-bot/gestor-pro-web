/* ===== Correção final · Solicitar saque PIX ===== */
(function(){
  const withdrawBtn = document.getElementById('partnerWithdrawBtn');
  const withdrawModal = document.getElementById('partnerWithdrawModal');
  const withdrawCancel = document.getElementById('partnerWithdrawCancel');
  const withdrawConfirm = document.getElementById('partnerWithdrawConfirm');
  const pixInput = document.getElementById('partnerPixKey');

  function partnerMoney(v){
    return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  }

  function closeWithdrawModal(){
    if(withdrawModal) withdrawModal.style.display='none';
  }

  withdrawBtn?.addEventListener('click', async function(e){
    e.preventDefault();
    e.stopPropagation();

    // Atualiza o saldo antes de abrir o modal.
    try{
      if(typeof window.loadPartnerDashboard==='function'){
        await window.loadPartnerDashboard();
      }
    }catch(_e){}

    // Lê o valor que está aparecendo no painel.
    const availableText = document.getElementById('partnerAvailable')?.textContent || 'R$ 0,00';
    const available = Number(
      availableText
        .replace(/[^\d,.-]/g,'')
        .replace(/\./g,'')
        .replace(',','.')
    ) || 0;

    if(available <= 0){
      if(typeof appAlert==='function'){
        await appAlert('Você ainda não possui saldo disponível para saque.','Solicitar saque');
      }
      return;
    }

    if(withdrawModal){
      withdrawModal.style.display='flex';
      setTimeout(()=>pixInput?.focus(),80);
    }
  });

  withdrawCancel?.addEventListener('click', function(e){
    e.preventDefault();
    e.stopPropagation();
    closeWithdrawModal();
  });

  withdrawModal?.addEventListener('click', function(e){
    if(e.target===withdrawModal) closeWithdrawModal();
  });

  withdrawConfirm?.addEventListener('click', async function(e){
    e.preventDefault();
    e.stopPropagation();

    const pix = String(pixInput?.value || '').trim();

    if(!pix){
      if(typeof appAlert==='function'){
        await appAlert('Informe sua chave Pix para continuar.','Solicitar saque');
      }
      return;
    }

    this.disabled = true;
    const oldText = this.textContent;
    this.textContent = 'Solicitando...';

    try{
      if(!supabaseClient){
        throw new Error('Conexão com o Supabase indisponível.');
      }

      const {data,error} = await supabaseClient.rpc(
        'request_my_partner_withdrawal',
        {p_pix_key:pix}
      );

      if(error) throw error;

      closeWithdrawModal();

      if(typeof window.loadPartnerDashboard==='function'){
        await window.loadPartnerDashboard();
      }

      openWithdrawSuccessModal(data?.amount,pix);
    }catch(err){
      console.error('Erro ao solicitar saque do parceiro:', err);
      if(typeof appAlert==='function'){
        await appAlert(
          String(err?.message || err || 'Não foi possível solicitar o saque.'),
          'Solicitar saque'
        );
      }
    }finally{
      this.disabled = false;
      this.textContent = oldText;
    }
  });
})();
