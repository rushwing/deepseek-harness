"""Additive Android workbench adapters for the source-built 0.2.1-alpha.2 client.

The public sessions retain/release path remains authoritative. No old client
bundle is copied over the new engine; anchors fail closed on upstream drift.
"""
import hashlib
import json
from pathlib import Path

VERSION = '0.2.1-alpha.2'
BASELINES = {
    'dsh-api-session-controller': '78cff35e659f78158343ba403cc3144b1554225ad6efced1105b360a33ec46bc',
    'dsh-client-ui-session': '160ebb0d8912b7436e7219d8c94784f0e559f85a31511d7ebbcf7314d3be7d57',
    'dsh-client-ui-renderer': 'e40ba7ee84a5d93f5f0894bab866a76bc0879ee6631d5d8c17269696754e3c4b',
    'dsh-client-ui-conversation': 'b3e968c5c0412b1070f355aecb3ce6acd3f9d4b14be1b0dc3370dc07f7472090',
    'dsh-client-ui-workspace': '0aea5207824d85f356aa3d278978cf642d69c84d6ac541280d4f2ec333dd9783',
}
SOURCES = {
    'dsh-api-session-controller': 'api/session-controller',
    'dsh-client-ui-session': 'client/ui-session',
    'dsh-client-ui-renderer': 'client/ui-renderer',
    'dsh-client-ui-conversation': 'client/ui-conversation',
    'dsh-client-ui-workspace': 'client/ui-workspace',
}


def replace(source, before, after, count=1):
    actual = source.count(before)
    if actual != count:
        raise ValueError(f'Unsupported master client anchor ({actual}/{count}): {before[:90]!r}')
    return source.replace(before, after)


