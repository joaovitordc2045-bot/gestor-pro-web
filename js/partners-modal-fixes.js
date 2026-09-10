/* Correção final dos botões dos modais do Programa de Parceiros.
   Este script fica no final do BODY para garantir que o HTML dos modais já exista. */
(function(){
  function closePartnerSuccess(){
    const modal=document.getElementById('partnerSuccessModal');
    if(modal){
      modal.style.display='none';
      modal.setAttribute('aria-hidden','true');
    }
  }

  const partnerSuccessModal=document.getElementById('partnerSuccessModal');
  const partnerSuccessClose=document.getElementById('partnerSuccessClose');
  const partnerSuccessOk=document.getElementById('partnerSuccessOk');
  const partnerSuccessCopy=document.getElementById('partnerSuccessCopy');

  partnerSuccessClose?.addEventListener('click',function(e){
    e.preventDefault();
    e.stopPropagation();
    closePartnerSuccess();
  });

  partnerSuccessOk?.addEventListener('click',function(e){
    e.preventDefault();
    e.stopPropagation();
    closePartnerSuccess();
  });

  partnerSuccessModal?.addEventListener('click',function(e){
    if(e.target===partnerSuccessModal) closePartnerSuccess();
  });

  partnerSuccessCopy?.addEventListener('click',async function(e){
    e.preventDefault();
    e.stopPropagation();

    const code=String(document.getElementById('partnerSuccessCode')?.textContent||'').trim();
    if(!code || code==='—') return;

    const oldText=this.textContent;
    try{
      await navigator.clipboard.writeText(code);
      this.textContent='Copiado ✓';
    }catch(_err){
      try{
        const ta=document.createElement('textarea');
        ta.value=code;
        ta.style.position='fixed';
        ta.style.opacity='0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        this.textContent='Copiado ✓';
      }catch(_e){}
    }
    setTimeout(()=>{this.textContent=oldText;},1400);
  });

  // Também reforça os botões do modal de indicação.
  function closeReferralSuccess(){
    const modal=document.getElementById('referralSuccessModal');
    if(modal){
      modal.style.display='none';
      modal.setAttribute('aria-hidden','true');
    }
  }

  document.getElementById('referralSuccessClose')?.addEventListener('click',function(e){
    e.preventDefault();
    e.stopPropagation();
    closeReferralSuccess();
  });

  document.getElementById('referralSuccessOk')?.addEventListener('click',function(e){
    e.preventDefault();
    e.stopPropagation();
    closeReferralSuccess();
  });

  document.getElementById('referralSuccessModal')?.addEventListener('click',function(e){
    if(e.target===this) closeReferralSuccess();
  });
})();
