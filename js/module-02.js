(function(){
  const $ = (id)=>document.getElementById(id);
  const esc = (value)=>String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

  // ---------- Resumo lateral Hoje ----------
  function gpTodayData(){
    const all = Array.isArray(clients) ? clients : [];
    const rows = all.map(client=>({client,days:daysUntil(client.vencimento)}))
      .filter(item=>item.days!==null)
      .sort((a,b)=>a.days-b.days || String(a.client?.nome||'').localeCompare(String(b.client?.nome||''),'pt-BR'));

    const late = rows.filter(x=>x.days<0);
    const due = rows.filter(x=>x.days===0);
    const soon = rows.filter(x=>x.days>0 && x.days<=7);
    const priority = rows.filter(x=>x.days<=7).slice(0,3);
    const expected = priority.reduce((sum,x)=>sum+Number(x.client?.valor||0),0);
    return {late,due,soon,priority,expected};
  }

  function renderGpTodayPanel(){
    const panel=$('gpTodayPanel'); if(!panel) return;
    const data=gpTodayData();
    const now=new Date();
    $('gpTodayDate').textContent=now.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'});
    $('gpQuickLate').textContent=String(data.late.length);
    $('gpQuickDue').textContent=String(data.due.length);
    $('gpQuickSoon').textContent=String(data.soon.length);
    $('gpQuickExpected').textContent=fmtMoney(data.expected);

    const list=$('gpQuickList');
    if(!data.priority.length){
      list.innerHTML='<div class="gp-today-empty">✓ Nenhuma cobrança urgente nos próximos 7 dias.</div>';
      return;
    }

    list.innerHTML=data.priority.map(({client,days})=>{
      const status=days<0?`Atrasado ${Math.abs(days)}d`:days===0?'Vence hoje':`Em ${days} dia${days===1?'':'s'}`;
      return `<div class="gp-today-item" data-gp-today-client="${esc(client.id)}" style="cursor:pointer"><b>${esc(client.nome||'Cliente')}</b><span>${esc(status)} · ${esc(fmtMoney(client.valor||0))}</span></div>`;
    }).join('');
  }

  $('gpTodayAgendaBtn')?.addEventListener('click',()=>document.querySelector('[data-target="agendaSection"]')?.click());
  $('gpTodayNotificationsBtn')?.addEventListener('click',()=>$('notificationsNavBtn')?.click());
  $('gpTodayViewAllBtn')?.addEventListener('click',()=>document.querySelector('[data-target="agendaSection"]')?.click());

  function syncGpTodayPanel(){
    const panel=$('gpTodayPanel');
    const welcome=$('executiveWelcome');
    if(!panel || !welcome || window.innerWidth<1580) return;
    const top=Math.max(18, Math.round(welcome.getBoundingClientRect().top));
    panel.style.top=top+'px';
  }
  window.addEventListener('resize',syncGpTodayPanel,{passive:true});
  window.addEventListener('scroll',syncGpTodayPanel,{passive:true});
  $('gpTodayList')?.addEventListener('click',e=>{
    const row=e.target.closest('[data-gp-today-client]'); if(!row)return;
    const client=(Array.isArray(clients)?clients:[]).find(c=>String(c.id)===row.dataset.gpTodayClient);
    const search=$('search');
    if(search && client){
      search.value=client.nome||'';
      currentPage=1;
      renderList();
      $('clientsSection')?.scrollIntoView({behavior:'smooth',block:'start'});
    }
  });

  // Atualiza o painel lateral sempre que o painel principal renderizar.
  if(typeof render==='function'){
    const originalRender=render;
    render=function(){
      const result=originalRender.apply(this,arguments);
      queueMicrotask(()=>{
        renderGpTodayPanel();
        maybeShowDailyWindowsNotification();
      });
      return result;
    };
  }
  setTimeout(()=>{renderGpTodayPanel();syncGpTodayPanel();},600);

  // ---------- Estado vazio do gráfico ----------
  document.addEventListener('click',e=>{
    const btn=e.target.closest('#gpChartEmptyAction'); if(!btn)return;
    if(Array.isArray(clients) && clients.length){
      $('clientsSection')?.scrollIntoView({behavior:'smooth',block:'start'});
      $('search')?.focus();
    }else{
      $('toggleFormBtn')?.click();
      setTimeout(()=>$('f-nome')?.focus(),120);
    }
  });

  // ---------- Busca rápida Ctrl+K ----------
  const palette=$('gpCommandPalette');
  const commandInput=$('gpCommandInput');
  const commandResults=$('gpCommandResults');
  let commandItems=[];
  let activeCommand=0;

  const commands=[
    {label:'Painel',desc:'Voltar para a visão geral',icon:'⌂',run:()=>document.querySelector('[data-target="overviewSection"]')?.click(),key:'Ctrl 1'},
    {label:'Agenda',desc:'Abrir agenda de cobranças',icon:'▣',run:()=>document.querySelector('[data-target="agendaSection"]')?.click(),key:'Ctrl 2'},
    {label:'Financeiro',desc:'Ir para receita e financeiro',icon:'↗',run:()=>document.querySelector('[data-target="financialSection"]')?.click(),key:'Ctrl 3'},
    {label:'Clientes',desc:'Buscar e gerenciar clientes',icon:'♙',run:()=>$('clientsSection')?.scrollIntoView({behavior:'smooth',block:'start'}),key:'Ctrl 4'},
    {label:'Novo cliente',desc:'Cadastrar um novo cliente',icon:'+',run:()=>$('toggleFormBtn')?.click(),key:'Ctrl N'},
    {label:'Automação',desc:'WhatsApp e lembretes automáticos',icon:'◉',run:()=>document.querySelector('[data-target="autoCard"]')?.click()},
    {label:'Notificações',desc:'Abrir central de notificações',icon:'🔔',run:()=>$('notificationsNavBtn')?.click()},
    {label:'Histórico',desc:'Ver histórico de atividades',icon:'◷',run:()=>$('activityNavBtn')?.click()},
    {label:'Empresa',desc:'Configurações da empresa',icon:'⚙',run:()=>$('companyNavBtn')?.click()},
    {label:'Assinatura',desc:'Plano e assinatura do Gestor Pro',icon:'◇',run:()=>document.querySelector('[data-target="billingSection"]')?.click()},
    {label:'Sobre',desc:'Versão e atualizações',icon:'ⓘ',run:()=>$('aboutNavBtn')?.click()},
    {label:'Suporte',desc:'Central de suporte',icon:'?',run:()=>$('supportNavBtn')?.click()}
  ];

  function openPalette(){
    if(!palette)return;
    palette.classList.add('open');
    palette.setAttribute('aria-hidden','false');
    commandInput.value='';
    activeCommand=0;
    renderCommands();
    requestAnimationFrame(()=>commandInput.focus());
  }
  function closePalette(){
    palette?.classList.remove('open');
    palette?.setAttribute('aria-hidden','true');
  }

  function ensureQuickSearchTrigger(){
    if($('gpQuickSearchTrigger')) return;
    const stack=document.querySelector('#overviewSection .datetime-stack');
    if(!stack) return;
    const btn=document.createElement('button');
    btn.type='button';
    btn.id='gpQuickSearchTrigger';
    btn.className='gp-quick-search-trigger';
    btn.title='Busca rápida (Ctrl+K)';
    btn.innerHTML='<span class="gp-search-icon">⌕</span><span>Buscar</span><kbd>Ctrl K</kbd>';
    btn.addEventListener('click',openPalette);
    stack.insertBefore(btn,stack.firstChild);
  }
  ensureQuickSearchTrigger();
  function runCommand(item){
    closePalette();
    setTimeout(()=>item?.run?.(),40);
  }
  function renderCommands(){
    if(!commandResults)return;
    const term=commandInput.value.trim().toLowerCase();

    const filteredCommands=commands.filter(item=>
      !term || `${item.label} ${item.desc}`.toLowerCase().includes(term)
    );

    const matchingClients=(Array.isArray(clients)?clients:[])
      .filter(c=>{
        if(!term)return false;
        return String(c.nome||'').toLowerCase().includes(term) ||
               String(c.telefone||'').toLowerCase().includes(term) ||
               String(c.plano||'').toLowerCase().includes(term);
      })
      .slice(0,6)
      .map(c=>({
        label:c.nome||'Cliente',
        desc:`${c.plano||'Sem plano'} · ${fmtMoney(c.valor||0)} · ${displayPhone(c.telefone||'')}`,
        icon:(c.nome||'?').charAt(0).toUpperCase(),
        run:()=>{
          const search=$('search');
          if(search){search.value=c.nome||'';currentPage=1;renderList();}
          $('clientsSection')?.scrollIntoView({behavior:'smooth',block:'start'});
        }
      }));

    commandItems=[...filteredCommands,...matchingClients];
    if(activeCommand>=commandItems.length)activeCommand=0;

    let markup='';
    if(filteredCommands.length){
      markup+='<div class="gp-command-group">Ações e telas</div>';
      markup+=filteredCommands.map((item,i)=>commandMarkup(item,i)).join('');
    }
    if(matchingClients.length){
      markup+='<div class="gp-command-group">Clientes</div>';
      markup+=matchingClients.map((item,i)=>commandMarkup(item,filteredCommands.length+i)).join('');
    }
    if(!commandItems.length){
      markup='<div class="feature-empty">Nenhum resultado encontrado. Tente outro nome ou comando.</div>';
    }
    commandResults.innerHTML=markup;
  }
  function commandMarkup(item,index){
    return `<button class="gp-command-item ${index===activeCommand?'active':''}" type="button" data-gp-command-index="${index}"><span class="gp-command-icon">${esc(item.icon||'→')}</span><span class="gp-command-copy"><b>${esc(item.label)}</b><span>${esc(item.desc||'')}</span></span>${item.key?`<span class="gp-command-key">${esc(item.key)}</span>`:''}</button>`;
  }

  commandInput?.addEventListener('input',()=>{activeCommand=0;renderCommands()});
  commandResults?.addEventListener('mousemove',e=>{
    const item=e.target.closest('[data-gp-command-index]'); if(!item)return;
    activeCommand=Number(item.dataset.gpCommandIndex||0);
    commandResults.querySelectorAll('.gp-command-item').forEach((el,i)=>el.classList.toggle('active',i===activeCommand));
  });
  commandResults?.addEventListener('click',e=>{
    const item=e.target.closest('[data-gp-command-index]'); if(!item)return;
    runCommand(commandItems[Number(item.dataset.gpCommandIndex)]);
  });
  palette?.addEventListener('mousedown',e=>{if(e.target===palette)closePalette()});

  document.addEventListener('keydown',e=>{
    const key=e.key.toLowerCase();
    if(e.ctrlKey && key==='k'){e.preventDefault();openPalette();return}
    if(e.key==='Escape' && palette?.classList.contains('open')){e.preventDefault();closePalette();return}

    if(palette?.classList.contains('open')){
      if(e.key==='ArrowDown'){e.preventDefault();activeCommand=Math.min(commandItems.length-1,activeCommand+1);renderCommands();return}
      if(e.key==='ArrowUp'){e.preventDefault();activeCommand=Math.max(0,activeCommand-1);renderCommands();return}
      if(e.key==='Enter'){e.preventDefault();runCommand(commandItems[activeCommand]);return}
      return;
    }

    const target=e.target;
    const editing=target && ['INPUT','TEXTAREA','SELECT'].includes(target.tagName);
    if(e.ctrlKey && key==='n'){e.preventDefault();$('toggleFormBtn')?.click();setTimeout(()=>$('f-nome')?.focus(),100);return}
    if(e.ctrlKey && key==='f'){e.preventDefault();$('search')?.focus();$('clientsSection')?.scrollIntoView({behavior:'smooth',block:'center'});return}
    if(e.ctrlKey && !editing && ['1','2','3','4'].includes(e.key)){
      e.preventDefault();
      const cmd=commands[Number(e.key)-1];
      cmd?.run?.();
    }
  });

  // ---------- Indicador de conexão ----------
  const offlineBanner=$('gpOfflineBanner');
  let onlineHideTimer=null;
  function setConnectionBanner(){
    if(!offlineBanner)return;
    clearTimeout(onlineHideTimer);
    if(navigator.onLine){
      offlineBanner.textContent='Conexão restaurada ✓';
      offlineBanner.classList.add('show','online');
      onlineHideTimer=setTimeout(()=>offlineBanner.classList.remove('show','online'),2200);
    }else{
      offlineBanner.textContent='Sem conexão · tentando reconectar';
      offlineBanner.classList.remove('online');
      offlineBanner.classList.add('show');
    }
  }
  window.addEventListener('offline',setConnectionBanner);
  window.addEventListener('online',setConnectionBanner);
  if(!navigator.onLine)setConnectionBanner();

  // ---------- Notificação nativa diária do Windows ----------
  function maybeShowDailyWindowsNotification(){
    try{
      if(!window.api?.showDesktopNotification || !currentAuthUser || !Array.isArray(clients))return;
      const data=gpTodayData();
      const urgent=data.late.length+data.due.length+data.soon.length;
      if(!urgent)return;

      const key=`gestor_pro_windows_daily_${new Date().toISOString().slice(0,10)}`;
      if(localStorage.getItem(key))return;

      const parts=[];
      if(data.late.length)parts.push(`${data.late.length} vencido${data.late.length===1?'':'s'}`);
      if(data.due.length)parts.push(`${data.due.length} vence hoje`);
      if(data.soon.length)parts.push(`${data.soon.length} nos próximos 7 dias`);

      window.api.showDesktopNotification(
        'Resumo de cobranças do Gestor Pro',
        parts.join(' · ')
      );
      localStorage.setItem(key,'1');
    }catch(_){}
  }

  // ---------- Centro de atualização em "Sobre" ----------
  function ensureUpdateCenter(){
    const aboutBody=document.querySelector('#aboutModal .about-body');
    if(!aboutBody || $('gpUpdateCenter'))return;

    const card=document.createElement('div');
    card.className='gp-update-center';
    card.id='gpUpdateCenter';
    card.innerHTML=`
      <div class="gp-update-center-top">
        <div class="gp-update-center-copy">
          <b>Atualizações do aplicativo</b>
          <span id="gpUpdateVersionText">Verificando a versão instalada...</span>
        </div>
        <button class="gp-update-check" id="gpUpdateCheckBtn" type="button">Verificar atualização</button>
      </div>
      <div class="gp-update-status" id="gpUpdateStatus">Atualizado</div>
    `;

    const description=aboutBody.querySelector('.about-description');
    if(description)aboutBody.insertBefore(card,description);
    else aboutBody.prepend(card);

    window.api?.getAppVersion?.().then(version=>{
      if($('gpUpdateVersionText'))$('gpUpdateVersionText').textContent=`Gestor Pro ${version} • Atualizado ✓`;

      const about=$('aboutModal');
      if(about){
        const installed=about.querySelector('.about-info-card');
        const installedSmall=installed?.querySelector('small');
        if(installedSmall) installedSmall.textContent='Versão atual instalada';

        if(!$('gpAboutVersionOk')){
          const badge=about.querySelector('.about-version-badge');
          if(badge){
            const ok=document.createElement('span');
            ok.id='gpAboutVersionOk';
            ok.className='gp-about-version-ok';
            ok.textContent='Atualizado';
            badge.insertAdjacentElement('afterend',ok);
          }
        }
      }

      document.querySelectorAll('.support-version').forEach(el=>el.textContent=`Gestor Pro · v${version}`);
    }).catch(()=>{});

    $('gpUpdateCheckBtn')?.addEventListener('click',async()=>{
      const status=$('gpUpdateStatus');
      const btn=$('gpUpdateCheckBtn');
      if(status){status.textContent='Verificando atualizações...';status.className='gp-update-status busy'}
      if(btn){btn.disabled=true;btn.textContent='Verificando...'}
      try{
        const result=await window.api?.checkForUpdates?.();
        if(result?.dev){
          if(status){status.textContent='Disponível apenas no aplicativo instalado';status.className='gp-update-status'}
        }else if(result?.ok){
          if(status){status.textContent='Verificação iniciada';status.className='gp-update-status busy'}
        }else{
          if(status){status.textContent=result?.error||'Não foi possível verificar agora';status.className='gp-update-status'}
        }
      }catch(_){
        if(status){status.textContent='Não foi possível verificar agora';status.className='gp-update-status'}
      }finally{
        if(btn){btn.disabled=false;btn.textContent='Verificar atualização'}
      }
    });
  }
  ensureUpdateCenter();
  $('aboutNavBtn')?.addEventListener('click',()=>setTimeout(ensureUpdateCenter,0));

  window.api?.onUpdateStatus?.((data)=>{
    ensureUpdateCenter();
    const status=$('gpUpdateStatus');
    if(!status)return;
    const state=data?.status||'';
    if(state==='checking'){status.textContent='Verificando atualizações...';status.className='gp-update-status busy'}
    if(state==='not-available'){status.textContent='Você está na versão mais recente ✓';status.className='gp-update-status'}
    if(state==='available'){status.textContent=`Nova versão ${data?.version||''} encontrada`;status.className='gp-update-status busy'}
    if(state==='downloading'){status.textContent=`Baixando atualização · ${Math.round(Number(data?.percent||0))}%`;status.className='gp-update-status busy'}
    if(state==='downloaded'){status.textContent=`Versão ${data?.version||''} pronta para instalar`;status.className='gp-update-status ready'}
    if(state==='error'){status.textContent='Não foi possível verificar agora';status.className='gp-update-status'}
  });
})();

