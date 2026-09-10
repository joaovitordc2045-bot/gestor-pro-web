-- Gestor PRO Fiscal V28 - metadados da validação local do certificado A1
-- Execute uma única vez no SQL Editor do Supabase.

alter table public.fiscal_auth_settings
  add column if not exists certificate_subject text,
  add column if not exists certificate_issuer text,
  add column if not exists certificate_serial text,
  add column if not exists certificate_not_before timestamptz,
  add column if not exists certificate_not_after timestamptz,
  add column if not exists certificate_holder_name text,
  add column if not exists certificate_holder_document text,
  add column if not exists certificate_document_match boolean,
  add column if not exists certificate_private_key_present boolean,
  add column if not exists certificate_validation_details jsonb not null default '{}'::jsonb;

comment on column public.fiscal_auth_settings.certificate_validation_details is
'V28: resumo não sensível da leitura local do A1. Não contém chave privada, senha, PFX/P12 ou material descriptografado.';
