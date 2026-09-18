#!/usr/bin/env bash
set -euo pipefail

ssh_host="oio-main"
remote_path="/opt/oio-production"

ssh "$ssh_host" "set -euo pipefail
cd '$remote_path'
echo branch=\$(git branch --show-current)
echo head=\$(git rev-parse HEAD)
echo working_tree_changes=\$(git status --porcelain | wc -l | tr -d ' ')
pm2 jlist | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{for(const p of JSON.parse(s)){if([\"oio-api-production\",\"oio-worker-production\"].includes(p.name))console.log([p.name,p.pm2_env?.status,p.pid??\"\",p.pm2_env?.restart_time??\"\"].join(\"\\t\"))}})'
curl -fsS --max-time 10 http://127.0.0.1:3102/health >/dev/null
echo api_health=ok
test \"\$(pm2 pid oio-worker-production)\" != \"0\"
echo worker_health=online"
