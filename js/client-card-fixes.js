/* Correção dos botões da Ficha do Cliente.
   Este script fica depois do HTML do modal, garantindo que os botões já existam. */
(function(){
  const modal=document.getElementById('clientProfileModal');
  const closeBtn=document.getElementById('clientProfileClose');
  const editBtn=document.getElementById('clientProfileEdit');
  const chargeBtn=document.getElementById('clientProfileCharge');

  function closeProfile(){
    if(modal) modal.style.display='none';
    clientProfileCurrentId=null;
  }

  closeBtn?.addEventListener('click',function(e){
    e.preventDefault();
    e.stopPropagation();
    closeProfile();
  });

  modal?.addEventListener('click',function(e){
    if(e.target===modal) closeProfile();
  });

  editBtn?.addEventListener('click',function(e){
    e.preventDefault();
    e.stopPropagation();

    const id=clientProfileCurrentId;
    const client=(Array.isArray(clients)?clients:[]).find(c=>String(c.id)===String(id));
    if(!client) return;

    closeProfile();

    if(typeof openForm==='function'){
      openForm(client);
      setTimeout(()=>{
        const form=document.getElementById('formCard');
        (form || document.getElementById('clientsSection'))?.scrollIntoView({
          behavior:'smooth',
          block:'start'
        });
      },80);
    }
  });

  chargeBtn?.addEventListener('click',async function(e){
    e.preventDefault();
    e.stopPropagation();

    const id=clientProfileCurrentId;
    const client=(Array.isArray(clients)?clients:[]).find(c=>String(c.id)===String(id));
    if(!client) return;

    // Usa exatamente a mesma rotina de cobrança que já funciona
    // na lista de clientes, agenda e inadimplência.
    const link=typeof whatsappLink==='function' ? whatsappLink(client) : null;

    if(!link){
      if(typeof appAlert==='function'){
        await appAlert('Este cliente não tem telefone/WhatsApp cadastrado.','WhatsApp não encontrado');
      }
      return;
    }

    if(typeof addActivity==='function'){
      addActivity('whatsapp','Cobrança aberta no WhatsApp',`Foi preparada uma cobrança para ${client.nome}.`);
    }

    window.open(link,'_blank');
  });
})();
