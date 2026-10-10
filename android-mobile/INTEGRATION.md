# Android mobile project

The Harness source tree remains at the repository root. This directory contains the Android shell, its plugins, and the Android packaging scripts. Run Android commands from this directory; start with [the first deployment guide](docs/FIRST-DEPLOY.md). Build outputs, credentials, device backups, and local toolchains remain ignored.

The Android runtime builds a pinned Harness revision recorded in [source-provenance.json](docs/source-provenance.json), rather than automatically using the surrounding checkout. To adopt another Harness revision, update the pinned input and review the Android patches through [the engine build guide](docs/MASTER-ENGINE-BUILD.md), then validate the resulting runtime and APK separately.

Keep future Harness updates at the repository root and Android changes under `android-mobile/`. Preserve merge commits when integrating these histories so subsequent synchronizations retain a common ancestor. The original Android project history and applicable licenses remain part of this repository.

For a fresh current-engine APK, prepare the documented host tools, activate `scripts/env.sh`, and run `python3 scripts/build-master-apk.py`. The Android mobile workflow executes the same entry from public inputs with independent toolchains and caches. Its APK uses a newly generated debug signing identity; an upgrade over an existing installation requires the operator's compatible private key. CI does not install on devices or validate live voice/model services.

Fork CI uses standard hosted runners by default. Real API validation is optional until the repository variable `DSH_RUN_REAL_API_TESTS` is `true` and the Actions secret `DEEPSEEK_API_KEY_EXTERNAL` is configured. Without opt-in, live validation is explicitly omitted; keyless gates remain active. Self-hosted standby drills require `DSH_RUN_SELF_HOSTED_STANDBY=true` and matching registered runners. The upstream Organization Project workflows belong to their configured repository.

Harness lint, bilingual pairing, terminology, repository-reference, and expected-filename checks apply to Harness sources. The independent Android project retains its own documentation conventions, fixed source references, license records, and generated bundles. Run its repository audit and the checks required by its [development instructions](AGENTS.md) from this directory.
