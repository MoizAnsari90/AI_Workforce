function assertTestDatabaseUrl(value, applicationUrl) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Set TEST_DATABASE_URL to a dedicated PostgreSQL test database'); }
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^[a-z0-9_]+_test(?:_[a-z0-9_]+)?$/i.test(name) || (url.searchParams.get('schema') && url.searchParams.get('schema') !== 'public')) {
    throw new Error('Test database name must end in _test or _test_<suffix>, using the public schema');
  }
  if (applicationUrl) {
    const application = new URL(applicationUrl);
    if (application.hostname === url.hostname && (application.port || '5432') === (url.port || '5432') && application.pathname === url.pathname) {
      throw new Error('TEST_DATABASE_URL must not point to the application database');
    }
  }
  return url;
}
module.exports = { assertTestDatabaseUrl };
