// Parinfer extension for CodeMirror 6.
// Adapted from @jurjanpaul/codemirror6-parinfer (MIT) so every
// @codemirror/* import resolves to Evalight's top-level packages.
import { StateEffect, StateField, EditorState, EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { setDiagnostics, forEachDiagnostic } from '@codemirror/lint';
import { invertedEffects } from '@codemirror/commands';
import { presentableDiff } from '@codemirror/merge';
import parinfer from 'parinfer';

const parinferLib = parinfer.smartMode ? parinfer : parinfer.default;
function filterTransactionEffects(effectType, transaction) {
    return transaction.effects.filter(e => e.is(effectType));
}
const setConfigEffect = StateEffect.define();
const defaultConfig = {
    enabled: true,
    mode: "smart"
};
const configField = StateField.define({
    create: () => null,
    update: (value, tr) => {
        const effect = filterTransactionEffects(setConfigEffect, tr).at(-1);
        return effect ? Object.assign(Object.assign({}, value), effect.value) : value;
    }
});
function enabled(state) {
    return Object.assign(Object.assign({}, defaultConfig), state.field(configField, false)).enabled;
}
function mode(state) {
    return Object.assign(Object.assign({}, defaultConfig), state.field(configField, false)).mode;
}
const parinferErrorEffect = StateEffect.define();
const parinferErrorField = StateField.define({
    create: () => null,
    update: (value, tr) => {
        const effect = tr.effects.filter(e => e.is(parinferErrorEffect)).at(-1);
        return effect ? effect.value : value;
    }
});
const invertParinferError = invertedEffects.of((tr) => {
    const effects = tr.effects.filter(e => e.is(parinferErrorEffect));
    if (effects.length) {
        const previous = tr.startState.field(parinferErrorField, false) || null;
        return [parinferErrorEffect.of(previous)];
    }
    return [];
});
function cmPosToParinferYx(doc, pos) {
    const line = doc["lineAt"](pos);
    const y = line.number - 1;
    const x = pos - line.from;
    return [y, x];
}
function parinferYxToCmPos(doc, y, x) {
    return doc["line"](y + 1).from + x;
}
function cmChangeSetToParinferChanges(oldDoc, cmChanges) {
    const parinferChanges = [];
    cmChanges["iterChanges"]((fromA, toA, _fromB, _toB, inserted) => {
        const [fromAy, fromAx] = cmPosToParinferYx(oldDoc, fromA);
        const oldText = oldDoc["sliceString"](fromA, toA);
        parinferChanges.push({
            lineNo: fromAy,
            x: fromAx,
            oldText: oldText,
            newText: inserted.toString()
        });
    });
    return parinferChanges;
}
function parinferResultToCmChanges(result, input) {
    const parinferredText = result.text;
    const diffs = presentableDiff(input, parinferredText);
    return diffs.map(change => {
        const { fromA, toA, fromB, toB } = change;
        return Object.assign({ from: fromA, to: toA }, (fromB !== toB && { insert: parinferredText.slice(fromB, toB) }));
    });
}
function maybeErrorEffect(startState, parinferError) {
    const existing = startState.field(parinferErrorField, false);
    if (JSON.stringify(existing) !== JSON.stringify(parinferError)) {
        return parinferErrorEffect.of(parinferError);
    }
    return null;
}
function invokeParinfer(mode, text, opts) {
    switch (mode) {
        case "smart":
            return parinferLib.smartMode(text, opts);
        case "indent":
            return parinferLib.indentMode(text, opts);
        case "paren":
            return parinferLib.parenMode(text, opts);
    }
}
function applyParinferSmartWithDiff(transaction) {
    const startState = transaction.startState;
    const oldCursor = startState.selection.main.head;
    const oldDoc = startState.doc;
    const [oldY, oldX] = cmPosToParinferYx(oldDoc, oldCursor);
    const newDoc = transaction["newDoc"];
    const newText = newDoc.toString();
    const newSelection = transaction["newSelection"].main;
    const newCursor = newSelection.head;
    const [newY, newX] = cmPosToParinferYx(newDoc, newCursor);
    const parinferChanges = cmChangeSetToParinferChanges(oldDoc, transaction.changes);
    const selectionStartLine = !newSelection.empty ? cmPosToParinferYx(newDoc, newSelection.from)[0] : undefined;
    const result = invokeParinfer(mode(startState), newText, {
        prevCursorX: oldX,
        prevCursorLine: oldY,
        cursorX: newX,
        cursorLine: newY,
        changes: parinferChanges,
        selectionStartLine: selectionStartLine
    });
    if (!result.success) {
        const effect = maybeErrorEffect(startState, result.error);
        return effect ? { effects: [effect] } : null;
    }
    const cmChanges = parinferResultToCmChanges(result, newText);
    const newTransaction = transaction.state.update({ changes: cmChanges, filter: false });
    const newPos = parinferYxToCmPos(newTransaction["newDoc"], result.cursorLine, result.cursorX);
    const effect = maybeErrorEffect(startState, null);
    return Object.assign({ changes: cmChanges, selection: EditorSelection.cursor(newPos), sequential: true }, (effect ? { effects: [effect] } : null));
}
function maybeInitialize(tr, initialConfig) {
    if (!(tr.startState.field(configField, false))) {
        return [
            tr,
            { effects: setConfigEffect.of(Object.assign(Object.assign({}, defaultConfig), initialConfig)) }
        ];
    }
    return tr;
}
function effectivelyEnabled(tr) {
    const aSetConfigEffect = filterTransactionEffects(setConfigEffect, tr).at(-1);
    return (enabled(tr.startState) ||
        (aSetConfigEffect && aSetConfigEffect.value.enabled));
}
function insertedIdentifierChar(tr) {
    if (!tr.docChanged) return false;
    // Quoted: Closure advanced renamed isUserEvent on our call sites
    // while leaving it on CodeMirror's Transaction, so clicks threw
    // and the caret never moved.
    if (!(tr["isUserEvent"]("input.type") || tr["isUserEvent"]("input.type.compose")))
        return false;
    let ok = true;
    let count = 0;
    let text = "";
    tr.changes["iterChanges"]((fromA, toA, _fromB, _toB, inserted) => {
        count++;
        text = typeof inserted === "string" ? inserted : inserted.toString();
        if (fromA !== toA || text.length !== 1) ok = false;
    });
    return ok && count === 1 && /^[A-Za-z0-9*!?+\-_$<>/]$/.test(text);
}

function needToApplyParinfer(tr) {
    if (!effectivelyEnabled(tr)) return false;
    if (tr["isUserEvent"]("undo") || tr["isUserEvent"]("redo")) return false;
    if (insertedIdentifierChar(tr)) return false;
    // Clicks are userEvent "select". Re-running smart mode on them
    // overwrote the new caret, often with line 0, and typing then
    // landed somewhere else. Undo also looked like a doc change and
    // Parinfer put the text back.
    return tr.docChanged;
}
function parinferTransactionFilter(initialConfig) {
    return EditorState.transactionFilter.of(tr => {
        try {
            if (needToApplyParinfer(tr)) {
                const parinferChanges = applyParinferSmartWithDiff(tr);
                if (parinferChanges) {
                    if (parinferChanges.effects ||
                        (parinferChanges.changes &&
                            (!Array.isArray(parinferChanges.changes) ||
                                parinferChanges.changes.length > 0))) {
                        return [tr, parinferChanges];
                    }
                }
            }
            return maybeInitialize(tr, initialConfig);
        } catch (err) {
            console.error("parinfer filter", err);
            return tr;
        }
    });
}
function errorToDiagnostics(doc, error) {
    const { x, lineNo, extra, message } = error;
    const pos = parinferYxToCmPos(doc, lineNo, x);
    const extraDiagnostics = extra ? errorToDiagnostics(doc, extra) : [];
    return [{
            severity: "error",
            source: "parinfer",
            from: pos,
            to: pos + 1,
            message: message
        }, ...extraDiagnostics];
}
function otherDiagnostics(state) {
    const others = [];
    forEachDiagnostic(state, (d, _from, _to) => {
        if (d.source !== "parinfer") {
            others.push(d);
        }
    });
    return others;
}
function hasEffectOfType(effectType, update) {
    return update.transactions.some(tr => {
        return tr.effects.some(e => e.is(effectType));
    });
}
function parinferViewUpdateListener() {
    return EditorView.updateListener.of(update => {
        if (hasEffectOfType(setConfigEffect, update) || update.docChanged) {
            const state = update.state;
            const parinferError = state.field(parinferErrorField, false);
            const parinferDiagnostics = (enabled(state) && parinferError) ? errorToDiagnostics(state.doc, parinferError)
                : [];
            const diagnosticTr = setDiagnostics(state, [...parinferDiagnostics,
                ...otherDiagnostics(state)]);
            update.view.dispatch(diagnosticTr);
        }
    });
}
/**
 * Updates the editor's extension configuration.
 * @param view the editor view
 * @param config new configuration for the Parinfer extension
 */
function configureParinfer(view, config) {
    view.dispatch({ effects: setConfigEffect.of(config) });
}
/**
 * Switches the Parinfer mode for the provided editor view.
 * @param view the editor view
 * @param mode the Parinfer mode to switch to
 */
function switchMode(view, mode) {
    configureParinfer(view, { mode: mode });
}
/**
 * Disables Parinfer for the provided editor view.
 * @param view the editor view
 */
function disableParinfer(view) {
    configureParinfer(view, { enabled: false });
}
/**
 * Enables Parinfer for the provided editor view.
 * @param view the editor view
 */
function enableParinfer(view) {
    configureParinfer(view, { enabled: true });
}
/**
 * Initialises the Parinfer extension for CodeMirror6.
 * @param initialConfig (optional) the initial configuration for the Parinfer extension
 * @returns the CodeMirror6 Parinfer extension in the form of an array of extensions
 */
function parinferExtension(initialConfig) {
    return [
        configField,
        parinferErrorField,
        invertParinferError,
        parinferTransactionFilter(initialConfig),
        parinferViewUpdateListener()
    ];
}

export { configField, configureParinfer, disableParinfer, enableParinfer, parinferExtension, setConfigEffect, switchMode };
