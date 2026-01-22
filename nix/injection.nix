{
  stdenv,
  nodejs,
  pnpm,
  ...
}:
stdenv.mkDerivation (rec {
  name = "TidaLuna";
  pname = "${name}";
  version = "1.9.2-beta";
  src = ./..;

  nativeBuildInputs = [
    nodejs
    pnpm.configHook
  ];

  pnpmDeps = pnpm.fetchDeps {
    inherit pname src version;
    fetcherVersion = 1;
    hash = "sha256-KYoHM+jbba27IQEeXYa7mRAiuebQI5NoyTWqjb5fm0g=";
  };

  buildPhase = ''
    runHook preBuild

    pnpm install
    pnpm run build

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    cp -R "dist" "$out"

    runHook postInstall
  '';

})
