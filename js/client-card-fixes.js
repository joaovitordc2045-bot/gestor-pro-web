/* Gestor PRO v12 - Ficha do Cliente no Web Mobile.
   Trava a página real usando position:fixed e deixa o scroll no overlay da ficha. */
(function(){
  const modal=document.getElementById('clientProfileModal');
  const closeBtn=document.getElementById('clientProfileClose');
  const editBtn=document.getElementById('clientProfileEdit');
  const chargeBtn=document.getElementById('clientProfileCharge');
  if(!modal) return;

  let lockedScrollY=0;
  let locked=false;

  function lockProfileScroll(){
    if(locked) return;
    lockedScrollY=window.scrollY || document.documentElement.scrollTop || 0;
    document.documentElement.style.setProperty('--gp-profile-lock-top', (-lockedScrollY)+'px');
    document.documentElement.classList.add('gp-client-profile-open');
    document.body.classList.add('gp-client-profile-open');
    locked=true;
    modal.scrollTop=0;
  }

  function unlockProfileScroll(){
    if(!locked){
      document.documentElement.classList.remove('gp-client-profile-open');
      document.body.classList.remove('gp-client-profile-open');
      return;
    }
    document.documentElement.classList.remove('gp-client-profile-open');
    document.body.classList.remove('gp-client-profile-open');
    document.documentElement.style.removeProperty('--gp-profile-lock-top');
    locked=false;
    window.scrollTo(0,lockedScrollY);
  }

  function closeProfile(){
    modal.style.display='none';
    unlockProfileScroll();
    if(typeof clientProfileCurrentId!=='undefined') clientProfileCurrentId=null;
  }

  function sync(){
    const open=getComputedStyle(modal).display!=='none';
    if(open) lockProfileScroll(); else unlockProfileScroll();
  }

  new MutationObserver(sync).observe(modal,{attributes:true,attributeFilter:['style','class']});
  sync();

  // Impede o gesto iniciado no backdrop de ser repassado para a página.
  modal.addEventListener('touchmove',function(e){
    if(e.target===modal) e.preventDefault();
  },{passive:false});

  closeBtn?.addEventListener('click',function(e){
    e.preventDefault(); e.stopPropagation(); closeProfile();
  });

  modal.addEventListener('click',function(e){
    if(e.target===modal) closeProfile();
  });

  editBtn?.addEventListener('click',function(e){
    e.preventDefault(); e.stopPropagation();
    const id=typeof clientProfileCurrentId!=='undefined'?clientProfileCurrentId:null;
    const client=(Array.isArray(window.clients)?window.clients:(typeof clients!=='undefined'&&Array.isArray(clients)?clients:[])).find(c=>String(c.id)===String(id));
    if(!client) return;
    closeProfile();
    if(typeof openForm==='function'){
      openForm(client);
      setTimeout(()=>{
        const form=document.getElementById('formCard');
        (form || document.getElementById('clientsSection'))?.scrollIntoView({behavior:'smooth',block:'start'});
      },80);
    }
  });

  chargeBtn?.addEventListener('click',async function(e){
    e.preventDefault(); e.stopPropagation();
    const id=typeof clientProfileCurrentId!=='undefined'?clientProfileCurrentId:null;
    const list=(typeof clients!=='undefined'&&Array.isArray(clients))?clients:[];
    const client=list.find(c=>String(c.id)===String(id));
    if(!client) return;
    const link=typeof whatsappLink==='function'?whatsappLink(client):null;
    if(!link){
      if(typeof appAlert==='function') await appAlert('Este cliente não tem telefone/WhatsApp cadastrado.','WhatsApp não encontrado');
      return;
    }
    if(typeof addActivity==='function') addActivity('whatsapp','Cobrança aberta no WhatsApp',`Foi preparada uma cobrança para ${client.nome}.`);
    window.open(link,'_blank');
  });
})();
