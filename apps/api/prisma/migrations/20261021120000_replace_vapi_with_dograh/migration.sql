-- Remove stored credentials for the retired voice provider. They must not remain
-- usable or decryptable after the Dograh cutover.
DELETE FROM external_integration_credentials WHERE lower(provider) = 'vapi';

-- Keep past transcripts for audit/history without presenting those calls as
-- Dograh calls. The voice UI can still filter and display the historical label.
UPDATE voice_sessions SET provider = 'LEGACY' WHERE upper(provider) = 'VAPI';