// ===== Gestor PRO Hoje / Central de inadimplência =====
document.getElementById('gpTodayResolveBtn')?.addEventListener('click',e=>{
  const target=e.currentTarget.dataset.target;
  if(target) document.getElementById(target)?.scrollIntoView({behavior:'smooth',block:'start'});
});
document.getElementById('gpTodayAgendaBtn')?.addEventListener('click',()=>document.getElementById('agendaSection')?.scrollIntoView({behavior:'smooth',block:'start'}));
document.getElementById('gpTodayClientsBtn')?.addEventListener('click',()=>document.getElementById('clientsSection')?.scrollIntoView({behavior:'smooth',block:'start'}));
document.getElementById('delinquencySearch')?.addEventListener('input',renderDelinquency);
document.getElementById('delinquencyFilter')?.addEventListener('change',renderDelinquency);
document.getElementById('delinquencyList')?.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-delinquency-action]');
  if(!btn)return;
  const client=clients.find(c=>c.id===btn.dataset.id);
  if(!client)return;
  if(btn.dataset.delinquencyAction==='cobrar'){
    const link=whatsappLink(client);
    if(!link){await appAlert('Este cliente não tem telefone/WhatsApp cadastrado.','WhatsApp não encontrado');return;}
    addActivity('whatsapp','Cobrança aberta pela inadimplência',`Foi preparada uma cobrança para ${client.nome}.`);
    window.open(link,'_blank');
    return;
  }
  if(btn.dataset.delinquencyAction==='cliente'){
    document.getElementById('search').value=client.nome||'';
    currentPage=1;
    renderList();
    document.getElementById('clientsSection')?.scrollIntoView({behavior:'smooth',block:'start'});
  }
});
document.getElementById('delinquencyChargeAllBtn')?.addEventListener('click',async ()=>{
  const rows=delinquencyData();
  if(!rows.length){await appAlert('Não há clientes inadimplentes para cobrar.','Tudo em dia');return;}
  const firstWithPhone=rows.find(({client})=>(client.telefone||'').replace(/\D/g,''));
  if(!firstWithPhone){await appAlert('Os clientes inadimplentes não possuem telefone/WhatsApp cadastrado.','WhatsApp não encontrado');return;}
  if(await appConfirm(`Existem ${rows.length} cliente(s) inadimplente(s). Abrir a primeira cobrança agora? As demais continuam listadas para você seguir com segurança.`,'Cobrar inadimplentes',{confirmText:'Abrir cobrança'})){
    const link=whatsappLink(firstWithPhone.client);
    if(link) window.open(link,'_blank');
  }
});
