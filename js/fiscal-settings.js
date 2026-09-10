(function(){
  const $=id=>document.getElementById(id);
  const fields={
    document_type:'fiscalDocumentType',cnpj_cpf:'fiscalDocument',razao_social:'fiscalLegalName',nome_fantasia:'fiscalTradeName',
    inscricao_municipal:'fiscalMunicipalRegistration',inscricao_estadual:'fiscalStateRegistration',regime_tributario:'fiscalTaxRegime',
    cep:'fiscalZip',logradouro:'fiscalStreet',numero:'fiscalNumber',complemento:'fiscalComplement',bairro:'fiscalDistrict',municipio:'fiscalCity',
    uf:'fiscalState',codigo_municipio_ibge:'fiscalIbge',email_fiscal:'fiscalEmail',telefone_fiscal:'fiscalPhone'
  };
  let loadedFor=null, hasSavedData=false, editMode=true, snapshot={};
  function status(msg,type=''){const el=$('fiscalSaveStatus');if(!el)return;el.textContent=msg||'';el.className='fiscal-save-status '+type;}
  function clean(v){v=String(v??'').trim();return v||null;}
  function fill(data={}){Object.entries(fields).forEach(([key,id])=>{const el=$(id);if(el) el.value=data[key]??'';});}
  function currentValues(){const out={};Object.entries(fields).forEach(([key,id])=>out[key]=$(id)?.value??'');return out;}
  function setLocked(locked){Object.values(fields).forEach(id=>{const el=$(id);if(el) el.disabled=locked;});}
  function renderMode(){
    const editBtn=$('fiscalEditBtn'), cancelBtn=$('fiscalCancelBtn'), saveBtn=$('fiscalSaveBtn'), badge=$('fiscalSavedBadge');
    const locked=hasSavedData&&!editMode; setLocked(locked);
    if(editBtn) editBtn.hidden=!locked;
    if(cancelBtn) cancelBtn.hidden=locked||!hasSavedData;
    if(saveBtn){saveBtn.hidden=locked;saveBtn.textContent=hasSavedData?'Salvar alterações':'Salvar dados fiscais';}
    if(badge) badge.hidden=!hasSavedData;
    $('fiscalCompanyForm')?.classList.toggle('is-locked',locked);
  }
  async function getUser(){
    if(typeof supabaseClient==='undefined'||!supabaseClient) throw new Error('Conexão com o Supabase indisponível.');
    const {data:{user},error}=await supabaseClient.auth.getUser(); if(error||!user) throw new Error('Sua sessão expirou. Entre novamente.'); return user;
  }
  async function load(){
    try{const user=await getUser(); if(loadedFor===user.id)return; status('Carregando dados fiscais...');
      const {data,error}=await supabaseClient.from('fiscal_company_settings').select('*').eq('user_id',user.id).maybeSingle();
      if(error) throw error; fill(data||{}); snapshot=currentValues(); hasSavedData=!!data; editMode=!hasSavedData; loadedFor=user.id; renderMode();
      status(data?'Cadastro fiscal salvo. Use “Editar dados fiscais” para fazer alterações.':'Preencha seus dados fiscais e clique em Salvar.','ok');
    }catch(e){console.error('Fiscal load:',e);status(e?.message||'Não foi possível carregar os dados fiscais.','error');}
  }
  async function save(ev){
    ev?.preventDefault(); if(hasSavedData&&!editMode)return; const btn=$('fiscalSaveBtn');
    try{const user=await getUser(); const payload={user_id:user.id}; Object.entries(fields).forEach(([key,id])=>payload[key]=clean($(id)?.value));
      if(payload.uf) payload.uf=payload.uf.toUpperCase();
      if(payload.document_type && !payload.cnpj_cpf) throw new Error('Informe o CNPJ/CPF.');
      if(payload.uf && payload.uf.length!==2) throw new Error('Informe a UF com 2 letras.');
      btn&&(btn.disabled=true); status('Salvando dados fiscais...');
      const {error}=await supabaseClient.from('fiscal_company_settings').upsert(payload,{onConflict:'user_id'}); if(error) throw error;
      loadedFor=user.id; hasSavedData=true; editMode=false; snapshot=currentValues(); renderMode(); status('Dados fiscais salvos com segurança.','success');
    }catch(e){console.error('Fiscal save:',e);status(e?.message||'Não foi possível salvar os dados fiscais.','error');}
    finally{btn&&(btn.disabled=false);}
  }
  function edit(){if(!hasSavedData)return; snapshot=currentValues();editMode=true;renderMode();status('Modo de edição ativado. Faça as alterações e salve.','ok');setTimeout(()=>$('fiscalDocumentType')?.focus(),0);}
  function cancel(){if(!hasSavedData)return;fill(snapshot);editMode=false;renderMode();status('Alterações canceladas.','ok');}
  function init(){
    $('fiscalCompanyForm')?.addEventListener('submit',save);
    $('fiscalEditBtn')?.addEventListener('click',edit); $('fiscalCancelBtn')?.addEventListener('click',cancel);
    $('fiscalState')?.addEventListener('input',e=>e.target.value=e.target.value.replace(/[^a-z]/gi,'').toUpperCase().slice(0,2));
    document.querySelector('[data-fiscal-tab="settings"]')?.addEventListener('click',()=>setTimeout(load,0));
    document.querySelectorAll('[data-open-fiscal-tab="settings"]').forEach(b=>b.addEventListener('click',()=>setTimeout(load,0)));
    $('fiscalNavBtn')?.addEventListener('click',()=>{loadedFor=null;});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
