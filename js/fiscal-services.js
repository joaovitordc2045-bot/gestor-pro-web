(function(){
 const $=id=>document.getElementById(id); let services=[];
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const pct=n=>n==null||n===''?'—':`${Number(n).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:2})}%`;
 function msg(t,type=''){const e=$('fiscalServiceStatus');if(e){e.textContent=t||'';e.className='fiscal-save-status '+type}}
 async function uid(){const {data:{user},error}=await supabaseClient.auth.getUser();if(error||!user)throw new Error('Sua sessão expirou.');return user.id}
 function parseMoney(v){if(!String(v||'').trim())return null;let x=String(v).replace(/[^0-9,.-]/g,'').replace(/\./g,'').replace(',','.');let n=Number(x);return Number.isFinite(n)&&n>=0?n:null}
 function parseRate(v){if(!String(v||'').trim())return null;let x=String(v).replace(/[^0-9,.-]/g,'').replace(',','.');let n=Number(x);return Number.isFinite(n)&&n>=0&&n<=100?n:null}
 function reset(){
   $('fiscalServiceId').value='';$('fiscalServiceName').value='';$('fiscalServiceAmount').value='';$('fiscalServiceDescription').value='';
   if($('fiscalServiceCode'))$('fiscalServiceCode').value=''; if($('fiscalServiceCnae'))$('fiscalServiceCnae').value=''; if($('fiscalServiceIssRate'))$('fiscalServiceIssRate').value=''; if($('fiscalServiceIssWithheld'))$('fiscalServiceIssWithheld').value='false';
   $('fiscalServiceCancel').hidden=true;$('fiscalServiceSave').textContent='+ Adicionar serviço';
 }
 function render(){
   const list=$('fiscalServiceList');
   if(list)list.innerHTML=services.length?services.map(x=>`<div class="fiscal-service-item"><div><b>${esc(x.name)}</b><span>${esc(x.description||'Sem descrição padrão')}</span><div class="fiscal-service-taxline"><small>${x.service_code?`Código: ${esc(x.service_code)}`:'Código fiscal não informado'}</small>${x.cnae?`<small>CNAE: ${esc(x.cnae)}</small>`:''}${x.iss_rate!=null?`<small>ISS: ${pct(x.iss_rate)}</small>`:''}${x.iss_withheld?'<small>ISS retido</small>':''}</div>${x.default_amount!=null?`<small>${money(x.default_amount)}</small>`:''}</div><div><button type="button" data-service-edit="${x.id}">Editar</button><button type="button" data-service-delete="${x.id}">Excluir</button></div></div>`).join(''):'<div class="fiscal-service-empty">Nenhum serviço cadastrado ainda.</div>';
   const sel=$('fiscalNfseService');if(sel){let cur=sel.value;sel.innerHTML='<option value="">Selecione um serviço cadastrado</option>'+services.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');if(services.some(x=>String(x.id)===cur))sel.value=cur}
   window.gpFiscalServices=services;window.dispatchEvent(new CustomEvent('gp:fiscal-services-loaded',{detail:services}));
 }
 async function load(){
   try{await uid();const {data,error}=await supabaseClient.from('fiscal_services').select('id,name,description,default_amount,service_code,cnae,iss_rate,iss_withheld,created_at').order('name');if(error)throw error;services=data||[];render();msg(services.length?`${services.length} serviço${services.length===1?'':'s'} cadastrado${services.length===1?'':'s'}.`:'Cadastre seu primeiro serviço fiscal.','ok')}
   catch(e){console.error(e);msg(e?.message?.includes('column')?'Atualize a estrutura fiscal no Supabase antes de usar a V19.':(e?.message||'Não foi possível carregar os serviços.'),'error')}
 }
 async function save(){
   try{
     let name=$('fiscalServiceName').value.trim();if(!name)throw new Error('Informe o nome do serviço.');
     let amount=parseMoney($('fiscalServiceAmount').value);if(String($('fiscalServiceAmount').value).trim()&&amount===null)throw new Error('Informe um valor padrão válido.');
     let rate=parseRate($('fiscalServiceIssRate')?.value);if(String($('fiscalServiceIssRate')?.value||'').trim()&&rate===null)throw new Error('Informe uma alíquota de ISS entre 0 e 100.');
     let payload={user_id:await uid(),name,description:$('fiscalServiceDescription').value.trim()||null,default_amount:amount,service_code:$('fiscalServiceCode')?.value.trim()||null,cnae:$('fiscalServiceCnae')?.value.trim()||null,iss_rate:rate,iss_withheld:$('fiscalServiceIssWithheld')?.value==='true'};
     let id=$('fiscalServiceId').value;let q=id?supabaseClient.from('fiscal_services').update(payload).eq('id',id):supabaseClient.from('fiscal_services').insert(payload);let {error}=await q;if(error)throw error;reset();await load();msg(id?'Serviço atualizado.':'Serviço adicionado.','success')
   }catch(e){msg(e?.message||'Não foi possível salvar o serviço.','error')}
 }
 async function del(id){const item=services.find(x=>String(x.id)===String(id));const ok=await window.gpConfirm({title:'Excluir serviço?',message:item?.name?`O serviço \"${item.name}\" será removido do seu cadastro fiscal.`:'Este serviço será removido do seu cadastro fiscal.',warning:'Essa ação não pode ser desfeita.',confirmText:'Excluir serviço',icon:'🗑'});if(!ok)return;try{let {error}=await supabaseClient.from('fiscal_services').delete().eq('id',id);if(error)throw error;await load();msg('Serviço excluído.','success')}catch(e){msg(e?.message||'Não foi possível excluir.','error')}}
 function edit(id){let x=services.find(s=>String(s.id)===String(id));if(!x)return;$('fiscalServiceId').value=x.id;$('fiscalServiceName').value=x.name||'';$('fiscalServiceDescription').value=x.description||'';$('fiscalServiceAmount').value=x.default_amount==null?'':money(x.default_amount);if($('fiscalServiceCode'))$('fiscalServiceCode').value=x.service_code||'';if($('fiscalServiceCnae'))$('fiscalServiceCnae').value=x.cnae||'';if($('fiscalServiceIssRate'))$('fiscalServiceIssRate').value=x.iss_rate==null?'':String(x.iss_rate).replace('.',',');if($('fiscalServiceIssWithheld'))$('fiscalServiceIssWithheld').value=x.iss_withheld?'true':'false';$('fiscalServiceCancel').hidden=false;$('fiscalServiceSave').textContent='Salvar alterações';$('fiscalServiceName').focus()}
 function init(){ $('fiscalServiceSave')?.addEventListener('click',save);$('fiscalServiceCancel')?.addEventListener('click',reset);$('fiscalServiceList')?.addEventListener('click',e=>{let b=e.target.closest('[data-service-edit],[data-service-delete]');if(!b)return;b.dataset.serviceEdit?edit(b.dataset.serviceEdit):del(b.dataset.serviceDelete)});document.querySelector('[data-fiscal-tab="settings"]')?.addEventListener('click',()=>setTimeout(load,0));document.querySelector('[data-fiscal-tab="issue"]')?.addEventListener('click',()=>setTimeout(load,0));$('fiscalQuickServiceBtn')?.addEventListener('click',()=>{document.querySelector('[data-fiscal-tab="settings"]')?.click();setTimeout(()=>{$('fiscalServiceName')?.focus();$('fiscalServiceName')?.scrollIntoView({behavior:'smooth',block:'center'})},100)});load() }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
