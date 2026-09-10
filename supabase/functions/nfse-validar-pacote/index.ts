import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const onlyDigits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Metodo nao permitido." }, 405);

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return reply({ error: "Sessao ausente." }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) return reply({ error: "Sessao invalida." }, 401);

    const { attempt_id } = await req.json().catch(() => ({}));
    if (!attempt_id) return reply({ error: "attempt_id obrigatorio." }, 400);

    const admin = createClient(url, service);
    const { data: attempt, error } = await admin
      .from("fiscal_integration_attempts")
      .select("id,user_id,environment,status,payload")
      .eq("id", attempt_id).eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!attempt) return reply({ error: "Pacote nao encontrado." }, 404);
    if (attempt.environment !== "homologation" || attempt.status !== "prepared")
      return reply({ error: "Somente pacotes preparados de homologacao podem ser validados." }, 409);

    const p: any = attempt.payload || {};
    const errors: string[] = [];
    const emitter = p.emitter || {}, taker = p.taker || {}, svc = p.service || {}, values = p.values || {};
    const docEmitter = onlyDigits(emitter.document), docTaker = onlyDigits(taker.document);
    if (![11,14].includes(docEmitter.length)) errors.push("Documento do prestador invalido ou ausente.");
    if (!/^\d{7}$/.test(String(emitter.municipality_code || ""))) errors.push("Codigo IBGE do municipio deve possuir 7 digitos.");
    if (!String(emitter.name || "").trim()) errors.push("Razao social/nome do prestador ausente.");
    if (![11,14].includes(docTaker.length)) errors.push("Documento do tomador invalido ou ausente.");
    if (!String(taker.name || "").trim()) errors.push("Nome do tomador ausente.");
    if (!String(svc.municipal_code || "").trim()) errors.push("Codigo do servico ausente.");
    if (!String(svc.description || "").trim()) errors.push("Descricao do servico ausente.");
    if (!(Number(values.service_amount) > 0)) errors.push("Valor do servico deve ser maior que zero.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.competence_date || ""))) errors.push("Data de competencia invalida.");
    if (p.readiness !== "ready") errors.push("Pacote nao esta marcado como pronto.");

    // V22 faz pre-validacao segura no servidor. A validacao XSD oficial e a transmissao
    // permanecem bloqueadas ate a etapa de certificado/autenticacao do contribuinte.
    const validation_status = errors.length ? "invalid" : "valid";
    const { error: updateError } = await admin.from("fiscal_integration_attempts").update({
      validation_status,
      validation_errors: errors,
      validated_at: new Date().toISOString(),
      backend_schema_version: "gestorpro.backend-prevalidation.v22",
      updated_at: new Date().toISOString(),
    }).eq("id", attempt.id).eq("user_id", user.id);
    if (updateError) throw updateError;

    return reply({
      ok: !errors.length,
      validation_status,
      errors,
      stage: "backend_prevalidation",
      official_xsd_validation: false,
      transmission_performed: false,
    });
  } catch (e) {
    console.error(e);
    return reply({ error: e instanceof Error ? e.message : "Falha interna na validacao." }, 500);
  }
});
