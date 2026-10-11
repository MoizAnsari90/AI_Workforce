// Credential storage is not proof that a number can receive or deliver messages.
export function whatsappConnectionState(connection: Record<string, unknown> | null, now = Date.now()) {
  if (!connection) return { connected: false, status: 'disconnected', deliveryVerified: false };
  const expiry = typeof connection.expiresAt === 'string' ? Date.parse(connection.expiresAt) : null;
  const status = expiry !== null && (!Number.isFinite(expiry) || expiry <= now)
    ? 'reconnect_required'
    : expiry !== null && expiry < now + 7 * 86_400_000 ? 'reconnect_soon' : 'verification_required';
  return {
    connected: true, status, deliveryVerified: false,
    phoneNumber: typeof connection.displayPhoneNumber === 'string' ? connection.displayPhoneNumber : null,
    verifiedName: typeof connection.verifiedName === 'string' ? connection.verifiedName : null,
    expiresAt: typeof connection.expiresAt === 'string' ? connection.expiresAt : null,
  };
}
