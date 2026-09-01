function openReferralSuccessModal(code){
  const modal=document.getElementById('referralSuccessModal');
  const codeEl=document.getElementById('referralSuccessCode');
  if(codeEl) codeEl.textContent=code||'—';
  if(modal){
    modal.style.display='flex';
    modal.setAttribute('aria-hidden','false');
  }
}
function closeReferralSuccessModal(){
  const modal=document.getElementById('referralSuccessModal');
  if(modal){
    modal.style.display='none';
    modal.setAttribute('aria-hidden','true');
  }
}
document.getElementById('referralSuccessClose')?.addEventListener('click',closeReferralSuccessModal);
document.getElementById('referralSuccessOk')?.addEventListener('click',closeReferralSuccessModal);
document.getElementById('referralSuccessModal')?.addEventListener('click',e=>{
  if(e.target?.id==='referralSuccessModal') closeReferralSuccessModal();
});
