(function(){
  if(window.gpConfirm)return;

  let currentResolve=null;
  let lastFocus=null;

  function ensure(){
    if(document.getElementById('gpConfirmOverlay')) return document.getElementById('gpConfirmOverlay');
    const style=document.createElement('style');
    style.id='gpConfirmModalStyles';
    style.textContent=`
      .gp-confirm-overlay{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(1,12,16,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
      .gp-confirm-overlay.is-open{display:flex}
      .gp-confirm-modal{width:min(460px,100%);border:1px solid rgba(89,222,202,.24);border-radius:18px;background:linear-gradient(180deg,#0d252c 0%,#091c22 100%);box-shadow:0 28px 80px rgba(0,0,0,.48);overflow:hidden;color:#eaf7f5;transform:translateY(8px) scale(.985);opacity:0;transition:transform .16s ease,opacity .16s ease}
      .gp-confirm-overlay.is-open .gp-confirm-modal{transform:none;opacity:1}
      .gp-confirm-body{padding:22px 22px 18px;display:grid;grid-template-columns:48px 1fr;gap:14px}
      .gp-confirm-icon{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;background:rgba(244,188,77,.10);border:1px solid rgba(244,188,77,.22);font-size:22px;color:#f1c45f}
      .gp-confirm-copy h3{margin:1px 0 7px;font-size:18px;line-height:1.25;color:#f4fbfa}
      .gp-confirm-copy p{margin:0;color:#a9bdc1;font-size:14px;line-height:1.55;white-space:pre-line}
      .gp-confirm-warning{margin-top:10px;color:#d7bd78!important;font-size:13px!important}
      .gp-confirm-actions{display:flex;justify-content:flex-end;gap:10px;padding:14px 22px 20px;border-top:1px solid rgba(120,170,177,.12)}
      .gp-confirm-btn{min-height:42px;padding:0 16px;border-radius:11px;border:1px solid rgba(130,173,179,.24);font:inherit;font-weight:750;cursor:pointer;transition:transform .12s ease,filter .12s ease,background .12s ease}
      .gp-confirm-btn:hover{filter:brightness(1.08)}
      .gp-confirm-btn:active{transform:translateY(1px)}
      .gp-confirm-cancel{background:rgba(255,255,255,.035);color:#d6e4e2}
      .gp-confirm-danger{background:#ef5b5b;color:#fff;border-color:#ef5b5b}
      .gp-confirm-primary{background:#35d1bd;color:#041a1c;border-color:#35d1bd}
      .gp-confirm-btn:focus-visible{outline:2px solid #62e7d5;outline-offset:2px}
      @media(max-width:600px){.gp-confirm-overlay{padding:16px;align-items:flex-end}.gp-confirm-modal{border-radius:20px 20px 14px 14px;width:100%}.gp-confirm-body{padding:20px 18px 16px;grid-template-columns:42px 1fr}.gp-confirm-icon{width:42px;height:42px;border-radius:12px}.gp-confirm-actions{padding:12px 18px 18px;display:grid;grid-template-columns:1fr 1fr}.gp-confirm-btn{width:100%;min-height:48px}}
      @media(prefers-reduced-motion:reduce){.gp-confirm-modal{transition:none}}
    `;
    document.head.appendChild(style);

    const overlay=document.createElement('div');
    overlay.id='gpConfirmOverlay';
    overlay.className='gp-confirm-overlay';
    overlay.setAttribute('aria-hidden','true');
    overlay.innerHTML=`<div class="gp-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="gpConfirmTitle" aria-describedby="gpConfirmMessage">
      <div class="gp-confirm-body"><div class="gp-confirm-icon" id="gpConfirmIcon">!</div><div class="gp-confirm-copy"><h3 id="gpConfirmTitle">Confirmar ação</h3><p id="gpConfirmMessage"></p><p class="gp-confirm-warning" id="gpConfirmWarning" hidden></p></div></div>
      <div class="gp-confirm-actions"><button type="button" class="gp-confirm-btn gp-confirm-cancel" id="gpConfirmCancel">Cancelar</button><button type="button" class="gp-confirm-btn gp-confirm-danger" id="gpConfirmOk">Excluir</button></div>
    </div>`;
    document.body.appendChild(overlay);

    const close=(value)=>{
      if(!currentResolve)return;
      const resolve=currentResolve; currentResolve=null;
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden','true');
      document.documentElement.classList.remove('gp-confirm-open');
      setTimeout(()=>{overlay.style.display='';lastFocus?.focus?.();resolve(value)},120);
    };
    overlay.querySelector('#gpConfirmCancel').addEventListener('click',()=>close(false));
    overlay.querySelector('#gpConfirmOk').addEventListener('click',()=>close(true));
    overlay.addEventListener('mousedown',e=>{if(e.target===overlay)close(false)});
    document.addEventListener('keydown',e=>{
      if(!currentResolve)return;
      if(e.key==='Escape'){e.preventDefault();close(false)}
      if(e.key==='Enter' && document.activeElement?.id!=='gpConfirmCancel'){e.preventDefault();overlay.querySelector('#gpConfirmOk').click()}
    });
    overlay._gpClose=close;
    return overlay;
  }

  window.gpConfirm=function(options={}){
    const o=typeof options==='string'?{message:options}:options;
    const overlay=ensure();
    if(currentResolve){overlay._gpClose(false)}
    lastFocus=document.activeElement;
    overlay.querySelector('#gpConfirmTitle').textContent=o.title||'Confirmar exclusão';
    overlay.querySelector('#gpConfirmMessage').textContent=o.message||'Tem certeza que deseja continuar?';
    const warning=overlay.querySelector('#gpConfirmWarning');
    warning.textContent=o.warning||'';warning.hidden=!o.warning;
    overlay.querySelector('#gpConfirmOk').textContent=o.confirmText||'Excluir';
    overlay.querySelector('#gpConfirmCancel').textContent=o.cancelText||'Cancelar';
    overlay.querySelector('#gpConfirmOk').className='gp-confirm-btn '+(o.danger===false?'gp-confirm-primary':'gp-confirm-danger');
    overlay.querySelector('#gpConfirmIcon').textContent=o.icon||'!';
    overlay.style.display='flex';
    requestAnimationFrame(()=>overlay.classList.add('is-open'));
    overlay.setAttribute('aria-hidden','false');
    document.documentElement.classList.add('gp-confirm-open');
    setTimeout(()=>overlay.querySelector('#gpConfirmCancel').focus(),40);
    return new Promise(resolve=>{currentResolve=resolve});
  };
})();
