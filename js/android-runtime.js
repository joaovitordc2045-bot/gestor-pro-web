/* Gestor PRO - comportamento exclusivo Android */
(function(){
  function applyAndroidUi(){
    if(!window.GestorProPlatform?.isAndroid) return;

    document.body.classList.add('gestor-pro-android');

    const card=document.getElementById('autoCard');
    if(card && !document.getElementById('androidAutomationNotice')){
      const title=card.querySelector('h2');
      const notice=document.createElement('div');
      notice.id='androidAutomationNotice';
      notice.className='android-platform-notice';
      notice.innerHTML=
        '<strong>📱 Automação no Android</strong>'+
        '<span>A automação automática do WhatsApp fica ativa na versão PC. '+
        'No celular, use o botão <b>Cobrar</b> dos clientes para abrir o WhatsApp com a mensagem pronta.</span>';

      if(title?.nextSibling){
        title.parentNode.insertBefore(notice,title.nextSibling);
      }else{
        card.prepend(notice);
      }

      card.querySelector('.auto-row')?.classList.add('android-pc-only');
      card.querySelector('.auto-warning')?.classList.add('android-pc-only');
      card.querySelector('.auto-monitor')?.classList.add('android-pc-only');
    }
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',applyAndroidUi,{once:true});
  }else{
    applyAndroidUi();
  }
})();
