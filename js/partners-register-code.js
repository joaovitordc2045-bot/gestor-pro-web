document.getElementById('registerPartnerCode')?.addEventListener('input',function(){
  const pos=this.selectionStart;
  this.value=this.value.toUpperCase().replace(/\s+/g,'');
  try{this.setSelectionRange(pos,pos);}catch(_e){}
});