def patch(name, source):
    if name == 'dsh-api-session-controller':
        anchor = '\t\t\tretain(target, options) {'
        source = replace(source, anchor, '''
            // Compatibility seat for Android consumers; references stay independent.
            acquireStage(id) {
                const reference = this.retain(id, {source: "androidWorkbench"});
                let released = false;
                return () => { if (!released) { released = true; reference.release(); } };
            }
            open(id) {
                const navigation = this.rootCtx.get("uiWorkspace");
                if (!navigation) throw new Error("Session navigation unavailable");
                navigation.openSession(id);
            }
''' + anchor)
        anchor = '\t\t\t\tconst disposeManagerProjection = this.manager.subscribe(() => {'
        # Preserve the same observable identity and stable snapshots. Main-view
        # ownership is the new controller's selection source of truth.
        first = source.find(anchor)
        if first < 0:
            raise ValueError('Missing ClientSessions initial list publication')
        source = source[:first] + '''
                const readList = this.list.getSnapshot.bind(this.list);
                const legacyLists = new WeakMap();
                this.list.getSnapshot = () => {
                    const value = readList();
                    let result = legacyLists.get(value);
                    if (!result) {
                        const current = Object.values(value.byId).find(row => (row.retainedBy?.mainView ?? 0) > 0)?.id;
                        result = {...value, current}; legacyLists.set(value, result);
                    }
                    return result;
                };
''' + source[first:]
    elif name == 'dsh-client-ui-session':
        anchor = 'bindingSource: (target) => this.bindingSource(target),'
        source = replace(source, anchor, anchor + '''
                    resolve: (id) => {
                        const binding = this.sessions.binding(id);
                        if (!binding) throw new Error("Workbench Session must be retained");
                        return this.materialize(binding);
                    },''')
    elif name == 'dsh-client-ui-renderer':
        anchor = '\t\texports.SlotRegistry = SlotRegistry;'
        source = replace(source, anchor, '''
        // Limited compatibility surface: callers retain the Session beforehand.
        function SessionSurface({sessionId, part, blocked, openView}) {
            const host = useHost();
            observableHook(host.scopeRevision)(value => value);
            const adapter = host.scope("session");
            if (!adapter) throw new SlotAssemblyError("Session adapter unavailable");
            observableHook(adapter.current)(value => value);
            const binding = adapter.resolve(sessionId);
            return react_jsx_runtime.jsx(ScopeBindingProvider, {binding,
                children: react_jsx_runtime.jsx(SessionSurfaceBody, {part, blocked, openView})}, sessionId);
        }
        function SessionSurfaceBody({part, blocked, openView}) {
            const binding = useScopeBinding();
            const root = useRootBinding();
            const session = observableHook(binding.hooks.session)(value => value);
            const input = observableHook(binding.hooks.input)(value => value);
            const pending = maybeObservableHook(root.hooks.sessionPendingInteraction)(value => value.get(binding.key));
            if (part === "chat") return react_jsx_runtime.jsx(SlotOutlet, {
                slotKey: "conversation.session", ownerProps: {view: "chat", openView}});
            if (part !== "composer") throw new Error("Unknown Session surface");
            const fallback = react_jsx_runtime.jsxs(react.Fragment, {children: [
                react_jsx_runtime.jsx(SlotOutlet, {slotKey: "conversation.input.dock", ownerProps: {session, input}}),
                react_jsx_runtime.jsx(SlotOutlet, {slotKey: "conversation.composer.bar", ownerProps: {variant: "composer", blocked}})
            ]});
            return react_jsx_runtime.jsx(SlotOutlet, {slotKey: "conversation.composer",
                ownerProps: {sessionId: binding.key, session, pendingInteraction: pending}, opts: {fallback, overlay: true}});
        }
        exports.SessionSurface = SessionSurface;
''' + anchor)
    elif name == 'dsh-client-ui-conversation':
        source = replace(source, 'name: "main.conversation",', '''name: "main.conversation",
                inject: sessionId => ({hooks: {deckView: sessionId === void 0 ? ABSENT_BLOCK :
                    ctx.slots.resolveStore(conversationStore, ctx.uiSession.adapter.resolve(sessionId))}}),''')
        source = replace(source, 'const hero = sessionId === void 0 || shellPhase === "blank" && (openState === "open" || summaryBlank === true);',
                         'const deckMode = props.useDeckView(value => value?.view === "voice-deck");\n            const hero = !deckMode && (sessionId === void 0 || shellPhase === "blank" && (openState === "open" || summaryBlank === true));')
        source = replace(source, 'hooks: { composerBlock: sessionId === void 0 ? ABSENT_BLOCK : composerBlocks.storeFor(sessionId) },',
                         'hooks: { composerBlock: sessionId === void 0 ? ABSENT_BLOCK : composerBlocks.storeFor(sessionId), deckView: sessionId === void 0 ? ABSENT_BLOCK : ctx.slots.resolveStore(conversationStore, ctx.uiSession.adapter.resolve(sessionId)) },')
        source = replace(source, 'const composerBlock = useComposerBlock((block) => block);',
                         'const composerBlock = useComposerBlock((block) => block);\n            const deckMode = props.useDeckView(value => value?.view === "voice-deck");')
        source = replace(source, 'children: [sessionId === void 0 ? null : (0, react_jsx_runtime.jsx)(Views, {}), composerSeat]',
                         'children: [sessionId === void 0 ? null : (0, react_jsx_runtime.jsx)(Views, {}), deckMode ? null : composerSeat]')
        source = replace(source, 'if (session.blank && conversationPhase(session, conversation) === "blank") return null;',
                         'if ((view ?? active?.id) !== "voice-deck" && session.blank && conversationPhase(session, conversation) === "blank") return null;')
        source = replace(source, '\t\tconst InputBar = (0, react.memo)(function InputBar(',
                         '\t\tconst deckSubmitters = new Map(), deckImageIntakes = new Map();\n\t\tconst InputBar = (0, react.memo)(function InputBar(')
        source = replace(source, '"data-composer-card": true,', '"data-composer-card": true,\n                        "data-dsh-input-session": sessionId,')
        source = replace(source, 'if (rejected !== null) showToast(rejected);', 'if (rejected !== null) showToast(rejected);\n                return rejected === null;')
        anchor = 'const canAcceptDrop = (subagent === null || continuable) && !locked && !machineBusy && addFiles !== void 0;'
        source = replace(source, anchor, anchor + '''
            react.useLayoutEffect(() => {
                if (sessionId === void 0) return;
                const accept = files => canAcceptDrop && intakeFiles(files) === true;
                deckImageIntakes.set(sessionId, accept);
                const card = cardRef.current;
                const nativeImages = event => { event.detail.accepted = accept(event.detail.files); };
                card?.addEventListener("dsh-native-images", nativeImages);
                return () => {
                    card?.removeEventListener("dsh-native-images", nativeImages);
                    if (deckImageIntakes.get(sessionId) === accept) deckImageIntakes.delete(sessionId);
                };
            }, [sessionId, canAcceptDrop, intakeFiles]);''')
        anchor = '\t\t\tconst onPrimary = () => {'
        source = replace(source, anchor, '''
            const submitDraft = () => {
                if (keyboard === void 0 || empty || disabled || machineBusy || uploadsPending || editor?.isComposing()) return false;
                keyboard.submit(primarySubmitMode, "click"); return true;
            };
            react.useLayoutEffect(() => {
                if (sessionId === void 0) return;
                deckSubmitters.set(sessionId, submitDraft);
                return () => { if (deckSubmitters.get(sessionId) === submitDraft) deckSubmitters.delete(sessionId); };
            }, [sessionId, submitDraft]);
''' + anchor)
        source = replace(source, 'if (locked || editor === null) return;\n\t\t\t\tfocusDraftEditor(editor, revealSelection);',
                         'if (locked || editor === null || editor.getRootElement()?.closest("[data-deck-lane]")) return;\n\t\t\t\tfocusDraftEditor(editor, revealSelection);')
        anchor = '\t\t\tconst inputHub = new InputHub(ctx, t);'
        source = replace(source, anchor, anchor + '''
            ctx.reflect.provide("deckInput", {for: id => {
                const shell = inputHub.shell(id);
                return {
                    state: shell.state,
                    composing: () => shell.editor.isComposing(),
                    focus: (atEnd = false) => {
                        const root = shell.editor.getRootElement();
                        if (!root || !shell.editor.isEditable() || atEnd && shell.editor.isComposing()) return false;
                        root.focus({preventScroll: true});
                        shell.editor.focus(undefined, atEnd ? {defaultSelection: "rootEnd"} : undefined);
                        return true;
                    },
                    send: () => deckSubmitters.get(id)?.() ?? false,
                    addImages: files => deckImageIntakes.get(id)?.(files) ?? false,
                    deleteBackward: () => {
                        if (shell.editor.isComposing() || !shell.editor.isEditable() || shell.snapshot.phase !== "plain") return false;
                        return shell.editor.dispatchCommand($e$2, true);
                    },
                    attach: () => {
                        const entry = ctx.slots.entries("conversation.session")[0];
                        if (!entry?.store) throw new Error("Conversation store unavailable");
                        const instance = ctx.slots.resolveStore(entry.store, ctx.uiSession.adapter.resolve(id));
                        return shell.bindDraftPersistence(instance.actions.setDraft);
                    }
                };
            }});
''')
    elif name == 'dsh-client-ui-workspace':
        anchor = '"sidebar.workspaces.directoryFlow": {\n'
        source = replace(source, anchor, '"sidebar.workspaces.before": {kind: "list", scope: "root"},\n' + anchor)
        anchor = 'className: clsx(WorkspaceBrowser_module_css_default.root, !wide && WorkspaceBrowser_module_css_default.rail),\n\t\t\t\tchildren: ['
        source = replace(source, anchor, anchor + '\n                    renderSlot("sidebar.workspaces.before", {wide}),')
    else:
        raise ValueError('Unknown workbench package: ' + name)
    return source


def stage(source_root, destination):
    """Generate patched bundles plus before/after fingerprints from fixed sources."""
    source_root, destination = Path(source_root), Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    manifest = {'engine': VERSION, 'packages': {}}
    for name, folder in SOURCES.items():
        package = source_root / 'packages' / folder
        if json.loads((package / 'package.json').read_text())['version'] != VERSION:
            raise ValueError('Unsupported workbench engine version')
        raw = (package / 'lib/client.js').read_bytes()
        if hashlib.sha256(raw).hexdigest() != BASELINES[name]:
            raise ValueError('Unaudited master client bundle: ' + name)
        result = patch(name, raw.decode()).encode()
        (destination / (name + '.js')).write_bytes(result)
        manifest['packages'][name] = {'base': hashlib.sha256(raw).hexdigest(), 'patched': hashlib.sha256(result).hexdigest()}
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest
