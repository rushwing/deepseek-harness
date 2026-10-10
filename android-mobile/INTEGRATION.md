# Android mobile project

The Harness source tree remains at the repository root. This directory contains the Android shell, its plugins, and the Android packaging scripts. Run Android commands from this directory; start with [the first deployment guide](docs/FIRST-DEPLOY.md). Build outputs, credentials, device backups, and local toolchains remain ignored.

The Android runtime builds a pinned Harness revision recorded in [source-provenance.json](docs/source-provenance.json), rather than automatically using the surrounding checkout. To adopt another Harness revision, update the pinned input and review the Android patches through [the engine build guide](docs/MASTER-ENGINE-BUILD.md), then validate the resulting runtime and APK separately.

Keep future Harness updates at the repository root and Android changes under `android-mobile/`. Preserve merge commits when integrating these histories so subsequent synchronizations retain a common ancestor. The original Android project history and applicable licenses remain part of this repository.

Harness lint, bilingual pairing, terminology, repository-reference, and expected-filename checks apply to Harness sources. The independent Android project retains its own documentation conventions, fixed source references, license records, and generated bundles. Run its repository audit and the checks required by its [development instructions](AGENTS.md) from this directory.
