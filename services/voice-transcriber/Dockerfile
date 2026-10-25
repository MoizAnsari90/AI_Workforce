# Immutable public Python base. No floating image or automatic runtime updates.
FROM python:3.12-slim-bookworm@sha256:6a0e06f5ba0b373d051aabd3fffb9b873f27f9a2a3a14bcbe37dee6f0e3bbc70 AS model
WORKDIR /build
COPY voice_policy.py model-lock.json download_model.py ./
RUN python download_model.py /models/whisper-base

FROM python:3.12-slim-bookworm@sha256:6a0e06f5ba0b373d051aabd3fffb9b873f27f9a2a3a14bcbe37dee6f0e3bbc70 AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip python -m pip install --timeout 120 --retries 3 --no-deps --require-hashes -r requirements.txt
COPY --from=model /models/whisper-base /models/whisper-base
COPY worker.py gateway.py voice_policy.py ./
ENV HOME=/tmp XDG_CACHE_HOME=/tmp/cache HF_HOME=/tmp/hf-cache HF_HUB_OFFLINE=1 HF_DATASETS_OFFLINE=1 TOKENIZERS_PARALLELISM=false OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 VOICE_PAYMENT_POLICY=free-only VOICE_MODEL_PATH=/models/whisper-base VOICE_CPU_THREADS=2 PORT=8091
USER 65532:65532
EXPOSE 8091
HEALTHCHECK --interval=10s --timeout=5s --start-period=120s --retries=5 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8091/health',timeout=4).read()"
CMD ["python", "worker.py"]
