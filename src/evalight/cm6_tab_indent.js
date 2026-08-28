// Tab / Shift-Tab indent the current line (or selection).
// Tab that accepts a completion is bound in editor.cljs at a higher
// precedence, using the same @codemirror/autocomplete instance as the
// completion source — a second copy of acceptCompletion never sees the
// open list. Shift-Tab always returns true so focus stays in the editor.
// userEvent "noformat" is a backstop if clojure-mode's format-changed-lines
// filter is ever reinstalled; Parinfer still runs because the document changed.
import { indentUnit, getIndentUnit, indentString } from "@codemirror/language";
import { countColumn, EditorSelection } from "@codemirror/state";

function changeBySelectedLine(state, f) {
  let atLine = -1;
  return state.changeByRange((range) => {
    const changes = [];
    for (let pos = range.from; pos <= range.to; ) {
      const line = state.doc.lineAt(pos);
      if (line.number > atLine && (range.empty || range.to > line.from)) {
        f(line, changes);
        atLine = line.number;
      }
      pos = line.to + 1;
    }
    const changeSet = state.changes(changes);
    return {
      changes,
      range: EditorSelection.range(
        changeSet.mapPos(range.anchor, 1),
        changeSet.mapPos(range.head, 1)
      ),
    };
  });
}

function indentMore({ state, dispatch }) {
  if (state.readOnly) return true;
  dispatch(
    state.update(
      changeBySelectedLine(state, (line, changes) => {
        changes.push({ from: line.from, insert: state.facet(indentUnit) });
      }),
      { userEvent: "noformat" }
    )
  );
  return true;
}

function indentLess({ state, dispatch }) {
  if (state.readOnly) return true;
  dispatch(
    state.update(
      changeBySelectedLine(state, (line, changes) => {
        const space = /^\s*/.exec(line.text)[0];
        if (!space) return;
        const col = countColumn(space, state.tabSize);
        const insert = indentString(
          state,
          Math.max(0, col - getIndentUnit(state))
        );
        let keep = 0;
        while (
          keep < space.length &&
          keep < insert.length &&
          space.charCodeAt(keep) === insert.charCodeAt(keep)
        ) {
          keep++;
        }
        changes.push({
          from: line.from + keep,
          to: line.from + space.length,
          insert: insert.slice(keep),
        });
      }),
      { userEvent: "noformat" }
    )
  );
  return true;
}

const tabIndentKeymap = [
  { key: "Tab", run: indentMore, preventDefault: true },
  { key: "Shift-Tab", run: indentLess, preventDefault: true },
];

export { indentLess, indentMore, tabIndentKeymap };
