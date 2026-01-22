{
  stdenv,
  nodejs,
  pnpm,
  ...
}:
stdenv.mkDerivation (rec {
  name = "TidaLuna";
  pname = "${name}";
  version = "1.9.7-beta";
  src = ./..;

  nativeBuildInputs = [
    nodejs
    pnpm.configHook
  ];

  pnpmDeps = pnpm.fetchDeps {
    inherit pname src version;
    fetcherVersion = 1;
    hash = "sha256-Oj34rQbKbsHnqPdVv+ti8z+gZTT+VOsDxg/MQ22sLRQ=";
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
