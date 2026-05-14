# CNB Deploy Templates

These files are examples for turning the existing CNB mirror into a deploy
button for Tencent Lighthouse. They are intentionally not active in the repo
root yet.

Copy them only after the Lighthouse instance is already working manually:

```bash
mkdir -p .cnb
cp deploy/tencent-lighthouse/cnb/cnb.yml.example .cnb.yml
cp deploy/tencent-lighthouse/cnb/tag_deploy.yml.example .cnb/tag_deploy.yml
```

## Required CNB Secrets

Configure these as protected CNB environment variables or secrets:

- `LIGHTHOUSE_HOST`: public IP or DNS name of the Lighthouse instance
- `LIGHTHOUSE_SSH_TARGET`: SSH target, for example `ubuntu@203.0.113.10`
- `LIGHTHOUSE_SSH_PRIVATE_KEY`: private deploy key allowed to update the server
- `DEEPSEEK_REPO_BRANCH`: branch or tag to deploy, for example `main`

Optional:

- `DEEPSEEK_REPO_URL`: defaults to the CNB mirror URL
- `LIGHTHOUSE_SSH_PORT`: defaults to `22`

The server side should already have `/opt/whalebro/deepseek-tui`,
`/etc/deepseek/runtime.env`, `/etc/deepseek/feishu-bridge.env`, and the
systemd services from `docs/TENCENT_LIGHTHOUSE_HK.md`.

## Safety Notes

- Do not store Feishu App Secret or DeepSeek API keys in CNB. They belong in
  `/etc/deepseek/*.env` on Lighthouse.
- Do not expose `127.0.0.1:7878` through EdgeOne, a security group, or a public
  reverse proxy.
- Start with a manual deploy button. Automatic deploy on every `main` push is
  convenient later, but it can consume CNB quota and restart the phone bridge
  while a turn is active.
