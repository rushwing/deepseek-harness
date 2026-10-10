# 官方 master 的 ARM64 构建

固定来源为 `deepseek-ai/deepseek-harness` 的公开提交
`d743267388641bc76f17c45ce8b4c231aed1d32c`（`0.2.1-alpha.2`）。
Android 工程保留在 `android-shell/`，官方源码使用固定公开 Git 输入构建；
维护分支通过集成 merge 保留两边公开历史，不把官方根目录覆盖到 Android 根目录。
仅编辑补丁资产不能证明已更新引擎；必须构建完整 CLI/Web 并通过快照门禁。

先按 [FIRST-DEPLOY.md](FIRST-DEPLOY.md) 准备本 checkout 的工具链、插件、
公开 Debian 输入、Codex 和语音原生资源。无需用户设备、账号、模型、旧 APK 或
维护者回执。以下命令使用 Linux/WSL、Python 3.11、Node 22、NDK 27.2.12479018。
Node 开发头文件位于 `.tools/node22/include/node`。

```bash
source scripts/env.sh
python3 scripts/first-build.py --phase plugins
python3 scripts/first-build.py --phase inputs
python3 scripts/first-build.py --phase native
python3 scripts/prepare-master-engine.py --work .local/master-engine
npm --prefix scripts/runtime-sharp-wasm ci --force --ignore-scripts --no-audit --no-fund
python3 scripts/build-master-flock.py --source .local/master-engine/source --output .local/master-engine/android-flock
python3 scripts/build-master-pty.py .local/master-engine/engine-master-deploy/node_modules/.pnpm/node-pty@1.2.0-beta.15/node_modules/node-pty .local/master-engine/android-pty
python3 scripts/build-master-koffi.py .local/master-engine/engine-master-deploy/node_modules/.pnpm/koffi@3.1.1/node_modules/koffi .local/master-engine/android-koffi
python3 scripts/stage-master-runtime.py --source .local/master-engine/source --deploy .local/master-engine/engine-master-deploy --runtime .local/master-engine/runtime --assets .local/master-engine/assets --native .local/master-engine
python3 scripts/package-master-runtime.py --source .local/master-engine/source --runtime .local/master-engine/runtime --generated .local/master-engine/assets --receipt .local/master-engine/master-runtime.json
python3 scripts/first-build.py --phase apk
```

`prepare-master-engine.py` 固定 pnpm 11.28.5，构建整个公开 workspace，并为离线
CLI/Web 部署包含必需的递归工作区 peer 依赖。不会运行父 checkout 的默认 Git
安装钩子。上游 Cosmokit/Schemastery 的 `link:` 覆盖转换为随包源码/编译产物，
所有生产链接限定在引擎目录内，不能借构建目录通过宿主检查。
`stage-master-runtime.py` 全新展开公开 Termux 基座，删除旧引擎目录，
安装源码构建的引擎、受审补丁和完整自有插件；不消费手机导出运行时。
`--resume` 仅供补齐本 checkout `.local/` 下有本脚本收据的暂存区，禁止用于用户运行目录。

旧版核心全文件补丁不能覆盖新核心。新补丁的包名、版本、相对路径、原始 SHA
和产物 SHA 位于 `master-runtime-patches.json`，原生壳仍使用版本与哈希保护。
生成的 `master-runtime.json`、快照、原生二进制和构建收据不入 Git。
许可证与构建来源随 APK 保留；Sharp WASM 许可说明见
[runtime-sharp-wasm](../scripts/runtime-sharp-wasm/README.md)。

验证分层报告：源码/插件测试，真实 Host 与 Client 集成，快照门禁，JVM 测试，
APK 签名/对齐/内容核对，安装，设备功能。构建完成不表示麦克风、折叠屏、
Codex 登录、真实模型或 Android 动态链接已在设备上验收。

回归入口：

- `DSH_MIGRATION_ENGINE=<engine/node_modules/@deepseek-ai> node --test scripts/test-legacy-session-migration.mjs`，使用真实迁移 catalog 和 v4 消息重读。
- `DSH_CONTEXT_ENGINE=<同一目录> node --test scripts/test-codex-context.mjs scripts/test-codex-settlement.mjs`，使用实际新引擎补丁。
- `DSH_MODEL_CATALOG_ASSET=android-shell/app/src/main/assets/patched/master-dsh-api-session-controller-index.js node --test scripts/test-model-catalog.mjs`。
- `test-master-deck.client.spec.ts` 复制到固定 workspace 的 `packages/api/session-controller/tests/`，设置 `DSH_ANDROID_ROOT`，用 workspace Vitest 运行。采用实际 Cordis、React DOM、会话组件与编辑器，检查双泳道、独立草稿和卸载释放。
- `test-master-startup.py <deployed-cli> <fixture-home>` 只接受 `.local/` 配置 fixture，复制公开 profile 到独立 Linux 临时 HOME；不复制用户凭据。带自有插件的 fixture 将插件代码放在其 `profiles/web/node_modules`；遇到版本禁用即失败。
- `test-master-sharp.cjs <deployed-sharp-package>` 使用实际官方 WASM 回退验证编码、缩放和元数据，属于宿主测试。
- `test-master-search.mjs <Android engine> <host rg binary>` 模拟 Android 路径选择，使用真实上游 subprocess/search 验证匹配、无匹配、参数隔离和缺失程序拒绝；不能替代设备执行。Android 搜索使用公开基座随包的 Termux `bin/rg`。

每次发布使用新 `.local/` 工作目录，审查暂存源码与公开历史，然后生成自己的
APK 回执。设备连接与安装仍必须由操作者明确授权，并指定完整 serial。
