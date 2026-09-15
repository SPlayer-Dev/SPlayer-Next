{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    systems.url = "github:nix-systems/default-linux";
  };

  outputs =
    { nixpkgs, systems, ... }:
    let
      eachSystem = nixpkgs.lib.genAttrs (import systems);
    in
    {
      packages = eachSystem (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          inherit (pkgs) lib;

          electron = pkgs.electron_43;

          packageJson = builtins.fromJSON (builtins.readFile ./package.json);

          splayer-next = pkgs.stdenv.mkDerivation (finalAttrs: {
            inherit (packageJson) version;

            pname = "splayer-next";
            src = ./.;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src;
              hash = "sha256-Ll+nfLfKQapsBc/vGabmd4xuSvYg/XnyLBg9w9hYlhY=";
              fetcherVersion = 4;
            };

            cargoDeps = pkgs.rustPlatform.importCargoLock {
              lockFile = ./Cargo.lock;
            };

            nativeBuildInputs = [
              pkgs.pnpmConfigHook
              pkgs.pnpm
              pkgs.nodejs
              pkgs.rustPlatform.cargoSetupHook
              pkgs.rustPlatform.bindgenHook
              pkgs.cargo
              pkgs.rustc
              pkgs.python3
              pkgs.makeWrapper
              pkgs.copyDesktopItems
              pkgs.pkg-config
            ];

            buildInputs = [
              pkgs.pipewire
              pkgs.libpulseaudio
              pkgs.openssl
              pkgs.ffmpeg-headless
              pkgs.alsa-lib
            ];

            strictDeps = true;
            __structuredAttrs = true;

            env = {
              ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
              FFMPEG_MODE = "system";
            };

            postPatch = ''
              # Workaround for https://github.com/electron/electron/issues/31121
              substituteInPlace electron/main/utils/nativeLoader.ts \
                --replace-fail 'process.resourcesPath' "'$out/share/splayer-next/resources'"

              substituteInPlace electron/main/services/recognition/fingerprint.ts \
                --replace-fail 'process.resourcesPath' "'$out/share/splayer-next/resources'"

              sed -i '/^[[:space:]]*\.atleast_version/d' \
                "$cargoDepsCopy"/{.,*}/ffmpeg_audio_sys-*/build.rs
            '';

            buildPhase = ''
              runHook preBuild

              # After the pnpm configure, we need to build the binaries of all instances
              # of better-sqlite3. It has a native part that it wants to build using a
              # script which is disallowed.
              # What's more, we need to use headers from electron to avoid ABI mismatches.
              for f in $(find . -path '*/node_modules/better-sqlite3' -type d); do
                (cd "$f" && (
                  npm run build-release --offline -- --nodedir="${electron.headers}"
                  rm -rf prebuilds
                  rm -rf build/Release/{.deps,obj,obj.target,test_extension.node}
                  find build -type f -exec \
                    ${lib.getExe pkgs.removeReferencesTo} \
                    -t "${electron.headers}" {} \;
                ))
              done

              pnpm build

              npm exec electron-builder -- \
                --dir \
                --config electron-builder.config.ts \
                -c.electronDist=${electron.dist} \
                -c.electronVersion=${electron.version}

              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              mkdir -p "$out/share/splayer-next"
              cp -Pr --no-preserve=ownership dist/*-unpacked/{locales,resources{,.pak}} $out/share/splayer-next

              _icon_sizes=(16x16 32x32 96x96 192x192 256x256 512x512)
              for _icons in "''${_icon_sizes[@]}";do
                install -D public/icons/favicon-$_icons.png $out/share/icons/hicolor/$_icons/apps/splayer-next.png
              done

              makeWrapper '${lib.getExe electron}' "$out/bin/splayer-next" \
                --add-flags $out/share/splayer-next/resources/app.asar \
                --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations --enable-wayland-ime=true --wayland-text-input-version=3}}" \
                --set-default ELECTRON_FORCE_IS_PACKAGED 1 \
                --set-default ELECTRON_IS_DEV 0 \
                --prefix LD_PRELOAD : "${pkgs.ffmpeg-headless.lib}/lib/libavformat.so" \
                --prefix LD_PRELOAD : "${pkgs.ffmpeg-headless.lib}/lib/libavcodec.so" \
                --prefix LD_PRELOAD : "${pkgs.ffmpeg-headless.lib}/lib/libavutil.so" \
                --prefix LD_PRELOAD : "${pkgs.ffmpeg-headless.lib}/lib/libswresample.so" \
                --inherit-argv0

              runHook postInstall
            '';

            desktopItems = [
              (pkgs.makeDesktopItem {
                name = "top.imsyy.splayer_next";
                desktopName = "SPlayer-Next";
                exec = "splayer-next %U";
                terminal = false;
                type = "Application";
                icon = "splayer-next";
                startupWMClass = "top.imsyy.splayer_next";
                comment = "Cross-platform desktop music player with rich lyric support and wide audio format compatibility";
                categories = [
                  "AudioVideo"
                  "Audio"
                  "Music"
                ];
                mimeTypes = [ "x-scheme-handler/orpheus" ];
                extraConfig.X-KDE-Protocols = "orpheus";
              })
            ];

            meta = {
              description = "Cross-platform desktop music player with rich lyric support";
              homepage = "https://splayer-next.imsyy.top";
              license = lib.licenses.agpl3Only;
              mainProgram = "splayer-next";
              platforms = lib.platforms.linux;
            };
          });
        in
        {
          default = splayer-next;
          inherit splayer-next;
        }
      );
    };
}
