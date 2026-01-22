{
  mkShellNoCC,
  callPackage,

  # packages
  nodejs,
  pnpm,
  prettierd,
}:
let
  defaultPackage = callPackage ./overlay.nix { };
  injection = callPackage ./injection.nix { };
in
mkShellNoCC {
  # load the overlay of tidal-hifi & the stand-alone injection
  inputsFrom = [
    defaultPackage
    injection
  ];

  # Get all required packages for this project
  packages = [
    nodejs
    pnpm

    prettierd
  ];
}