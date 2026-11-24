# Public URL of the forwarded port inside GitHub Codespaces (empty elsewhere).
if [ -n "${CODESPACE_NAME:-}" ]; then
  export APP_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
else
  export APP_URL="${APP_URL:-http://localhost:3000}"
fi
export PORT=3000
