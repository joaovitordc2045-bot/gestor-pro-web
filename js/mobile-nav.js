(function(){
  'use strict';
  if (window.__gpMobileNavV2) return;
  window.__gpMobileNavV2 = true;

  const mq = window.matchMedia('(max-width: 760px)');
  let nav, more, backdrop, moreBtn;

  const mainItems = [
    {label:'Início', icon:'⌂', selector:'.nav-item[data-target="overviewSection"]', key:'home'},
    {label:'Clientes', icon:'♙', selector:'.nav-item[data-target="clientsSection"]', key:'clients'},
    {label:'Cobranças', icon:'◉', selector:'.nav-item[data-target="autoCard"]', key:'charges'},
    {label:'Financeiro', icon:'↗', selector:'.nav-item[data-target="financialSection"]', key:'financial'}
  ];

  const moreItems = [
    {label:'Agenda', icon:'▣', selector:'.nav-item[data-target="agendaSection"]', badge:'#agendaBadge'},
    {label:'Inadimplência', icon:'!', selector:'.nav-item[data-target="delinquencySection"]', badge:'#delinquencyNavBadge'},
    {label:'Assinatura', icon:'◇', selector:'.nav-item[data-target="billingSection"]'},
    {label:'Notificações', icon:'🔔', selector:'#notificationsNavBtn', badge:'#notificationsBadge'},
    {label:'Histórico', icon:'◷', selector:'#activityNavBtn'},
    {label:'Empresa', icon:'⚙', selector:'#companyNavBtn'},
    {label:'Seja parceiro', icon:'🤝', selector:'#partnersNavBtn'},
    {label:'Administração', icon:'⚙', selector:'#adminNavBtn', admin:true},
    {label:'Sobre', icon:'ⓘ', selector:'#aboutNavBtn'},
    {label:'Suporte', icon:'?', selector:'#supportNavBtn'}
  ];

  function q(sel){ return document.querySelector(sel); }
  function triggerOriginal(selector){
    const original = q(selector);
    if (!original || original.hidden || getComputedStyle(original).display === 'none') return false;
    original.click();
    closeMore();
    setTimeout(syncActive, 20);
    return true;
  }

  function createMainButton(item){
    const btn = document.createElement('button');
    btn.type='button';
    btn.className='gp-mobile-nav-btn';
    btn.dataset.gpKey=item.key;
    btn.innerHTML='<span class="gp-mnav-icon" aria-hidden="true">'+item.icon+'</span><span class="gp-mnav-label">'+item.label+'</span>';
    btn.addEventListener('click',()=>triggerOriginal(item.selector));
    return btn;
  }

  function createMoreItem(item){
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='gp-mobile-more-item';
    btn.dataset.originalSelector=item.selector;
    btn.innerHTML='<span class="gp-more-icon" aria-hidden="true">'+item.icon+'</span><span class="gp-more-label">'+item.label+'</span>'+
      (item.badge?'<span class="gp-more-count" data-badge-source="'+item.badge+'">0</span>':'<span class="gp-more-arrow">›</span>');
    btn.addEventListener('click',()=>triggerOriginal(item.selector));
    return btn;
  }

  function build(){
    if (q('.gp-mobile-nav')) return;

    backdrop=document.createElement('div');
    backdrop.className='gp-mobile-more-backdrop';
    backdrop.addEventListener('click', closeMore);

    more=document.createElement('div');
    more.className='gp-mobile-more';
    more.setAttribute('role','dialog');
    more.setAttribute('aria-label','Mais opções');
    const head=document.createElement('div');
    head.className='gp-mobile-more-head';
    head.innerHTML='<span>Mais opções</span><button type="button" class="gp-mobile-more-close" aria-label="Fechar">×</button>';
    head.querySelector('button').addEventListener('click',closeMore);
    more.appendChild(head);
    moreItems.forEach(item=>more.appendChild(createMoreItem(item)));

    nav=document.createElement('nav');
    nav.className='gp-mobile-nav';
    nav.setAttribute('aria-label','Navegação móvel');
    mainItems.forEach(item=>nav.appendChild(createMainButton(item)));

    moreBtn=document.createElement('button');
    moreBtn.type='button';
    moreBtn.className='gp-mobile-nav-btn';
    moreBtn.dataset.gpKey='more';
    moreBtn.setAttribute('aria-expanded','false');
    moreBtn.innerHTML='<span class="gp-mnav-icon" aria-hidden="true">•••</span><span class="gp-mnav-label">Mais</span><span class="gp-mnav-badge" id="gpMoreBadge">0</span>';
    moreBtn.addEventListener('click', toggleMore);
    nav.appendChild(moreBtn);

    document.body.append(backdrop,more,nav);
    syncVisibility();
    syncBadges();
    syncActive();

    const side=q('#sideNav');
    if(side){
      const observer=new MutationObserver(()=>{syncActive();syncVisibility();syncBadges();});
      observer.observe(side,{subtree:true,attributes:true,attributeFilter:['class','style','hidden'],childList:true,characterData:true});
    }
    ['agendaBadge','delinquencyNavBadge','notificationsBadge'].forEach(id=>{
      const el=document.getElementById(id);
      if(el) new MutationObserver(syncBadges).observe(el,{subtree:true,childList:true,characterData:true,attributes:true});
    });
  }

  function openMore(){
    if(!more) return;
    more.classList.add('open');
    backdrop.classList.add('open');
    moreBtn.classList.add('gp-more-open');
    moreBtn.setAttribute('aria-expanded','true');
    syncVisibility();
    syncBadges();
  }
  function closeMore(){
    if(!more) return;
    more.classList.remove('open');
    backdrop.classList.remove('open');
    moreBtn.classList.remove('gp-more-open');
    moreBtn.setAttribute('aria-expanded','false');
  }
  function toggleMore(){ more && more.classList.contains('open') ? closeMore() : openMore(); }

  function isUsable(el){
    if(!el || el.hidden) return false;
    const s=getComputedStyle(el);
    return s.display!=='none' && s.visibility!=='hidden';
  }

  function syncVisibility(){
    if(!more) return;
    more.querySelectorAll('.gp-mobile-more-item').forEach(btn=>{
      const original=q(btn.dataset.originalSelector);
      btn.hidden=!isUsable(original);
    });
  }

  function readCount(selector){
    const el=q(selector);
    if(!el) return 0;
    const n=parseInt((el.textContent||'').replace(/\D/g,''),10);
    return Number.isFinite(n) ? n : 0;
  }

  function syncBadges(){
    if(!moreBtn) return;
    let total=0;
    document.querySelectorAll('.gp-more-count[data-badge-source]').forEach(b=>{
      const n=readCount(b.dataset.badgeSource);
      b.textContent=n>99?'99+':String(n);
      b.classList.toggle('show',n>0);
      if(b.dataset.badgeSource==='#notificationsBadge') total += n;
    });
    const badge=q('#gpMoreBadge');
    if(badge){
      badge.textContent=total>99?'99+':String(total);
      badge.classList.toggle('show',total>0);
    }
  }

  function syncActive(){
    if(!nav) return;
    const mapping={home:mainItems[0],clients:mainItems[1],charges:mainItems[2],financial:mainItems[3]};
    Object.entries(mapping).forEach(([key,item])=>{
      const proxy=nav.querySelector('[data-gp-key="'+key+'"]');
      const original=q(item.selector);
      if(proxy) proxy.classList.toggle('active',!!(original && original.classList.contains('active')));
    });
  }

  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeMore(); });
  window.addEventListener('resize',()=>{ if(!mq.matches) closeMore(); });

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',build,{once:true});
  else build();
})();
