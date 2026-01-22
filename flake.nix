{
  description = "Injection for TIDAL";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      forAllSystems =
        function:
        nixpkgs.lib.genAttrs nixpkgs.lib.systems.flakeExposed (
          system: function nixpkgs.legacyPackages.${system}
        );
    in
    {
    packages = forAllSystems (pkgs: {
      # TidaLuna injection stand-alone
      injection = pkgs.callPackage ./nix/injection.nix { };

      # TidaLuna injected into tidal-hifi
      default = pkgs.callPackage ./nix/overlay.nix { };
    });

    # Dev environment
    devShells = forAllSystems (pkgs: {
      default = pkgs.callPackage ./nix/shell.nix { };
    });

    # Overlay (if preferred)
    overlays.default = final: _: { tidal-luna = final.callPackage ./nix/overlay.nix { }; };
  };
}