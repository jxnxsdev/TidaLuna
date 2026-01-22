{
  mkShellNoCC,
  callPackage,

  # packages
  nodejs,
  pnpm,
  prettierd,
}:
let
  defaultPackage = callPackage ./nix/overlay.nix { };
  injection = callPackage ./nix/injection.nix { };
in
mkShellNoCC {
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