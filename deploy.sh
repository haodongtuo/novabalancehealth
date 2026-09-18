#!/bin/bash
export NETLIFY_AUTH_TOKEN=$(cat /home/haodongtuo/.netlify_token | tr -d '[:space:]')
cd /home/haodongtuo/.openclaw/workspace/projects/novabalancehealth
netlify deploy --prod --site=ea1af736-aaab-419e-b769-fa0b55b6f51a 2>&1 | tail -5
