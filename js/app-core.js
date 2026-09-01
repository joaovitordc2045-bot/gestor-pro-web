const STORAGE_KEY = 'painel_clientes_data'; // usado só para migrar dados antigos (versão sem automação)
let clients = [];
let editingId = null;
let currentPage = 1;
let agendaDays = 7;
const pageSize = 10;
const selectedClients = new Set();
let phonesVisible = false;

// ---------------- Acesso / autenticação online (Supabase) ----------------
const SUPABASE_URL = 'https://lauedzvwxhncdcabwarl.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_0Mha1TIugXDxzdD4_zx-lw_3g0TPoXI';

const GP_IS_WEB_BROWSER = !/Electron/i.test(navigator.userAgent);
const GP_SUPABASE_STORAGE_KEY = 'sb-lauedzvwxhncdcabwarl-auth-token';

function gpSetWebSessionBootMask(active){
  if(!GP_IS_WEB_BROWSER) return;
  const gate=document.getElementById('authGate');
  if(!gate) return;
  if(active){
    gate.style.setProperty('visibility','hidden','important');
    gate.style.setProperty('pointer-events','none','important');
  }else{
    gate.style.removeProperty('visibility');
    gate.style.removeProperty('pointer-events');
  }
}

// Se o navegador já possui uma sessão Supabase salva, escondemos a tela de
// login imediatamente enquanto getSession() valida/restaura o painel.
// Assim F5 não mostra a tela de login antes de voltar para a conta.
try{
  if(GP_IS_WEB_BROWSER && localStorage.getItem(GP_SUPABASE_STORAGE_KEY)){
    gpSetWebSessionBootMask(true);
  }
}catch(_e){}

let currentAuthUser = null;
let appInitializedForUser = null;
let supabaseClient = null;
let currentProfile = null;
let adminProfiles = [];
let adminClientCounts = new Map();
let adminSelectedUserId = null;
let accessHeartbeatTimer = null;
let authReloadInProgress = false;
let passwordRecoveryMode = false;
const REMEMBER_EMAIL_KEY = 'gestor_pro_remember_email';
// Não salvamos a senha real. Quando existe uma sessão válida já lembrada pelo Supabase,
// mostramos uma máscara no campo de senha e só liberamos o painel após o clique em Entrar.
const REMEMBERED_SESSION_MASK = 'GESTOR_PRO_SESSAO_LEMBRADA';
let pendingRememberedSession = null;
const AUTH_FLASH_KEY = 'gestor_pro_auth_flash';
const RECOVERY_COOLDOWN_KEY = 'gestor_pro_recovery_cooldown_until';
let recoveryCooldownTimer=null;

// ---------------- Proteção do teste grátis ----------------
// Identificador aleatório da instalação. Não usa serial, MAC, IMEI ou hardware.
const TRIAL_INSTALLATION_KEY = 'gestor_pro_installation_id_v1';

