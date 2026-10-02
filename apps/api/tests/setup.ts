// Test environment setup
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://postgres:pakistanf6@localhost:5432/ai_workforce';
process.env.META_VERIFY_TOKEN = 'test_verify_token';
process.env.META_APP_SECRET = 'test_webhook_secret';
process.env.META_ACCESS_TOKEN = 'test_access_token';
process.env.META_PHONE_NUMBER_ID = 'test_phone_number_id';
process.env.OPENAI_API_KEY = 'test_openai_key';
process.env.JWT_SECRET = 'test_jwt_secret_at_least_16_chars';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.LOG_LEVEL = 'error';
process.env.INTEGRATION_ENCRYPTION_KEY = 'test-only-integration-key-not-for-production';
