{
  callPackage,
  fetchFromGitHub,

  fetchNpmDeps,

  lib,

  tidal-hifi
}:
let
  injection = callPackage ./injection.nix { };
in
  tidal-hifi.overrideAttrs rec {
    version = "6.1.0-rc1";

    src = fetchFromGitHub {
      owner = "Mastermindzh";
      repo = "tidal-hifi";
      tag = "6.1.0-rc1";
      hash = "sha256-8hh+YYiuMulRh5FVDvrcw5ZJoluBvtqXG9EueelydFw=";
    };

    npmDepsHash = "sha256-R49I1oAE+KnZFuPxNkcqAturAMMY3yl1T5Q/us4DVLo=";
    npmDeps = fetchNpmDeps {
        inherit src;
        name = "tidal-hifi-${version}-npm-deps";
        hash = npmDepsHash;
        forceGitDeps = true;
    };


     postInstall = ''
       mv $out/share/tidal-hifi/resources/app.asar $out/share/tidal-hifi/resources/original.asar

       mkdir -p "$out/share/tidal-hifi/resources/app/"
       cp -R ${injection}/* $out/share/tidal-hifi/resources/app/
     '';
  }