# Ubuntu Sandbox Startup Failure

Electron may fail to start on Ubuntu or another Linux distribution because Chromium's sandbox cannot initialize.

```text
The SUID sandbox helper binary was found, but is not configured correctly.
```

## Enable user namespaces

```bash
# Temporary
echo 1 | sudo tee /proc/sys/kernel/unprivileged_userns_clone

# Persistent
echo 'kernel.unprivileged_userns_clone=1' | sudo tee /etc/sysctl.d/00-local-userns.conf
sudo sysctl --system
```

## Fix chrome-sandbox permissions

```bash
find /opt /usr -name "chrome-sandbox" 2>/dev/null
sudo chown root:root /path/to/chrome-sandbox
sudo chmod 4755 /path/to/chrome-sandbox
```

## Disable the sandbox

::: danger Security warning
`--no-sandbox` reduces security. Use it only when safer options are unavailable.
:::

```bash
./SPlayer-Next-*.AppImage --no-sandbox
```

## Missing libraries

Ubuntu and Debian may require:

```bash
sudo apt update
sudo apt install libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2
```

Fedora and Arch users should install the equivalent NSS, ALSA, and X11 libraries with their package manager.

For WSL, use WSL2 with WSLg. If the problem remains, file an issue with the distribution version, full error, `uname -a`, and the value of `/proc/sys/kernel/unprivileged_userns_clone`.
