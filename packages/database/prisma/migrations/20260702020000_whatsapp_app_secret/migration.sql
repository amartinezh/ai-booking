-- =============================================================================
-- 🔏 FIRMA DEL WEBHOOK DE META (X-Hub-Signature-256)
--
-- App Secret por clínica, cifrado con AES-256-GCM igual que el access token.
-- Cuando la clínica lo configura, el POST /chatbot/webhook exige la firma
-- HMAC-SHA256 del body crudo; sin firma válida el evento se rechaza.
-- NULL = verificación desactivada para esa clínica (retrocompatibilidad).
-- =============================================================================
ALTER TABLE "WhatsappAccountConfig" ADD COLUMN "encryptedAppSecret" TEXT;
