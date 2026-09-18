# NovaBalance Health Recovery

Recovered on 2026-08-18 from the preserved OpenClaw workspace.

## Authoritative sources

- Live site: https://novabalancehealth.com
- GitHub repository: https://github.com/haodongtuo/novabalancehealth
- Preserved deployment source: `/home/haodongtuo/old-openclaw-import/old-openclaw/workspace/_nova_deploy_tmp`
- Preserved workspace Git history: `/home/haodongtuo/old-openclaw-import/old-openclaw/workspace/.git`
- Netlify site: `sparkling-creponne-02d71e`
- Deployment method recorded in the old daily logs: Netlify CLI production deployment from `_nova_deploy_tmp`

## Recovered state

The GitHub `main` branch stopped at the 2026-04-18 version. The preserved deployment directory contains later work through 2026-05-18. This recovery branch restores that later source.

The recovered public pages and assets were byte-compared with the live site on 2026-08-18. All 11 checked files matched exactly: the home, about, contact, four product, and verification pages plus the logo, manifest, and service worker.

## Safety

The original imported OpenClaw archive remains unchanged. Sensitive-pattern checks found no obvious credential strings in this recovered project copy. Historical memory files are not part of this repository and must not be committed.

A backend service credential was found in a historical daily log. Rotate it through the provider's secure account interface before relying on the NFC backend for production changes.
