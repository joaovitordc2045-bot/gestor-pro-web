import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const clean=(v:unknown)=>String(v??"").trim();
const digits=(v:unknown)=>clean(v).replace(/\D/g,"");
const xml=(v:unknown)=>clean(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
const tag=(n:string,v:unknown)=>clean(v)?`<${n}>${xml(v)}</${n}>`:"";

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return reply({error:"Metodo nao permitido."},405);
  try{
    const auth=req.headers.get("Authorization"); if(!auth)return reply({error:"Sessao ausente."},401);
    const url=Deno.env.get("SUPABASE_URL")!, anon=Deno.env.get("SUPABASE_ANON_KEY")!, service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
    const {data:{user},error:userError}=await authClient.auth.getUser(); if(userError||!user)return reply({error:"Sessao invalida."},401);
    const {attempt_id}=await req.json().catch(()=>({})); if(!attempt_id)return reply({error:"attempt_id obrigatorio."},400);
    const admin=createClient(url,service);
    const {data:a,error}=await admin.from("fiscal_integration_attempts").select("id,user_id,environment,status,payload,validation_status").eq("id",attempt_id).eq("user_id",user.id).maybeSingle();
    if(error)throw error; if(!a)return reply({error:"Pacote nao encontrado."},404);
    if(a.environment!=="homologation"||a.status!=="prepared"||a.validation_status!=="valid")return reply({error:"O pacote precisa estar PREPARADO e BACKEND VALIDADO."},409);

    const p:any=a.payload||{}, em=p.emitter||{}, tk=p.taker||{}, sv=p.service||{}, val=p.values||{};
    const {data:company}=await admin.from("fiscal_company_settings").select("cnpj_cpf,razao_social,inscricao_municipal,regime_tributario,codigo_municipio_ibge").eq("user_id",user.id).maybeSingle();
    const errs:string[]=[]; const de=digits(company?.cnpj_cpf||em.document), dt=digits(tk.document), ibge=digits(company?.codigo_municipio_ibge||em.municipality_code);
    if(![11,14].includes(de.length))errs.push("Documento do prestador precisa ser CPF ou CNPJ valido para estruturar a DPS.");
    if(!/^\d{7}$/.test(ibge))errs.push("Codigo IBGE do municipio emissor ausente ou invalido.");
    if(!clean(company?.inscricao_municipal))errs.push("Inscricao Municipal do prestador ausente.");
    if(!clean(company?.regime_tributario))errs.push("Regime tributario do prestador ausente.");
    if(![11,14].includes(dt.length))errs.push("Documento do tomador ausente ou invalido.");
    if(!clean(sv.municipal_code))errs.push("Classificacao do servico ainda precisa ser conciliada com o codigo exigido pelo leiaute nacional/parametros municipais.");
    if(!(Number(val.service_amount)>0))errs.push("Valor do servico invalido.");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(clean(p.competence_date)))errs.push("Data de competencia invalida.");

    // V23 gera uma ESTRUTURA TECNICA NAO ASSINADA baseada no leiaute DPS v1.01.
    // Ela nao e marcada como XSD-validada e nao e transmitida. Serie/nDPS e grupos fiscais
    // finais serao fechados na etapa de parametrizacao municipal + certificado.
    let dpsXml:string|null=null;
    if(!errs.length){
      const now=new Date().toISOString().replace("Z","-00:00");
      const prestDoc=de.length===14?tag("CNPJ",de):tag("CPF",de);
      const tomaDoc=dt.length===14?tag("CNPJ",dt):tag("CPF",dt);
      dpsXml=`<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS><tpAmb>2</tpAmb><dhEmi>${xml(now)}</dhEmi><verAplic>GestorPRO-V23</verAplic><dCompet>${xml(p.competence_date)}</dCompet><tpEmit>1</tpEmit><cLocEmi>${xml(ibge)}</cLocEmi><prest>${prestDoc}${tag("IM",company?.inscricao_municipal)}</prest><toma>${tomaDoc}${tag("xNome",tk.name)}</toma><serv><cServ>${tag("cTribMun",sv.municipal_code)}${tag("xDescServ",sv.description)}</cServ></serv><valores><vServPrest>${Number(val.service_amount).toFixed(2)}</vServPrest></valores></infDPS></DPS>`;
    }
    const generation_status=errs.length?"blocked":"generated";
    const {error:up}=await admin.from("fiscal_integration_attempts").update({dps_layout_version:"1.01",dps_generation_status:generation_status,dps_xml:dpsXml,dps_generation_errors:errs,dps_generated_at:new Date().toISOString(),backend_schema_version:"gestorpro.dps-structure.v23",updated_at:new Date().toISOString()}).eq("id",a.id).eq("user_id",user.id);
    if(up)throw up;
    return reply({ok:!errs.length,dps_generation_status:generation_status,layout_version:"1.01",errors:errs,unsigned_xml_generated:!!dpsXml,official_xsd_validation:false,xml_signature:false,transmission_performed:false});
  }catch(e){console.error(e);return reply({error:e instanceof Error?e.message:"Falha interna ao estruturar DPS."},500)}
});
