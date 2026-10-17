import subprocess,json,time,sys,shlex
from pathlib import Path
variant=sys.argv[1];cases=sys.argv[2:] or ['qrc','ttml','lrc','long']
Path('work').mkdir(exist_ok=True)
base='export XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus; '
def remote(s):return subprocess.check_output(['ssh','-o','BatchMode=yes','neclyon@192.168.2.155','bash','-c',shlex.quote(base+s)],text=True)
results=[]
remote('systemctl --user stop surface-player.service || true')
try:
 for case in cases:
  remote('rm -f ~/.local/state/surface-player/status.json; systemd-run --user --unit=surface-player-benchmark --collect --setenv=DISPLAY=:0 --setenv=XAUTHORITY=/home/neclyon/.Xauthority --setenv=SURFACE_PLAYER_URL=http://192.168.2.38:14558/display/benchmark/index.html?variant='+variant+'\\&case='+case+' /usr/bin/surface-player')
  start=time.monotonic(); samples=[];data={}
  while time.monotonic()-start<50:
   time.sleep(5)
   raw=remote("python3 - <<'EOF'\nimport json,subprocess,time\nfrom pathlib import Path\nroot=Path('/sys/fs/cgroup'+subprocess.check_output(['systemctl','--user','show','surface-player-benchmark','-p','ControlGroup','--value'],text=True).strip())\npss=0\nfor pid in (root/'cgroup.procs').read_text().split():\n try:\n  for l in Path('/proc',pid,'smaps_rollup').read_text().splitlines():\n   if l.startswith('Pss:'):pss+=int(l.split()[1])\n except OSError:pass\nprint(json.dumps({'time':time.monotonic(),'cpu':dict(x.split() for x in (root/'cpu.stat').read_text().splitlines())['usage_usec'],'pssMiB':pss/1024,'data':json.loads(Path.home().joinpath('.local/state/surface-player/status.json').read_text()) if Path.home().joinpath('.local/state/surface-player/status.json').exists() else {}}))\nEOF")
   sample=json.loads(raw);samples.append(sample);data=sample['data']
   if data.get('done'):break
  running=[x for x in samples if not x['data'].get('done')]
  cpu=None
  if len(running)>1:cpu=(int(running[-1]['cpu'])-int(running[0]['cpu']))/(running[-1]['time']-running[0]['time'])/10000
  row={'variant':variant,'case':case,'cpuPercent':cpu,'pssMiB':max(x['pssMiB'] for x in samples),'result':data}
  results.append(row);print(json.dumps(row),flush=True);Path('work/amll-'+variant+'-benchmark.json').write_text(json.dumps(results,indent=2))
  remote('systemctl --user stop surface-player-benchmark.service')
  time.sleep(1)
finally:
 remote('systemctl --user stop surface-player-benchmark.service || true; systemd-run --user --unit=surface-player --collect --setenv=DISPLAY=:0 --setenv=XAUTHORITY=/home/neclyon/.Xauthority /usr/bin/surface-player')
 Path('work/amll-'+variant+'-benchmark.json').write_text(json.dumps(results,indent=2))
