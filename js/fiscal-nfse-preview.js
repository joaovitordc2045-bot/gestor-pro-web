(function(){
  const $=id=>document.getElementById(id); let clients=[],loaded=false;
  const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  function status(msg,type=''){const e=$('fiscalNfseStatus');if(e){e.textContent=msg||'';e.className='fiscal-save-status '+type;}}
  async function user(){const {data:{user},error}=await supabaseClient.auth.getUser();if(error||!user)throw new Error('Sua sessão expirou. Entre novamente.');return user;}
  async function load(){
    try{await user();status('Carregando seus clientes...');
      const {data,error}=await supabaseClient.from('clientes').select('id,nome,documento,plano,valor').order('nome',{ascending:true});if(error)throw error;clients=data||[];
      const sel=$('fiscalNfseClient');if(!sel)return;sel.innerHTML='<option value="">Selecione um cliente cadastrado</option>'+clients.map(c=>`<option value="${c.id}">${String(c.nome||'Cliente').replace(/</g,'&lt;')}</option>`).join('');
      loaded=true;status(clients.length?`${clients.length} cliente${clients.length===1?'':'s'} disponível${clients.length===1?'':'is'} para a prévia.`:'Nenhum cliente cadastrado no Gestor PRO.','ok');
    }catch(e){console.error(e);status(e?.message||'Não foi possível carregar os clientes.','error');}
  }
  function selected(){return clients.find(c=>String(c.id)===String($('fiscalNfseClient')?.value));}
  function invalidatePreview(){window.gpFiscalCurrentPreview=null;const b=$('fiscalSaveDraftBtn');if(b)b.disabled=true;const tax=$('fiscalPreviewTax');if(tax)tax.hidden=true;}
  function change(){invalidatePreview();const c=selected();$('fiscalNfseDocument').value=c?.documento?(window.gpFormatCpfCnpj?window.gpFormatCpfCnpj(c.documento):c.documento):'';if(c&&Number(c.valor)>0)$('fiscalNfseAmount').value=money(c.valor);}
  async function preview(ev){ev.preventDefault();const c=selected();if(!c)return status('Selecione um cliente para gerar a prévia.','error');const desc=$('fiscalNfseDescription').value.trim();if(!desc)return status('Informe a descrição do serviço.','error');const raw=$('fiscalNfseAmount').value.replace(/[^0-9,.-]/g,'').replace(/\./g,'').replace(',','.');const amount=Number(raw);if(!Number.isFinite(amount)||amount<=0)return status('Informe um valor válido para o serviço.','error');if(!$('fiscalNfseDate').value)return status('Informe a data de competência.','error');
    let company=null;try{const u=await user();const {data}=await supabaseClient.from('fiscal_company_settings').select('razao_social,nome_fantasia,cnpj_cpf,municipio,uf,codigo_municipio_ibge').eq('user_id',u.id).maybeSingle();company=data;}catch{}
    $('nfsePreviewCompany').textContent=company?.razao_social||company?.nome_fantasia||'Dados fiscais não cadastrados';$('nfsePreviewCompanyDoc').textContent=company?.cnpj_cpf||'Documento não informado';if($('nfsePreviewCompanyLocation'))$('nfsePreviewCompanyLocation').textContent=[company?.municipio,company?.uf].filter(Boolean).join(' / ')+(company?.codigo_municipio_ibge?` · IBGE ${company.codigo_municipio_ibge}`:'');$('nfsePreviewClient').textContent=c.nome||'Cliente';$('nfsePreviewClientDoc').textContent=c.documento?(window.gpFormatCpfCnpj?window.gpFormatCpfCnpj(c.documento):c.documento):'Documento não informado';$('nfsePreviewDescription').textContent=desc;$('nfsePreviewDate').textContent=new Date($('fiscalNfseDate').value+'T12:00:00').toLocaleDateString('pt-BR');$('nfsePreviewAmount').textContent=money(amount);
    const svc=(window.gpFiscalServices||[]).find(s=>String(s.id)===String($('fiscalNfseService')?.value));
    const taxBox=$('fiscalPreviewTax'), taxCode=$('nfsePreviewServiceCode'), taxMeta=$('nfsePreviewTaxMeta');
    if(taxBox){
      taxBox.hidden=false;
      if(taxCode) taxCode.textContent=svc?.service_code?`Código municipal: ${svc.service_code}`:'Código fiscal não informado';
      const parts=[];
      if(svc?.cnae) parts.push(`CNAE ${svc.cnae}`);
      if(svc?.iss_rate!=null) parts.push(`ISS ${Number(svc.iss_rate).toLocaleString('pt-BR',{maximumFractionDigits:2})}%`);
      parts.push(svc?.iss_withheld?'ISS retido':'ISS não retido');
      if(taxMeta) taxMeta.textContent=parts.join(' · ');
    }
    window.gpFiscalCurrentPreview={client_id:c.id,service_id:svc?.id||null,client_name:c.nome||'Cliente',client_document:c.documento||null,service_name:svc?.name||desc,service_description:desc,service_code:svc?.service_code||null,service_cnae:svc?.cnae||null,iss_rate:svc?.iss_rate??null,iss_withheld:!!svc?.iss_withheld,company_name:company?.razao_social||company?.nome_fantasia||null,company_document:company?.cnpj_cpf||null,company_city:company?.municipio||null,company_uf:company?.uf||null,company_ibge:company?.codigo_municipio_ibge||null,amount,competence_date:$('fiscalNfseDate').value,readiness_status:window.gpFiscalReadiness?.ready?'ready':'draft'};
    window.dispatchEvent(new CustomEvent('gp:fiscal-preview-ready',{detail:window.gpFiscalCurrentPreview}));
    $('fiscalNfsePreview').hidden=false;status('Prévia gerada. Nenhum documento fiscal foi emitido.','success');$('fiscalNfsePreview').scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  function init(){const d=$('fiscalNfseDate');if(d&&!d.value)d.value=new Date().toISOString().slice(0,10);$('fiscalNfseClient')?.addEventListener('change',change);$('fiscalNfseService')?.addEventListener('change',()=>{invalidatePreview();const x=(window.gpFiscalServices||[]).find(s=>String(s.id)===String($('fiscalNfseService').value));if(!x)return;$('fiscalNfseDescription').value=x.description||x.name||'';if(x.default_amount!=null)$('fiscalNfseAmount').value=money(x.default_amount);});['fiscalNfseDescription','fiscalNfseAmount','fiscalNfseDate'].forEach(id=>$(id)?.addEventListener('input',invalidatePreview));$('fiscalNfseForm')?.addEventListener('submit',preview);document.querySelector('[data-fiscal-tab="issue"]')?.addEventListener('click',()=>{if(!loaded)setTimeout(load,0)});document.querySelectorAll('[data-open-fiscal-tab="issue"]').forEach(b=>b.addEventListener('click',()=>{if(!loaded)setTimeout(load,0)}));$('fiscalNavBtn')?.addEventListener('click',()=>{loaded=false;});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
