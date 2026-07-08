{
  description = "Swarm Stash — Neuro-sama meme trading card game";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: rec {
        swarm-stash = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
          pname = "swarm-stash";
          version = "1.0.0";
          src = ./.;
          pnpmDeps = pkgs.fetchPnpmDeps {
            inherit (finalAttrs) pname version src;
            fetcherVersion = 3;
            hash = "sha256-gXaUt1UbIvNWgB/wyDE6+yIqcHZBCZQMRiVvJUmVApo=";
          };
          nativeBuildInputs = [
            pkgs.makeWrapper
            pkgs.nodejs_22
            pkgs.pnpm_11
            pkgs.pnpmConfigHook
          ];
          buildPhase = ''
            runHook preBuild
            node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild server.tsx \
              --bundle \
              --platform=node \
              --format=esm \
              --target=node22 \
              --packages=external \
              --outdir=dist
            runHook postBuild
          '';
          installPhase = ''
            mkdir -p $out/share/swarm-stash $out/bin
            cp -r dist *.ts *.tsx lib routes public package.json node_modules $out/share/swarm-stash/
            makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/swarm-stash \
              --add-flags "$out/share/swarm-stash/dist/server.js" \
              --set-default DATA_DIR ./data
          '';
          meta = {
            description = "Trade Neuro-sama & Evil Neuro meme cards with the swarm";
            mainProgram = "swarm-stash";
          };
        });
        default = swarm-stash;
      });

      apps = forAllSystems (pkgs: rec {
        swarm-stash = {
          type = "app";
          program = nixpkgs.lib.getExe self.packages.${pkgs.stdenv.hostPlatform.system}.swarm-stash;
        };
        default = swarm-stash;
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_22 ];
        };
      });

      nixosModules.default = { config, lib, pkgs, ... }:
        let cfg = config.services.swarm-stash;
        in {
          options.services.swarm-stash = {
            enable = lib.mkEnableOption "Swarm Stash meme TCG";

            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${pkgs.stdenv.hostPlatform.system}.swarm-stash;
              description = "swarm-stash package to run.";
            };

            port = lib.mkOption {
              type = lib.types.port;
              default = 3000;
              description = "Port the server listens on.";
            };

            baseUrl = lib.mkOption {
              type = lib.types.str;
              default = "http://localhost:3000";
              example = "https://swarm.example.com";
              description = "Public base URL; must match the Discord OAuth redirect origin.";
            };

            environmentFile = lib.mkOption {
              type = lib.types.nullOr lib.types.path;
              default = null;
              example = "/run/secrets/swarm-stash.env";
              description = ''
                File with secrets (DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET,
                SESSION_SECRET, optionally ALLOW_DEV_LOGIN=1) in KEY=value format.
              '';
            };

            openFirewall = lib.mkOption {
              type = lib.types.bool;
              default = false;
              description = "Open the configured port in the firewall.";
            };
          };

          config = lib.mkIf cfg.enable {
            systemd.services.swarm-stash = {
              description = "Swarm Stash — Neuro-sama meme TCG";
              wantedBy = [ "multi-user.target" ];
              after = [ "network.target" ];
              environment = {
                PORT = toString cfg.port;
                BASE_URL = cfg.baseUrl;
                DATA_DIR = "/var/lib/swarm-stash";
              };
              serviceConfig = {
                ExecStart = lib.getExe cfg.package;
                DynamicUser = true;
                StateDirectory = "swarm-stash";
                Restart = "on-failure";
                EnvironmentFile = lib.optional (cfg.environmentFile != null) cfg.environmentFile;
                # hardening
                ProtectSystem = "strict";
                ProtectHome = true;
                PrivateTmp = true;
                NoNewPrivileges = true;
                CapabilityBoundingSet = "";
                RestrictAddressFamilies = [ "AF_INET" "AF_INET6" ];
              };
            };
            networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];
          };
        };
    };
}
