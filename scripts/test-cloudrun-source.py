"""Local security/command tests; never invokes Google Cloud."""
import importlib.util
import pathlib
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("source_deploy", pathlib.Path(__file__).with_name("deploy-cloudrun-source.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SourceDeploymentTests(unittest.TestCase):
    def test_context_keeps_workspaces_and_excludes_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory) / "repo"
            target = pathlib.Path(directory) / "staged"
            root.mkdir()
            target.mkdir()
            for name in ("package.json", "package-lock.json", ".dockerignore", ".gcloudignore",
                         "apps/api/Dockerfile", "apps/web/Dockerfile", "packages/shared/package.json",
                         "scripts/run-migrations.cjs", "apps/api/src/index.ts",
                         "apps/api/.env.production", "apps/web/.env.local", "apps/api/private.key",
                         "apps/api/secrets/token.txt", "apps/api/node_modules/ignored.js",
                         "apps/api/account-service-account.json", "apps/api/credentials.json"):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(name)
            with patch.object(module, "ROOT", root):
                module.stage(target, "api")
            files = {str(p.relative_to(target)).replace('\\', '/') for p in target.rglob('*') if p.is_file()}
            self.assertIn("packages/shared/package.json", files)
            self.assertIn("apps/api/src/index.ts", files)
            self.assertEqual((target / "Dockerfile").read_text(), "apps/api/Dockerfile")
            self.assertFalse(any('.env' in name or 'private.key' in name or 'secrets/' in name or 'node_modules/' in name or 'credentials.json' in name or 'service-account.json' in name for name in files))

    def test_source_command_preserves_security_flags_and_propagates_failure(self):
        flags = ["--build-service-account=projects/example/serviceAccounts/build", "--set-secrets=DATABASE_URL=db:1", "--allow-unauthenticated"]
        with patch.object(module.sys, 'argv', ['script', 'web', 'dashboard', *flags]), \
             patch.object(module.shutil, 'which', return_value='gcloud'), \
             patch.object(module, 'stage') as stage, \
             patch.object(module.subprocess, 'run', return_value=types.SimpleNamespace(returncode=7)) as run:
            with self.assertRaises(SystemExit) as result:
                module.main()
            self.assertEqual(result.exception.code, 7)
            self.assertEqual(run.call_args.args[0], ['gcloud', 'run', 'deploy', 'dashboard', '--source', '.', *flags])
            self.assertEqual(stage.call_args.args[1], 'web')
            self.assertFalse(run.call_args.kwargs['cwd'].exists())

    def test_missing_cli_stops_before_staging(self):
        with patch.object(module.sys, 'argv', ['script', 'api', 'api-service']), \
             patch.object(module.shutil, 'which', return_value=None), \
             patch.object(module, 'stage') as stage:
            with self.assertRaisesRegex(SystemExit, 'not on PATH'):
                module.main()
            stage.assert_not_called()


if __name__ == '__main__':
    unittest.main()
