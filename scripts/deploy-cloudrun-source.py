"""Stage a minimal, credential-free monorepo Docker context for gcloud --source ."""
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXCLUDED_DIRS = {"node_modules", "dist", "build", ".next", ".git", ".local", "secrets", "coverage", "tests", "__tests__"}


def excluded(path):
    name = path.name.lower()
    return (name.startswith(".env") or name.endswith((".env", ".pem", ".key", ".p12", ".pfx", ".log"))
            or name.endswith(("-credentials.json", "-service-account.json"))
            or name in {"credentials.json", "application_default_credentials.json"}
            or ".local." in name)


def copy_tree(source, target):
    target.mkdir(parents=True, exist_ok=True)
    for path in source.iterdir():
        if path.is_symlink() or excluded(path) or path.name in EXCLUDED_DIRS:
            continue
        if path.is_dir():
            copy_tree(path, target / path.name)
        elif path.is_file():
            shutil.copy2(path, target / path.name)


def stage(target, app):
    for name in ("package.json", "package-lock.json", ".dockerignore", ".gcloudignore"):
        shutil.copy2(ROOT / name, target / name)
    for name in ("apps/api", "apps/web", "packages/shared", "scripts"):
        copy_tree(ROOT / name, target / name)
    shutil.copy2(ROOT / "apps" / app / "Dockerfile", target / "Dockerfile")


def main():
    app, service, *flags = sys.argv[1:]
    if app not in {"api", "web"}:
        raise SystemExit("Expected api or web")
    # Windows CreateProcess does not resolve extensionless gcloud through PATHEXT.
    executable = shutil.which("gcloud.cmd" if sys.platform == "win32" else "gcloud")
    if executable is None:
        raise SystemExit("Google Cloud CLI is not on PATH")
    # Python owns and cleans only this fresh temporary source directory.
    with tempfile.TemporaryDirectory(prefix="ai-workforce-source-") as directory:
        target = pathlib.Path(directory)
        stage(target, app)
        print(f"Deploying {service} from isolated {app} monorepo source context", flush=True)
        result = subprocess.run([executable, "run", "deploy", service, "--source", ".", *flags], cwd=target)
        raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
