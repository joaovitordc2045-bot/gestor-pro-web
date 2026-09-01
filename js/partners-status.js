(function(){
  function highlightPartnerWithdrawalStatuses(){
    document.querySelectorAll('#adminWithdrawalsList .admin-partner-cell').forEach(cell=>{
      const label=cell.querySelector('span');
      const value=cell.querySelector('b');
      if(!label || !value || label.textContent.trim().toLowerCase()!=='status') return;
      const status=value.textContent.trim().toUpperCase();
      value.style.display='inline-flex';
      value.style.padding='5px 8px';
      value.style.borderRadius='999px';
      value.style.fontWeight='900';
      if(status==='PAGO'){
        value.style.color='var(--green)';
        value.style.background='rgba(66,230,164,.10)';
      }else if(status==='AGUARDANDO'){
        value.style.color='var(--yellow)';
        value.style.background='rgba(245,196,81,.10)';
      }else if(status==='REJEITADO'){
        value.style.color='var(--red)';
        value.style.background='rgba(255,107,122,.10)';
      }
    });
  }

  const oldRender=window.renderAdminPartners;
  const observer=new MutationObserver(highlightPartnerWithdrawalStatuses);
  const target=document.getElementById('adminWithdrawalsList');
  if(target) observer.observe(target,{childList:true,subtree:true});
  setTimeout(highlightPartnerWithdrawalStatuses,300);
})();
