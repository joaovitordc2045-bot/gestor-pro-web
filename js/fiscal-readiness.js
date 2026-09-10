(function(){
  const $=id=>document.getElementById(id);
  let company=null, loading=false, loadedUser=null;
  const digits=v=>String(v||'').replace(/\D/g,'');
  const text=v=>String(v||'').trim();
  const validAmount=()=>{
    const raw=text($('fiscalNfseAmount')?.value).replace(/[^0-9,.-]/g,'').replace(/\./g,'').replace(',','.');
    const n=Number(raw); return Number.isFinite(n)&&n>0;
  };
  async function getUser(){
    if(typeof supabaseClient==='undefined'||!supabaseClient) throw new Error('Conexão indisponível.');
    const {data:{user},error}=await supabaseClient.auth.getUser();
    if(error||!user) throw new Error('Sessão expirada.');
    return user;
  }
  async function loadCompany(force=false){
    if(loading)return;
    try{
      const u=await getUser();
      if(!force && loadedUser===u.id && company!==null)return;
      loading=true;
      const {data,error}=await supabaseClient.from('fiscal_company_settings')
        .select('cnpj_cpf,razao_social,nome_fantasia,regime_tributario,municipio,uf,codigo_municipio_ibge')
        .eq('user_id',u.id).maybeSingle();
      if(error)throw error;
      company=data||{}; loadedUser=u.id;
    }catch(e){console.error('Fiscal readiness:',e);company={};}
    finally{loading=false;render();}
  }
  function checks(){
    const clientSel=$('fiscalNfseClient');
    const serviceSel=$('fiscalNfseService');
    const companyName=text(company?.razao_social||company?.nome_fantasia);
    const companyDoc=digits(company?.cnpj_cpf);
    const city=text(company?.municipio), uf=text(company?.uf), ibge=digits(company?.codigo_municipio_ibge);
    return [
      {key:'company',label:'Cadastro fiscal da empresa',detail:'Documento, nome e regime tributário',ok:companyDoc.length>=11 && !!companyName && !!text(company?.regime_tributario),fix:'settings'},
      {key:'location',label:'Município e código IBGE',detail:'Município, UF e código oficial',ok:!!city && uf.length===2 && ibge.length>=6,fix:'settings'},
      {key:'client',label:'CPF / CNPJ do cliente',detail:'Documento cadastrado no cliente selecionado',ok:digits($('fiscalNfseDocument')?.value).length>=11},
      {key:'service',label:'Serviço prestado',detail:'Serviço fiscal selecionado',ok:!!text(serviceSel?.value)},
      {key:'tax',label:'Código fiscal do serviço',detail:'Código municipal preparado para futura integração',ok:(()=>{const svc=(window.gpFiscalServices||[]).find(s=>String(s.id)===String(serviceSel?.value));return !!text(svc?.service_code)})(),fix:'service'},
      {key:'description',label:'Descrição do serviço',detail:'Descrição do que foi prestado',ok:text($('fiscalNfseDescription')?.value).length>=3},
      {key:'amount',label:'Valor do serviço',detail:'Valor maior que zero',ok:validAmount()},
      {key:'date',label:'Data de competência',detail:'Data referente à prestação do serviço',ok:!!text($('fiscalNfseDate')?.value)}
    ];
  }
  function render(){
    const list=$('fiscalReadinessList'), badge=$('fiscalReadinessBadge'), summary=$('fiscalReadinessSummary'), settings=$('fiscalReadinessSettingsBtn');
    if(!list||!badge||!summary)return;
    const rows=checks(), done=rows.filter(x=>x.ok).length, total=rows.length, ready=done===total;
    list.innerHTML=rows.map(x=>`<div class="fiscal-readiness-item ${x.ok?'is-ok':'is-missing'}"><span class="fiscal-readiness-icon">${x.ok?'✓':'!'}</span><div><b>${x.label}</b><span>${x.detail}</span></div><em>${x.ok?'OK':'Pendente'}</em>${!x.ok&&x.fix?`<button class="fiscal-readiness-fix" type="button" data-fiscal-fix="${x.fix}">Corrigir</button>`:''}</div>`).join('');
    badge.className='fiscal-readiness-badge '+(ready?'is-ready':'is-pending');
    badge.textContent=ready?'Pronto para integrar':`${done}/${total} concluídos`;
    summary.textContent=ready?'Todos os dados essenciais estão preenchidos para a futura integração fiscal.':`Faltam ${total-done} ${total-done===1?'item':'itens'} para deixar esta preparação pronta.`;
    if(settings) settings.hidden=!rows.some(x=>!x.ok&&x.fix==='settings');
    document.getElementById('fiscalReadinessBox')?.classList.toggle('is-ready',ready);
    window.gpFiscalReadiness={ready,done,total,checks:rows};
  }
  function openSettings(){
    document.querySelector('[data-fiscal-tab="settings"]')?.click();
    setTimeout(()=>document.getElementById('fiscalCompanyForm')?.scrollIntoView({behavior:'smooth',block:'start'}),100);
  }
  function bind(){
    ['fiscalNfseClient','fiscalNfseService','fiscalNfseDescription','fiscalNfseAmount','fiscalNfseDate','fiscalNfseDocument'].forEach(id=>{
      $(id)?.addEventListener('input',render); $(id)?.addEventListener('change',()=>setTimeout(render,0));
    });
    $('fiscalReadinessSettingsBtn')?.addEventListener('click',openSettings);$('fiscalReadinessList')?.addEventListener('click',e=>{const b=e.target.closest('[data-fiscal-fix]');if(!b)return;if(b.dataset.fiscalFix==='settings')openSettings();if(b.dataset.fiscalFix==='service'){document.querySelector('[data-fiscal-tab="settings"]')?.click();setTimeout(()=>document.getElementById('fiscalServiceCode')?.scrollIntoView({behavior:'smooth',block:'center'}),120);}});
    document.querySelector('[data-fiscal-tab="issue"]')?.addEventListener('click',()=>{loadCompany(true);setTimeout(render,100);});
    document.querySelectorAll('[data-open-fiscal-tab="issue"]').forEach(b=>b.addEventListener('click',()=>{loadCompany(true);setTimeout(render,100);}));
    $('fiscalNavBtn')?.addEventListener('click',()=>{loadedUser=null;company=null;});
    window.addEventListener('gp:fiscal-preview-ready',render);
    window.addEventListener('gp:fiscal-services-loaded',render);
    // Cadastro salvo: atualiza prontidão sem depender de eventos externos.
    $('fiscalCompanyForm')?.addEventListener('submit',()=>setTimeout(()=>loadCompany(true),700));
    setTimeout(()=>{loadCompany();render();},250);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
