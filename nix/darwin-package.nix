{
  lib,
  stdenv,
  callPackage,
  fetchurl,
}: let
  injection = callPackage ./injection-darwin.nix {};

  tidalDmg = fetchurl {
    url = "https://download.tidal.com/desktop/TIDAL.arm64.dmg";
    sha256 = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  };
in
  import ./darwin-tidal.nix {
    prev = {inherit lib stdenv;};
    inherit injection tidalDmg;
  }
