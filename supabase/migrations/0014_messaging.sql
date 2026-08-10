-- ===========================================================================
-- 0014_messaging.sql — click-to-chat contact channels on the storefront.
-- WhatsApp (phone), Telegram (handle/link), KakaoTalk (channel URL/id).
-- Instagram DM reuses the existing salons.instagram handle.
-- Plain text columns; salon managers already control salon updates via RLS.
-- ===========================================================================
alter table public.salons add column if not exists whatsapp text;
alter table public.salons add column if not exists telegram text;
alter table public.salons add column if not exists kakao text;