function getTrialInstallationId(){
  try{
    let id=localStorage.getItem(TRIAL_INSTALLATION_KEY);
    if(id && id.length>=16) return id;
    id=(crypto?.randomUUID?.() || `gp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(TRIAL_INSTALLATION_KEY,id);
    return id;
  }catch(_e){
    return `gp-session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

function trialClaimSource(){
  try{
    if(window.Capacitor?.isNativePlatform?.()) return 'android';
    if(window.api) return 'desktop';
  }catch(_e){}
  return 'desktop';
}

async function claimTrialForCurrentInstallation(){
  if(!supabaseClient) throw new Error('Conexão com o Supabase indisponível.');
  const {data:{session},error:sessionError}=await supabaseClient.auth.getSession();
  if(sessionError || !session?.access_token) throw new Error('Sua sessão expirou. Entre novamente.');

  const controller=new AbortController();
  const timeoutId=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(`${SUPABASE_URL}/functions/v1/claim-trial`,{
      method:'POST',
      headers:{
        'Authorization':`Bearer ${session.access_token}`,
        'apikey':SUPABASE_PUBLISHABLE_KEY,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        installation_id:getTrialInstallationId(),
        source:trialClaimSource()
      }),
      signal:controller.signal
    });

    const text=await response.text();
    let data={};
    try{ data=text?JSON.parse(text):{}; }catch(_e){}

    if(response.status===409 && data?.decision==='denied') return data;
    if(!response.ok) throw new Error(data?.error || data?.details || `Erro HTTP ${response.status}`);
    return data;
  }catch(err){
    if(err?.name==='AbortError') throw new Error('A validação do período gratuito demorou para responder. Tente novamente.');
    throw err;
  }finally{
    clearTimeout(timeoutId);
  }
}

function authInitials(name){
  return String(name||'GP').trim().split(/\s+/).slice(0,2).map(p=>p[0]||'').join('').toUpperCase() || 'GP';
}
function setAuthMessage(message='', type='error'){
  const el=document.getElementById('authMessage');
  if(!el) return;
  el.textContent=message;
  el.className='auth-message'+(message?` show ${type}`:'');
}
function setAuthFlash(message='',type='error'){
  try{
    if(message) sessionStorage.setItem(AUTH_FLASH_KEY,JSON.stringify({message,type}));
    else sessionStorage.removeItem(AUTH_FLASH_KEY);
  }catch(_e){}
}
function consumeAuthFlash(){
  try{
    const raw=sessionStorage.getItem(AUTH_FLASH_KEY);
    if(!raw) return;
    sessionStorage.removeItem(AUTH_FLASH_KEY);
    const data=JSON.parse(raw);
    if(data?.message) setAuthMessage(data.message,data.type||'error');
  }catch(_e){}
}
function restoreRememberedEmail(){
  const emailInput=document.getElementById('loginEmail');
  const remember=document.getElementById('rememberEmail');
  if(!emailInput || !remember) return;
  try{
    const saved=localStorage.getItem(REMEMBER_EMAIL_KEY)||'';
    emailInput.value=saved;
    remember.checked=!!saved;
  }catch(_e){}
}
function persistRememberedEmail(){
  const email=(document.getElementById('loginEmail')?.value||'').trim().toLowerCase();
  const remember=!!document.getElementById('rememberEmail')?.checked;
  try{
    if(remember && email) localStorage.setItem(REMEMBER_EMAIL_KEY,email);
    else localStorage.removeItem(REMEMBER_EMAIL_KEY);
  }catch(_e){}
}

function prepareRememberedSessionLogin(session){
  pendingRememberedSession=session||null;
  const emailInput=document.getElementById('loginEmail');
  const passwordInput=document.getElementById('loginPassword');
  const remember=document.getElementById('rememberEmail');
  if(!emailInput || !passwordInput || !remember || !session?.user) return;

  let savedEmail='';
  try{ savedEmail=(localStorage.getItem(REMEMBER_EMAIL_KEY)||'').trim().toLowerCase(); }catch(_e){}
  const sessionEmail=String(session.user.email||'').trim().toLowerCase();

  // Só preenche o acesso quando o usuário já havia escolhido lembrar o e-mail.
  if(savedEmail && sessionEmail && savedEmail===sessionEmail){
    emailInput.value=sessionEmail;
    remember.checked=true;
    passwordInput.value=REMEMBERED_SESSION_MASK;
    passwordInput.dataset.rememberedSession='true';
  }
}

function clearRememberedSessionMask(){
  const passwordInput=document.getElementById('loginPassword');
  if(passwordInput?.dataset.rememberedSession==='true'){
    passwordInput.value='';
    delete passwordInput.dataset.rememberedSession;
  }
  pendingRememberedSession=null;
}

function recoveryCooldownUntil(){
  try{ return Number(localStorage.getItem(RECOVERY_COOLDOWN_KEY)||0); }catch(_e){ return 0; }
}
function setRecoveryCooldown(seconds=60){
  const until=Date.now()+(Math.max(1,Number(seconds)||60)*1000);
  try{ localStorage.setItem(RECOVERY_COOLDOWN_KEY,String(until)); }catch(_e){}
  refreshRecoveryCooldown();
}
function refreshRecoveryCooldown(){
  const submit=document.getElementById('forgotSubmit');
  if(!submit) return;
  const remaining=Math.ceil((recoveryCooldownUntil()-Date.now())/1000);
  if(remaining>0){
    submit.disabled=true;
    submit.textContent=`Aguarde ${remaining}s para reenviar`;
    if(!recoveryCooldownTimer){
      recoveryCooldownTimer=setInterval(()=>{
        const left=Math.ceil((recoveryCooldownUntil()-Date.now())/1000);
        if(left<=0){
          clearInterval(recoveryCooldownTimer);
          recoveryCooldownTimer=null;
          try{ localStorage.removeItem(RECOVERY_COOLDOWN_KEY); }catch(_e){}
        }
        refreshRecoveryCooldown();
      },1000);
    }
  }else{
    if(recoveryCooldownTimer){ clearInterval(recoveryCooldownTimer); recoveryCooldownTimer=null; }
    submit.disabled=false;
    submit.textContent='Enviar link de recuperação';
  }
}

function setAuthView(view){
  const gate=document.getElementById('authGate');
  if(!gate) return;
  gate.dataset.view=view;
  document.querySelectorAll('[data-auth-view]').forEach(btn=>btn.classList.toggle('active',btn.classList.contains('auth-tab') && btn.dataset.authView===view));
  setAuthMessage('');
  if(view==='forgot'){
    refreshRecoveryCooldown();
    const forgot=document.getElementById('forgotEmail');
    const login=document.getElementById('loginEmail');
    if(forgot && !forgot.value) forgot.value=(login?.value||localStorage.getItem(REMEMBER_EMAIL_KEY)||'').trim();
  }
  const focusId={register:'registerName',login:'loginEmail',forgot:'forgotEmail',reset:'newPassword'}[view]||'loginEmail';
  setTimeout(()=>document.getElementById(focusId)?.focus(),40);
}
function updateAccountChip(user){
  const chip=document.getElementById('accountChip');
  if(!chip) return;
  document.getElementById('accountAvatar').textContent=authInitials(user?.name);
  document.getElementById('accountName').textContent=user?.name || 'Conta';
  document.getElementById('accountEmail').textContent=user?.email || '—';
  chip.classList.toggle('show',!!user);
}
function mapSupabaseUser(user){
  if(!user) return null;
  const meta=user.user_metadata || {};
  return {
    id:user.id,
    email:user.email || '',
    name:meta.name || meta.full_name || (user.email ? user.email.split('@')[0] : 'Conta'),
    business:meta.business || '',
    createdAt:user.created_at || ''
  };
}
function authRateLimitKind(error){
  const raw=String(error?.message || error || '').toLowerCase();
  const code=String(error?.code || '').toLowerCase();

  if(
    code==='over_email_send_rate_limit' ||
    raw.includes('email rate limit') ||
    raw.includes('too many emails') ||
    raw.includes('email send rate')
  ) return 'email';

  if(
    code==='over_request_rate_limit' ||
    raw.includes('too many requests') ||
    raw.includes('429') ||
    raw.includes('rate limit')
  ) return 'request';

  return '';
}

function friendlyAuthError(error){
  const raw=String(error?.message || error || '').toLowerCase();
  if(raw.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if(raw.includes('email not confirmed')) return 'Seu e-mail ainda não foi confirmado. Abra a mensagem enviada pelo Gestor Pro e confirme sua conta.';
  if(raw.includes('user already registered')) return 'Já existe uma conta cadastrada com este e-mail.';
  if(raw.includes('password should be')) return 'A senha não atende aos requisitos de segurança.';
  if(authRateLimitKind(error)==='email') return 'O envio de e-mail está temporariamente indisponível. Aguarde alguns minutos e tente novamente.';
  if(authRateLimitKind(error)==='request') return 'O serviço está temporariamente ocupado. Aguarde alguns instantes e tente novamente.';
  if(raw.includes('expired') && (raw.includes('otp') || raw.includes('token'))) return 'Este link de recuperação expirou. Solicite um novo link.';
  if(raw.includes('invalid') && (raw.includes('otp') || raw.includes('token'))) return 'Este link de recuperação é inválido ou já foi usado. Solicite um novo link.';
  if(raw.includes('failed to fetch') || raw.includes('network')) return 'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';
  return error?.message || 'Não foi possível concluir a autenticação.';
}
function profileTableMissing(error){
  const raw=String(error?.message||error||'').toLowerCase();
  return raw.includes('profiles') && (raw.includes('does not exist') || raw.includes('schema cache') || raw.includes('could not find'));
}
function setAdminVisibility(enabled){
  document.querySelectorAll('.admin-only').forEach(el=>el.classList.toggle('admin-visible',!!enabled));
  document.getElementById('accountAdminTag')?.classList.toggle('show',!!enabled);
  if(!enabled && document.getElementById('adminUserModal')) document.getElementById('adminUserModal').style.display='none';
}
function trialState(profile){
  if(!profile || profile.role==='admin') return {expired:false,days:null,end:null};
  if(profile.subscription_status!=='trial') return {expired:false,days:null,end:profile.trial_end?new Date(profile.trial_end):null};
  const end=profile.trial_end?new Date(profile.trial_end):null;
  if(!end || Number.isNaN(end.getTime())) return {expired:true,days:0,end:null};
  const diff=end.getTime()-Date.now();
  return {expired:diff<=0,days:Math.max(0,Math.ceil(diff/86400000)),end};
}
function effectiveSubscriptionStatus(profile){
  if(!profile) return 'unknown';
  if(profile.role==='admin') return 'paid';
  if(profile.subscription_status==='trial' && trialState(profile).expired) return 'overdue';
  return profile.subscription_status||'trial';
}
function accessDenialMessage(profile){
  if(!profile) return 'Não foi possível validar sua assinatura. Entre em contato com o responsável pelo Gestor Pro.';
  if(profile.status==='blocked') return 'Sua conta está bloqueada. Entre em contato com o responsável pelo Gestor Pro.';
  if(profile.role==='admin') return '';
  const sub=effectiveSubscriptionStatus(profile);
  if(sub==='paid') return '';
  if(sub==='trial' && !trialState(profile).expired) return '';
  if(profile.trial_eligibility==='denied') return 'O período gratuito já foi utilizado neste dispositivo ou houve várias avaliações recentes nesta rede. Para continuar, ative um plano do Gestor Pro.';
  if(sub==='canceled') return 'Sua assinatura está inativa. Ative um plano do Gestor Pro para continuar.';
  return 'Seu período grátis de 7 dias terminou. Para continuar usando o Gestor Pro, sua assinatura precisa ser ativada.';
}

const BILLING_PLANS={
  mensal:{key:'mensal',label:'Mensal',amount:49.90,months:1,period:'1 mês de acesso'},
  semestral:{key:'semestral',label:'Semestral',amount:269.90,months:6,period:'6 meses de acesso'},
  anual:{key:'anual',label:'Anual',amount:479.90,months:12,period:'12 meses de acesso'}
};
let selectedBillingPlan='mensal';
let pixStatusTimer=null;
let pixStatusStartedAt=0;
function billingPlanKey(profile){ const k=String(profile?.billing_cycle||'').toLowerCase(); return BILLING_PLANS[k]?k:'mensal'; }
function billingPlanInfo(key=selectedBillingPlan){ return BILLING_PLANS[key]||BILLING_PLANS.mensal; }
function billingPriceValue(profile){
  if(profile?.role==='admin') return 0;
  const value=Number(profile?.monthly_price);
  return Number.isFinite(value) && value>=0 ? value : 49.90;
}
function billingMoney(value){ return Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
function setSelectedBillingPlan(key){
  if(!BILLING_PLANS[key]) return;
  selectedBillingPlan=key;
  const info=billingPlanInfo(key);
  document.querySelectorAll('[data-billing-plan]').forEach(btn=>btn.classList.toggle('selected',btn.dataset.billingPlan===key));
  const topPrice=document.getElementById('billingPrice'); if(topPrice) topPrice.textContent=billingMoney(info.amount);
  const topPeriod=document.getElementById('billingPricePeriod'); if(topPeriod) topPeriod.textContent=`plano ${info.label.toLowerCase()}`;
  const gatePrice=document.getElementById('billingGatePrice'); if(gatePrice) gatePrice.textContent=billingMoney(info.amount);
  const gatePeriod=document.getElementById('billingGatePeriod'); if(gatePeriod) gatePeriod.textContent=info.period;
  const gateLabel=document.getElementById('billingGateSelectedLabel'); if(gateLabel) gateLabel.textContent=`Você escolheu: ${info.label}`;
  const mainBtn=document.getElementById('billingSubscribeBtn'); if(mainBtn && !mainBtn.disabled) mainBtn.textContent=`Gerar Pix · ${info.label} ${billingMoney(info.amount)}`;
  const gateBtn=document.getElementById('billingGateSubscribeBtn'); if(gateBtn && !gateBtn.disabled) gateBtn.textContent=`Gerar Pix · ${info.label}`;
  const modalPrice=document.getElementById('billingModalPrice'); if(modalPrice) modalPrice.textContent=billingMoney(info.amount);
}
function stopPixStatusPolling(){ if(pixStatusTimer){clearTimeout(pixStatusTimer);pixStatusTimer=null;} }
function billingOnlyState(profile){
  if(!profile || profile.role==='admin' || profile.status!=='active') return false;
  const sub=effectiveSubscriptionStatus(profile);
  return sub==='overdue' || sub==='canceled';
}
function renderBillingSection(profile){
  if(!profile) return;
  const billingSection=document.getElementById('billingSection');
  billingSection?.classList.toggle('owner-compact', profile.role==='admin');
  const sub=effectiveSubscriptionStatus(profile);
  const price=billingPriceValue(profile);
  const state=document.getElementById('billingState');
  const plan=document.getElementById('billingPlan');
  const renewal=document.getElementById('billingRenewal');
  const access=document.getElementById('billingAccess');
  const cycle=document.getElementById('billingCycle');
  const priceEl=document.getElementById('billingPrice');
  const btn=document.getElementById('billingSubscribeBtn');
  const note=document.getElementById('billingNote');
  const progress=document.getElementById('billingProgressWrap');
  const progressText=document.getElementById('billingProgressText');
  const progressFill=document.getElementById('billingProgressFill');
  const billingTop=document.querySelector('#billingSection .billing-top');
  const billingTopTitle=billingTop?.querySelector('h2');
  const billingTopText=billingTop?.querySelector('p');
  if(billingTopTitle) billingTopTitle.textContent=profile.role==='admin'?'Conta proprietária':'Seu plano Gestor Pro';
  if(billingTopText) billingTopText.textContent=profile.role==='admin'
    ?'Acesso administrativo permanente ao Gestor Pro, sem vencimento e sem cobrança.'
    :'Acompanhe seu período de teste, situação da assinatura e próxima renovação.';
  if(profile.role==='admin'){ if(priceEl) priceEl.textContent='Acesso permanente'; } else { if(sub==='paid') selectedBillingPlan=billingPlanKey(profile); setSelectedBillingPlan(selectedBillingPlan); }
  if(plan) plan.textContent=profile.role==='admin'?'Conta proprietária':(profile.plan==='free'?'Gestor Pro':`Gestor Pro · ${adminPlanLabel(profile.plan)}`);
  if(state){ state.className=`billing-state ${profile.role==='admin'?'owner':sub}`; state.textContent=profile.role==='admin'?'Proprietário':adminSubscriptionLabel(sub); }
  if(access) access.textContent=profile.status==='blocked'?'Bloqueado':billingOnlyState(profile)?'Aguardando renovação':'Liberado';
  if(profile.role==='admin'){
    if(renewal) renewal.textContent='Sem vencimento';
    if(cycle) cycle.textContent='Permanente';
    document.querySelectorAll('[data-billing-plan]').forEach(b=>b.disabled=true);
    if(progress) progress.style.display='none';
    if(btn){btn.textContent='Conta proprietária';btn.disabled=true;}
    if(note) note.textContent='Sua conta administrativa não possui cobrança.';
    return;
  }
  document.querySelectorAll('[data-billing-plan]').forEach(b=>b.disabled=false);
  if(sub==='trial'){
    if(cycle) cycle.textContent=billingPlanInfo(selectedBillingPlan).label;
    const t=trialState(profile);
    if(renewal) renewal.textContent=t.end?t.end.toLocaleDateString('pt-BR'):'—';
    if(progress) progress.style.display='block';
    const days=Math.max(0,Number(t.days||0));
    if(progressText) progressText.textContent=days===1?'1 dia restante':`${days} dias restantes`;
    const pct=Math.max(0,Math.min(100,(days/7)*100));
    if(progressFill){progressFill.style.width=`${pct}%`;progressFill.classList.toggle('warning',days<=2);}
    if(btn){btn.disabled=false;setSelectedBillingPlan(selectedBillingPlan);}
    if(note) note.textContent='Assine antes do fim do teste para continuar usando o sistema sem interrupção.';
  }else if(sub==='paid'){
    if(cycle) cycle.textContent=billingPlanInfo(billingPlanKey(profile)).label;
    const end=profile.current_period_end?new Date(profile.current_period_end):null;
    if(renewal) renewal.textContent=end&&!Number.isNaN(end.getTime())?end.toLocaleDateString('pt-BR'):'Assinatura ativa';
    if(progress) progress.style.display='none';
    if(btn){btn.disabled=false;setSelectedBillingPlan(selectedBillingPlan);}
    if(note) note.textContent='Seu acesso está ativo. Você pode estender o período agora; os novos meses serão somados ao vencimento atual.';
  }else{
    if(cycle) cycle.textContent=billingPlanInfo(selectedBillingPlan).label;
    const end=profile.current_period_end||profile.trial_end;
    const d=end?new Date(end):null;
    if(renewal) renewal.textContent=d&&!Number.isNaN(d.getTime())?`Venceu em ${d.toLocaleDateString('pt-BR')}`:'Vencida';
    if(progress) progress.style.display='none';
    if(btn){btn.disabled=false;setSelectedBillingPlan(selectedBillingPlan);}
    if(note) note.textContent='Seus dados continuam protegidos. Reative a assinatura para recuperar o acesso.';
  }
}
function showBillingGate(profile){
  const gate=document.getElementById('billingGate');
  if(!gate || !profile) return;
  renderBillingSection(profile);
  const sub=effectiveSubscriptionStatus(profile);
  const trialDenied=profile.trial_eligibility==='denied';
  document.getElementById('billingGateBadge').textContent=trialDenied?'Teste grátis já utilizado':sub==='canceled'?'Assinatura inativa':'Período encerrado';
  document.getElementById('billingGateTitle').textContent=trialDenied?'Ative seu Gestor Pro':sub==='canceled'?'Ative sua assinatura':'Seu período grátis terminou';
  document.getElementById('billingGateText').textContent=trialDenied
    ?'Esta instalação ou rede já utilizou uma avaliação gratuita. Seus dados permanecem protegidos. Ative um plano para liberar o acesso completo.'
    :sub==='canceled'
      ?'Sua assinatura está inativa. Seus dados permanecem protegidos e serão liberados quando um plano for ativado.'
      :'Os 7 dias grátis terminaram. Seus dados continuam protegidos e o acesso completo volta assim que a assinatura for ativada.';
  if(sub==='paid') selectedBillingPlan=billingPlanKey(profile);
  setSelectedBillingPlan(selectedBillingPlan);
  gate.classList.remove('hidden');
}
function hideBillingGate(){ document.getElementById('billingGate')?.classList.add('hidden'); }
let pendingPixCode = '';

function setPaymentModalState(title,text,status,showPix=false){
  const modal=document.getElementById('billingPaymentModal');
  const titleEl=document.getElementById('billingPaymentTitle');
  const textEl=document.getElementById('billingPaymentText');
  const statusEl=document.getElementById('billingPaymentStatus');
  const priceEl=document.getElementById('billingModalPrice');
  const pixArea=document.getElementById('billingPixArea');
  if(priceEl) priceEl.textContent=billingMoney(billingPlanInfo().amount);
  if(titleEl) titleEl.textContent=title;
  if(textEl) textEl.textContent=text;
  if(statusEl) statusEl.textContent=status;
  if(pixArea) pixArea.style.display=showPix?'block':'none';
  if(modal) modal.style.display='flex';
}

async function copyPixCode(){
  if(!pendingPixCode) return;
  try{
    await navigator.clipboard.writeText(pendingPixCode);
    const btn=document.getElementById('billingPixCopyBtn');
    if(btn){const old=btn.textContent;btn.textContent='Código Pix copiado ✓';setTimeout(()=>btn.textContent=old,1800);}
  }catch(_){
    prompt('Copie o código Pix:',pendingPixCode);
  }
}

async function checkPixPaymentStatus(paymentId){
  if(!supabaseClient) throw new Error('Conexão com o Supabase não iniciada.');
  const {data:{session},error:sessionError}=await supabaseClient.auth.getSession();
  if(sessionError || !session?.access_token) throw new Error('Sua sessão expirou. Entre novamente no Gestor Pro.');
  const response=await fetch(`${SUPABASE_URL}/functions/v1/verificar-pagamento-pix`,{
    method:'POST',
    headers:{
      'Authorization':`Bearer ${session.access_token}`,
      'apikey':SUPABASE_PUBLISHABLE_KEY,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({payment_id:paymentId})
  });
  const text=await response.text();
  let data={}; try{data=text?JSON.parse(text):{};}catch(_){data={error:text||'Resposta inválida da verificação.'};}
  if(!response.ok || data?.error) throw new Error(data?.error || `Erro HTTP ${response.status}`);
  return data;
}
function showPixApproved(data){
  stopPixStatusPolling();
  const pixArea=document.getElementById('billingPixArea'); if(pixArea) pixArea.style.display='none';
  const info=billingPlanInfo(data?.plan||selectedBillingPlan);
  const title=document.getElementById('billingPaymentTitle'); if(title) title.textContent='Pagamento confirmado ✓';
  const text=document.getElementById('billingPaymentText'); if(text) text.textContent=`O Mercado Pago confirmou seu Pix. O plano ${info.label} foi aplicado com sucesso.`;
  const status=document.getElementById('billingPaymentStatus');
  const end=data?.current_period_end||data?.new_period_end||data?.profile?.current_period_end;
  if(status) status.textContent=end?`Acesso liberado até ${new Date(end).toLocaleDateString('pt-BR')}.`:`Plano ${info.label} ativado.`;
  const price=document.getElementById('billingModalPrice'); if(price) price.textContent='Pagamento aprovado';
  const close=document.getElementById('billingPaymentCloseBtn'); if(close) close.textContent='Entrar no Gestor Pro';
}
async function startPixStatusPolling(paymentId){
  stopPixStatusPolling();
  pixStatusStartedAt=Date.now();
  const run=async()=>{
    try{
      const data=await checkPixPaymentStatus(paymentId);
      if(data?.approved){
        showPixApproved(data);
        const fresh=await fetchCurrentProfile();
        if(fresh){currentProfile=fresh;await enterApp(currentAuthUser,fresh);}
        return;
      }
      const status=document.getElementById('billingPaymentStatus');
      if(status) status.textContent=data?.status==='rejected'?'Pagamento não aprovado. Gere um novo Pix.':'Aguardando confirmação do Mercado Pago…';
      if(data?.status==='rejected'||data?.status==='cancelled') return;
    }catch(err){ console.warn('Verificação do Pix:',err); }
    if(Date.now()-pixStatusStartedAt<10*60*1000) pixStatusTimer=setTimeout(run,4000);
    else{const status=document.getElementById('billingPaymentStatus');if(status)status.textContent='A confirmação está demorando. Você pode fechar esta janela e tentar novamente depois.';}
  };
  run();
}

async function startMercadoPagoCheckout(planKey=selectedBillingPlan){
  if(BILLING_PLANS[planKey]) selectedBillingPlan=planKey;
  const info=billingPlanInfo();
  pendingPixCode='';
  stopPixStatusPolling();
  const mainBtn=document.getElementById('billingSubscribeBtn');
  const gateBtn=document.getElementById('billingGateSubscribeBtn');
  const buttons=[mainBtn,gateBtn].filter(Boolean);
  const labels=buttons.map(btn=>btn.textContent);
  buttons.forEach(btn=>{btn.disabled=true;btn.textContent='Gerando Pix...';});

  setPaymentModalState('Gerando Pix',`Estamos preparando o Pix do plano ${info.label}. Aguarde alguns segundos.`,'Conectando ao Mercado Pago...');

  try{
    if(!supabaseClient) throw new Error('Conexão com o Supabase não iniciada.');
    const {data:{session},error:sessionError}=await supabaseClient.auth.getSession();
    if(sessionError || !session?.access_token) throw new Error('Sua sessão expirou. Entre novamente no Gestor Pro.');

    const controller=new AbortController();
    const timeoutId=setTimeout(()=>controller.abort(),20000);
    let response;
    try{
      response=await fetch(`${SUPABASE_URL}/functions/v1/criar-pagamento-pix`,{
        method:'POST',
        headers:{
          'Authorization':`Bearer ${session.access_token}`,
          'apikey':SUPABASE_PUBLISHABLE_KEY,
          'Content-Type':'application/json'
        },
        body:JSON.stringify({plan:selectedBillingPlan,source:'gestor-pro-desktop'}),
        signal:controller.signal
      });
    }catch(fetchError){
      if(fetchError?.name==='AbortError') throw new Error('A função de pagamento demorou mais de 20 segundos para responder.');
      throw fetchError;
    }finally{clearTimeout(timeoutId);}

    const responseText=await response.text();
    let data={};
    try{data=responseText?JSON.parse(responseText):{};}catch(_){data={error:responseText||'Resposta inválida da Edge Function.'};}
    if(!response.ok){
      let message=data?.error||data?.message||`Erro HTTP ${response.status}`;
      if(data?.details?.message) message+=` (${data.details.message})`;
      throw new Error(message);
    }
    if(data?.error) throw new Error(data.error);

    const pixCode=data?.pix?.copia_e_cola||data?.qr_code||'';
    const qrBase64=data?.pix?.qr_code_base64||data?.qr_code_base64||'';
    if(!pixCode&&!qrBase64) throw new Error('O Mercado Pago não devolveu os dados do Pix.');

    pendingPixCode=pixCode;
    const qr=document.getElementById('billingPixQr');
    const code=document.getElementById('billingPixCode');
    if(qr){if(qrBase64){qr.src=qrBase64.startsWith('data:')?qrBase64:`data:image/png;base64,${qrBase64}`;qr.style.display='inline-block';}else qr.style.display='none';}
    if(code){code.value=pixCode;code.style.display=pixCode?'block':'none';}

    setPaymentModalState(
      'Pix pronto para pagamento',
      `Pague ${billingMoney(info.amount)} pelo aplicativo do seu banco. Este Pix ativa o plano ${info.label} e não cria cobrança automática.`,
      `Após a confirmação, seu acesso será estendido por ${info.months===1?'1 mês':info.months+' meses'}.`,
      true
    );
    if(data?.payment_id) startPixStatusPolling(data.payment_id);
  }catch(err){
    console.error('Falha ao gerar Pix:',err);
    setPaymentModalState('Não foi possível gerar o Pix',err?.message||'Ocorreu um erro ao criar o pagamento Pix.','Confira Supabase → Edge Functions → criar-pagamento-pix → Logs.');
  }finally{
    buttons.forEach((btn,i)=>{btn.disabled=false;btn.textContent=labels[i]||'Gerar Pix';});
    setSelectedBillingPlan(selectedBillingPlan);
  }
}
function closePaymentPreview(){ stopPixStatusPolling(); const modal=document.getElementById('billingPaymentModal'); if(modal) modal.style.display='none'; const close=document.getElementById('billingPaymentCloseBtn'); if(close) close.textContent='Fechar'; }
async function enterBillingOnly(user,profile){
  currentAuthUser=user;
  currentProfile=profile;
  updateAccountChip(user);
  setAdminVisibility(false);
  renderSubscriptionBanner(profile);
  renderBillingSection(profile);
  clients=[];
  selectedClients.clear();
  try{ render(); }catch(_e){}
  document.getElementById('authGate')?.classList.add('hidden');
  showBillingGate(profile);
  clearInterval(accessHeartbeatTimer);
  accessHeartbeatTimer=setInterval(refreshAccountAccess,60000);
}

function renderSubscriptionBanner(profile){
  const box=document.getElementById('subscriptionBanner');
  if(!box){ return; }
  if(!profile){ box.classList.remove('show','warning'); return; }
  const title=document.getElementById('subscriptionTitle');
  const text=document.getElementById('subscriptionText');
  const pill=document.getElementById('subscriptionPill');
  const date=document.getElementById('subscriptionDate');
  box.classList.add('show'); box.classList.remove('warning');
  const plan=adminPlanLabel(profile.plan);
  const sub=effectiveSubscriptionStatus(profile);
  if(profile.role==='admin'){
    title.textContent='Conta proprietária'; text.textContent='Acesso administrativo permanente ao Gestor Pro.';
    pill.textContent='Proprietário'; pill.className='subscription-pill owner'; date.textContent='Sem vencimento'; return;
  }
  if(sub==='paid'){
    const paidEnd=profile.current_period_end?new Date(profile.current_period_end):null;
    const paidEndValid=paidEnd&&!Number.isNaN(paidEnd.getTime());
    title.textContent='Gestor Pro';
    text.textContent=paidEndValid
      ? `Seu acesso está ativo até ${paidEnd.toLocaleDateString('pt-BR')}.`
      : 'Seu pagamento está ativo e o acesso está liberado.';
    pill.textContent='Ativa';
    pill.className='subscription-pill paid';
    date.textContent=paidEndValid
      ? `Ativo até ${paidEnd.toLocaleDateString('pt-BR')}`
      : 'Acesso ativo';
    return;
  }
  const t=trialState(profile);
  if(sub==='trial' && !t.expired){
    title.textContent='Período de teste grátis';
    text.textContent=t.days===0?'Seu teste termina hoje.':t.days===1?'Resta 1 dia do seu teste gratuito.':`Restam ${t.days} dias do seu teste gratuito.`;
    pill.textContent='Teste'; pill.className='subscription-pill trial';
    date.textContent=t.end?`Até ${t.end.toLocaleDateString('pt-BR')}`:'Data não definida';
    if(t.days<=2) box.classList.add('warning');
    return;
  }
  title.textContent='Assinatura necessária'; text.textContent='Seu acesso precisa ser renovado para continuar usando o Gestor Pro.';
  pill.textContent=sub==='canceled'?'Cancelada':'Vencida'; pill.className='subscription-pill overdue';
  date.textContent=profile.trial_end?`Venceu em ${new Date(profile.trial_end).toLocaleDateString('pt-BR')}`:'Acesso indisponível'; box.classList.add('warning');
}
async function syncCurrentSubscription(){
  if(!supabaseClient || !currentAuthUser) return;
  try{ await supabaseClient.rpc('sync_my_subscription_status'); }catch(err){ console.warn('Não foi possível sincronizar a assinatura:',err); }
}
async function fetchCurrentProfile(){
  if(!supabaseClient || !currentAuthUser) return null;
  const {data,error}=await supabaseClient.from('profiles')
    .select('*')
    .eq('id',currentAuthUser.id).maybeSingle();
  if(error){
    if(profileTableMissing(error)) return null;
    throw error;
  }
  return data||null;
}
async function touchLastSeen(){
  if(!supabaseClient || !currentProfile) return;
  try{ await supabaseClient.rpc('touch_last_seen'); }catch(_e){}
}
async function syncPartnerReferralFromAccount(){
  if(!supabaseClient) return {ok:false,skipped:true};

  try{
    const {data:userData,error:userError}=await supabaseClient.auth.getUser();
    if(userError || !userData?.user) return {ok:false,skipped:true};

    const rawUser=userData.user;
    const partnerCode=String(rawUser.user_metadata?.partner_code||'').trim().toUpperCase();
    if(!partnerCode) return {ok:true,skipped:true};

    // apply_partner_referral é idempotente: se a conta já estiver vinculada,
    // o banco apenas devolve o vínculo existente.
    const {data,error}=await supabaseClient.rpc('apply_partner_referral',{p_code:partnerCode});
    if(error) throw error;

    // O Supabase mescla metadados; por isso definimos partner_code como null
    // para realmente limpar o valor após o primeiro vínculo confirmado.
    try{
      await supabaseClient.auth.updateUser({
        data:{partner_code:null}
      });
    }catch(_e){}

    // Se a conta já estava vinculada, não mostramos a confirmação novamente.
    return {
      ok:true,
      linked:!data?.already_linked,
      alreadyLinked:!!data?.already_linked,
      code:data?.referral_code||partnerCode
    };
  }catch(err){
    console.warn('Não foi possível aplicar o código de parceiro:',err);
    return {ok:false,error:err};
  }
}

async function authorizeSignedInUser(user){
  currentAuthUser=user;

  let profile=null;
  try{
    profile=await fetchCurrentProfile();

    // Nova conta: o teste só começa depois da confirmação de e-mail
    // e depois que o servidor valida esta instalação.
    if(
      profile &&
      profile.role!=='admin' &&
      profile.status==='active' &&
      profile.trial_eligibility==='pending' &&
      profile.subscription_status!=='paid'
    ){
      try{
        await claimTrialForCurrentInstallation();
      }catch(err){
        console.error('Falha ao validar período gratuito:',err);
        setAuthFlash(err?.message || 'Não foi possível validar seu período gratuito. Tente novamente.','error');
        authReloadInProgress=true;
        await supabaseClient.auth.signOut();
        window.location.reload();
        return false;
      }

      profile=await fetchCurrentProfile();
    }

    await syncCurrentSubscription();
    profile=await fetchCurrentProfile();
  }catch(err){
    console.warn('Não foi possível carregar/validar o perfil:',err);
  }

  const denial=accessDenialMessage(profile);
  if(!profile || profile.status==='blocked'){
    setAuthFlash(denial||'Não foi possível validar sua conta.','error');
    authReloadInProgress=true;
    await supabaseClient.auth.signOut();
    window.location.reload();
    return false;
  }
  const partnerReferralResult=await syncPartnerReferralFromAccount();

  if(billingOnlyState(profile)){
    await enterBillingOnly(user,profile);
    if(partnerReferralResult?.error){
      setTimeout(()=>appAlert(
        'Sua conta foi criada normalmente, mas o código de parceiro informado não pôde ser vinculado.\n\n'+String(partnerReferralResult.error?.message||'Código inválido ou inativo.'),
        'Código de parceiro'
      ),350);
    }
    return true;
  }
  if(denial){
    setAuthFlash(denial,'error');
    authReloadInProgress=true;
    await supabaseClient.auth.signOut();
    window.location.reload();
    return false;
  }
  await enterApp(user,profile);

  if(partnerReferralResult?.error){
    setTimeout(()=>appAlert(
      'Sua conta entrou normalmente, mas não foi possível vincular o código de parceiro informado.\n\n'+String(partnerReferralResult.error?.message||'Código inválido ou inativo.'),
      'Código de parceiro'
    ),350);
  }else if(partnerReferralResult?.linked){
    setTimeout(()=>openReferralSuccessModal(partnerReferralResult.code),350);
  }

  return true;
}
async function enterApp(user,profile=null){
  currentAuthUser=user;
  currentProfile=profile;
  updateAccountChip(user);
  setAdminVisibility(profile?.role==='admin');
  renderSubscriptionBanner(profile);
  renderBillingSection(profile);
  hideBillingGate();
  document.getElementById('authGate')?.classList.add('hidden');
  if(appInitializedForUser !== user.id){
    clients=[];
    selectedClients.clear();
    currentPage=1;
    await initApp();
    appInitializedForUser=user.id;
  } else {
    render();
    scheduleFirstOnboarding();
  }
  if(profile){
    touchLastSeen();
    if(profile.role==='admin') loadAdminDashboard();
  }
  clearInterval(accessHeartbeatTimer);
  accessHeartbeatTimer=setInterval(refreshAccountAccess,60000);
}
async function refreshAccountAccess(){
  if(!supabaseClient || !currentAuthUser || !currentProfile) return;
  try{
    await syncCurrentSubscription();
    const fresh=await fetchCurrentProfile();
    if(!fresh) return;
    currentProfile=fresh;
    setAdminVisibility(fresh.role==='admin');
    renderSubscriptionBanner(fresh);
    renderBillingSection(fresh);
    const denial=accessDenialMessage(fresh);
    if(fresh.status==='blocked'){
      setAuthFlash(denial,'error');
      authReloadInProgress=true;
      await supabaseClient.auth.signOut();
      window.location.reload();
      return;
    }
    if(billingOnlyState(fresh)){
      clients=[]; selectedClients.clear(); try{render();}catch(_e){}
      showBillingGate(fresh);
      return;
    }
    hideBillingGate();
    if(denial){
      setAuthFlash(denial,'error');
      authReloadInProgress=true;
      await supabaseClient.auth.signOut();
      window.location.reload();
    }
  }catch(err){ console.warn('Falha ao atualizar situação da conta:',err); }
}
function passwordRecoveryRedirectUrl(){
  // Fluxo oficial do Gestor Pro: o link de recuperação sempre abre no site
  // seguro. Assim funciona no PC, celular ou qualquer dispositivo com navegador.
  return 'https://gestorpro.app.br/redefinir-senha/';
}
function urlHasRecoveryMarker(){
  return /(?:[?#&]type=recovery\b|gestor_pro_recovery=1|access_token=|refresh_token=|token_hash=)/i.test(location.href);
}
async function activateRecoveryFromLink(rawLink){
  if(!supabaseClient) throw new Error('Conexão com o Supabase indisponível.');
  const value=String(rawLink||'').trim();
  if(!value) throw new Error('Cole o link de recuperação recebido no e-mail.');
  let parsed;
  try{ parsed=new URL(value); }catch(_e){ throw new Error('O link informado não é válido. Copie o endereço completo do navegador/e-mail.'); }

  const hash=new URLSearchParams((parsed.hash||'').replace(/^#/,''));
  const accessToken=hash.get('access_token');
  const refreshToken=hash.get('refresh_token');
  if(accessToken && refreshToken){
    const {error}=await supabaseClient.auth.setSession({access_token:accessToken,refresh_token:refreshToken});
    if(error) throw error;
    passwordRecoveryMode=true;
    document.getElementById('authGate')?.classList.remove('hidden');
    setAuthView('reset');
    setAuthMessage('Link confirmado. Agora crie sua nova senha.','success');
    return;
  }

  const code=parsed.searchParams.get('code');
  if(code){
    const {error}=await supabaseClient.auth.exchangeCodeForSession(code);
    if(error) throw error;
    passwordRecoveryMode=true;
    document.getElementById('authGate')?.classList.remove('hidden');
    setAuthView('reset');
    setAuthMessage('Link confirmado. Agora crie sua nova senha.','success');
    return;
  }

  const tokenHash=parsed.searchParams.get('token_hash') || parsed.searchParams.get('token');
  const type=parsed.searchParams.get('type');
  if(tokenHash && (!type || type==='recovery')){
    const {error}=await supabaseClient.auth.verifyOtp({token_hash:tokenHash,type:'recovery'});
    if(error) throw error;
    passwordRecoveryMode=true;
    document.getElementById('authGate')?.classList.remove('hidden');
    setAuthView('reset');
    setAuthMessage('Link confirmado. Agora crie sua nova senha.','success');
    return;
  }

  throw new Error('Não encontrei os dados de recuperação nesse link. Solicite um novo e-mail e tente novamente.');
}
async function finishPasswordRecovery(){
  passwordRecoveryMode=false;
  setAuthFlash('Senha alterada com sucesso. Entre com sua nova senha.','success');
  authReloadInProgress=true;
  try{ await supabaseClient?.auth.signOut(); }catch(_e){}
  window.location.reload();
}

async function clearAppSession(){
  if(onboardingModal) onboardingModal.style.display='none';
  currentAuthUser=null;
  pendingRememberedSession=null;
  currentProfile=null;
  adminProfiles=[];
  adminClientCounts=new Map();
  adminSelectedUserId=null;
  clearInterval(accessHeartbeatTimer);
  accessHeartbeatTimer=null;
  setAdminVisibility(false);
  appInitializedForUser=null;
  clients=[];
  selectedClients.clear();
  updateAccountChip(null);
  renderSubscriptionBanner(null);

  const gate=document.getElementById('authGate');
  const loginForm=document.getElementById('loginForm');
  const loginEmail=document.getElementById('loginEmail');
  const loginPassword=document.getElementById('loginPassword');
  const loginSubmit=document.getElementById('loginSubmit');

  // Reabre a tela de acesso em um estado totalmente interativo.
  // Usamos display via classe (em vez de visibility/pointer-events) para evitar
  // que o Chromium/Electron mantenha uma camada invisível capturando o mouse após o logout.
  gate?.classList.remove('hidden');
  loginForm?.reset();
  restoreRememberedEmail();
  [loginEmail,loginPassword,loginSubmit].forEach(el=>{
    if(!el) return;
    el.disabled=false;
    el.removeAttribute('readonly');
    el.style.pointerEvents='auto';
  });
  setAuthView('login');
  render();

  requestAnimationFrame(()=>{
    gate?.scrollTo?.({top:0,left:0,behavior:'auto'});
    loginEmail?.focus();
  });
}
async function logoutApp(){
  // Não salvamos a senha no HTML/localStorage. Apenas o e-mail pode ser lembrado.
  // O reload após o signOut força o Chromium/Electron a reconstruir a tela de login,
  // evitando a camada de clique travada que alguns usuários viram após sair.
  persistRememberedEmail();
  authReloadInProgress=true;
  if(supabaseClient){
    const { error }=await supabaseClient.auth.signOut();
    if(error){ authReloadInProgress=false; setAuthMessage(friendlyAuthError(error)); return; }
  }
  window.location.reload();
}
async function bootAuth(){
  if(!window.supabase?.createClient){
    gpSetWebSessionBootMask(false);
    document.getElementById('authGate')?.classList.remove('hidden');
    setAuthView('login');
    setAuthMessage('Não foi possível carregar a conexão segura com o Supabase. Verifique sua internet e abra o arquivo novamente.');
    return;
  }

  supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  window.gpSupabaseClient=supabaseClient;

  // Recebe o link de recuperação encaminhado pelo Electron.
  // O link contém o code/token criado pelo Supabase e é validado pela mesma
  // rotina usada no fluxo manual.
  window.api?.onRecoveryLink?.(async (url)=>{
    try{
      await activateRecoveryFromLink(url);
    }catch(err){
      document.getElementById('authGate')?.classList.remove('hidden');
      setAuthView('forgot');
      setAuthMessage(friendlyAuthError(err),'error');
    }
  });

  supabaseClient.auth.onAuthStateChange((event,session)=>{
    if(event==='PASSWORD_RECOVERY'){
      passwordRecoveryMode=true;
      document.getElementById('authGate')?.classList.remove('hidden');
      setAuthView('reset');
      setAuthMessage('Link de recuperação confirmado. Crie sua nova senha.','success');
      return;
    }
    if(event==='SIGNED_OUT' && !session && !authReloadInProgress) clearAppSession();
  });

  const { data, error }=await supabaseClient.auth.getSession();
  if(error){
    gpSetWebSessionBootMask(false);
    setAuthMessage(friendlyAuthError(error));
    return;
  }
  if(data?.session?.user && (passwordRecoveryMode || urlHasRecoveryMarker())){
    gpSetWebSessionBootMask(false);
    passwordRecoveryMode=true;
    document.getElementById('authGate')?.classList.remove('hidden');
    setAuthView('reset');
    setAuthMessage('Crie uma nova senha para concluir a recuperação.','success');
  } else if(data?.session?.user && GP_IS_WEB_BROWSER){
    // Na versão Web detectamos pelo navegador, porque app-core cria uma window.api simulada também no browser.
    // Ao atualizar a página (F5), reabrimos o painel automaticamente.
    // Isso NÃO altera o comportamento do PC nem do Android.
    try{
      await authorizeSignedInUser(mapSupabaseUser(data.session.user));
      gpSetWebSessionBootMask(false);
    }catch(err){
      gpSetWebSessionBootMask(false);
      console.error('Falha ao restaurar sessão Web:',err);
      const gate=document.getElementById('authGate');
      gate?.classList.remove('hidden');
      restoreRememberedEmail();
      prepareRememberedSessionLogin(data.session);
      setAuthView('login');
      setAuthMessage('Não foi possível restaurar sua sessão. Clique em Entrar para continuar.','error');
    }
  } else {
    gpSetWebSessionBootMask(false);
    // PC/Android mantêm o comportamento atual:
    // mesmo com sessão salva, a tela de login continua visível.
    const gate=document.getElementById('authGate');
    gate?.classList.remove('hidden');
    ['loginEmail','loginPassword','loginSubmit'].forEach(id=>{
      const el=document.getElementById(id);
      if(el){ el.disabled=false; el.removeAttribute('readonly'); el.style.pointerEvents='auto'; }
    });
    restoreRememberedEmail();
    if(data?.session?.user) prepareRememberedSessionLogin(data.session);
    setAuthView('login');
    consumeAuthFlash();
  }
}

restoreRememberedEmail();
refreshRecoveryCooldown();

document.querySelectorAll('[data-auth-view]').forEach(btn=>btn.addEventListener('click',()=>setAuthView(btn.dataset.authView)));
const PASSWORD_EYE_SVG=`<svg viewBox="0 0 24 24" aria-hidden="true"><path class="eye-stroke" d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle class="eye-stroke" cx="12" cy="12" r="2.5"/></svg>`;
const PASSWORD_EYE_OFF_SVG=`<svg viewBox="0 0 24 24" aria-hidden="true"><path class="eye-stroke" d="M3 3l18 18"/><path class="eye-stroke" d="M10.6 6.2A10.4 10.4 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.1 3.7"/><path class="eye-stroke" d="M6.2 6.3C3.8 8.1 2.5 12 2.5 12s3.5 6 9.5 6c1 0 2-.2 2.8-.5"/><path class="eye-stroke" d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`;

document.getElementById('loginEmail')?.addEventListener('input',()=>{
  const passwordInput=document.getElementById('loginPassword');
  if(passwordInput?.dataset.rememberedSession==='true') clearRememberedSessionMask();
});
document.getElementById('loginPassword')?.addEventListener('input',e=>{
  if(e.target.dataset.rememberedSession==='true' && e.target.value!==REMEMBERED_SESSION_MASK){
    delete e.target.dataset.rememberedSession;
    pendingRememberedSession=null;
  }
});

document.querySelectorAll('[data-password-target]').forEach(btn=>{
  btn.setAttribute('aria-label','Mostrar senha');
  btn.setAttribute('aria-pressed','false');

  btn.addEventListener('click',()=>{
    const input=document.getElementById(btn.dataset.passwordTarget);
    if(!input) return;

    const show=input.type==='password';
    input.type=show?'text':'password';

    btn.innerHTML=show?PASSWORD_EYE_OFF_SVG:PASSWORD_EYE_SVG;
    btn.classList.toggle('password-visible',show);
    btn.title=show?'Ocultar senha':'Mostrar senha';
    btn.setAttribute('aria-label',show?'Ocultar senha':'Mostrar senha');
    btn.setAttribute('aria-pressed',show?'true':'false');
  });
});

document.getElementById('loginForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const submit=document.getElementById('loginSubmit');
  submit.disabled=true; submit.textContent='Entrando...';
  try{
    if(!supabaseClient) throw new Error('Conexão com o Supabase indisponível. Recarregue a página.');
    const email=document.getElementById('loginEmail').value.trim().toLowerCase();
    const passwordInput=document.getElementById('loginPassword');
    const password=passwordInput.value;
    const usingRememberedSession=passwordInput.dataset.rememberedSession==='true' && password===REMEMBERED_SESSION_MASK;

    let user=null;
    if(usingRememberedSession){
      const sessionEmail=String(pendingRememberedSession?.user?.email||'').trim().toLowerCase();
      if(!pendingRememberedSession?.user || !sessionEmail || sessionEmail!==email){
        clearRememberedSessionMask();
        throw new Error('Digite sua senha novamente para entrar nesta conta.');
      }

      // Confirma que a sessão lembrada ainda é válida antes de abrir o painel.
      const {data:userData,error:userError}=await supabaseClient.auth.getUser();
      if(userError || !userData?.user){
        clearRememberedSessionMask();
        throw new Error('Sua sessão salva expirou. Digite sua senha novamente.');
      }
      user=userData.user;
    }else{
      const { data, error }=await supabaseClient.auth.signInWithPassword({email,password});
      if(error) throw error;
      if(!data?.user) throw new Error('Não foi possível localizar sua conta.');
      user=data.user;
      pendingRememberedSession=data.session||null;
    }

    persistRememberedEmail();
    setAuthMessage('Acesso confirmado. Abrindo seu painel...','success');
    await authorizeSignedInUser(mapSupabaseUser(user));
  }catch(err){ setAuthMessage(friendlyAuthError(err)); }
  finally{ submit.disabled=false; submit.textContent='Entrar no Gestor Pro'; }
});

document.getElementById('forgotPasswordForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const submit=document.getElementById('forgotSubmit');
  const remaining=Math.ceil((recoveryCooldownUntil()-Date.now())/1000);
  if(remaining>0){
    setAuthMessage(`Por segurança, aguarde ${remaining} segundos antes de solicitar outro e-mail.`,'error');
    refreshRecoveryCooldown();
    return;
  }
  submit.disabled=true; submit.textContent='Enviando...';
  try{
    if(!supabaseClient) throw new Error('Conexão com o Supabase indisponível. Recarregue a página.');
    const email=document.getElementById('forgotEmail').value.trim().toLowerCase();
    if(!email) throw new Error('Informe o e-mail da sua conta.');
    const redirectTo=passwordRecoveryRedirectUrl();
    const options=redirectTo?{redirectTo}:undefined;

    // Evita cliques repetidos. O próprio provedor de autenticação também limita reenvios.
    setRecoveryCooldown(60);
    const {error}=await supabaseClient.auth.resetPasswordForEmail(email,options);
    if(error) throw error;
    document.getElementById('loginEmail').value=email;
    if(document.getElementById('rememberEmail')?.checked) persistRememberedEmail();
    setAuthMessage('E-mail de recuperação enviado. Abra a mensagem e clique em “Redefinir senha”. A página segura do Gestor Pro será aberta para você criar uma nova senha. O link funciona no celular e no computador. Confira também a pasta de spam.','success');
  }catch(err){
    const raw=String(err?.message||err||'').toLowerCase();
    if(authRateLimitKind(err)){
      setAuthMessage(
        'O envio do e-mail está temporariamente indisponível. Aguarde alguns minutos e tente novamente.',
        'notice'
      );
    }else{
      setAuthMessage(friendlyAuthError(err));
    }
  }finally{
    refreshRecoveryCooldown();
  }
});

document.getElementById('toggleRecoveryLinkBtn')?.addEventListener('click',()=>{
  const box=document.getElementById('recoveryLinkBox');
  box?.classList.toggle('show');
  if(box?.classList.contains('show')) setTimeout(()=>document.getElementById('recoveryLinkInput')?.focus(),30);
});

document.getElementById('useRecoveryLinkBtn')?.addEventListener('click',async()=>{
  const btn=document.getElementById('useRecoveryLinkBtn');
  btn.disabled=true; btn.textContent='Validando link...';
  try{ await activateRecoveryFromLink(document.getElementById('recoveryLinkInput')?.value); }
  catch(err){ setAuthMessage(friendlyAuthError(err)); }
  finally{ btn.disabled=false; btn.textContent='Continuar com este link'; }
});

document.getElementById('resetPasswordForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const submit=document.getElementById('resetPasswordSubmit');
  submit.disabled=true; submit.textContent='Salvando...';
  try{
    if(!supabaseClient) throw new Error('Conexão com o Supabase indisponível.');
    const password=document.getElementById('newPassword').value;
    const password2=document.getElementById('newPassword2').value;
    if(password.length<6) throw new Error('A nova senha precisa ter pelo menos 6 caracteres.');
    if(password!==password2) throw new Error('As senhas não são iguais.');
    const {error}=await supabaseClient.auth.updateUser({password});
    if(error) throw error;
    setAuthMessage('Senha alterada com sucesso. Voltando para o login...','success');
    setTimeout(()=>finishPasswordRecovery(),700);
  }catch(err){ setAuthMessage(friendlyAuthError(err)); }
  finally{ submit.disabled=false; submit.textContent='Salvar nova senha'; }
});

document.getElementById('cancelRecoveryBtn')?.addEventListener('click',async()=>{
  try{ await supabaseClient?.auth.signOut(); }catch(_e){}
  passwordRecoveryMode=false;
  setAuthView('login');
});

document.getElementById('registerForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const submit=document.getElementById('registerSubmit');
  submit.disabled=true; submit.textContent='Criando conta...';
  try{
    if(!supabaseClient) throw new Error('Conexão com o Supabase indisponível. Recarregue a página.');
    const name=document.getElementById('registerName').value.trim();
    const business=document.getElementById('registerBusiness').value.trim();
    const partnerCode=document.getElementById('registerPartnerCode')?.value.trim().toUpperCase() || '';
    const email=document.getElementById('registerEmail').value.trim().toLowerCase();
    const password=document.getElementById('registerPassword').value;
    const password2=document.getElementById('registerPassword2').value;
    if(name.length<2) throw new Error('Informe seu nome.');
    if(password.length<6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');
    if(password!==password2) throw new Error('As senhas não são iguais.');

    const { data, error }=await supabaseClient.auth.signUp({
      email,
      password,
      options:{
        data:{
          name,
          business,
          ...(partnerCode ? {partner_code:partnerCode} : {})
        },
        emailRedirectTo:'https://gestorpro.app.br/confirmar-cadastro/'
      }
    });
    if(error) throw error;

    // Com confirmação de e-mail ativa, o Supabase pode ocultar que o endereço
    // já existe e devolver um usuário "ofuscado". Nessa situação, identities
    // vem vazio. Não mostramos falso sucesso nem dizemos que outro e-mail foi enviado.
    const signUpUser=data?.user || data?.session?.user || null;
    const identities=signUpUser?.identities;
    const duplicatedEmail=!!signUpUser && Array.isArray(identities) && identities.length===0;

    if(duplicatedEmail){
      document.getElementById('loginEmail').value=email;
      setAuthView('login');
      setAuthMessage('Este e-mail já está cadastrado. Entre com sua senha ou use “Esqueci minha senha”.','error');
      return;
    }

    document.getElementById('registerForm')?.reset();
    if(data?.session?.user){
      setAuthMessage('Conta criada com sucesso. Abrindo o Gestor Pro...','success');
      await authorizeSignedInUser(mapSupabaseUser(data.session.user));
    } else {
      document.getElementById('loginEmail').value=email;
      setAuthView('login');
      setAuthMessage('Conta criada. Enviamos um e-mail de confirmação. Abra a mensagem, confirme seu cadastro e depois volte ao Gestor Pro para fazer login.','success');
    }
  }catch(err){
    const limitKind=authRateLimitKind(err);
    if(limitKind==='email'){
      setAuthMessage(
        'O servidor de e-mail do cadastro está em uma pausa temporária. Seu computador não está com problema. Aguarde alguns minutos e tente criar a conta novamente.',
        'notice'
      );
    }else if(limitKind==='request'){
      setAuthMessage(
        'O cadastro está temporariamente ocupado. Aguarde alguns instantes e tente novamente.',
        'notice'
      );
    }else{
      setAuthMessage(friendlyAuthError(err));
    }
  }
  finally{ submit.disabled=false; submit.textContent='Criar minha conta'; }
});

document.getElementById('logoutBtn')?.addEventListener('click',async()=>{
  if(await appConfirm('Deseja sair do Gestor Pro?','Sair da conta')) await logoutApp();
});


// ---------------- Administração do SaaS ----------------
function adminFmtDate(value,withTime=false){
  if(!value) return '—';
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR',withTime?{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}:{});
}
function adminPlanLabel(plan){ return ({free:'Grátis',basic:'Básico',pro:'Pro',premium:'Premium',owner:'Proprietário'})[plan]||plan||'Grátis'; }
function adminSubscriptionLabel(status){ return ({trial:'Teste',paid:'Ativa',overdue:'Atrasada',canceled:'Cancelada'})[status]||status||'Teste'; }
async function loadAdminDashboard(){
  if(!supabaseClient || currentProfile?.role!=='admin') return;
  const refresh=document.getElementById('adminRefreshBtn');
  if(refresh){refresh.disabled=true;refresh.textContent='Atualizando...';}
  try{
    const {error:syncError}=await supabaseClient.rpc('admin_sync_expired_trials');
    if(syncError) console.warn('Não foi possível sincronizar testes vencidos:',syncError);
    const [{data:profiles,error:profilesError},{data:counts,error:countsError}]=await Promise.all([
      supabaseClient.from('profiles').select('*').order('created_at',{ascending:false}),
      supabaseClient.rpc('admin_client_counts')
    ]);
    if(profilesError) throw profilesError;
    if(countsError) throw countsError;
    adminProfiles=profiles||[];
    adminClientCounts=new Map((counts||[]).map(row=>[row.user_id,Number(row.client_count||0)]));
    renderAdminDashboard();
  }catch(err){
    console.error('Falha no painel admin:',err);
    const list=document.getElementById('adminUsersList');
    if(list) list.innerHTML='<div class="admin-empty">Não foi possível carregar a administração. Rode o SQL de configuração do Painel Admin no Supabase.</div>';
  }finally{
    if(refresh){refresh.disabled=false;refresh.textContent='↻ Atualizar';}
  }
}
function renderAdminDashboard(){
  if(currentProfile?.role!=='admin') return;
  const total=adminProfiles.length;
  const active=adminProfiles.filter(p=>p.status==='active' && !accessDenialMessage(p)).length;
  const blocked=adminProfiles.filter(p=>p.status==='blocked').length;
  const trials=adminProfiles.filter(p=>effectiveSubscriptionStatus(p)==='trial').length;
  const overdue=adminProfiles.filter(p=>effectiveSubscriptionStatus(p)==='overdue').length;
  const managed=[...adminClientCounts.values()].reduce((a,b)=>a+b,0);
  const mrr=adminProfiles.filter(p=>p.role!=='admin' && p.status==='active' && effectiveSubscriptionStatus(p)==='paid').reduce((sum,p)=>sum+billingPriceValue(p),0);
  document.getElementById('adminTotalUsers').textContent=total;
  document.getElementById('adminActiveUsers').textContent=active;
  document.getElementById('adminBlockedUsers').textContent=blocked;
  document.getElementById('adminTrialUsers').textContent=trials;
  document.getElementById('adminOverdueUsers').textContent=overdue;
  document.getElementById('adminMrr').textContent=billingMoney(mrr);
  document.getElementById('adminManagedClients').textContent=managed;
  document.getElementById('adminBlockedChip')?.classList.toggle('show',blocked>0);
  document.getElementById('adminTrialChip')?.classList.toggle('show',trials>0);
  document.getElementById('adminOverdueCard')?.classList.toggle('has-alert',overdue>0);

  const q=(document.getElementById('adminSearch')?.value||'').trim().toLowerCase();
  const filter=document.getElementById('adminStatusFilter')?.value||'all';
  const filtered=adminProfiles.filter(p=>{
    const hay=[p.nome,p.email,p.empresa].join(' ').toLowerCase();
    if(q && !hay.includes(q)) return false;
    if(filter==='active') return p.status==='active' && !accessDenialMessage(p);
    if(filter==='blocked') return p.status==='blocked';
    if(['trial','paid','overdue'].includes(filter)) return effectiveSubscriptionStatus(p)===filter;
    return true;
  });
  const list=document.getElementById('adminUsersList');
  const empty=document.getElementById('adminEmptyUsers');
  if(!list||!empty) return;
  empty.style.display=filtered.length?'none':'block';
  list.innerHTML=filtered.map(p=>{
    const clientsCount=adminClientCounts.get(p.id)||0;
    const isOwner=p.role==='admin';
    const effectiveSub=effectiveSubscriptionStatus(p);
    const t=trialState(p);
    const subExtra=effectiveSub==='trial'?(t.days===1?'1 dia':`${t.days} dias`):(effectiveSub==='overdue'&&p.trial_end?`venceu ${adminFmtDate(p.trial_end)}`:'');
    const accessLabel=p.status==='blocked'?'Bloqueado':accessDenialMessage(p)?'Sem acesso':'Ativo';
    const accessClass=p.status==='blocked'||accessDenialMessage(p)?'blocked':'active';
    const needsAttention=!isOwner && (p.status==='blocked' || effectiveSub==='overdue' || effectiveSub==='canceled' || !!accessDenialMessage(p));
    const rowClass=`admin-user-row${needsAttention?' needs-attention':''}${isOwner?' owner-row':''}`;
    return `<div class="${rowClass}">
      <div class="admin-user-main"><b>${escapeHtml(p.nome||p.email||'Usuário')}${isOwner?' · Admin':''}</b><span>${escapeHtml(p.email||'—')}${p.empresa?' · '+escapeHtml(p.empresa):''}</span>${needsAttention?'<span class="admin-attention-note">Requer atenção</span>':''}</div>
      <span class="admin-pill ${accessClass}">${accessLabel}</span>
      <div><span class="admin-pill ${escapeHtml(effectiveSub)}">${escapeHtml(adminSubscriptionLabel(effectiveSub))}</span>${subExtra?`<div class="admin-date" style="margin-top:4px">${escapeHtml(subExtra)}</div>`:''}</div>
      <span class="admin-number">${escapeHtml(adminPlanLabel(p.plan))}</span>
      <div><span class="admin-number">${p.role==='admin'?'—':escapeHtml(billingMoney(billingPriceValue(p)))}</span><div class="admin-date" style="margin-top:4px">${p.current_period_end?'até '+escapeHtml(adminFmtDate(p.current_period_end)):effectiveSub==='trial'?'após o teste':'—'}</div></div>
      <span class="admin-number">${clientsCount}</span>
      <div class="admin-row-action"><button class="btn-mini btn-ghost" type="button" data-admin-user="${p.id}">Gerenciar</button></div>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-admin-user]').forEach(btn=>btn.addEventListener('click',()=>openAdminUser(btn.dataset.adminUser)));
}
function openAdminUser(id){
  const p=adminProfiles.find(x=>x.id===id);
  if(!p) return;
  adminSelectedUserId=id;
  const t=trialState(p);
  const sub=effectiveSubscriptionStatus(p);
  document.getElementById('adminModalSummary').textContent=p.role==='admin'?'Conta administrativa':sub==='trial'?`Conta em teste · ${t.days} dia${t.days===1?'':'s'} restante${t.days===1?'':'s'}`:sub==='overdue'?'Conta com período vencido':'Conta de cliente do Gestor Pro';
  document.getElementById('adminModalName').textContent=p.nome||'—';
  document.getElementById('adminModalEmail').textContent=p.email||'—';
  document.getElementById('adminModalBusiness').textContent=p.empresa||'—';
  document.getElementById('adminModalClients').textContent=adminClientCounts.get(id)||0;
  document.getElementById('adminModalCreated').textContent=adminFmtDate(p.created_at,true);
  document.getElementById('adminModalLastSeen').textContent=adminFmtDate(p.last_seen_at,true);
  document.getElementById('adminEditStatus').value=p.status||'active';
  document.getElementById('adminEditPlan').value=p.plan||'free';
  document.getElementById('adminEditSubscription').value=effectiveSubscriptionStatus(p)==='overdue'?'overdue':(p.subscription_status||'trial');
  document.getElementById('adminEditTrialEnd').value=p.trial_end?String(p.trial_end).slice(0,10):'';
  document.getElementById('adminEditMonthlyPrice').value=Number(p.monthly_price??49.90).toFixed(2);
  document.getElementById('adminEditPeriodEnd').value=p.current_period_end?String(p.current_period_end).slice(0,10):'';
  document.getElementById('adminUserModal').style.display='flex';
}
function closeAdminUser(){
  adminSelectedUserId=null;
  document.getElementById('adminUserModal').style.display='none';
}
async function saveAdminUser(){
  if(!adminSelectedUserId || currentProfile?.role!=='admin') return;
  const btn=document.getElementById('adminSaveUserBtn');
  const profile=adminProfiles.find(p=>p.id===adminSelectedUserId);
  const status=document.getElementById('adminEditStatus').value;
  if(profile?.role==='admin' && profile.id===currentAuthUser?.id && status==='blocked'){
    await appAlert('Para evitar perder seu próprio acesso, o Gestor Pro não permite bloquear a conta administrativa atual.','Ação não permitida');
    return;
  }
  const plan=document.getElementById('adminEditPlan').value;
  const subscription=document.getElementById('adminEditSubscription').value;
  const trialDate=document.getElementById('adminEditTrialEnd').value;
  const monthlyPrice=Math.max(0,Number(document.getElementById('adminEditMonthlyPrice').value||39.90));
  const periodDate=document.getElementById('adminEditPeriodEnd').value;
  btn.disabled=true;btn.textContent='Salvando...';
  try{
    const {error}=await supabaseClient.rpc('admin_update_billing_profile',{
      p_target_user_id:adminSelectedUserId,
      p_status:status,
      p_plan:plan,
      p_subscription_status:subscription,
      p_trial_end:trialDate?new Date(trialDate+'T23:59:59').toISOString():null,
      p_monthly_price:monthlyPrice,
      p_current_period_end:periodDate?new Date(periodDate+'T23:59:59').toISOString():null
    });
    if(error) throw error;
    closeAdminUser();
    await loadAdminDashboard();
  }catch(err){
    await appAlert('Não foi possível atualizar o usuário. '+(err?.message||err),'Erro ao atualizar');
  }finally{btn.disabled=false;btn.textContent='Salvar alterações';}
}
document.getElementById('adminEditSubscription')?.addEventListener('change',e=>{
  const trial=document.getElementById('adminEditTrialEnd');
  const period=document.getElementById('adminEditPeriodEnd');
  const price=document.getElementById('adminEditMonthlyPrice');
  if(e.target.value==='trial' && trial && !trial.value){
    const d=new Date(); d.setDate(d.getDate()+7);
    trial.value=d.toISOString().slice(0,10);
  }
  if(e.target.value==='paid'){
    if(price && !Number(price.value)) price.value='39.90';
    if(period && !period.value){ const d=new Date(); d.setDate(d.getDate()+30); period.value=d.toISOString().slice(0,10); }
  }
});
document.getElementById('adminRefreshBtn')?.addEventListener('click',loadAdminDashboard);
document.getElementById('adminSearch')?.addEventListener('input',renderAdminDashboard);
document.getElementById('adminStatusFilter')?.addEventListener('change',renderAdminDashboard);
document.getElementById('adminModalCloseBtn')?.addEventListener('click',closeAdminUser);
document.getElementById('adminModalCloseX')?.addEventListener('click',closeAdminUser);
document.getElementById('adminSaveUserBtn')?.addEventListener('click',saveAdminUser);
document.getElementById('adminUserModal')?.addEventListener('click',e=>{if(e.target.id==='adminUserModal')closeAdminUser();});


document.getElementById('billingGateLogoutBtn')?.addEventListener('click',logoutApp);
document.getElementById('billingPixCopyBtn')?.addEventListener('click',copyPixCode);
document.getElementById('billingPaymentCloseBtn')?.addEventListener('click',closePaymentPreview);
document.getElementById('billingPaymentModal')?.addEventListener('click',e=>{if(e.target.id==='billingPaymentModal')closePaymentPreview();});


// Checkout: vínculo explícito dos botões, sem depender de onclick inline.
async function handleCheckoutButtonClick(event){
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const btn=event?.currentTarget;
  if(btn){
    btn.dataset.checkoutClicked='1';
    btn.textContent='Preparando Pix...';
  }
  try{
    await startMercadoPagoCheckout(selectedBillingPlan);
  }catch(err){
    console.error('Erro inesperado no botão de checkout:',err);
    setPaymentModalState(
      'Erro ao gerar Pix',
      err?.message || String(err),
      'O clique funcionou, mas houve um erro antes de gerar o Pix.'
    );
  }
}
document.querySelectorAll('[data-billing-plan]').forEach(btn=>btn.addEventListener('click',()=>setSelectedBillingPlan(btn.dataset.billingPlan)));
setSelectedBillingPlan('mensal');

const checkoutMainButton=document.getElementById('billingSubscribeBtn');
const checkoutGateButton=document.getElementById('billingGateSubscribeBtn');
checkoutMainButton?.addEventListener('click',handleCheckoutButtonClick);
checkoutGateButton?.addEventListener('click',handleCheckoutButtonClick);
// Mantém a função acessível globalmente para compatibilidade com versões antigas.
window.startMercadoPagoCheckout=startMercadoPagoCheckout;

// Fallback para recursos locais que ainda não foram migrados para a nuvem (configurações/WhatsApp).
// Os CLIENTES, porém, são sempre lidos e gravados no Supabase nesta versão.
if(!window.api){
  const browserKey=(suffix)=>{
    const userId=currentAuthUser?.id || 'sem_usuario';
    return `gestor_pro_browser_${userId}_${suffix}`;
  };
  window.api={
    async loadClients(){ return []; },
    async saveClients(){},
    async loadSettings(){ try{return JSON.parse(localStorage.getItem(browserKey('settings'))||'{}')}catch(e){return{}} },
    async saveSettings(data){ localStorage.setItem(browserKey('settings'),JSON.stringify(data||{})); },
    startWhatsapp(){ appAlert('A conexão real do WhatsApp funciona na versão desktop do Gestor Pro.','Modo navegador'); },
    logoutWhatsapp(){},
    onQr(){}, onStatus(){}, onLog(){}, onClientsUpdated(){}
  };
}

function isUuid(value){
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));
}


// ---------------- Diálogos customizados ----------------
const appDialogEl=document.getElementById('appDialog');
const appDialogBoxEl=document.getElementById('appDialogBox');
const appDialogIconEl=document.getElementById('appDialogIcon');
const appDialogTitleEl=document.getElementById('appDialogTitle');
const appDialogMessageEl=document.getElementById('appDialogMessage');
const appDialogConfirmBtn=document.getElementById('appDialogConfirmBtn');
const appDialogCancelBtn=document.getElementById('appDialogCancelBtn');
let appDialogResolver=null;

function closeAppDialog(result=false){
  if(!appDialogEl) return;
  appDialogEl.style.display='none';
  appDialogEl.setAttribute('aria-hidden','true');
  const resolve=appDialogResolver;
  appDialogResolver=null;
  if(resolve) resolve(result);
}
function showAppDialog({title='Gestor Pro',message='',confirmText='OK',cancelText='Cancelar',mode='alert',tone='default'}={}){
  return new Promise(resolve=>{
    // Se uma confirmação/alerta for disparada de dentro de outro modal,
    // o diálogo é levado para o final do <body> e recebe a camada máxima.
    // Isso resolve Histórico, Empresa, Administração, pagamentos e futuros modais.
    if(appDialogEl){
      try{
        if(appDialogEl.parentElement!==document.body) document.body.appendChild(appDialogEl);
      }catch(_e){}
      appDialogEl.style.zIndex='60000';
    }

    // Evita deixar uma Promise anterior pendurada caso duas mensagens
    // sejam disparadas quase ao mesmo tempo.
    if(appDialogResolver){
      try{ appDialogResolver(false); }catch(_e){}
      appDialogResolver=null;
    }

    appDialogResolver=resolve;
    if(appDialogTitleEl) appDialogTitleEl.textContent=title;
    if(appDialogMessageEl) appDialogMessageEl.textContent=String(message||'');
    if(appDialogConfirmBtn) appDialogConfirmBtn.textContent=confirmText;
    if(appDialogCancelBtn) appDialogCancelBtn.textContent=cancelText;
    if(appDialogCancelBtn) appDialogCancelBtn.style.display=mode==='confirm' ? 'inline-flex' : 'none';
    if(appDialogBoxEl) appDialogBoxEl.classList.toggle('app-dialog-danger',tone==='danger');
    if(appDialogIconEl) appDialogIconEl.textContent=tone==='danger' ? '!' : (mode==='confirm' ? '?' : 'i');
    if(appDialogEl){
      appDialogEl.style.display='flex';
      appDialogEl.setAttribute('aria-hidden','false');
    }
    setTimeout(()=>appDialogConfirmBtn?.focus(),20);
  });
}
async function appAlert(message,title='Gestor Pro',options={}){
  await showAppDialog({title,message,confirmText:options.confirmText||'OK',mode:'alert',tone:options.tone||'default'});
}
async function appConfirm(message,title='Confirmar ação',options={}){
  return await showAppDialog({title,message,confirmText:options.confirmText||'Confirmar',cancelText:options.cancelText||'Cancelar',mode:'confirm',tone:options.tone||'default'});
}
appDialogConfirmBtn?.addEventListener('click',()=>closeAppDialog(true));
appDialogCancelBtn?.addEventListener('click',()=>closeAppDialog(false));
appDialogEl?.addEventListener('click',e=>{ if(e.target===appDialogEl) closeAppDialog(false); });
document.addEventListener('keydown',e=>{
  if(appDialogEl?.style.display!=='flex') return;
  if(e.key==='Escape') closeAppDialog(false);
  if(e.key==='Enter') closeAppDialog(true);
});
function uid(){
  if(window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
    const r=Math.random()*16|0, v=c==='x'?r:(r&0x3|0x8);
    return v.toString(16);
  });
}
function ensureCloudIds(list){
  let changed=false;
  (list||[]).forEach(client=>{
    if(!isUuid(client.id)){ client.id=uid(); changed=true; }
  });
  return changed;
}
function mapClientFromDb(row){
  return {
    id:row.id,
    nome:row.nome || '',
    telefone:row.telefone || '',
    plano:row.plano || '',
    valor:Number(row.valor || 0),
    pagamento:row.pagamento || '',
    vencimento:row.vencimento || '',
    tags:Array.isArray(row.tags) ? row.tags : [],
    paymentHistory:Array.isArray(row.payment_history) ? row.payment_history : [],
    parcelado:Boolean(row.parcelado),
    parcelasTotal:Math.max(1,Number(row.parcelas_total||1)),
    parcelasPagas:Math.max(0,Number(row.parcelas_pagas||0)),
    jurosAtivo:Boolean(row.juros_ativo),
    jurosPercentual:Math.max(0,Number(row.juros_percentual||0))
  };
}
function mapClientToDb(client){
  return {
    id:client.id,
    user_id:currentAuthUser.id,
    nome:String(client.nome||'').trim(),
    telefone:String(client.telefone||'').trim() || null,
    plano:String(client.plano||'').trim() || null,
    valor:Number(client.valor||0),
    pagamento:client.pagamento || null,
    vencimento:client.vencimento || null,
    tags:Array.isArray(client.tags) ? client.tags : [],
    payment_history:Array.isArray(client.paymentHistory) ? client.paymentHistory : [],
    parcelado:Boolean(client.parcelado),
    parcelas_total:Math.max(1,Number(client.parcelasTotal||1)),
    parcelas_pagas:Math.max(0,Number(client.parcelasPagas||0)),
    juros_ativo:Boolean(client.jurosAtivo),
    juros_percentual:Math.max(0,Number(client.jurosPercentual||0)),
    updated_at:new Date().toISOString()
  };
}
function friendlyDataError(error){
  const raw=String(error?.message || error || '');
  if(/row-level security|rls/i.test(raw)) return 'O banco bloqueou a operação por segurança (RLS). Confira as políticas da tabela clientes.';
  if(/failed to fetch|network/i.test(raw)) return 'Não foi possível sincronizar com o banco. Verifique sua internet.';
  return raw || 'Não foi possível sincronizar os clientes com o banco.';
}
async function loadClientsFromCloud(){
  if(!supabaseClient || !currentAuthUser) return [];
  const { data, error }=await supabaseClient
    .from('clientes')
    .select('id,nome,telefone,plano,valor,pagamento,vencimento,tags,payment_history,parcelado,parcelas_total,parcelas_pagas,juros_ativo,juros_percentual,created_at')
    .order('created_at',{ascending:true});
  if(error) throw error;
  return (data||[]).map(mapClientFromDb);
}

async function syncClientsToAutomationCache(list){
  // Na versão desktop, a automação do WhatsApp roda no processo principal
  // e usa clients.json. Mantemos esse arquivo como um espelho do Supabase.
  if(!window.api?.saveClients) return true;
  try{
    const snapshot=(Array.isArray(list)?list:[]).map(client=>({
      ...client,
      tags:Array.isArray(client.tags)?[...client.tags]:[],
      paymentHistory:Array.isArray(client.paymentHistory)
        ? client.paymentHistory.map(item=>({...item}))
        : []
    }));
    await window.api.saveClients(snapshot);
    return true;
  }catch(err){
    console.warn('Não foi possível atualizar o espelho local da automação:',err);
    return false;
  }
}
async function saveClientsToCloud(list){
  if(!supabaseClient || !currentAuthUser) throw new Error('Faça login novamente para salvar seus clientes.');
  ensureCloudIds(list);

  const { data:existing, error:existingError }=await supabaseClient
    .from('clientes')
    .select('id');
  if(existingError) throw existingError;

  const rows=(list||[]).map(mapClientToDb);
  if(rows.length){
    const { error:upsertError }=await supabaseClient
      .from('clientes')
      .upsert(rows,{onConflict:'id'});
    if(upsertError) throw upsertError;
  }

  const keepIds=new Set(rows.map(row=>row.id));
  const removeIds=(existing||[]).map(row=>row.id).filter(id=>!keepIds.has(id));
  if(removeIds.length){
    const { error:deleteError }=await supabaseClient
      .from('clientes')
      .delete()
      .in('id',removeIds);
    if(deleteError) throw deleteError;
  }
}

let saveInFlight=Promise.resolve();
async function save(){
  const snapshot=clients.map(client=>({
    ...client,
    tags:Array.isArray(client.tags)?[...client.tags]:[],
    paymentHistory:Array.isArray(client.paymentHistory)?client.paymentHistory.map(p=>({...p})):[]
  }));
  saveInFlight=saveInFlight.catch(()=>{}).then(()=>saveClientsToCloud(snapshot));
  try{
    await saveInFlight;
    await syncClientsToAutomationCache(snapshot);
    return true;
  }catch(err){
    console.error('Falha ao sincronizar clientes:',err);
    await appAlert('Não foi possível salvar no banco online. '+friendlyDataError(err),'Erro ao salvar');
    return false;
  }
}

function fmtDate(iso){
  if(!iso) return '--';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function fmtMoney(v){
  return 'R$ ' + Number(v||0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
}
function maskPhone(phone){
  const value=String(phone||'-');
  const digitCount=(value.match(/\d/g)||[]).length;
  let digitIndex=0;
  return value.replace(/\d/g,digit=>{
    digitIndex++;
    return digitIndex<=Math.max(0,digitCount-4) ? '•' : digit;
  });
}
function displayPhone(phone){ return phonesVisible ? String(phone||'-') : maskPhone(phone); }
function currentMonthKey(){ return new Date().toISOString().slice(0,7); }
function hasPaymentInMonth(client, monthKey=currentMonthKey()){
  return Array.isArray(client.paymentHistory) && client.paymentHistory.some(p=>(p.date||'').slice(0,7)===monthKey);
}
function normalizePaymentHistory(){
  let changed=false;
  clients.forEach(client=>{
    if(!Array.isArray(client.paymentHistory)) return;
    const seen=new Set();
    const unique=[];
    client.paymentHistory.forEach(payment=>{
      const month=(payment.date||'').slice(0,7);
      if(month && seen.has(month)){ changed=true; return; }
      if(month) seen.add(month);
      unique.push(payment);
    });
    client.paymentHistory=unique;
  });
  return changed;
}
function paymentIndexInMonth(client, monthKey=currentMonthKey()){
  if(!Array.isArray(client.paymentHistory)) return -1;
  for(let i=client.paymentHistory.length-1;i>=0;i--){
    if((client.paymentHistory[i].date||'').slice(0,7)===monthKey) return i;
  }
  return -1;
}
function refreshLastPayment(client){
  const dates=(client.paymentHistory||[]).map(p=>p.date||'').filter(Boolean).sort();
  client.pagamento=dates.length ? dates[dates.length-1] : '';
}
function removePayment(client,index){
  if(!Array.isArray(client.paymentHistory) || !client.paymentHistory[index]) return false;
  const payment=client.paymentHistory[index];
  const isLatest=index===client.paymentHistory.length-1;
  if(isLatest && payment.previousDueDate && (!payment.nextDueDate || client.vencimento===payment.nextDueDate)){
    client.vencimento=payment.previousDueDate;
  }
  client.paymentHistory.splice(index,1);
  refreshLastPayment(client);
  return true;
}
function daysUntil(iso){
  if(!iso) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(iso + 'T00:00:00');
  return Math.round((target - today) / 86400000);
}
function statusOf(client){
  const d = daysUntil(client.vencimento);
  if(d === null) return {key:'ok', label:'Em dia'};
  if(d < 0) return {key:'late', label:`Vencido (${Math.abs(d)}d)`, veryLate: Math.abs(d) >= 15};
  if(d <= 7) return {key:'soon', label:`Vence em breve (${d}d)`};
  return {key:'ok', label:`Em dia (${d}d)`};
}

function updateDatetime(){
  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR');
  const timeStr = now.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
  document.getElementById('datetime').textContent = `${dateStr}, ${timeStr}`;
}
updateDatetime();
setInterval(updateDatetime, 30000);


function updateExecutiveWelcome(){
  const greetingEl=document.getElementById('executiveGreeting');
  const summaryEl=document.getElementById('executiveSummary');
  if(!greetingEl||!summaryEl)return;
  const hour=new Date().getHours();
  const greeting=hour<12?'Bom dia':hour<18?'Boa tarde':'Boa noite';
  const displayName=(currentProfile?.full_name||currentProfile?.name||currentProfile?.nome||currentAuthUser?.user_metadata?.full_name||currentAuthUser?.user_metadata?.name||currentAuthUser?.email?.split('@')[0]||'').trim();
  const firstName=displayName?displayName.split(/\s+/)[0]:'';
  greetingEl.textContent=`${greeting}${firstName?', '+firstName:''}`;
  const total=clients.length;
  let late=0,soon=0,todayDue=0;
  const today=new Date(); today.setHours(0,0,0,0);
  clients.forEach(c=>{
    if(!c.vencimento)return;
    const due=new Date(`${String(c.vencimento).slice(0,10)}T00:00:00`);
    if(Number.isNaN(due.getTime()))return;
    const diff=Math.round((due-today)/86400000);
    if(diff<0)late++; else if(diff===0)todayDue++; else if(diff<=3)soon++;
  });
  if(!total) summaryEl.textContent='Sua carteira ainda está vazia. Cadastre o primeiro cliente para começar.';
  else if(late>0) summaryEl.textContent=`Você tem ${total} cliente${total===1?'':'s'} e ${late} cobrança${late===1?'':'s'} atrasada${late===1?'':'s'} que merece${late===1?'':'m'} atenção.`;
  else if(todayDue>0) summaryEl.textContent=`Tudo sob controle. ${todayDue} cobrança${todayDue===1?' vence':'s vencem'} hoje e nenhuma está atrasada.`;
  else if(soon>0) summaryEl.textContent=`Sua carteira está em dia. ${soon} cobrança${soon===1?' vence':'s vencem'} nos próximos 3 dias.`;
  else summaryEl.textContent=`Você tem ${total} cliente${total===1?' ativo':'s ativos'} e nenhuma cobrança urgente no momento.`;

  document.getElementById('executiveWelcome')?.classList.add('ready');
}


function financeInfo(client){
  const base=Math.max(0,Number(client?.valor||0));
  const parcelado=Boolean(client?.parcelado);
  const total=Math.max(1,Number(client?.parcelasTotal||1));
  const paid=Math.min(total,Math.max(0,Number(client?.parcelasPagas||0)));
  const rate=client?.jurosAtivo ? Math.max(0,Number(client?.jurosPercentual||0)) : 0;
  const totalWithInterest=base*(1+rate/100);
  const installment=parcelado ? totalWithInterest/total : base;
  return {base,parcelado,total,paid,remaining:Math.max(0,total-paid),rate,totalWithInterest,installment,finished:parcelado&&paid>=total};
}
function updateFinanceForm(){
  const parcelado=document.getElementById('f-parcelado')?.checked;
  const fields=document.getElementById('financeFields');
  const preview=document.getElementById('financePreview');
  const juros=document.getElementById('f-juros-ativo')?.value==='sim';
  document.getElementById('interestRateWrap')?.classList.toggle('finance-hidden',!juros);
  fields?.classList.toggle('finance-hidden',!parcelado);
  preview?.classList.toggle('finance-hidden',!parcelado);
  if(!parcelado||!preview)return;
  const base=Math.max(0,parseFloat(document.getElementById('f-valor')?.value)||0);
  const total=Math.max(1,parseInt(document.getElementById('f-parcelas-total')?.value,10)||1);
  let paid=Math.max(0,parseInt(document.getElementById('f-parcelas-pagas')?.value,10)||0);
  if(paid>total){paid=total;document.getElementById('f-parcelas-pagas').value=paid}
  const rate=juros?Math.max(0,parseFloat(document.getElementById('f-juros-percentual')?.value)||0):0;
  const finalValue=base*(1+rate/100), installment=finalValue/total;
  preview.innerHTML=`Valor base: <b>${fmtMoney(base)}</b> · Total com juros: <b>${fmtMoney(finalValue)}</b> · ${total}x de <b>${fmtMoney(installment)}</b> · Restam <b>${Math.max(0,total-paid)}</b> parcela(s).`;
}


function delinquencyData(){
  const rows=clients
    .map(client=>{
      const d=daysUntil(client.vencimento);
      return {client,days:d===null?0:Math.abs(d),diff:d};
    })
    .filter(item=>item.diff!==null && item.diff<0)
    .sort((a,b)=>b.days-a.days);
  return rows;
}
function renderGestorToday(){
  const lateRows=delinquencyData();
  const today=new Date(); today.setHours(0,0,0,0);
  const next7=clients.filter(c=>{
    if(!c.vencimento) return false;
    const d=daysUntil(c.vencimento);
    return d!==null && d>=0 && d<=7;
  });
  const expected=next7.reduce((sum,c)=>sum+Number(c.parcelado?financeInfo(c).installment:c.valor||0),0);
  const total=clients.length;
  const inDay=Math.max(0,total-lateRows.length);
  const health=total?Math.round((inDay/total)*100):100;
  const actions=lateRows.length+next7.length;

  const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value};
  set('gpTodayScore',health+'%');
  set('gpTodayLate',String(lateRows.length));
  set('gpTodayLateText',lateRows.length?`${lateRows.length} cobrança${lateRows.length>1?'s':''} precisa${lateRows.length===1?'':'m'} de atenção.`:'Nenhuma cobrança vencida.');
  set('gpTodaySoon',String(next7.length));
  set('gpTodaySoonText',next7.length?`${next7.length} cliente${next7.length>1?'s':''} vence${next7.length===1?'':'m'} nos próximos 7 dias.`:'Nenhuma cobrança próxima.');
  set('gpTodayExpected',fmtMoney(expected));
  set('gpTodayActionsCount',String(actions));
  set('gpTodayActionsText',actions?`${actions} prioridade${actions>1?'s':''} para revisar hoje.`:'Tudo sob controle.');

  const resolve=document.getElementById('gpTodayResolveBtn');
  if(resolve){
    resolve.textContent=lateRows.length?'Ver inadimplentes':next7.length?'Ver agenda de cobranças':'Tudo em dia';
    resolve.disabled=!lateRows.length && !next7.length;
    resolve.dataset.target=lateRows.length?'delinquencySection':'agendaSection';
  }
}
function renderDelinquency(){
  const list=document.getElementById('delinquencyList');
  if(!list) return;
  const rows=delinquencyData();
  const totalValue=rows.reduce((sum,item)=>sum+Number(item.client.parcelado?financeInfo(item.client).installment:item.client.valor||0),0);
  const bucket7=rows.filter(x=>x.days<=7).length;
  const bucket30=rows.filter(x=>x.days>=8&&x.days<=30).length;
  const bucket31=rows.filter(x=>x.days>30).length;
  const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value};
  set('delinquencyTotalValue',fmtMoney(totalValue));
  set('delinquencyCount',String(rows.length));
  set('delinquency7',String(bucket7));
  set('delinquency30',String(bucket30));
  set('delinquency31',String(bucket31));
  const badge=document.getElementById('delinquencyNavBadge');
  if(badge){badge.textContent=rows.length;badge.classList.remove('show');}

  const search=(document.getElementById('delinquencySearch')?.value||'').trim().toLowerCase();
  const filter=document.getElementById('delinquencyFilter')?.value||'todos';
  const filtered=rows.filter(({client,days})=>{
    const matches=!search ||
      String(client.nome||'').toLowerCase().includes(search) ||
      String(client.telefone||'').toLowerCase().includes(search) ||
      (client.tags||[]).some(t=>String(t).toLowerCase().includes(search));
    const bucket=filter==='todos' ||
      (filter==='1-7'&&days<=7) ||
      (filter==='8-30'&&days>=8&&days<=30) ||
      (filter==='31+'&&days>30);
    return matches&&bucket;
  });

  if(!filtered.length){
    list.innerHTML=rows.length
      ? `<div class="delinquency-empty"><b>Nenhum resultado neste filtro</b>Tente outro período ou termo de busca.</div>`
      : `<div class="delinquency-empty"><b>✓ Nenhum cliente inadimplente</b>Sua carteira não possui cobranças vencidas neste momento.</div>`;
    return;
  }

  list.innerHTML=filtered.map(({client,days})=>{
    const amount=client.parcelado?financeInfo(client).installment:Number(client.valor||0);
    return `<div class="delinquency-row">
      <div class="delinquency-client">
        <div class="delinquency-avatar">${escapeHtml((client.nome||'?').charAt(0).toUpperCase())}</div>
        <div><b>${escapeHtml(client.nome||'Cliente')}</b><span>${escapeHtml(displayPhone(client.telefone))}</span></div>
      </div>
      <div class="delinquency-cell"><span>Valor</span><b>${fmtMoney(amount)}</b></div>
      <div class="delinquency-cell"><span>Vencimento</span><b>${fmtDate(client.vencimento)}</b></div>
      <div><span class="delinquency-days">${days} dia${days===1?'':'s'} em atraso</span></div>
      <div class="delinquency-actions">
        <button class="btn-mini btn-whats" data-delinquency-action="cobrar" data-id="${client.id}">Cobrar</button>
        <button class="btn-mini btn-ghost" data-delinquency-action="cliente" data-id="${client.id}">Ver cliente</button>
      </div>
    </div>`;
  }).join('');
}

function renderStats(){
  updateExecutiveWelcome();
  const total = clients.length;
  let ok=0, soon=0, late=0, revenue=0;
  clients.forEach(c=>{
    const s = statusOf(c);
    if(s.key==='ok') ok++;
    else if(s.key==='soon') soon++;
    else if(s.key==='late') late++;
    revenue += Number(c.valor||0);
  });
  document.getElementById('statTotal').textContent = total;
  document.getElementById('statOk').textContent = ok;
  document.getElementById('statSoon').textContent = soon;
  document.getElementById('statLate').textContent = late;
  document.getElementById('statLateCard')?.classList.toggle('has-late', late > 0);
  document.getElementById('statRevenue').textContent = fmtMoney(revenue);
  document.getElementById('qTotal').textContent = total;
  document.getElementById('qOk').textContent = ok;
  document.getElementById('qSoon').textContent = soon;
  document.getElementById('qLate').textContent = late;

  const premiumRevenue = document.getElementById('premiumRevenue');
  const premiumHealth = document.getElementById('premiumHealth');
  if(premiumRevenue) premiumRevenue.textContent = fmtMoney(revenue);
  if(premiumHealth) premiumHealth.textContent = total ? Math.round((ok / total) * 100) + '%' : '100%';

  const attentionItems = document.getElementById('attentionItems');
  const attentionBox = document.getElementById('attentionBox');
  if(attentionItems && attentionBox){
    const soonClients = clients.filter(c=>statusOf(c).key==='soon');
    const lateClients = clients.filter(c=>statusOf(c).key==='late');
    const items = [];
    if(lateClients.length) items.push(`<div class="attention-item">🔴 <b>${lateClients.length}</b> cobrança${lateClients.length>1?'s':''} em atraso <span style="color:var(--muted)">· resolva agora</span></div>`);
    if(soonClients.length) items.push(`<div class="attention-item">🟡 <b>${soonClients.length}</b> cliente${soonClients.length>1?'s':''} vence${soonClients.length===1?'':'m'} nos próximos dias</div>`);
    if(!items.length) items.push(`<div class="attention-item">🟢 <b>Tudo tranquilo.</b> Seus clientes estão em dia.</div>`);
    attentionItems.innerHTML = items.join('');
    attentionBox.classList.toggle('all-good', !lateClients.length && !soonClients.length);
    const attentionTitle = attentionBox.querySelector('.attention-title');
    if(attentionTitle) attentionTitle.textContent = (!lateClients.length && !soonClients.length) ? '✓ Nenhuma cobrança atrasada' : '⚡ Atenção necessária';
    attentionBox.style.display = 'block';
  }
  renderGestorToday();
  renderDelinquency();
  document.getElementById('clientCountLabel').textContent='Gestão inteligente de clientes e mensalidades';
}

function renderList(){
  const search = document.getElementById('search').value.trim().toLowerCase();
  const filter = document.getElementById('filter').value;
  const sort = document.getElementById('sort').value;
  const list = document.getElementById('clientList');
  const empty = document.getElementById('emptyState');
  list.innerHTML = '';

  let filtered = clients.filter(c=>{
    const s = statusOf(c);
    const matchesSearch = !search ||
      c.nome.toLowerCase().includes(search) ||
      (c.telefone||'').toLowerCase().includes(search) ||
      (c.tags||[]).some(t=>t.toLowerCase().includes(search));
    let matchesFilter = true;
    if(filter==='em-dia') matchesFilter = s.key==='ok';
    if(filter==='vence-em-breve') matchesFilter = s.key==='soon';
    if(filter==='vencidos') matchesFilter = s.key==='late';
    return matchesSearch && matchesFilter;
  });

  filtered.sort((a,b)=>{
    if(sort==='nome') return (a.nome||'').localeCompare(b.nome||'', 'pt-BR');
    if(sort==='valor-desc') return Number(b.valor||0)-Number(a.valor||0);
    if(sort==='status'){
      const rank={late:0,soon:1,ok:2};
      return rank[statusOf(a).key]-rank[statusOf(b).key];
    }
    return (a.vencimento||'9999').localeCompare(b.vencimento||'9999');
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length/pageSize));
  currentPage = Math.min(currentPage,totalPages);
  const start=(currentPage-1)*pageSize;
  const pageClients=filtered.slice(start,start+pageSize);

  if(filtered.length===0){
    empty.style.display='block';
  } else {
    empty.style.display='none';
  }

  pageClients.forEach(c=>{
    const s = statusOf(c);
    const el = document.createElement('div');
    el.className = 'client' +
      (s.key==='late' ? ' late' : s.key==='soon' ? ' soon' : '') +
      (s.veryLate ? ' very-late' : '');
    const tags = Array.isArray(c.tags) ? c.tags : [];
    const tagsHtml = tags.length
      ? `<div class="client-tags">${tags.map(t=>`<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';
    el.innerHTML = `
      <div class="client-select-wrap"><input class="select-client" type="checkbox" data-id="${c.id}" ${selectedClients.has(c.id)?'checked':''} aria-label="Selecionar ${escapeHtml(c.nome)}"></div>
      <div class="client-info-wrap">
          <div class="avatar">${escapeHtml((c.nome||'?').charAt(0).toUpperCase())}</div>
          <div class="client-info">
            <div class="client-name">${s.veryLate ? '⚠️ ' : ''}${escapeHtml(c.nome)}</div>
        <div class="client-meta">${escapeHtml(c.plano||'-')} &middot; <span title="${phonesVisible?'Telefone visível':'Telefone protegido'}">${escapeHtml(displayPhone(c.telefone))}</span></div>
        ${tagsHtml}
          </div>
      </div>
      <div class="client-right">
        <div class="client-value">${c.parcelado?fmtMoney(financeInfo(c).installment):fmtMoney(c.valor)}<small>${c.parcelado?`${financeInfo(c).total}x · ${financeInfo(c).paid} paga(s)`:'por mês'}</small>${c.parcelado?`<span class="installment-pill">${financeInfo(c).remaining} restante(s)${financeInfo(c).rate?` · juros ${financeInfo(c).rate}%`:''}</span>`:''}</div>
        <div class="dates">
          <span style="color:var(--muted-2)">Próximo vencimento</span><br>
          <b style="color:var(--text)">${fmtDate(c.vencimento)}</b>
        </div>
        <span class="badge ${s.key}">${s.label}</span>
        <div class="primary-actions">
          <button class="btn-mini btn-whats" data-action="lembrar" data-id="${c.id}" title="Enviar cobrança pelo WhatsApp"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a9.5 9.5 0 0 0-8.1 14.5L2.6 21.4l5-1.3A9.5 9.5 0 1 0 12 2Zm0 17.3a7.7 7.7 0 0 1-3.9-1.1l-.3-.2-2.9.8.8-2.8-.2-.3a7.8 7.8 0 1 1 6.5 3.6Zm4.3-5.8c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1-1.4-.7-2.4-1.5-3.2-2.8-.2-.2 0-.4.1-.5l.5-.6.2-.5c.1-.2 0-.4 0-.5L9.5 7c-.2-.5-.5-.4-.7-.4h-.5c-.2 0-.5.1-.7.4-.8.8-1.2 1.7-1.2 2.7 0 1.6 1.2 3.2 1.4 3.4.2.2 2.4 3.7 5.9 5.1 2.1.8 2.9.9 3.9.7.6-.1 1.9-.8 2.2-1.5.3-.7.3-1.3.2-1.5-.1-.1-.3-.2-.5-.3l-2.2-1.1Z"/></svg>Cobrar</button>
          <button class="btn-mini ${hasPaymentInMonth(c)?'btn-ghost':'btn-accent'}" data-action="${hasPaymentInMonth(c)?'desfazer':'pagar'}" data-id="${c.id}" title="${hasPaymentInMonth(c)?'Desfazer pagamento deste mês':'Registrar pagamento'}">${hasPaymentInMonth(c)?'↶ Desfazer pago':'Marcar pago'}</button>
          <button class="btn-mini btn-ghost btn-menu" data-action="menu" data-id="${c.id}" aria-label="Mais ações">•••</button>
          <div class="action-menu" data-menu-id="${c.id}">
            <button data-action="historico" data-id="${c.id}">Histórico</button>
            <button data-action="editar" data-id="${c.id}">Editar cliente</button>
            <button class="danger" data-action="excluir" data-id="${c.id}">Excluir cliente</button>
          </div>
        </div>
      </div>
    `;
    list.appendChild(el);
  });

  const shownEnd=Math.min(start+pageSize,filtered.length);
  document.getElementById('pageInfo').textContent=filtered.length ? `Mostrando ${start+1}–${shownEnd} de ${filtered.length} clientes` : 'Nenhum cliente para mostrar';
  document.getElementById('pageNumber').textContent=`${currentPage} / ${totalPages}`;
  document.getElementById('prevPage').disabled=currentPage===1;
  document.getElementById('nextPage').disabled=currentPage===totalPages;
  const allPageSelected=pageClients.length>0 && pageClients.every(c=>selectedClients.has(c.id));
  document.getElementById('selectAll').checked=allPageSelected;
  updateBulkBar();
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderChart(){
  const wrap = document.getElementById('revenueChart');
  const now = new Date();
  const months = [];
  for(let i=5; i>=0; i--){
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: d.toLocaleDateString('pt-BR', {month:'short'}).replace('.','') });
  }
  const totals = {};
  months.forEach(m => totals[m.key] = 0);

  clients.forEach(c=>{
    const seenMonths=new Set();
    (c.paymentHistory || []).forEach(p=>{
      const key = (p.date||'').slice(0,7);
      if(seenMonths.has(key)) return;
      seenMonths.add(key);
      if(key in totals) totals[key] += Number(p.amount||0);
    });
  });

  const values = months.map(m=>totals[m.key]);
  const current = values[values.length-1];
  const previous = values[values.length-2];
  document.getElementById('chartCurrentValue').textContent = fmtMoney(current);
  const trendEl = document.getElementById('chartTrend');
  if(previous > 0){
    const variation = ((current - previous) / previous) * 100;
    trendEl.textContent = `${variation >= 0 ? '↗' : '↘'} ${Math.abs(variation).toLocaleString('pt-BR',{maximumFractionDigits:1})}% vs. mês anterior`;
    trendEl.className = 'chart-trend ' + (variation > 0 ? '' : variation < 0 ? 'down' : 'neutral');
  } else {
    trendEl.textContent = current > 0 ? 'Primeiro mês registrado' : 'Sem comparação';
    trendEl.className = 'chart-trend neutral';
  }

  if(!values.some(v=>v>0)){
    wrap.innerHTML = `<div class="chart-empty gp-chart-empty"><div class="gp-empty-icon">↗</div><div class="gp-empty-copy"><b>Seu gráfico está pronto para começar</b><span>Registre pagamentos como pagos e acompanhe aqui a evolução real da receita mês a mês.</span><button class="btn btn-ghost gp-empty-action" id="gpChartEmptyAction" type="button">${clients.length ? 'Ver clientes' : '+ Cadastrar primeiro cliente'}</button></div></div>`;
    return;
  }

  const W=900, H=220, left=62, right=18, top=16, bottom=34;
  const plotW=W-left-right, plotH=H-top-bottom;
  const rawMax=Math.max(...values,1);
  const magnitude=Math.pow(10, Math.floor(Math.log10(rawMax)));
  const max=Math.ceil(rawMax/magnitude)*magnitude;
  const points=values.map((v,i)=>({x:left+(plotW/(values.length-1))*i,y:top+plotH-(v/max)*plotH,v,label:months[i].label}));
  const linePath=points.map((p,i)=>`${i?'L':'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath=`${linePath} L ${points[points.length-1].x} ${top+plotH} L ${points[0].x} ${top+plotH} Z`;
  const grid=[0,.25,.5,.75,1].map(r=>{
    const y=top+plotH-(r*plotH), val=max*r;
    return `<line class="chart-grid" x1="${left}" y1="${y}" x2="${W-right}" y2="${y}"/><text class="chart-axis-label" x="${left-10}" y="${y+4}" text-anchor="end">${val>=1000?'R$ '+(val/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+'k':'R$ '+Math.round(val)}</text>`;
  }).join('');
  const labels=points.map(p=>`<text class="chart-axis-label" x="${p.x}" y="${H-8}" text-anchor="middle">${escapeHtml(p.label.toUpperCase())}</text>`).join('');
  const circles=points.map((p,i)=>`<circle class="chart-point" cx="${p.x}" cy="${p.y}" r="4" data-index="${i}" tabindex="0" aria-label="${escapeHtml(p.label)}: ${fmtMoney(p.v)}"/>`).join('');
  wrap.innerHTML=`<div class="chart-tooltip" id="chartTooltip"></div><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Gráfico de receita recebida nos últimos seis meses"><defs><linearGradient id="revenueArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#35d6c2" stop-opacity=".30"/><stop offset="100%" stop-color="#35d6c2" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${areaPath}" fill="url(#revenueArea)"/><path class="chart-line" d="${linePath}"/>${circles}${labels}</svg>`;
  const tooltip=wrap.querySelector('#chartTooltip');
  const showTip=(point,el)=>{
    tooltip.innerHTML=`<b>${escapeHtml(point.label.toUpperCase())}</b>${fmtMoney(point.v)} recebidos`;
    tooltip.style.left=(el.cx.baseVal.value/W*100)+'%';
    tooltip.style.top=(el.cy.baseVal.value/H*100)+'%';
    tooltip.style.opacity='1';
  };
  wrap.querySelectorAll('.chart-point').forEach(el=>{
    const point=points[Number(el.dataset.index)];
    el.addEventListener('mouseenter',()=>showTip(point,el));
    el.addEventListener('focus',()=>showTip(point,el));
    el.addEventListener('mouseleave',()=>tooltip.style.opacity='0');
    el.addEventListener('blur',()=>tooltip.style.opacity='0');
  });
}

function renderAgenda(){
  const list=document.getElementById('agendaList');
  if(!list) return;
  const entries=clients
    .map(client=>({client,days:daysUntil(client.vencimento)}))
    .filter(item=>item.days!==null && item.days<=agendaDays)
    .sort((a,b)=>a.days-b.days || (a.client.nome||'').localeCompare(b.client.nome||'', 'pt-BR'));
  const expected=entries.reduce((sum,item)=>sum+Number(item.client.valor||0),0);
  document.getElementById('agendaExpected').textContent=fmtMoney(expected);

  const urgentCount=clients.filter(client=>{
    const days=daysUntil(client.vencimento);
    return days!==null && days<=7;
  }).length;
  const badge=document.getElementById('agendaBadge');
  if(badge){
    badge.textContent=urgentCount>99?'99+':urgentCount;
    badge.classList.remove('show');
    badge.setAttribute('aria-label',`${urgentCount} cobrança${urgentCount===1?'':'s'} pendente${urgentCount===1?'':'s'}`);
  }

  if(!entries.length){
    list.innerHTML='<div class="agenda-empty gp-agenda-empty"><div class="gp-empty-icon">✓</div><div class="gp-empty-copy"><b>Nenhuma cobrança neste período</b><span>Sua agenda está tranquila. Quando houver um vencimento, ele aparecerá aqui automaticamente.</span></div></div>';
    return;
  }
  list.innerHTML=entries.map(({client,days})=>{
    const statusClass=days<0?'late':days===0?'today':'soon';
    const statusLabel=days<0?`Atrasado ${Math.abs(days)}d`:days===0?'Vence hoje':`Em ${days} dia${days===1?'':'s'}`;
    return `<div class="agenda-row">
      <div class="agenda-client"><span class="agenda-avatar">${escapeHtml((client.nome||'?').charAt(0).toUpperCase())}</span><div><b>${escapeHtml(client.nome||'Cliente')}</b><small>${escapeHtml(displayPhone(client.telefone))}</small></div></div>
      <div class="agenda-date"><b>${fmtDate(client.vencimento)}</b><small>${fmtMoney(client.valor)} por mês</small></div>
      <span class="agenda-status ${statusClass}">${statusLabel}</span>
      <button class="btn-mini btn-whats" data-agenda-action="cobrar" data-id="${client.id}" title="Cobrar pelo WhatsApp">Cobrar</button>
    </div>`;
  }).join('');
}

function render(){
  renderStats();
  renderAgenda();
  renderList();
  renderChart();
  updateNotificationCenter();
}

// Navegação rápida entre as áreas do painel
const navItems=[...document.querySelectorAll('.nav-item[data-target]')];
const navSections=[...new Set(navItems.map(item=>item.dataset.target))]
  .map(id=>document.getElementById(id)).filter(Boolean);
navItems.forEach(item=>item.addEventListener('click',()=>{
  const target=document.getElementById(item.dataset.target);
  if(target) target.scrollIntoView({behavior:'smooth',block:'start'});
}));
let navTicking=false;
function updateActiveNavigation(){
  const marker=window.innerHeight*.36;
  const visibleSections=navSections.filter(section=>section.offsetParent!==null);
  let active=visibleSections[0];
  visibleSections.forEach(section=>{if(section.getBoundingClientRect().top<=marker)active=section;});
  navItems.forEach(item=>item.classList.toggle('active',item.dataset.scrollOnly!=='true' && item.offsetParent!==null && item.dataset.target===active?.id));
  navTicking=false;
}
window.addEventListener('scroll',()=>{
  if(!navTicking){navTicking=true;requestAnimationFrame(updateActiveNavigation);}
},{passive:true});
window.addEventListener('resize',updateActiveNavigation);
updateActiveNavigation();

function updateBulkBar(){
  const count=selectedClients.size;
  document.getElementById('bulkBar').classList.toggle('show',count>0);
  document.getElementById('bulkCount').textContent=`${count} cliente${count===1?'':'s'} selecionado${count===1?'':'s'}`;
}

// form handling
const formCard = document.getElementById('formCard');
const toggleFormBtn = document.getElementById('toggleFormBtn');
const formTitle = document.getElementById('formTitle');

function openForm(client){
  editingId = client ? client.id : null;
  formTitle.textContent = client ? 'Editar cliente' : 'Novo cliente';
  document.getElementById('f-nome').value = client ? client.nome : '';
  document.getElementById('f-telefone').value = client ? client.telefone : '';
  document.getElementById('f-plano').value = client ? client.plano : '';
  document.getElementById('f-valor').value = client ? client.valor : '';
  document.getElementById('f-pagamento').value = client ? client.pagamento : '';
  document.getElementById('f-vencimento').value = client ? client.vencimento : '';
  document.getElementById('f-tags').value = client && Array.isArray(client.tags) ? client.tags.join(', ') : '';
  document.getElementById('f-parcelado').checked = Boolean(client?.parcelado);
  document.getElementById('f-parcelas-total').value = client ? Math.max(1,Number(client.parcelasTotal||1)) : 1;
  document.getElementById('f-parcelas-pagas').value = client ? Math.max(0,Number(client.parcelasPagas||0)) : 0;
  document.getElementById('f-juros-ativo').value = client?.jurosAtivo ? 'sim' : 'nao';
  document.getElementById('f-juros-percentual').value = client ? Math.max(0,Number(client.jurosPercentual||0)) : 0;
  updateFinanceForm();
  formCard.style.display = 'block';
  document.getElementById('f-nome').focus();
}
function closeForm(){
  formCard.style.display = 'none';
  editingId = null;
}


['f-parcelado','f-parcelas-total','f-parcelas-pagas','f-juros-ativo','f-juros-percentual','f-valor'].forEach(id=>{
  document.getElementById(id)?.addEventListener('input',updateFinanceForm);
  document.getElementById(id)?.addEventListener('change',updateFinanceForm);
});

document.getElementById('executiveNewClientBtn')?.addEventListener('click',()=>{
  document.getElementById('clientsSection')?.scrollIntoView({behavior:'smooth',block:'start'});
  setTimeout(()=>toggleFormBtn.click(),220);
});
toggleFormBtn.addEventListener('click', ()=>{
  if(formCard.style.display === 'block'){
    closeForm();
  } else {
    openForm(null);
  }
});
document.getElementById('cancelBtn').addEventListener('click', closeForm);

document.getElementById('saveBtn').addEventListener('click', async ()=>{
  const nome = document.getElementById('f-nome').value.trim();
  if(!nome){ await appAlert('Informe o nome do cliente.','Campo obrigatório'); return; }
  const tagsRaw = document.getElementById('f-tags').value.trim();
  const tags = tagsRaw ? tagsRaw.split(',').map(t=>t.trim()).filter(Boolean) : [];
  const data = {
    nome,
    telefone: document.getElementById('f-telefone').value.trim(),
    plano: document.getElementById('f-plano').value.trim(),
    valor: parseFloat(document.getElementById('f-valor').value) || 0,
    pagamento: document.getElementById('f-pagamento').value,
    vencimento: document.getElementById('f-vencimento').value,
    tags,
    parcelado: document.getElementById('f-parcelado').checked,
    parcelasTotal: Math.max(1,parseInt(document.getElementById('f-parcelas-total').value,10)||1),
    parcelasPagas: Math.max(0,parseInt(document.getElementById('f-parcelas-pagas').value,10)||0),
    jurosAtivo: document.getElementById('f-juros-ativo').value==='sim',
    jurosPercentual: Math.max(0,parseFloat(document.getElementById('f-juros-percentual').value)||0)
  };
  if(data.parcelasPagas>data.parcelasTotal) data.parcelasPagas=data.parcelasTotal;
  if(!data.parcelado){ data.parcelasTotal=1; data.parcelasPagas=0; data.jurosAtivo=false; data.jurosPercentual=0; }
  if(editingId){
    const idx = clients.findIndex(c=>c.id===editingId);
    const oldName=clients[idx]?.nome||nome;
    clients[idx] = {...clients[idx], ...data};
    addActivity('cliente', 'Cliente atualizado', `${oldName} teve seus dados atualizados.`);
  } else {
    const paymentHistory = data.pagamento ? [{ date: data.pagamento, amount: data.valor }] : [];
    clients.push({id: uid(), paymentHistory, ...data});
    addActivity('cliente', 'Cliente cadastrado', `${nome} foi adicionado à carteira de clientes.`);
  }
  save();
  closeForm();
  render();
});

function whatsappLink(client){
  let digits = (client.telefone||'').replace(/\D/g,'');
  if(!digits){ return null; }
  // se não tem código de país, assume Brasil (55)
  if(digits.length <= 11){ digits = '55' + digits; }

  const s = statusOf(client);
  const templateKey = s.key === 'late' ? 'late' : (s.key === 'soon' ? 'soon' : 'general');
  const template = messageTemplates[templateKey] || DEFAULT_MESSAGE_TEMPLATES[templateKey];
  const mensagem = renderMessageTemplate(template, client);
  return `https://wa.me/${digits}?text=${encodeURIComponent(mensagem)}`;
}

document.querySelectorAll('.agenda-tab').forEach(tab=>tab.addEventListener('click',()=>{
  agendaDays=Number(tab.dataset.agendaDays);
  document.querySelectorAll('.agenda-tab').forEach(item=>item.classList.toggle('active',item===tab));
  renderAgenda();
}));
document.getElementById('agendaList').addEventListener('click',async e=>{
  const btn=e.target.closest('[data-agenda-action="cobrar"]');
  if(!btn) return;
  const client=clients.find(item=>item.id===btn.dataset.id);
  if(!client) return;
  const link=whatsappLink(client);
  if(!link){ await appAlert('Este cliente não tem telefone/WhatsApp cadastrado.','WhatsApp não encontrado'); return; }
  addActivity('whatsapp', 'Cobrança aberta no WhatsApp', `Foi preparada uma cobrança para ${client.nome}.`);
  window.open(link,'_blank');
});

document.getElementById('clientList').addEventListener('click', async (e)=>{
  const checkbox=e.target.closest('.select-client');
  if(checkbox){
    checkbox.checked ? selectedClients.add(checkbox.dataset.id) : selectedClients.delete(checkbox.dataset.id);
    updateBulkBar();
    return;
  }
  const btn = e.target.closest('button[data-action]');
  if(!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  const client = clients.find(c=>c.id===id);
  if(!client) return;

  if(action==='menu'){
    const menu=document.querySelector(`[data-menu-id="${id}"]`);
    document.querySelectorAll('.action-menu.open').forEach(m=>{if(m!==menu){m.classList.remove('open');m.closest('.client')?.classList.remove('menu-open')}});
    menu.classList.toggle('open');
    menu.closest('.client')?.classList.toggle('menu-open',menu.classList.contains('open'));
    return;
  }
  document.querySelectorAll('.action-menu.open').forEach(m=>{m.classList.remove('open');m.closest('.client')?.classList.remove('menu-open')});

  if(action==='lembrar'){
    const link = whatsappLink(client);
    if(!link){
      await appAlert('Este cliente não tem telefone/WhatsApp cadastrado.','WhatsApp não encontrado');
      return;
    }
    window.open(link, '_blank');
    return;
  }

  if(action==='historico'){
    openHistory(client);
    return;
  }

  if(action==='excluir'){
    if(await appConfirm(`Excluir o cliente "${client.nome}"?`,'Excluir cliente',{tone:'danger',confirmText:'Excluir'})){
      addActivity('cliente', 'Cliente excluído', `${client.nome} foi removido do cadastro.`);
      clients = clients.filter(c=>c.id!==id);
      selectedClients.delete(id);
      save();
      render();
    }
  } else if(action==='editar'){
    openForm(client);
  } else if(action==='desfazer'){
    const index=paymentIndexInMonth(client);
    if(index<0) return;
    const payment=client.paymentHistory[index];
    const legacyWarning=payment.previousDueDate ? '' : '\n\nEste é um registro antigo; o vencimento atual será mantido.';
    if(await appConfirm(`Desfazer o pagamento de ${client.nome} referente a ${fmtDate(payment.date)}?${legacyWarning}`,'Desfazer pagamento',{confirmText:'Desfazer'})){
      const removedWasInstallment=Boolean(payment.installmentNumber);
      removePayment(client,index);
      if(removedWasInstallment && client.parcelado) client.parcelasPagas=Math.max(0,Number(client.parcelasPagas||0)-1);
      addActivity('pagamento', 'Pagamento desfeito', `O pagamento de ${client.nome} foi revertido.`);
      save();
      render();
    }
  } else if(action==='pagar'){
    const today = new Date();
    const iso = today.toISOString().slice(0,10);
    if(hasPaymentInMonth(client, iso.slice(0,7))){
      await appAlert(`O pagamento de ${client.nome} já foi registrado neste mês.`,'Pagamento já registrado');
      return;
    }
    if(!Array.isArray(client.paymentHistory)) client.paymentHistory = [];
    const previousDueDate=client.vencimento||'';
    // empurra vencimento 30 dias a partir de hoje
    const next = new Date(today);
    next.setDate(next.getDate() + 30);
    const nextDueDate=next.toISOString().slice(0,10);
    const fin=financeInfo(client);
    const paymentAmount=client.parcelado ? fin.installment : Number(client.valor||0);
    client.paymentHistory.push({
      date:iso,
      amount:paymentAmount,
      referenceMonth:iso.slice(0,7),
      previousDueDate,
      nextDueDate,
      installmentNumber:client.parcelado ? Math.min(fin.total,fin.paid+1) : null,
      installmentsTotal:client.parcelado ? fin.total : null
    });
    if(client.parcelado) client.parcelasPagas=Math.min(fin.total,fin.paid+1);
    client.pagamento=iso;
    client.vencimento=nextDueDate;
    addActivity('pagamento', 'Pagamento registrado', `${client.nome} foi marcado como pago em ${fmtMoney(paymentAmount)}${client.parcelado?` · parcela ${client.parcelasPagas}/${fin.total}`:''}.`);
    save();
    render();
  }
});

document.getElementById('search').addEventListener('input', ()=>{currentPage=1;renderList();});
document.getElementById('filter').addEventListener('change', ()=>{currentPage=1;syncQuickFilters();renderList();});
document.getElementById('sort').addEventListener('change', ()=>{currentPage=1;renderList();});
document.getElementById('privacyToggleBtn').addEventListener('click',()=>{
  phonesVisible=!phonesVisible;
  const btn=document.getElementById('privacyToggleBtn');
  btn.classList.toggle('active',phonesVisible);
  btn.setAttribute('aria-pressed',String(phonesVisible));
  btn.title=phonesVisible?'Ocultar telefones':'Mostrar telefones';
  document.getElementById('privacyIcon').textContent=phonesVisible?'🙈':'👁';
  document.getElementById('privacyText').textContent=phonesVisible?'Ocultar telefones':'Mostrar telefones';
  renderList();
});
document.getElementById('quickFilters').addEventListener('click',e=>{
  const btn=e.target.closest('.quick-filter'); if(!btn)return;
  document.getElementById('filter').value=btn.dataset.filter;
  currentPage=1;syncQuickFilters();renderList();
});
function syncQuickFilters(){
  const value=document.getElementById('filter').value;
  document.querySelectorAll('.quick-filter').forEach(b=>b.classList.toggle('active',b.dataset.filter===value));
}
document.getElementById('prevPage').addEventListener('click',()=>{if(currentPage>1){currentPage--;renderList();}});
document.getElementById('nextPage').addEventListener('click',()=>{currentPage++;renderList();});
document.getElementById('selectAll').addEventListener('change',e=>{
  document.querySelectorAll('.select-client').forEach(cb=>{cb.checked=e.target.checked;e.target.checked?selectedClients.add(cb.dataset.id):selectedClients.delete(cb.dataset.id)});
  updateBulkBar();
});
document.getElementById('bulkClearBtn').addEventListener('click',()=>{selectedClients.clear();renderList();});
document.getElementById('bulkWhatsappBtn').addEventListener('click',async ()=>{
  const chosen=clients.filter(c=>selectedClients.has(c.id) && whatsappLink(c));
  if(!chosen.length){await appAlert('Os clientes selecionados não possuem telefone cadastrado.','WhatsApp não encontrado');return;}
  if(!(await appConfirm(`Abrir ${chosen.length} cobrança${chosen.length===1?'':'s'} no WhatsApp?`,'Abrir cobranças',{confirmText:'Abrir'})))return;
  chosen.forEach((c,i)=>setTimeout(()=>window.open(whatsappLink(c),'_blank'),i*350));
});
document.addEventListener('click',e=>{if(!e.target.closest('.primary-actions'))document.querySelectorAll('.action-menu.open').forEach(m=>{m.classList.remove('open');m.closest('.client')?.classList.remove('menu-open')});});

// ---------------- Automação WhatsApp ----------------

const waStatusDot = document.getElementById('waStatusDot');
const waStatusText = document.getElementById('waStatusText');
const waConnectBtn = document.getElementById('waConnectBtn');
const waLogoutBtn = document.getElementById('waLogoutBtn');
const qrModal = document.getElementById('qrModal');
const qrImage = document.getElementById('qrImage');
const autoEnabledEl = document.getElementById('autoEnabled');
const autoDaysEl = document.getElementById('autoDays');
const autoSendTimeEl = document.getElementById('autoSendTime');
const autoLogEl = document.getElementById('autoLog');
const autoSentTodayEl = document.getElementById('autoSentToday');
const autoFailedTodayEl = document.getElementById('autoFailedToday');
const autoMonitorStateEl = document.getElementById('autoMonitorState');
const autoMonitorStateDetailEl = document.getElementById('autoMonitorStateDetail');
const autoLastActivityEl = document.getElementById('autoLastActivity');
const autoLastActivityDetailEl = document.getElementById('autoLastActivityDetail');
const autoActivityListEl = document.getElementById('autoActivityList');
const autoHistoryClearBtn = document.getElementById('autoHistoryClearBtn');
const rulerBeforeDaysEl=document.getElementById('rulerBeforeDays');
const rulerLate1DaysEl=document.getElementById('rulerLate1Days');
const rulerLate2DaysEl=document.getElementById('rulerLate2Days');
const rulerPresetStandardBtn=document.getElementById('rulerPresetStandard');
const rulerPreviewEl=document.getElementById('rulerPreview');
const AUTO_ACTIVITY_KEY = 'gestorpro_auto_activity_v1';
let autoActivityHistory = [];

const STATUS_LABELS = {
  disconnected: 'Desconectado',
  connecting: 'Conectando...',
  qr: 'Aguardando leitura do QR code',
  connected: 'Conectado',
  error: 'Erro na conexão'
};

function setWaStatus(status){
  waStatusDot.className = 'status-dot ' + status;
  waStatusText.textContent = STATUS_LABELS[status] || status;
  if(status === 'connected'){
    waConnectBtn.style.display = 'none';
    waLogoutBtn.style.display = 'inline-block';
    qrModal.style.display = 'none';
  } else {
    waConnectBtn.style.display = 'inline-block';
    waLogoutBtn.style.display = 'none';
  }
  if(status !== 'qr'){
    qrModal.style.display = 'none';
  }
  renderAutoMonitor();
}

function normalizeAutoActivity(entry){
  const msg=String(entry?.msg||'Atividade da automação');
  const structured=entry?.source==='automation';
  let type='info';

  if(structured){
    type=entry?.outcome==='sent'?'sent':entry?.outcome==='failed'?'error':'info';
  }else{
    const lower=msg.toLowerCase();

    // Eventos de conexão do WhatsApp são apenas informativos.
    // Eles não podem entrar no contador "Envios hoje".
    if(/whatsapp conectado com sucesso|sessão do whatsapp|sessao do whatsapp|conectando|conectado/.test(lower)){
      type='info';
    }else if(/erro|falha|failed|não foi possível|nao foi possivel|desconectad/.test(lower)){
      type='error';
    }else if(/aguard|qr|atenção|atencao|aviso|limite/.test(lower)){
      type='warning';
    }else if(/mensagem automática enviada|mensagem automatica enviada|mensagem enviada|lembrete enviado|cobrança enviada|cobranca enviada/.test(lower)){
      type='sent';
    }
  }

  return {
    time: entry?.time || new Date().toISOString(),
    msg,
    type,
    source: entry?.source || '',
    outcome: entry?.outcome || '',
    clientName: entry?.clientName || '',
    clientPhone: entry?.clientPhone || '',
    reminderKind: entry?.reminderKind || '',
    reminderLabel: entry?.reminderLabel || '',
    dueDate: entry?.dueDate || '',
    daysUntilDue: Number.isFinite(Number(entry?.daysUntilDue)) ? Number(entry.daysUntilDue) : null,
    error: entry?.error || ''
  };
}
function saveAutoActivityHistory(){
  try{ localStorage.setItem(AUTO_ACTIVITY_KEY,JSON.stringify(autoActivityHistory.slice(0,100))); }catch(_){}
}
function loadAutoActivityHistory(){
  try{
    const saved=JSON.parse(localStorage.getItem(AUTO_ACTIVITY_KEY)||'[]');
    autoActivityHistory=(Array.isArray(saved)?saved:[])
      .slice(0,100)
      .map(item=>{
        // Corrige registros antigos que classificaram a conexão do WhatsApp
        // como se fosse uma mensagem automática enviada.
        const msg=String(item?.msg||'').toLowerCase();
        if(item?.source!=='automation' && /whatsapp conectado com sucesso|sessão do whatsapp|sessao do whatsapp|conectando|conectado/.test(msg)){
          return {...item,type:'info',outcome:''};
        }
        return item;
      });
    saveAutoActivityHistory();
  }catch(_){ autoActivityHistory=[]; }
}
function sameLocalDay(a,b=new Date()){
  const d=new Date(a);
  return d.getFullYear()===b.getFullYear() && d.getMonth()===b.getMonth() && d.getDate()===b.getDate();
}
function renderAutoMonitor(){
  if(!autoActivityListEl)return;
  const today=new Date();
  const todayItems=autoActivityHistory.filter(x=>sameLocalDay(x.time,today));
  const sent=todayItems.filter(x=>x.type==='sent').length;
  const failed=todayItems.filter(x=>x.type==='error').length;
  if(autoSentTodayEl) autoSentTodayEl.textContent=String(sent);
  if(autoFailedTodayEl) autoFailedTodayEl.textContent=String(failed);

  if(autoMonitorStateEl){
    autoMonitorStateEl.textContent=autoEnabledEl?.checked?'Ligada':'Desligada';
    autoMonitorStateEl.style.color=autoEnabledEl?.checked?'var(--green)':'';
  }
  if(autoMonitorStateDetailEl){
    const days=parseInt(autoDaysEl?.value,10)||0;
    autoMonitorStateDetailEl.textContent=autoEnabledEl?.checked
      ? (days===0?'Avisos no dia do vencimento':`Avisos com ${days} dia${days===1?'':'s'} de antecedência`)
      : 'Envios automáticos desativados';
  }

  const latest=autoActivityHistory[0];
  if(latest){
    const d=new Date(latest.time);
    if(autoLastActivityEl) autoLastActivityEl.textContent=d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    if(autoLastActivityDetailEl) autoLastActivityDetailEl.textContent=latest.msg;
  }else{
    if(autoLastActivityEl) autoLastActivityEl.textContent='—';
    if(autoLastActivityDetailEl) autoLastActivityDetailEl.textContent='Nenhuma atividade registrada';
  }

  if(!autoActivityHistory.length){
    autoActivityListEl.innerHTML='<div class="auto-activity-empty">As atividades da automação aparecerão aqui conforme o Gestor Pro trabalhar.</div>';
    return;
  }
  autoActivityListEl.innerHTML=autoActivityHistory.slice(0,40).map(item=>{
    const d=new Date(item.time);
    const icon=item.type==='sent'?'✓':item.type==='error'?'!':item.type==='warning'?'⚠':'•';
    const cls=item.type==='error'?' error':item.type==='warning'?' warning':'';

    let title=item.msg;
    let subtitle=item.type==='sent'?'Envio concluído':item.type==='error'?'Falha / erro':item.type==='warning'?'Atenção':'Atividade';

    if(item.source==='automation'){
      title=item.clientName || 'Cliente';
      const parts=[];
      if(item.reminderLabel) parts.push(item.reminderLabel);
      parts.push(item.outcome==='sent'?'Enviada com sucesso':'Falha no envio');
      if(item.dueDate){
        const due=new Date(item.dueDate+'T00:00:00');
        if(!Number.isNaN(due.getTime())) parts.push(`venc. ${due.toLocaleDateString('pt-BR')}`);
      }
      subtitle=parts.join(' · ');
      if(item.error) subtitle+=` · ${item.error}`;
    }

    return `<div class="auto-activity-row${cls}">
      <div class="auto-activity-icon">${icon}</div>
      <div class="auto-activity-main">
        <b>${escapeHtml(title)}</b>
        <span>${escapeHtml(subtitle)}</span>
      </div>
      <div class="auto-activity-time">${d.toLocaleDateString('pt-BR')} · ${d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>
    </div>`;
  }).join('');
}
function addLogLine(entry){
  const normalized=normalizeAutoActivity(entry);
  autoActivityHistory.unshift(normalized);
  autoActivityHistory=autoActivityHistory.slice(0,100);
  saveAutoActivityHistory();
  renderAutoMonitor();

  // Mantém o log legado internamente para não alterar integrações existentes.
  if(autoLogEl){
    const time = new Date(normalized.time).toLocaleTimeString('pt-BR');
    const line = document.createElement('div');
    line.textContent = `[${time}] ${normalized.msg}`;
    autoLogEl.prepend(line);
    while(autoLogEl.children.length > 30) autoLogEl.removeChild(autoLogEl.lastChild);
  }
}

waConnectBtn.addEventListener('click', () => {
  window.api.startWhatsapp();
});
waLogoutBtn.addEventListener('click', async () => {
  if(await appConfirm('Desconectar o WhatsApp deste programa?','Desconectar WhatsApp',{confirmText:'Desconectar'})){
    window.api.logoutWhatsapp();
  }
});
document.getElementById('qrCloseBtn').addEventListener('click', () => {
  qrModal.style.display = 'none';
});

window.api.onQr((dataUrl) => {
  qrImage.src = dataUrl;
  qrModal.style.display = 'flex';
});
window.api.onStatus((status) => setWaStatus(status));
window.api.onLog((entry) => addLogLine(entry));
window.api.onClientsUpdated((updated) => {
  // A automação altera apenas metadados locais (ex.: lastAutoReminder).
  // Não substituímos os dados atuais vindos do Supabase por uma cópia local.
  const localById=new Map((Array.isArray(updated)?updated:[]).map(item=>[String(item?.id||''),item]));
  clients=clients.map(client=>{
    const local=localById.get(String(client?.id||''));
    return local?.lastAutoReminder
      ? {...client,lastAutoReminder:local.lastAutoReminder}
      : client;
  });
  render();
});

loadAutoActivityHistory();
renderAutoMonitor();
autoHistoryClearBtn?.addEventListener('click',async ()=>{
  if(!(await appConfirm('Limpar o histórico visual da automação neste computador? Isso não altera clientes nem pagamentos.','Limpar histórico',{confirmText:'Limpar'})))return;
  autoActivityHistory=[];
  saveAutoActivityHistory();
  renderAutoMonitor();
});

const DEFAULT_MESSAGE_TEMPLATES = {
  general: `Olá querido(a) cliente *{nome}*,
Passando para lembrar sobre a renovação da sua conta.
Seu plano de *{valor}* vence em:
*{vencimento} 23:59:59*
*Observações:* Deixar campo de descrição em branco ou se precisar coloque *SUPORTE TÉCNICO*
Por favor, nos envie o comprovante de pagamento assim que possível.
É sempre um prazer te atender.`,
  soon: `Olá querido(a) cliente *{nome}*,
*SUA CONTA EXPIRA EM BREVE!*
Seu plano de *{valor}* vence em:
*{vencimento} 23:59:59*
Evite o bloqueio automático do seu sinal
*Observações:* Deixar campo de descrição em branco ou se precisar coloque *SUPORTE TÉCNICO*
Por favor, nos envie o comprovante de pagamento assim que possível.
É sempre um prazer te atender.`,
  late: `Olá querido(a) cliente *{nome}*,
*SUA CONTA ESTÁ VENCIDA!*
Seu plano de *{valor}* venceu em:
*{vencimento} 23:59:59*
Evite o bloqueio automático do seu sinal
*Observações:* Deixar campo de descrição em branco ou se precisar coloque *SUPORTE TÉCNICO*
Por favor, nos envie o comprovante de pagamento assim que possível.
É sempre um prazer te atender.`
};
let messageTemplates={...DEFAULT_MESSAGE_TEMPLATES};
let appLocalSettings={autoEnabled:false,daysBefore:3,sendTime:'09:00',late1Days:2,late2Days:5,messageTemplates:{...DEFAULT_MESSAGE_TEMPLATES}};
let lastMessageTextarea=null;

const messageGeneralEl=document.getElementById('messageGeneral');
const messageSoonEl=document.getElementById('messageSoon');
const messageLateEl=document.getElementById('messageLate');
const messageSaveStatusEl=document.getElementById('messageSaveStatus');
const messagePreviewEl=document.getElementById('messagePreview');
const messageEditorModal=document.getElementById('messageEditorModal');
const messageEditorOpenBtn=document.getElementById('messageEditorOpenBtn');
const messageEditorCloseBtn=document.getElementById('messageEditorCloseBtn');

function renderMessageTemplate(template,client){
  const values={
    nome:String(client?.nome||'Cliente'),
    valor:fmtMoney(client?.valor||0),
    vencimento:fmtDate(client?.vencimento),
    plano:String(client?.plano||'—'),
    telefone:String(client?.telefone||'—')
  };
  return String(template||'').replace(/\{(nome|valor|vencimento|plano|telefone)\}/g,(_match,key)=>values[key]??'');
}
function readMessageEditors(){
  return {
    general:messageGeneralEl?.value?.trim() || DEFAULT_MESSAGE_TEMPLATES.general,
    soon:messageSoonEl?.value?.trim() || DEFAULT_MESSAGE_TEMPLATES.soon,
    late:messageLateEl?.value?.trim() || DEFAULT_MESSAGE_TEMPLATES.late
  };
}
function fillMessageEditors(){
  if(messageGeneralEl) messageGeneralEl.value=messageTemplates.general||DEFAULT_MESSAGE_TEMPLATES.general;
  if(messageSoonEl) messageSoonEl.value=messageTemplates.soon||DEFAULT_MESSAGE_TEMPLATES.soon;
  if(messageLateEl) messageLateEl.value=messageTemplates.late||DEFAULT_MESSAGE_TEMPLATES.late;
}
function setMessageSaveStatus(text,type=''){
  if(!messageSaveStatusEl)return;
  messageSaveStatusEl.textContent=text;
  messageSaveStatusEl.className='message-save-status'+(type?` ${type}`:'');
}
async function persistLocalSettings(){
  appLocalSettings={
    ...appLocalSettings,
    autoEnabled:autoEnabledEl.checked,
    daysBefore:parseInt(autoDaysEl.value,10)||0,
    sendTime:autoSendTimeEl?.value||'09:00',
    late1Days:Math.max(1,parseInt(rulerLate1DaysEl?.value,10)||2),
    late2Days:Math.max(2,parseInt(rulerLate2DaysEl?.value,10)||5),
    messageTemplates:{...messageTemplates}
  };
  await window.api.saveSettings(appLocalSettings);
}
async function loadAutoSettings(){
  const settings = (await window.api.loadSettings()) || {};
  appLocalSettings={...appLocalSettings,...settings};
  messageTemplates={...DEFAULT_MESSAGE_TEMPLATES,...(settings.messageTemplates||{})};
  appLocalSettings.messageTemplates={...messageTemplates};
  autoEnabledEl.checked = !!settings.autoEnabled;
  autoDaysEl.value = settings.daysBefore ?? 3;
  if(autoSendTimeEl) autoSendTimeEl.value=settings.sendTime||'09:00';
  if(rulerBeforeDaysEl) rulerBeforeDaysEl.value=settings.daysBefore ?? 3;
  if(rulerLate1DaysEl) rulerLate1DaysEl.value=settings.late1Days ?? 2;
  if(rulerLate2DaysEl) rulerLate2DaysEl.value=settings.late2Days ?? 5;
  updateRulerPreview();
  fillMessageEditors();
}
async function saveAutoSettings(){
  try{
    await persistLocalSettings();
  }catch(err){
    console.error('Falha ao salvar configurações:',err);
  }
}
async function saveMessageSettings(){
  try{
    messageTemplates=readMessageEditors();
    await persistLocalSettings();
    setMessageSaveStatus('Mensagens salvas ✓','ok');
    setTimeout(()=>setMessageSaveStatus('As alterações ficam salvas neste Gestor Pro.'),2200);
  }catch(err){
    console.error('Falha ao salvar mensagens:',err);
    setMessageSaveStatus('Não foi possível salvar as mensagens.','error');
  }
}
function previewMessageSettings(){
  const sample=clients?.[0] || {nome:'João da Silva',valor:39.90,vencimento:new Date(Date.now()+3*86400000).toISOString().slice(0,10),plano:'Mensal',telefone:'(11) 99999-9999'};
  const current=readMessageEditors();
  if(!messagePreviewEl)return;
  messagePreviewEl.innerHTML=`<b>Prévia — vence em breve</b>${escapeHtml(renderMessageTemplate(current.soon,sample))}`;
  messagePreviewEl.classList.add('show');
}

[messageGeneralEl,messageSoonEl,messageLateEl].filter(Boolean).forEach(el=>{
  el.addEventListener('focus',()=>lastMessageTextarea=el);
  el.addEventListener('input',()=>setMessageSaveStatus('Alterações ainda não salvas.'));
});
document.querySelectorAll('[data-message-var]').forEach(btn=>btn.addEventListener('click',()=>{
  const target=lastMessageTextarea || messageSoonEl || messageGeneralEl;
  if(!target)return;
  const token=btn.dataset.messageVar||'';
  const start=target.selectionStart??target.value.length;
  const end=target.selectionEnd??start;
  target.setRangeText(token,start,end,'end');
  target.focus();
  setMessageSaveStatus('Alterações ainda não salvas.');
}));
function openMessageEditor(){
  if(messageEditorModal) messageEditorModal.style.display='flex';
}
function closeMessageEditor(){
  if(messageEditorModal) messageEditorModal.style.display='none';
}
messageEditorOpenBtn?.addEventListener('click',openMessageEditor);
messageEditorCloseBtn?.addEventListener('click',closeMessageEditor);
messageEditorModal?.addEventListener('click',e=>{ if(e.target===messageEditorModal) closeMessageEditor(); });
document.getElementById('messageSaveBtn')?.addEventListener('click',saveMessageSettings);
document.getElementById('messagePreviewBtn')?.addEventListener('click',previewMessageSettings);
document.getElementById('messageResetBtn')?.addEventListener('click',async ()=>{
  if(!(await appConfirm('Restaurar as três mensagens padrão do Gestor Pro?','Restaurar mensagens',{confirmText:'Restaurar'})))return;
  messageTemplates={...DEFAULT_MESSAGE_TEMPLATES};
  fillMessageEditors();
  setMessageSaveStatus('Mensagens padrão restauradas. Clique em Salvar mensagens.');
  messagePreviewEl?.classList.remove('show');
});

function updateRulerPreview(){
 if(!rulerPreviewEl)return;
 const b=Math.max(1,parseInt(rulerBeforeDaysEl?.value,10)||3),l1=Math.max(1,parseInt(rulerLate1DaysEl?.value,10)||2),l2=Math.max(l1+1,parseInt(rulerLate2DaysEl?.value,10)||5);
 rulerPreviewEl.textContent=`Fluxo ativo: ${b} dia${b===1?'':'s'} antes → no vencimento → ${l1} dia${l1===1?'':'s'} depois → ${l2} dias depois.`;
}
async function saveRulerSettings(){
 let l1=Math.max(1,parseInt(rulerLate1DaysEl.value,10)||2),l2=Math.max(2,parseInt(rulerLate2DaysEl.value,10)||5);
 if(l2<=l1){l2=l1+1;rulerLate2DaysEl.value=l2}
 autoDaysEl.value=Math.max(1,parseInt(rulerBeforeDaysEl.value,10)||3);
 updateRulerPreview(); await saveAutoSettings(); renderAutoMonitor();
}
[rulerBeforeDaysEl,rulerLate1DaysEl,rulerLate2DaysEl].forEach(el=>el?.addEventListener('change',saveRulerSettings));
rulerPresetStandardBtn?.addEventListener('click',async()=>{rulerBeforeDaysEl.value=3;rulerLate1DaysEl.value=2;rulerLate2DaysEl.value=5;await saveRulerSettings();showToast('Régua padrão aplicada.','success')});
autoEnabledEl.addEventListener('change',()=>{saveAutoSettings();renderAutoMonitor();});
autoDaysEl.addEventListener('change',()=>{saveAutoSettings();renderAutoMonitor();});
autoSendTimeEl?.addEventListener('change',()=>{saveAutoSettings();renderAutoMonitor();});

// ---------------- Histórico de pagamentos ----------------

const historyModal = document.getElementById('historyModal');
const historyList = document.getElementById('historyList');
const historyTitle = document.getElementById('historyTitle');

function openHistory(client){
  historyTitle.textContent = `Histórico de pagamentos — ${client.nome}`;
  const payments = Array.isArray(client.paymentHistory) ? client.paymentHistory.map((p,index)=>({...p,_index:index})) : [];
  payments.sort((a,b)=> (b.date||'').localeCompare(a.date||''));
  historyList.innerHTML = payments.length
    ? payments.map(p=>`<div class="history-item"><div class="history-main"><span>${fmtDate(p.date)}</span><span>${fmtMoney(p.amount)}</span></div><button class="history-delete" data-client-id="${client.id}" data-payment-index="${p._index}" title="Excluir este pagamento">Excluir</button></div>`).join('')
    : '<div class="history-empty">Nenhum pagamento registrado ainda.</div>';
  historyModal.style.display = 'flex';
}
historyList.addEventListener('click',async e=>{
  const btn=e.target.closest('.history-delete');
  if(!btn)return;
  const client=clients.find(c=>c.id===btn.dataset.clientId);
  const index=Number(btn.dataset.paymentIndex);
  if(!client || !client.paymentHistory?.[index])return;
  const payment=client.paymentHistory[index];
  const legacyWarning=payment.previousDueDate ? '' : '\n\nSe for um registro antigo, o vencimento atual será mantido.';
  if(await appConfirm(`Excluir o pagamento de ${fmtDate(payment.date)} no valor de ${fmtMoney(payment.amount)}?${legacyWarning}`,'Excluir pagamento',{tone:'danger',confirmText:'Excluir'})){
    removePayment(client,index);
    save();
    render();
    openHistory(client);
  }
});
document.getElementById('historyCloseBtn').addEventListener('click', ()=>{
  historyModal.style.display = 'none';
});

// ---------------- Exportar CSV ----------------

async function downloadBlob(content, filename, mime){
  if(window.GestorProPlatform?.isAndroid && window.GestorProBridge?.shareTextFile){
    const nativeResult=await window.GestorProBridge.shareTextFile(content,filename,mime);
    if(nativeResult?.ok) return true;
    console.warn('Exportação nativa indisponível; usando fallback web:',nativeResult?.error||'');
  }

  const blob = new Blob([content], {type: mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

document.getElementById('exportCsvBtn').addEventListener('click', ()=>{
  const header = ['Nome','Telefone','Plano','Valor','Tags','Pagamento','Vencimento','Status'];
  const rows = clients.map(c=>{
    const s = statusOf(c);
    return [
      c.nome, c.telefone||'', c.plano||'',
      Number(c.valor||0).toFixed(2).replace('.',','),
      (c.tags||[]).join('; '),
      fmtDate(c.pagamento), fmtDate(c.vencimento), s.label
    ];
  });
  const csv = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(';'))
    .join('\r\n');
  const bom = '\uFEFF'; // garante acentuação correta ao abrir no Excel
  downloadBlob(bom + csv, `clientes_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv;charset=utf-8');
});

document.getElementById('bulkExportBtn').addEventListener('click',()=>{
  const chosen=clients.filter(c=>selectedClients.has(c.id));
  if(!chosen.length)return;
  const header=['Nome','Telefone','Plano','Valor','Tags','Pagamento','Vencimento','Status'];
  const rows=chosen.map(c=>[c.nome,c.telefone||'',c.plano||'',Number(c.valor||0).toFixed(2).replace('.',','),(c.tags||[]).join('; '),fmtDate(c.pagamento),fmtDate(c.vencimento),statusOf(c).label]);
  const csv=[header,...rows].map(row=>row.map(cell=>`"${String(cell).replace(/"/g,'""')}"`).join(';')).join('\r\n');
  downloadBlob('\uFEFF'+csv,`clientes_selecionados_${new Date().toISOString().slice(0,10)}.csv`,'text/csv;charset=utf-8');
});

// ---------------- Backup manual ----------------

document.getElementById('backupBtn').addEventListener('click', ()=>{
  const backup = { versao: 1, exportadoEm: new Date().toISOString(), clients };
  downloadBlob(JSON.stringify(backup, null, 2), `backup_painel_clientes_${new Date().toISOString().slice(0,10)}.json`, 'application/json');
});

document.getElementById('importBtn').addEventListener('click', ()=>{
  document.getElementById('importFile').click();
});
document.getElementById('importFile').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      const imported = Array.isArray(data) ? data : data.clients;
      if(!Array.isArray(imported)) throw new Error('Formato inválido');
      if(await appConfirm(`Importar ${imported.length} cliente(s)? Isso vai SUBSTITUIR os clientes cadastrados atualmente.`,'Importar backup',{confirmText:'Importar'})){
        clients = imported;
        await save();
        addActivity('sistema', 'Backup importado', `${imported.length} cliente(s) foram importados para o Gestor Pro.`);
        render();
        await appAlert('Backup importado com sucesso.','Importação concluída');
      }
    } catch(err){
      await appAlert('Não foi possível ler esse arquivo de backup. Verifique se é o arquivo correto.','Erro ao importar');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});



// Sincroniza os dados da empresa quando a sessão autenticada é restaurada.
window.addEventListener('load',()=>{
  setTimeout(async()=>{
    try{
      if(currentAuthUser) await hydrateCompanySettingsFromAccount();
      applyCompanySettings();
    }catch(err){
      console.warn('Falha ao restaurar configurações da empresa:',err);
    }
  },700);
});

// ---------------- Central de Notificações / Histórico / Empresa ----------------
function userScopedKey(base){
  return `${base}_${currentAuthUser?.id || 'local'}`;
}

function safeJsonParse(raw,fallback){
  try{return raw?JSON.parse(raw):fallback;}catch(_e){return fallback;}
}

// Histórico de atividade
function loadActivityLog(){
  return safeJsonParse(localStorage.getItem(userScopedKey('gestor_pro_activity_v1')),[]);
}
function saveActivityLog(items){
  localStorage.setItem(userScopedKey('gestor_pro_activity_v1'),JSON.stringify((items||[]).slice(0,300)));
}
function addActivity(type,title,description=''){
  const items=loadActivityLog();
  items.unshift({id:(crypto?.randomUUID?.()||String(Date.now()+Math.random())),type,title,description,time:new Date().toISOString()});
  saveActivityLog(items);
  renderActivityLog();
}
function activityIcon(type){
  return type==='pagamento'?'$':type==='whatsapp'?'W':type==='cliente'?'C':'•';
}
function renderActivityLog(){
  const list=document.getElementById('activityList'); if(!list)return;
  const q=(document.getElementById('activitySearch')?.value||'').trim().toLowerCase();
  const filter=document.getElementById('activityFilter')?.value||'all';
  const items=loadActivityLog().filter(item=>{
    const matchesType=filter==='all'||item.type===filter;
    const hay=`${item.title||''} ${item.description||''}`.toLowerCase();
    return matchesType && (!q||hay.includes(q));
  });
  if(!items.length){list.innerHTML='<div class="feature-empty">Nenhuma atividade encontrada.<br>As próximas ações importantes do sistema aparecerão aqui.</div>';return;}
  list.innerHTML=items.map(item=>{
    const d=new Date(item.time); const date=Number.isNaN(d.getTime())?'':d.toLocaleDateString('pt-BR');
    const time=Number.isNaN(d.getTime())?'':d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    return `<div class="activity-item"><div class="activity-icon">${activityIcon(item.type)}</div><div class="activity-copy"><b>${escapeHtml(item.title||'Atividade')}</b><span>${escapeHtml(item.description||'')}</span></div><div class="activity-time">${date}<br>${time}</div></div>`;
  }).join('');
}

// Configurações da empresa
const DEFAULT_COMPANY_SETTINGS={name:'',owner:'',whatsapp:'',email:'',city:'',document:'',description:''};

function companyStorageKey(){
  return userScopedKey('gestor_pro_company_v2');
}

function legacyCompanyStorageKey(){
  return userScopedKey('gestor_pro_company_v1');
}

function normalizeCompanySettings(value){
  const data=(value && typeof value==='object')?value:{};
  return {
    ...DEFAULT_COMPANY_SETTINGS,
    name:String(data.name||''),
    owner:String(data.owner||''),
    whatsapp:String(data.whatsapp||''),
    email:String(data.email||''),
    city:String(data.city||''),
    document:String(data.document||''),
    description:String(data.description||'')
  };
}

function loadCompanySettings(){
  // 1) cache local da conta atual
  const current=safeJsonParse(localStorage.getItem(companyStorageKey()),null);
  if(current) return normalizeCompanySettings(current);

  // 2) migra automaticamente os dados que já existiam na versão anterior
  const legacy=safeJsonParse(localStorage.getItem(legacyCompanyStorageKey()),null);
  if(legacy){
    const migrated=normalizeCompanySettings(legacy);
    localStorage.setItem(companyStorageKey(),JSON.stringify(migrated));
    return migrated;
  }

  // 3) fallback para os metadados persistentes da conta Supabase
  const cloud=currentAuthUser?.user_metadata?.gestor_pro_company;
  if(cloud){
    const restored=normalizeCompanySettings(cloud);
    localStorage.setItem(companyStorageKey(),JSON.stringify(restored));
    return restored;
  }

  return {...DEFAULT_COMPANY_SETTINGS};
}

async function saveCompanySettings(settings){
  const normalized=normalizeCompanySettings(settings);

  // Salva imediatamente no computador para a interface nunca perder os dados.
  localStorage.setItem(companyStorageKey(),JSON.stringify(normalized));
  localStorage.setItem(legacyCompanyStorageKey(),JSON.stringify(normalized));

  // Salva também na própria conta do Supabase. Assim os dados voltam
  // mesmo após fechar/reabrir o programa ou entrar em outro computador.
  if(supabaseClient && currentAuthUser){
    const {data,error}=await supabaseClient.auth.updateUser({
      data:{gestor_pro_company:normalized}
    });
    if(error) throw error;
    if(data?.user) currentAuthUser=data.user;
  }

  return normalized;
}

async function hydrateCompanySettingsFromAccount(){
  if(!supabaseClient || !currentAuthUser) return loadCompanySettings();

  try{
    const {data,error}=await supabaseClient.auth.getUser();
    if(error) throw error;
    if(data?.user) currentAuthUser=data.user;

    const cloud=currentAuthUser?.user_metadata?.gestor_pro_company;
    const local=safeJsonParse(localStorage.getItem(companyStorageKey()),null);

    if(cloud){
      const normalized=normalizeCompanySettings(cloud);
      localStorage.setItem(companyStorageKey(),JSON.stringify(normalized));
      localStorage.setItem(legacyCompanyStorageKey(),JSON.stringify(normalized));
      return normalized;
    }

    // Se havia configuração local antiga, envia para a conta uma única vez.
    if(local){
      await saveCompanySettings(local);
      return normalizeCompanySettings(local);
    }
  }catch(err){
    console.warn('Não foi possível sincronizar as configurações da empresa com a conta:',err);
  }

  return loadCompanySettings();
}
function fillCompanyForm(){
  const s=loadCompanySettings();
  const map={companyName:'name',companyOwner:'owner',companyWhatsapp:'whatsapp',companyEmail:'email',companyCity:'city',companyDocument:'document',companyDescription:'description'};
  Object.entries(map).forEach(([id,key])=>{const el=document.getElementById(id);if(el)el.value=s[key]||'';});
  updateCompanyPreview();
}
function readCompanyForm(){
  return {
    name:(document.getElementById('companyName')?.value||'').trim(),
    owner:(document.getElementById('companyOwner')?.value||'').trim(),
    whatsapp:(document.getElementById('companyWhatsapp')?.value||'').trim(),
    email:(document.getElementById('companyEmail')?.value||'').trim(),
    city:(document.getElementById('companyCity')?.value||'').trim(),
    document:(document.getElementById('companyDocument')?.value||'').trim(),
    description:(document.getElementById('companyDescription')?.value||'').trim()
  };
}
function updateCompanyPreview(){
  const s=readCompanyForm();
  const name=s.name||'Gestor Pro';
  const desc=s.description||'Gestão inteligente de clientes e mensalidades';
  const n=document.getElementById('companyPreviewName'); if(n)n.textContent=name;
  const d=document.getElementById('companyPreviewDescription'); if(d)d.textContent=desc;
}
function applyCompanySettings(){
  const s=loadCompanySettings();
  const subtitle=document.getElementById('clientCountLabel');
  if(subtitle) subtitle.textContent=s.description||'Gestão inteligente de clientes e mensalidades';
  document.title=s.name?`${s.name} · Gestor Pro`:'Gestor Pro — Clientes Online';
}


// ---------------- Primeiro acesso / Boas-vindas ----------------
const onboardingModal=document.getElementById('onboardingModal');

function onboardingStorageKey(){
  return `gestor_pro_onboarding_${currentAuthUser?.id||'local'}_v2`;
}
function onboardingWasSeen(){
  try{return localStorage.getItem(onboardingStorageKey())==='1';}
  catch(_e){return false;}
}
function markOnboardingSeen(){
  try{localStorage.setItem(onboardingStorageKey(),'1');}catch(_e){}
}
function onboardingState(){
  const all=Array.isArray(clients)?clients:[];
  const hasClient=all.length>0;
  const hasBilling=all.some(c=>Number(c?.valor||0)>0 && !!c?.vencimento);
  const auto=document.getElementById('autoEnabled');
  const hasCharge=!!auto?.checked;
  const wa=document.getElementById('waStatusDot');
  const hasWhatsapp=!!wa?.classList.contains('connected');
  return {
    account:true,
    client:hasClient,
    billing:hasBilling,
    charge:hasCharge,
    whatsapp:hasWhatsapp
  };
}
function updateOnboardingProgress(){
  const state=onboardingState();
  const map={
    account:'onboardingStepAccount',
    client:'onboardingStepClient',
    billing:'onboardingStepBilling',
    charge:'onboardingStepCharge',
    whatsapp:'onboardingStepWhatsapp'
  };
  Object.entries(map).forEach(([key,id])=>{
    const card=document.getElementById(id); if(!card)return;
    const done=!!state[key];
    card.classList.toggle('is-done',done);
    const label=card.querySelector('.onboarding-step-state');
    if(label)label.textContent=done?'Concluído':'Pendente';
  });
  const done=Object.values(state).filter(Boolean).length;
  const pct=done*20;
  const bar=document.getElementById('onboardingProgressBar');
  const text=document.getElementById('onboardingProgressText');
  if(bar)bar.style.width=`${pct}%`;
  if(text)text.textContent=pct===100?'100% concluído · Tudo pronto!':`${pct}% concluído`;
  return {state,done,pct};
}
function openOnboarding({manual=false}={}){
  if(!onboardingModal || !currentAuthUser)return;
  if(!manual && onboardingWasSeen())return;

  const authGate=document.getElementById('authGate');
  const billingGate=document.getElementById('billingGate');
  const authVisible=authGate && !authGate.classList.contains('hidden');
  const billingVisible=billingGate && !billingGate.classList.contains('hidden');
  if(authVisible || billingVisible)return;

  // Primeiro acesso automático é voltado principalmente para contas ainda sem clientes.
  // Se a conta já está em uso, não interrompe o usuário.
  if(!manual && Array.isArray(clients) && clients.length>0){
    markOnboardingSeen();
    return;
  }

  onboardingModal.dataset.manual=manual?'1':'0';
  updateOnboardingProgress();
  onboardingModal.style.display='flex';
}
function closeOnboarding({remember=true}={}){
  if(!onboardingModal)return;
  if(remember)markOnboardingSeen();
  onboardingModal.style.display='none';
}
function scheduleFirstOnboarding(){
  if(!currentAuthUser || onboardingWasSeen())return;
  clearTimeout(window.__gestorProOnboardingTimer);
  window.__gestorProOnboardingTimer=setTimeout(()=>openOnboarding(),550);
}
function onboardingGoToClient(){
  closeOnboarding({remember:false});
  const target=document.getElementById('clientsSection');
  target?.scrollIntoView({behavior:'smooth',block:'start'});
  setTimeout(()=>{
    const form=document.getElementById('formCard');
    if(form?.style.display==='none' || getComputedStyle(form).display==='none'){
      document.getElementById('toggleFormBtn')?.click();
    }
    setTimeout(()=>document.getElementById('f-nome')?.focus(),180);
  },260);
}
function onboardingGoToBilling(){
  onboardingGoToClient();
  setTimeout(()=>document.getElementById('f-valor')?.focus(),420);
}
function onboardingGoToAutomation({connect=false}={}){
  closeOnboarding({remember:false});
  document.querySelector('[data-target="automationSection"]')?.click();
  setTimeout(()=>{
    document.getElementById('autoCard')?.scrollIntoView({behavior:'smooth',block:'center'});
    if(connect) setTimeout(()=>document.getElementById('waConnectBtn')?.click(),300);
  },180);
}

document.getElementById('onboardingClientBtn')?.addEventListener('click',onboardingGoToClient);
document.getElementById('onboardingBillingBtn')?.addEventListener('click',onboardingGoToBilling);
document.getElementById('onboardingChargeBtn')?.addEventListener('click',()=>onboardingGoToAutomation({connect:false}));
document.getElementById('onboardingWhatsappBtn')?.addEventListener('click',()=>onboardingGoToAutomation({connect:true}));
document.getElementById('onboardingSkipBtn')?.addEventListener('click',()=>closeOnboarding({remember:true}));
document.getElementById('onboardingFinishBtn')?.addEventListener('click',()=>{
  closeOnboarding({remember:true});
  document.getElementById('overviewSection')?.scrollIntoView({behavior:'smooth',block:'start'});
});
document.getElementById('companyShowOnboardingBtn')?.addEventListener('click',()=>{
  if(companyModal)companyModal.style.display='none';
  setTimeout(()=>openOnboarding({manual:true}),80);
});
onboardingModal?.addEventListener('keydown',e=>{
  if(e.key==='Escape') closeOnboarding({remember:true});
});
document.getElementById('autoEnabled')?.addEventListener('change',updateOnboardingProgress);
new MutationObserver(()=>updateOnboardingProgress()).observe(
  document.getElementById('waStatusDot')||document.documentElement,
  {attributes:true,attributeFilter:['class']}
);

// Notificações dinâmicas
function dateAtMidnight(value){
  if(!value)return null;
  const d=new Date(`${String(value).slice(0,10)}T00:00:00`);
  return Number.isNaN(d.getTime())?null:d;
}
function buildNotifications(){
  const now=new Date(); const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const items=[]; let late=0,todayCount=0,soon=0;
  (clients||[]).forEach(client=>{
    const due=dateAtMidnight(client.vencimento); if(!due)return;
    const diff=Math.round((due-today)/86400000);
    if(diff<0){
      late++; items.push({kind:'late',icon:'!',title:`${client.nome} está vencido`,text:`Vencimento em ${fmtDate(client.vencimento)} · ${fmtMoney(client.valor||0)}`,clientId:client.id,days:diff});
    }else if(diff===0){
      todayCount++; items.push({kind:'today',icon:'⏱',title:`${client.nome} vence hoje`,text:`Mensalidade de ${fmtMoney(client.valor||0)} vence hoje.`,clientId:client.id,days:diff});
    }else if(diff<=3){
      soon++; items.push({kind:'soon',icon:'↗',title:`${client.nome} vence em ${diff} dia${diff===1?'':'s'}`,text:`Vencimento em ${fmtDate(client.vencimento)} · ${fmtMoney(client.valor||0)}`,clientId:client.id,days:diff});
    }
  });
  if(currentProfile && currentProfile.role!=='admin'){
    const end=currentProfile.current_period_end||currentProfile.trial_end;
    const d=end?new Date(end):null;
    if(d&&!Number.isNaN(d.getTime())){
      const diff=Math.ceil((d-now)/86400000);
      if(diff>=0 && diff<=5) items.unshift({kind:'system',icon:'G',title:'Assinatura do Gestor Pro próxima do vencimento',text:diff===0?'Seu acesso vence hoje.':`Seu acesso vence em ${diff} dia${diff===1?'':'s'}.`});
    }
  }
  const priority={late:0,today:1,soon:2,system:3};
  items.sort((a,b)=>(priority[a.kind]??9)-(priority[b.kind]??9)||(a.days??0)-(b.days??0));
  return {items,late,today:todayCount,soon,total:items.length};
}
function updateNotificationCenter(){
  const data=buildNotifications();

  const badge=document.getElementById('notificationsBadge');
  if(badge){
    badge.textContent=data.total>99?'99+':String(data.total);
    badge.classList.toggle('show',data.total>0);
  }

  const vals={
    notifLateCount:data.late,
    notifTodayCount:data.today,
    notifSoonCount:data.soon,
    notifPartnerCount:0,
    notifTotalCount:data.total
  };
  Object.entries(vals).forEach(([id,value])=>{
    const el=document.getElementById(id);
    if(el)el.textContent=String(value);
  });

  const list=document.getElementById('notificationList');
  if(!list)return;

  if(!data.items.length){
    list.innerHTML='<div class="feature-empty"><b style="color:#b8f7de">✓ Tudo em ordem</b><br>Nenhum vencimento urgente ou aviso importante neste momento.</div>';
    return;
  }

  list.innerHTML=data.items.map(item=>`
    <div class="notification-item ${item.kind}"
      ${item.clientId?`data-notification-client="${item.clientId}"`:''}>
      <div class="notification-icon">${item.icon}</div>
      <div class="notification-copy">
        <b>${escapeHtml(item.title)}</b>
        <span>${escapeHtml(item.text)}</span>
        <small class="notification-route">${item.clientId?'Clique para abrir o cliente':'Clique para abrir a área relacionada'}</small>
      </div>
    </div>
  `).join('');
}

// Abertura/fechamento dos novos painéis
const notificationsModal=document.getElementById('notificationsModal');
const activityModal=document.getElementById('activityModal');
const companyModal=document.getElementById('companyModal');
function bindFeatureModal(openId,modal,closeId,onOpen){
  document.getElementById(openId)?.addEventListener('click',()=>{onOpen?.();modal.style.display='flex';});
  document.getElementById(closeId)?.addEventListener('click',()=>{modal.style.display='none';});
  modal?.addEventListener('click',e=>{if(e.target===modal)modal.style.display='none';});
}
bindFeatureModal('notificationsNavBtn',notificationsModal,'notificationsCloseBtn',updateNotificationCenter);
bindFeatureModal('activityNavBtn',activityModal,'activityCloseBtn',renderActivityLog);
bindFeatureModal('companyNavBtn',companyModal,'companyCloseBtn',async()=>{
  await hydrateCompanySettingsFromAccount();
  fillCompanyForm();
});

document.getElementById('notificationList')?.addEventListener('click',e=>{
  const row=e.target.closest('.notification-item');
  if(!row)return;

  if(row.dataset.notificationClient){
    notificationsModal.style.display='none';
    const search=document.getElementById('search');
    const client=clients.find(c=>String(c.id)===String(row.dataset.notificationClient));
    if(search&&client){
      search.value=client.nome||'';
      currentPage=1;
      renderList();
    }
    document.getElementById('clientsSection')?.scrollIntoView({behavior:'smooth',block:'start'});
    return;
  }

  notificationsModal.style.display='none';
  document.getElementById('billingSection')?.scrollIntoView({
    behavior:'smooth',
    block:'start'
  });
});
document.getElementById('activitySearch')?.addEventListener('input',renderActivityLog);
document.getElementById('activityFilter')?.addEventListener('change',renderActivityLog);
document.getElementById('activityClearBtn')?.addEventListener('click',async()=>{
  if(await appConfirm('Deseja apagar o histórico de atividade deste usuário?','Limpar histórico',{tone:'danger',confirmText:'Limpar'})){
    saveActivityLog([]); renderActivityLog();
  }
});
['companyName','companyOwner','companyWhatsapp','companyEmail','companyCity','companyDocument','companyDescription'].forEach(id=>document.getElementById(id)?.addEventListener('input',updateCompanyPreview));
document.getElementById('companySaveBtn')?.addEventListener('click',async()=>{
  const btn=document.getElementById('companySaveBtn');
  const original=btn?.textContent||'Salvar configurações';
  const data=readCompanyForm();

  try{
    if(btn){btn.disabled=true;btn.textContent='Salvando...';}
    await saveCompanySettings(data);
    applyCompanySettings();
    addActivity('sistema','Configurações da empresa atualizadas',data.name?`Dados de ${data.name} foram salvos.`:'Os dados da empresa foram atualizados.');
    companyModal.style.display='none';
    await appAlert('Configurações salvas na sua conta. Elas continuarão disponíveis depois de fechar e abrir o Gestor Pro.','Empresa atualizada');
  }catch(err){
    console.error('Erro ao salvar configurações da empresa:',err);
    // O cache local já foi salvo; mantemos a tela preenchida e avisamos sobre a nuvem.
    applyCompanySettings();
    await appAlert('Os dados foram salvos neste computador, mas não foi possível sincronizá-los com sua conta agora. Verifique a conexão e tente novamente.','Sincronização pendente');
  }finally{
    if(btn){btn.disabled=false;btn.textContent=original;}
  }
});
document.getElementById('companyResetBtn')?.addEventListener('click',async()=>{
  if(await appConfirm('Restaurar as configurações da empresa?','Restaurar configurações',{confirmText:'Restaurar'})){
    try{
      await saveCompanySettings({...DEFAULT_COMPANY_SETTINGS});
      fillCompanyForm(); applyCompanySettings();
      addActivity('sistema','Configurações da empresa restauradas','Os dados personalizados da empresa foram removidos.');
    }catch(err){
      console.error('Erro ao restaurar configurações da empresa:',err);
      fillCompanyForm(); applyCompanySettings();
      await appAlert('As configurações foram restauradas localmente, mas a sincronização com a conta ficou pendente.','Sincronização pendente');
    }
  }
});




// ---------------- Atualizações automáticas ----------------
const updateModal=document.getElementById('updateModal');
const updateSubtitle=document.getElementById('updateModalSubtitle');
const updateText=document.getElementById('updateModalText');
const updateProgress=document.getElementById('updateProgress');
const updateProgressFill=document.getElementById('updateProgressFill');
const updateProgressText=document.getElementById('updateProgressText');
const updateInstallBtn=document.getElementById('updateInstallBtn');
const updateLaterBtn=document.getElementById('updateLaterBtn');

function openUpdateModal(){
  if(updateModal) updateModal.style.display='flex';
}
function closeUpdateModal(){
  if(updateModal) updateModal.style.display='none';
}

updateLaterBtn?.addEventListener('click',closeUpdateModal);
updateInstallBtn?.addEventListener('click',()=>{
  updateInstallBtn.disabled=true;
  updateInstallBtn.textContent='Reiniciando...';
  window.api?.installUpdateNow?.();
});

window.api?.onUpdateStatus?.((data)=>{
  const status=data?.status||'';
  const version=data?.version||'';

  if(status==='available'){
    if(updateSubtitle) updateSubtitle.textContent=version?`Nova versão ${version} encontrada`:'Nova versão encontrada';
    if(updateText) updateText.textContent='A atualização será baixada automaticamente. Você pode continuar usando o Gestor Pro normalmente.';
    updateProgress?.classList.add('show');
    if(updateInstallBtn) updateInstallBtn.style.display='none';
    openUpdateModal();
  }

  if(status==='downloading'){
    const pct=Math.max(0,Math.min(100,Math.round(Number(data?.percent||0))));
    updateProgress?.classList.add('show');
    if(updateProgressFill) updateProgressFill.style.width=`${pct}%`;
    if(updateProgressText) updateProgressText.textContent=`${pct}%`;
  }

  if(status==='downloaded'){
    if(updateSubtitle) updateSubtitle.textContent=version?`Versão ${version} pronta para instalar`:'Atualização pronta para instalar';
    if(updateText) updateText.innerHTML='<span class="update-status-dot"></span>A atualização já foi baixada. Você pode reiniciar agora ou continuar trabalhando; ela será aplicada automaticamente ao fechar o Gestor Pro.';
    updateProgress?.classList.remove('show');
    if(updateInstallBtn){
      updateInstallBtn.style.display='inline-flex';
      updateInstallBtn.disabled=false;
      updateInstallBtn.textContent='Reiniciar e atualizar';
    }
    openUpdateModal();
  }
});

// Mostra a versão real do executável na janela Sobre, inclusive nas versões futuras.
window.api?.getAppVersion?.().then(version=>{
  if(!version)return;
  document.querySelectorAll('.about-version-badge').forEach(el=>el.textContent=`Versão ${version}`);
  const about=document.getElementById('aboutModal');
  if(about){
    about.querySelectorAll('b').forEach(el=>{
      if(/^v\d+\.\d+\.\d+$/.test(el.textContent.trim())) el.textContent=`v${version}`;
      if(/^Gestor Pro · v\d+\.\d+\.\d+$/.test(el.textContent.trim())) el.textContent=`Gestor Pro · v${version}`;
    });
  }
}).catch(()=>{});


// ---------------- Sobre o Gestor Pro ----------------
const aboutModal = document.getElementById('aboutModal');

document.getElementById('aboutNavBtn')?.addEventListener('click',()=>{
  if(aboutModal) aboutModal.style.display='flex';
});
document.getElementById('aboutCloseBtn')?.addEventListener('click',()=>{
  if(aboutModal) aboutModal.style.display='none';
});
aboutModal?.addEventListener('click',(e)=>{
  if(e.target===aboutModal) aboutModal.style.display='none';
});
document.getElementById('aboutSupportBtn')?.addEventListener('click',()=>{
  if(aboutModal) aboutModal.style.display='none';
  setTimeout(()=>document.getElementById('supportNavBtn')?.click(),80);
});

// ---------------- Central de Suporte ----------------
// Coloque aqui somente números, com DDI + DDD. Ex.: 5511999999999
const GESTOR_PRO_SUPPORT_WHATSAPP = '5514998539797';
const GESTOR_PRO_VERSION = '1.0.0';

const supportModal = document.getElementById('supportModal');
document.getElementById('supportNavBtn')?.addEventListener('click',()=>{ supportModal.style.display='flex'; });
document.getElementById('supportCloseBtn')?.addEventListener('click',()=>{ supportModal.style.display='none'; });
supportModal?.addEventListener('click',(e)=>{ if(e.target===supportModal) supportModal.style.display='none'; });

document.getElementById('supportWhatsBtn')?.addEventListener('click',async()=>{
  if(!GESTOR_PRO_SUPPORT_WHATSAPP){
    await appAlert('O número do WhatsApp de suporte não está configurado.','WhatsApp do suporte');
    return;
  }
  const email = currentAuthUser?.email || document.getElementById('accountEmail')?.textContent || '';
  const msg = `Olá! Preciso de suporte no Gestor Pro.${email ? `\nMinha conta: ${email}` : ''}`;
  window.open(`https://wa.me/${GESTOR_PRO_SUPPORT_WHATSAPP}?text=${encodeURIComponent(msg)}`,'_blank','noopener,noreferrer');
});


// ---------------- Clientes em destaque + Ficha completa ----------------
let clientProfileCurrentId=null;
function gpEsc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function gpClientDays(c){try{return daysUntil(c.vencimento)}catch(_e){const d=new Date(String(c.vencimento)+'T12:00:00'),n=new Date();n.setHours(12,0,0,0);return Math.ceil((d-n)/86400000);}}
function gpClientStatus(c){
  const d=gpClientDays(c);
  if(d<0)return {label:`Atrasado ${Math.abs(d)}d`,cls:'late'};
  if(d===0)return {label:'Vence hoje',cls:'today'};
  if(d<=7)return {label:`Em ${d}d`,cls:'soon'};
  return {label:`Em dia (${d}d)`,cls:'ok'};
}
function renderDashboardClientPreview(){
  const box=document.getElementById('dashboardClientPreviewList'); if(!box)return;
  const list=(Array.isArray(clients)?clients:[]).slice().sort((a,b)=>gpClientDays(a)-gpClientDays(b)).slice(0,5);
  if(!list.length){box.innerHTML='<div class="agenda-empty">Nenhum cliente cadastrado ainda.</div>';return;}
  box.innerHTML=list.map(c=>{
    const st=gpClientStatus(c), initial=gpEsc((c.nome||'C').trim().charAt(0).toUpperCase());
    return `<div class="dashboard-client-preview-row" data-profile-client="${gpEsc(c.id)}">
      <div class="dashboard-client-preview-main"><div class="avatar">${initial}</div><div><b>${gpEsc(c.nome||'Cliente')}</b><small>${gpEsc(c.plano||c.tag||'Cliente')}</small></div></div>
      <div class="dashboard-client-preview-cell"><span>Mensalidade</span><b>${fmtMoney(Number(c.valor)||0)}</b></div>
      <div class="dashboard-client-preview-cell"><span>Próximo vencimento</span><b>${fmtDate(c.vencimento)}</b></div>
      <div><span class="badge ${st.cls==='today'?'soon':st.cls}">${gpEsc(st.label)}</span></div>
    </div>`;
  }).join('');
}
function gpPaymentRows(c){
  const h=Array.isArray(c?.paymentHistory)?c.paymentHistory:(Array.isArray(c?.historico)?c.historico:[]);
  if(!h.length)return '<div class="history-empty">Nenhum pagamento registrado para este cliente.</div>';
  return h.slice().reverse().slice(0,12).map(p=>{
    const date=p.date||p.data||p.paidAt||p.created_at||'';
    const value=p.value??p.valor??c.valor??0;
    const label=p.label||p.mes||p.month||'Pagamento registrado';
    return `<div class="client-profile-history-item"><b>${gpEsc(label)}</b> · ${fmtMoney(Number(value)||0)}<small>${date?gpEsc(String(date)):'Data não informada'}</small></div>`;
  }).join('');
}
function openClientProfile(id){
  const c=(Array.isArray(clients)?clients:[]).find(x=>String(x.id)===String(id)); if(!c)return;
  clientProfileCurrentId=String(c.id); const st=gpClientStatus(c);
  document.getElementById('clientProfileAvatar').textContent=(c.nome||'C').trim().charAt(0).toUpperCase();
  document.getElementById('clientProfileName').textContent=c.nome||'Cliente';
  document.getElementById('clientProfileSubtitle').textContent=`${c.plano||c.tag||'Cliente'} · ${st.label}`;
  document.getElementById('clientProfileKpis').innerHTML=`
    <div class="client-profile-kpi"><span>Mensalidade</span><b>${fmtMoney(Number(c.valor)||0)}</b></div>
    <div class="client-profile-kpi"><span>Vencimento</span><b>${fmtDate(c.vencimento)}</b></div>
    <div class="client-profile-kpi"><span>Status</span><b>${gpEsc(st.label)}</b></div>
    <div class="client-profile-kpi"><span>Pagamentos</span><b>${(Array.isArray(c.paymentHistory)?c.paymentHistory:(Array.isArray(c.historico)?c.historico:[])).length}</b></div>`;
  document.getElementById('clientProfileDetails').innerHTML=`
    <div class="client-profile-line"><span>Nome</span><b>${gpEsc(c.nome||'—')}</b></div>
    <div class="client-profile-line"><span>Telefone</span><b>${gpEsc(c.telefone||'—')}</b></div>
    <div class="client-profile-line"><span>Plano / Tag</span><b>${gpEsc(c.plano||c.tag||'—')}</b></div>
    <div class="client-profile-line"><span>Mensalidade</span><b>${fmtMoney(Number(c.valor)||0)}</b></div>
    <div class="client-profile-line"><span>Próximo vencimento</span><b>${fmtDate(c.vencimento)}</b></div>
    <div class="client-profile-line"><span>Observações</span><b>${gpEsc(c.observacoes||c.observacao||'—')}</b></div>`;
  document.getElementById('clientProfileHistory').innerHTML=gpPaymentRows(c);
  document.getElementById('clientProfileModal').style.display='flex';
}
function closeClientProfile(){document.getElementById('clientProfileModal').style.display='none';clientProfileCurrentId=null;}
document.getElementById('dashboardViewAllClients')?.addEventListener('click',()=>{
  document.getElementById('clientsSection')?.scrollIntoView({behavior:'smooth',block:'start'});
  document.getElementById('search')?.focus();
});
document.getElementById('dashboardClientPreviewList')?.addEventListener('click',e=>{
  const row=e.target.closest('[data-profile-client]'); if(row)openClientProfile(row.dataset.profileClient);
});
document.getElementById('clientProfileClose')?.addEventListener('click',closeClientProfile);
document.getElementById('clientProfileModal')?.addEventListener('click',e=>{if(e.target.id==='clientProfileModal')closeClientProfile();});
document.getElementById('clientProfileEdit')?.addEventListener('click',()=>{
  const id=clientProfileCurrentId;
  const c=clients.find(x=>String(x.id)===String(id));
  if(!c)return;

  closeClientProfile();

  // A edição normal do Gestor PRO usa openForm(client).
  // Abrimos o mesmo formulário já existente, agora preenchido com este cliente.
  if(typeof openForm==='function'){
    openForm(c);
    setTimeout(()=>{
      const form=document.getElementById('formCard');
      (form || document.getElementById('clientsSection'))?.scrollIntoView({
        behavior:'smooth',
        block:'start'
      });
    },80);
  }else{
    appAlert('Não foi possível abrir a edição deste cliente.','Editar cliente');
  }
});
document.getElementById('clientProfileCharge')?.addEventListener('click',()=>{
  const c=clients.find(x=>String(x.id)===String(clientProfileCurrentId)); if(!c)return;
  const phone=String(c.telefone||'').replace(/\D/g,'');
  if(!phone){appAlert('Este cliente não possui telefone cadastrado.','Cobrança');return;}
  const template=(typeof messageTemplates!=='undefined' && (gpClientDays(c)<0?messageTemplates.late:messageTemplates.soon)) || '';
  const msg=typeof renderMessageTemplate==='function'?renderMessageTemplate(template,c):`Olá ${c.nome||''}. Sua mensalidade vence em ${fmtDate(c.vencimento)}.`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`,'_blank','noopener,noreferrer');
});


if(typeof render==='function' && !render.__gpClientPreviewWrapped){
  const __gpBaseRender=render;
  render=function(){
    const r=__gpBaseRender.apply(this,arguments);
    queueMicrotask(renderDashboardClientPreview);
    return r;
  };
  render.__gpClientPreviewWrapped=true;
}
// ---------------- Inicialização ----------------

async function initApp(){
  try{
    clients = await loadClientsFromCloud();
    await syncClientsToAutomationCache(clients);
  }catch(err){
    console.error('Falha ao carregar clientes do Supabase:',err);
    clients=[];
    await appAlert('Não foi possível carregar seus clientes do banco online. '+friendlyDataError(err),'Erro ao carregar');
  }

  // Migração opcional: se esta conta ainda estiver vazia, oferece enviar para a nuvem
  // os clientes antigos que existiam somente neste computador.
  const legacyMigrationKey = `gestor_pro_cloud_migration_${currentAuthUser?.id||'sem_usuario'}_v1`;
  if(clients.length===0 && !localStorage.getItem(legacyMigrationKey)){
    let legacy=[];
    try{
      const browserLegacy=localStorage.getItem(`gestor_pro_browser_${currentAuthUser?.id||'sem_usuario'}_clients`);
      const oldLegacy=localStorage.getItem(STORAGE_KEY);
      const candidate=browserLegacy || oldLegacy;
      if(candidate){
        const parsed=JSON.parse(candidate);
        if(Array.isArray(parsed)) legacy=parsed;
      }
    }catch(e){ legacy=[]; }

    if(legacy.length && await appConfirm(`Encontramos ${legacy.length} cliente(s) salvos neste computador. Deseja enviar esses dados para sua conta online agora?`,'Migrar clientes antigos',{confirmText:'Enviar agora'})){
      clients=legacy;
      ensureCloudIds(clients);
      if(!(await save())) clients=[];
    }
    localStorage.setItem(legacyMigrationKey,'1');
  }

  // Corrige registros repetidos criados por vários cliques no mesmo mês.
  if(normalizePaymentHistory()) await save();

  setWaStatus('disconnected');
  await loadAutoSettings();
  applyCompanySettings();
  renderActivityLog();
  render();
  renderDashboardClientPreview();
  scheduleFirstOnboarding();
}

bootAuth();
