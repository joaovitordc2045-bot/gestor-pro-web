/* ===== Central de Parceiros · Atualização automática ===== */
(function(){
  let gpPartnerAutoRefreshTimer=null;

  async function refreshPartnersSafely(){
    try{
      if(currentProfile?.role==='admin' && typeof window.loadAdminPartners==='function'){
        await window.loadAdminPartners();
      }
    }catch(err){
      console.warn('Atualização automática da Central de Parceiros:',err);
    }
  }

  // Atualiza assim que a área de Administração for aberta.
  document.addEventListener('click',function(e){
    const btn=e.target.closest(
      '#adminNavBtn,[data-target="adminSection"],[data-section="adminSection"],[href="#adminSection"]'
    );
    if(btn) setTimeout(refreshPartnersSafely,120);
  });

  // Caso a navegação use somente scroll/section, observa quando a Administração
  // entra na tela e atualiza uma vez.
  const adminSection=document.getElementById('adminSection');
  if(adminSection && 'IntersectionObserver' in window){
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries){
        if(entry.isIntersecting && entry.intersectionRatio>.12){
          refreshPartnersSafely();
        }
      }
    },{threshold:[.12]});
    observer.observe(adminSection);
  }

  // Após o login, o perfil pode levar alguns instantes para ficar disponível.
  // Faz algumas tentativas curtas para que os números não permaneçam zerados.
  [900,1800,3200,5000].forEach(ms=>setTimeout(refreshPartnersSafely,ms));

  // Mantém a Central atualizada sem exigir clique do proprietário.
  gpPartnerAutoRefreshTimer=setInterval(refreshPartnersSafely,60000);

  window.addEventListener('beforeunload',()=>{
    if(gpPartnerAutoRefreshTimer) clearInterval(gpPartnerAutoRefreshTimer);
  });
})();
