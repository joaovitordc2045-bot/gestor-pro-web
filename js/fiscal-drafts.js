(function(){
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  let drafts=[];
  let editingId=null;

  function status(msg,type=''){
    const e=$('fiscalDraftStatus');
    if(e){e.textContent=msg||'';e.className='fiscal-save-status '+type;}
  }
  async function user(){
    const {data:{user},error}=await supabaseClient.auth.getUser();
    if(error||!user) throw new Error('Sua sessão expirou. Entre novamente.');
    return user;
  }
  function fmtDate(v){
    if(!v)return '—';
    try{return new Date(String(v).slice(0,10)+'T12:00:00').toLocaleDateString('pt-BR');}catch{return v;}
  }
  function fmtDateTime(v){
    if(!v)return '—';
    try{return new Date(v).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});}catch{return '—';}
  }
  function currentPayload(){
    const p=window.gpFiscalCurrentPreview;
    if(!p) throw new Error('Gere a prévia antes de salvar o rascunho.');
    return p;
  }
  function render(){
    const list=$('fiscalDraftList');
    if(!list)return;
    $('fiscalDraftCount').textContent=String(drafts.length);
    $('fiscalDraftAmount').textContent=money(drafts.reduce((a,x)=>a+Number(x.amount||0),0));
    $('fiscalDraftLast').textContent=drafts.length?fmtDateTime(drafts[0].updated_at||drafts[0].created_at):'—';
    if(!drafts.length){
      list.innerHTML='<div class="fiscal-empty fiscal-draft-empty"><div>▧</div><h4>Nenhum rascunho salvo</h4><p>Gere uma prévia de NFS-e e salve para encontrá-la aqui.</p><span>Simulação</span></div>';
      return;
    }
    list.innerHTML=drafts.map(d=>`<article class="fiscal-draft-card" data-draft-id="${d.id}">
      <div class="fiscal-draft-main">
        <div class="fiscal-draft-icon">▤</div>
        <div class="fiscal-draft-copy">
          <div class="fiscal-draft-topline"><b>${esc(d.client_name)}</b><span class="fiscal-draft-status ${d.readiness_status==='ready'?'is-ready':'is-draft'}">${d.readiness_status==='ready'?'PRONTO PARA EMISSÃO':'RASCUNHO'}</span></div>
          <strong>${esc(d.service_name)}</strong>
          <p>${esc(d.service_description||'Sem descrição adicional')}</p>
          <div class="fiscal-draft-meta"><span>Competência <b>${fmtDate(d.competence_date)}</b></span><span>Valor <b>${money(d.amount)}</b></span></div><div class="fiscal-draft-taxline">${d.service_code?`<span>Cód. ${esc(d.service_code)}</span>`:''}${d.service_cnae?`<span>CNAE ${esc(d.service_cnae)}</span>`:''}${d.iss_rate!=null?`<span>ISS ${Number(d.iss_rate).toLocaleString('pt-BR')}%</span>`:''}<span>${d.iss_withheld?'ISS retido':'ISS não retido'}</span></div>
        </div>
      </div>
      <div class="fiscal-draft-actions">
        <button type="button" data-draft-open="${d.id}">Abrir</button>
        <button type="button" data-draft-edit="${d.id}">Editar</button>
        <button type="button" class="danger" data-draft-delete="${d.id}">Excluir</button>
      </div>
      <div class="fiscal-draft-details" id="fiscalDraftDetails-${d.id}" hidden>
        <div><small>Cliente</small><b>${esc(d.client_name)}</b><span>${esc(d.client_document||'Documento não informado')}</span></div>
        <div><small>Serviço</small><b>${esc(d.service_name)}</b><span>${esc(d.service_description||'—')}</span></div>
        <div><small>Competência</small><b>${fmtDate(d.competence_date)}</b></div>
        <div><small>Valor</small><b>${money(d.amount)}</b></div><div><small>Prestador</small><b>${esc(d.company_name||'Não informado')}</b><span>${esc(d.company_document||'Documento não informado')}</span></div><div><small>Local fiscal</small><b>${esc([d.company_city,d.company_uf].filter(Boolean).join(' / ')||'Não informado')}</b><span>${d.company_ibge?'IBGE '+esc(d.company_ibge):'IBGE não informado'}</span></div>
      </div>
    </article>`).join('');
  }
  async function loadOfficialNotes(){try{const panel=document.querySelector('[data-fiscal-panel="notes"]');if(!panel)return;let root=document.getElementById('fiscalOfficialNotes');if(!root){root=document.createElement('div');root.id='fiscalOfficialNotes';root.className='gp-official-notes';const head=panel.querySelector('.fiscal-section-head');head?.insertAdjacentElement('afterend',root)}const {data,error}=await supabaseClient.from('fiscal_notes').select('id,status,access_key,id_dps,number,client_name,service_name,amount,competence_date,authorized_at,cancelled_at,created_at').order('created_at',{ascending:false}).limit(50);if(error)throw error;const notes=data||[];root.innerHTML=`<style>.gp-official-notes{margin:14px 0 20px}.gp-note-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.gp-note-title h4{margin:0;font-size:16px}.gp-note-title span{font-size:12px;color:#75ddcb}.gp-note-list{display:grid;gap:9px}.gp-note-card{display:flex;justify-content:space-between;gap:15px;padding:13px 14px;border:1px solid rgba(83,156,160,.22);border-radius:12px;background:rgba(8,34,40,.45)}.gp-note-card>div{display:grid;gap:4px}.gp-note-card small{color:#8fa6ab}.gp-note-card em{font-style:normal;color:#62dfc9;font-size:12px}.gp-note-empty{padding:12px 14px;border:1px dashed rgba(120,160,166,.2);border-radius:10px;color:#81979b}@media(max-width:720px){.gp-note-card{display:grid}.gp-note-card em{justify-self:start}}</style><div class="gp-note-title"><h4>Notas fiscais</h4><span>${notes.length} registro${notes.length===1?'':'s'}</span></div>${notes.length?`<div class="gp-note-list">${notes.map(n=>`<article class="gp-note-card"><div><b>${esc(n.client_name||'Cliente')} · ${esc(n.service_name||'Serviço')}</b><small>${money(n.amount)} · ${fmtDate(n.competence_date)}</small><small>${n.access_key?'Chave '+esc(n.access_key):'Aguardando chave de acesso'}</small></div><em>${n.cancelled_at?'CANCELADA':String(n.status||'authorized').toUpperCase()}</em></article>`).join('')}</div>`:'<div class="gp-note-empty">Nenhuma NFS-e autorizada ainda. As simulações continuam logo abaixo.</div>'}`;}catch(e){console.error('Notas oficiais:',e)}}
  async function load(){
    try{
      await user();status('Carregando histórico...');
      const {data,error}=await supabaseClient.from('fiscal_drafts').select('id,client_id,service_id,client_name,client_document,service_name,service_description,service_code,service_cnae,iss_rate,iss_withheld,company_name,company_document,company_city,company_uf,company_ibge,amount,competence_date,status,readiness_status,created_at,updated_at').order('updated_at',{ascending:false});
      if(error)throw error;
      drafts=data||[];render();await loadOfficialNotes();status(drafts.length?`${drafts.length} rascunho${drafts.length===1?'':'s'} salvo${drafts.length===1?'':'s'}.`:'Nenhum rascunho salvo.','ok');
    }catch(e){console.error(e);status(e?.message||'Não foi possível carregar os rascunhos.','error');}
  }
  async function save(){
    try{
      const u=await user();
      const p=currentPayload();
      const payload={
        user_id:u.id,
        client_id:p.client_id||null,
        service_id:p.service_id||null,
        client_name:p.client_name,
        client_document:p.client_document||null,
        service_name:p.service_name,
        service_description:p.service_description||null,
        amount:p.amount,
        competence_date:p.competence_date,
        status:'draft',
        service_code:p.service_code||null,service_cnae:p.service_cnae||null,iss_rate:p.iss_rate??null,iss_withheld:!!p.iss_withheld,company_name:p.company_name||null,company_document:p.company_document||null,company_city:p.company_city||null,company_uf:p.company_uf||null,company_ibge:p.company_ibge||null,readiness_status:p.readiness_status==='ready'?'ready':'draft',
        updated_at:new Date().toISOString()
      };
      let error;
      if(editingId){({error}=await supabaseClient.from('fiscal_drafts').update(payload).eq('id',editingId));}
      else {({error}=await supabaseClient.from('fiscal_drafts').insert(payload));}
      if(error)throw error;
      const wasEdit=!!editingId;editingId=null;
      const btn=$('fiscalSaveDraftBtn');if(btn){btn.textContent='Salvar rascunho';btn.disabled=true;}
      const issueStatus=$('fiscalNfseStatus');if(issueStatus){issueStatus.textContent=wasEdit?'Rascunho atualizado com segurança.':'Rascunho salvo com segurança.';issueStatus.className='fiscal-save-status success';}
      await load();
      document.querySelector('[data-fiscal-tab="notes"]')?.click();
      setTimeout(()=>status(wasEdit?'Rascunho atualizado com segurança.':'Rascunho salvo com segurança.','success'),0);
    }catch(e){console.error(e);const issueStatus=$('fiscalNfseStatus');if(issueStatus){issueStatus.textContent=e?.message||'Não foi possível salvar o rascunho.';issueStatus.className='fiscal-save-status error';}}
  }
  function find(id){return drafts.find(x=>String(x.id)===String(id));}
  function open(id){
    const details=$('fiscalDraftDetails-'+id);if(!details)return;
    const willOpen=details.hidden;
    document.querySelectorAll('.fiscal-draft-details').forEach(x=>x.hidden=true);
    details.hidden=!willOpen;
  }
  async function edit(id){
    const d=find(id);if(!d)return;
    editingId=d.id;
    document.querySelector('[data-fiscal-tab="issue"]')?.click();
    await new Promise(resolve=>{let n=0;const tick=()=>{n++;const c=$('fiscalNfseClient'),sv=$('fiscalNfseService');if((!d.client_id||[...c.options].some(o=>String(o.value)===String(d.client_id)))&&(!d.service_id||[...sv.options].some(o=>String(o.value)===String(d.service_id))))return resolve();if(n>25)return resolve();setTimeout(tick,80)};tick();});
    const client=$('fiscalNfseClient');if(client){client.value=d.client_id||'';client.dispatchEvent(new Event('change',{bubbles:true}));}
    const service=$('fiscalNfseService');if(service){service.value=d.service_id||'';service.dispatchEvent(new Event('change',{bubbles:true}));}
    if($('fiscalNfseDescription'))$('fiscalNfseDescription').value=d.service_description||d.service_name||'';
    if($('fiscalNfseAmount'))$('fiscalNfseAmount').value=money(d.amount);
    if($('fiscalNfseDate'))$('fiscalNfseDate').value=String(d.competence_date||'').slice(0,10);
    if($('fiscalNfsePreview'))$('fiscalNfsePreview').hidden=true;
    const btn=$('fiscalSaveDraftBtn');if(btn){btn.textContent='Salvar alterações';btn.disabled=true;}
    const s=$('fiscalNfseStatus');if(s){s.textContent='Rascunho carregado. Ajuste os dados, gere a prévia e salve as alterações.';s.className='fiscal-save-status ok';}
  }
  async function del(id){
    const d=find(id);const ok=await window.gpConfirm({title:'Excluir rascunho?',message:d?.client_name?`A preparação fiscal de ${d.client_name} será excluída.`:'Esta preparação fiscal será excluída.',warning:'Essa ação remove apenas o rascunho e não pode ser desfeita.',confirmText:'Excluir rascunho',icon:'🗑'});if(!ok)return;
    try{const {error}=await supabaseClient.from('fiscal_drafts').delete().eq('id',id);if(error)throw error;if(editingId===id)editingId=null;await load();status('Rascunho excluído.','success');}catch(e){status(e?.message||'Não foi possível excluir o rascunho.','error');}
  }
  function newDraft(){
    editingId=null;
    document.querySelector('[data-fiscal-tab="issue"]')?.click();
    setTimeout(()=>{
      $('fiscalNfseForm')?.reset();
      if($('fiscalNfseDate'))$('fiscalNfseDate').value=new Date().toISOString().slice(0,10);
      if($('fiscalNfsePreview'))$('fiscalNfsePreview').hidden=true;
      window.gpFiscalCurrentPreview=null;
      const b=$('fiscalSaveDraftBtn');if(b){b.textContent='Salvar rascunho';b.disabled=true;}
      const s=$('fiscalNfseStatus');if(s){s.textContent='Nova preparação iniciada.';s.className='fiscal-save-status ok';}
    },100);
  }
  function init(){
    $('fiscalSaveDraftBtn')?.addEventListener('click',save);
    $('fiscalNewDraftBtn')?.addEventListener('click',newDraft);
    $('fiscalDraftList')?.addEventListener('click',e=>{
      const b=e.target.closest('[data-draft-open],[data-draft-edit],[data-draft-delete]');if(!b)return;
      if(b.dataset.draftOpen)open(b.dataset.draftOpen);
      else if(b.dataset.draftEdit)edit(b.dataset.draftEdit);
      else if(b.dataset.draftDelete)del(b.dataset.draftDelete);
    });
    document.querySelector('[data-fiscal-tab="notes"]')?.addEventListener('click',()=>setTimeout(load,0));window.addEventListener('gp:fiscal-notes-refresh',()=>loadOfficialNotes());
    document.querySelectorAll('[data-open-fiscal-tab="notes"]').forEach(b=>b.addEventListener('click',()=>setTimeout(load,0)));
    window.addEventListener('gp:fiscal-preview-ready',()=>{const b=$('fiscalSaveDraftBtn');if(b){b.disabled=false;b.textContent=editingId?'Salvar alterações':'Salvar rascunho';}});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
