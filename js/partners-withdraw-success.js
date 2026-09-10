(function(){
  window.openWithdrawSuccessModal=function(amount,pix){
    const modal=document.getElementById('withdrawSuccessModal');
    const amountEl=document.getElementById('withdrawSuccessAmount');
    const pixEl=document.getElementById('withdrawSuccessPix');
    if(amountEl) amountEl.textContent=Number(amount||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    if(pixEl) pixEl.textContent=String(pix||'—');
    if(modal){
      modal.style.display='flex';
      modal.setAttribute('aria-hidden','false');
    }
  };

  function closeWithdrawSuccessModal(){
    const modal=document.getElementById('withdrawSuccessModal');
    if(modal){
      modal.style.display='none';
      modal.setAttribute('aria-hidden','true');
    }
  }

  document.getElementById('withdrawSuccessClose')?.addEventListener('click',function(e){
    e.preventDefault();
    e.stopPropagation();
    closeWithdrawSuccessModal();
  });

  document.getElementById('withdrawSuccessOk')?.addEventListener('click',function(e){
    e.preventDefault();
    e.stopPropagation();
    closeWithdrawSuccessModal();
  });

  document.getElementById('withdrawSuccessModal')?.addEventListener('click',function(e){
    if(e.target===this) closeWithdrawSuccessModal();
  });
})();
