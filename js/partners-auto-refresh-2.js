/* ===== Parceiros · Relatório + Notificações automáticas ===== */
(function(){
  const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const dateFmt=v=>{
    if(!v)return '—';
    const d=new Date(v);
    return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR',{
      day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'
    });
  };
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  let partnerReportCommissions=[];
  let partnerNotifications=[];

  function notificationIcon(type){
    return ({
      commission_generated:'💰',
      commission_available:'✅',
      withdrawal_requested:'💸',
      withdrawal_paid:'🎉',
      withdrawal_rejected:'↩️'
    })[type]||'🔔';
  }

  function renderPartnerReport(commissions){
    partnerReportCommissions=Array.isArray(commissions)?commissions:[];
    const isAdmin=currentProfile?.role==='admin';

    const totalGenerated=partnerReportCommissions.reduce((s,r)=>s+Number(r.commission_amount||0),0);
    const totalPaid=partnerReportCommissions
      .filter(r=>r.status==='paid')
      .reduce((s,r)=>s+Number(r.commission_amount||0),0);

    const generatedLabel=document.getElementById('partnerReportGeneratedLabel');
    const paidLabel=document.getElementById('partnerReportPaidLabel');
    const countLabel=document.getElementById('partnerReportCountLabel');
    const activeLabel=document.getElementById('partnerReportActiveLabel');

    if(isAdmin){
      if(generatedLabel) generatedLabel.textContent='Comissões geradas';
      if(paidLabel) paidLabel.textContent='Comissões pagas';
      if(countLabel) countLabel.textContent='Parceiros ativos';
      if(activeLabel) activeLabel.textContent='Indicados ativos';

      document.getElementById('partnerReportGenerated').textContent=money(totalGenerated);
      document.getElementById('partnerReportPaid').textContent=money(totalPaid);

      // Na conta admin, usa a Central de Parceiros como visão geral do programa.
      const partnerCount=Number(document.getElementById('adminPartnersCount')?.textContent||0) || 0;
      const activeReferrals=Array.from(document.querySelectorAll('#adminPartnersList .admin-partner-row'))
        .reduce((sum,row)=>{
          const cells=row.querySelectorAll('.admin-partner-cell');
          for(const cell of cells){
            if(cell.querySelector('span')?.textContent.trim().toLowerCase()==='ativos'){
              return sum + (Number(cell.querySelector('b')?.textContent||0)||0);
            }
          }
          return sum;
        },0);

      document.getElementById('partnerReportCount').textContent=String(partnerCount);
      document.getElementById('partnerReportActive').textContent=String(activeReferrals);
    }else{
      if(generatedLabel) generatedLabel.textContent='Total gerado';
      if(paidLabel) paidLabel.textContent='Total recebido';
      if(countLabel) countLabel.textContent='Comissões';
      if(activeLabel) activeLabel.textContent='Indicados ativos';

      document.getElementById('partnerReportGenerated').textContent=money(totalGenerated);
      document.getElementById('partnerReportPaid').textContent=money(totalPaid);
      document.getElementById('partnerReportCount').textContent=String(partnerReportCommissions.length);

      const activeText=document.getElementById('partnerActive')?.textContent||'0';
      document.getElementById('partnerReportActive').textContent=String(Number(activeText)||0);
    }

    const now=new Date();
    const months=[];
    for(let i=5;i>=0;i--){
      const d=new Date(now.getFullYear(),now.getMonth()-i,1);
      months.push({
        key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
        label:d.toLocaleDateString('pt-BR',{month:'short'}).replace('.','').toUpperCase(),
        generated:0,
        paid:0
      });
    }

    for(const c of partnerReportCommissions){
      const d=new Date(c.created_at);
      if(Number.isNaN(d.getTime()))continue;
      const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const m=months.find(x=>x.key===key);
      if(!m)continue;
      m.generated+=Number(c.commission_amount||0);
      if(c.status==='paid')m.paid+=Number(c.commission_amount||0);
    }

    const max=Math.max(1,...months.map(m=>m.generated));
    const box=document.getElementById('partnerReportMonths');
    if(box){
      box.innerHTML=months.map(m=>`
        <div class="partner-report-month">
          <div class="partner-report-month-label">${esc(m.label)}</div>
          <div class="partner-report-bar-wrap"><div class="partner-report-bar" style="width:${Math.round((m.generated/max)*100)}%"></div></div>
          <div><span>${isAdmin?'Gerado':'Gerado'}</span><b>${money(m.generated)}</b></div>
          <div><span>${isAdmin?'Pago':'Recebido'}</span><b>${money(m.paid)}</b></div>
        </div>
      `).join('');
    }
  }
  function renderPartnerNotifications(rows){
    partnerNotifications=Array.isArray(rows)?rows:[];
    const unreadRows=partnerNotifications.filter(n=>!n.is_read);
    const unread=unreadRows.length;

    const count=document.getElementById('partnerNotifyCount');
    if(count)count.textContent=String(unread);

    const nav=document.getElementById('partnersNavBtn');
    if(nav){
      nav.classList.remove('partner-has-news');
      delete nav.dataset.partnerNews;
    }

    // Em "Novidades do parceiro" mostramos apenas notificações ainda não lidas.
    // Ao marcar como lidas, elas continuam salvas no Supabase, mas somem desta área.
    const box=document.getElementById('partnerNotifyList');
    if(!box)return;

    box.innerHTML=unreadRows.length?unreadRows.map(n=>`
      <div class="partner-notify-row unread">
        <div class="partner-notify-icon">${notificationIcon(n.type)}</div>
        <div class="partner-notify-main">
          <b>${esc(n.title||'Atualização')}</b>
          <p>${esc(n.message||'')}</p>
          <small>${dateFmt(n.created_at)}</small>
        </div>
        <div class="partner-notify-amount">${n.amount!=null?money(n.amount):''}</div>
      </div>
    `).join(''):'<div class="partner-notify-empty">✓ Você está em dia. Nenhuma novidade não lida no momento.</div>';
  }

  async function loadPartnerInsights(){
    if(!supabaseClient || !currentAuthUser)return;
    try{
      const [{data:commissions,error:cErr},{data:notifications,error:nErr}] = await Promise.all([
        supabaseClient.rpc('get_my_partner_commissions'),
        supabaseClient.rpc('get_my_partner_notifications')
      ]);

      if(cErr)throw cErr;
      if(nErr)throw nErr;

      renderPartnerReport(commissions);
      renderPartnerNotifications(notifications);
    }catch(err){
      console.warn('Relatório/notificações de parceiros indisponíveis:',err);
      const box=document.getElementById('partnerNotifyList');
      if(box)box.innerHTML='<div class="partner-notify-empty">Execute o SQL da Etapa 7 no Supabase para ativar as notificações automáticas.</div>';
    }
  }

  document.getElementById('partnerMarkReadBtn')?.addEventListener('click',async function(){
    const btn=this;
    btn.disabled=true;
    const oldText=btn.textContent;
    btn.textContent='Marcando...';
    try{
      const {error}=await supabaseClient.rpc('mark_my_partner_notifications_read');
      if(error)throw error;
      await loadPartnerInsights();
    }catch(err){
      await appAlert(String(err?.message||err),'Notificações');
    }finally{
      btn.disabled=false;
      btn.textContent=oldText;
    }
  });

  document.getElementById('partnersNavBtn')?.addEventListener('click',()=>setTimeout(loadPartnerInsights,150));

  const oldLoadHistory=window.loadPartnerHistory;
  if(typeof oldLoadHistory==='function' && !oldLoadHistory.__insightsWrapped){
    window.loadPartnerHistory=async function(){
      const r=await oldLoadHistory.apply(this,arguments);
      await loadPartnerInsights();
      return r;
    };
    window.loadPartnerHistory.__insightsWrapped=true;
  }

  // Atualização automática periódica das novidades do parceiro.
  setTimeout(loadPartnerInsights,1800);
  setInterval(()=>{
    if(currentAuthUser)loadPartnerInsights();
  },60000);

  window.loadPartnerInsights=loadPartnerInsights;
})();
