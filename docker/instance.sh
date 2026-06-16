# Install proxy CA certificates
# apk --no-cache add ca-certificates
# update-ca-certificates
# Installing certificate manually
cat /usr/local/share/ca-certificates/* >> /etc/ssl/certs/ca-certificates.crt
# ! Python're request library ignores the system's CA certificate bundle and uses a built-in bundle. See https://stackoverflow.com/a/42982144/1497385
# Error: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate
# Fixing that by overriding the CA bundle.
export REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

# Install uv
apt-get update && apt-get install -y curl
curl -LsSf https://astral.sh/uv/install.sh | sh

export PATH="$PATH:$HOME/.local/bin"

# Install tangle-deploy
uv tool install /tangent/packages_to_install/python/tangle_deploy* --with /tangent/packages_to_install/python/rowlet*
# ! Need to configure tangle-deploy auth, otherwise it tries using interactive Minerva auth and gets stuck forever.
export TANGLE_AUTH="DUMMY_USER:DUMMY_PASSWORD"

# [Not] Installing Google Cloud SDK in background
apt-get install -y python3 bash
#export PATH="$PATH:/root/google-cloud-sdk/bin/"
# curl -sSL https://sdk.cloud.google.com | bash 2>/dev/null && /root/google-cloud-sdk/bin/gcloud auth list && /root/google-cloud-sdk/bin/gcloud config set core/custom_ca_certs_file /etc/ssl/certs/ca-certificates.crt &
# # == tangent-service-account@shopify-skypilot-clusters.iam.gserviceaccount.com

# Activating proxy (The `http_*` casing matters for curl). https://superuser.com/questions/876100/https-proxy-vs-https-proxy
# gcloud CLI only supports HTTP proxies https://docs.cloud.google.com/sdk/docs/proxy-settings#proxy_configuration
# export HTTPS_PROXY=https://localhost:8080
export HTTPS_PROXY=http://localhost:8080
export http_proxy=http://localhost:8080
export NODE_USE_ENV_PROXY=1
export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1

# Must differ from the proxy container's {DEFAULT_PROXY_PORT}.
export PORT=8000
export PI_DEBUG=true
export PI_PROXY_API_KEY=redacted

export SESSIONS_ROOT=/root/workspace/.sessions
export SESSIONS_DB=/root/workspace/.sessions/tangent.db
export AGENT_BUNDLES_ROOT=/root/workspace/.agent-bundles
export GLOBAL_MEMORY_DIR=/root/workspace/memory
export AUTH_JWT_TOKEN_COOKIE_NAME=MINERVA_TOKEN

cd /app
exec /app/docker/docker-entrypoint.sh