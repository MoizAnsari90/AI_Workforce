"""Build-time only: download one pinned public MIT model; never upgrade/fallback."""
import hashlib
import json
from pathlib import Path
import sys
from urllib.error import HTTPError
from urllib.request import urlopen

from voice_policy import ENGINE_VERSION, assert_free_policy, PaidUpgradeBlocked

lock = json.loads(Path(__file__).with_name('model-lock.json').read_text())
assert_free_policy(lock, ENGINE_VERSION, 'free-only')
if lock['repository'] != 'Systran/faster-whisper-base':
    raise PaidUpgradeBlocked()
destination = Path(sys.argv[1])
destination.mkdir(parents=True, exist_ok=True)
hashes = {}
for name in ['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt']:
    url = f"https://huggingface.co/{lock['repository']}/resolve/{lock['modelRevision']}/{name}"
    try:
        with urlopen(url, timeout=120) as response, (destination / name).open('wb') as output:
            digest = hashlib.sha256()
            while data := response.read(1024 * 1024):
                output.write(data)
                digest.update(data)
            hashes[name] = digest.hexdigest()
    except HTTPError as error:
        if error.code in [401, 402, 403]:
            raise SystemExit('Free model download blocked. Paid access and automatic upgrades are disabled.') from None
        raise SystemExit('Pinned free model is unavailable. No alternate provider will be used.') from None
(destination / 'manifest.json').write_text(json.dumps({**lock, 'files': hashes}, indent=2))
print('Pinned MIT Whisper model downloaded; runtime downloads remain disabled.')
