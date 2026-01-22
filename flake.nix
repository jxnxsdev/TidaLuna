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
      injection = pkgs.callPackage ./nix/injection.nix { };
      default = pkgs.callPackage ./nix/overlay.nix { };
    });

    devShells = forAllSystems (pkgs: {
      default = pkgs.callPackage ./shell.nix { };
    });

    overlays.default = final: _: { tidal-luna = final.callPackage ./nix/overlay.nix { }; };
  };
}