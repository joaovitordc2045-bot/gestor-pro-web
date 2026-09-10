/* ===== Parceiros · Abas principais ===== */
(function(){
  function openPartnerMainTab(tab){
    document.querySelectorAll('[data-partner-main-tab]').forEach(btn=>{
      btn.classList.toggle('active',btn.dataset.partnerMainTab===tab);
    });
    document.querySelectorAll('.partner-tab-panel').forEach(panel=>{
      panel.classList.toggle('active',panel.id===({
        overview:'partnerTabOverview',
        commissions:'partnerTabCommissions',
        withdrawals:'partnerTabWithdrawals',
        news:'partnerTabNews'
      })[tab]);
    });

    if(tab==='commissions' || tab==='withdrawals'){
      if(typeof window.loadPartnerHistory==='function') window.loadPartnerHistory();
    }
    if(tab==='news'){
      if(typeof window.loadPartnerInsights==='function') window.loadPartnerInsights();
    }
  }

  document.querySelectorAll('[data-partner-main-tab]').forEach(btn=>{
    btn.addEventListener('click',()=>openPartnerMainTab(btn.dataset.partnerMainTab));
  });

  document.getElementById('partnersNavBtn')?.addEventListener('click',()=>{
    setTimeout(()=>openPartnerMainTab('overview'),80);
  });

  window.openPartnerMainTab=openPartnerMainTab;
})();
