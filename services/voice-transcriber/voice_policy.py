"""Reviewed immutable free-only engine policy; upgrades require source review."""
ENGINE_VERSION = '1.2.1'
MODEL_REVISION = 'ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66'


class VoiceError(Exception):
    def __init__(self, message, status=503, code='VOICE_UNAVAILABLE'):
        super().__init__(message)
        self.status, self.code = status, code


class PaidUpgradeBlocked(VoiceError):
    def __init__(self):
        super().__init__('Voice is locked to the pinned free self-hosted engine. Paid upgrades are disabled.', 402, 'VOICE_PAID_UPGRADE_BLOCKED')


def assert_free_policy(manifest, installed_version, requested_policy):
    if (manifest.get('modelRevision') != MODEL_REVISION or manifest.get('engineVersion') != ENGINE_VERSION
            or installed_version != ENGINE_VERSION or manifest.get('license') != 'MIT'
            or manifest.get('policy') != 'free-only' or requested_policy != 'free-only'):
        raise PaidUpgradeBlocked()
