/* Scene-graph adapter; it never edits referenced component definitions. */
window.PrototypeWorkspace = window.EditorWorkspace.create({
  schema: "prototype",
  enabled: () => state.inspectMode,
  doc: () => state.proto.doc,
  tokens: () => state.design?.tokens,
  selection: () => state.selectedPath,
  select: selectPath,
  value: valueAtPath,
  nodeSelector: "[data-proto-path]",
  nodePath: (node) => node?.dataset.protoPath ? JSON.parse(node.dataset.protoPath) : null,
  preview: () => $("#frame-wrap"),
  viewport: () => $(".workspace > .stage"),
  names: () => state.runtime?.componentNames || [],
  label: (node) => layerLabel(node).detail,
  layout: (node) => node?.layout === "row" || node?.direction === "horizontal" ? "horizontal" : node?.layout,
  canContain: ProtoEditorModel.container,
  prepare: () => {},
  destination: ProtoEditorModel.destination,
  insert: ProtoEditorModel.insert,
  move: ProtoEditorModel.move,
  validate: validateDraft,
  commit: (mutator) => commitPrototypeMutation(() => {
    const path = mutator();
    if (path) state.selectedPath = path;
  }),
  beforeGesture: commitPropertyEdit,
  dragPath: () => state.dragPath,
  setDragPath: (path) => { state.dragPath = path; },
  moving: () => !!state.freeformDrag,
  cancelMove: cancelFreeformDrag,
  clearTreeDrop: clearLayerDrop,
  suppressClick: () => { state.suppressInspectClickUntil = Date.now() + 500; },
  report: editorError,
  focusText: () => {
    setInspectorTab("properties");
    const input = $("#proto-properties textarea");
    input?.focus(); input?.select();
  },
  refresh: () => {},
  docked: applyZoom,
});
