-- Reforço da assinatura · CPF + flag de OTP confirmado
alter table public.termos_adesao add column if not exists assinante_cpf text;
alter table public.termos_adesao add column if not exists otp_confirmado boolean default false;
alter table public.nda_solicitacoes add column if not exists assinante_cpf text;
alter table public.nda_solicitacoes add column if not exists otp_confirmado boolean default false;
