/* Component document adapter for the shared editor workspace. */
window.InspectWorkspace = window.EditorWorkspace.create({
  schema: "component",
  enabled: () => state.inspectMode && state.page === "components",
  doc: () => state.componentsDoc,
  tokens: () => state.tokens,
  selection: () => selectedComponentNode() ? state.selection.path : null,
  select: (path) => selectDesignPath("components.jsonc", path, componentLayerLabel(valueAtPath(state.componentsDoc, path)).detail),
  value: valueAtPath,
  nodeSelector: "[data-ds-node-path]",
  nodePath: renderedNodePath,
  preview: () => $("#app"),
  names: availableComponentNames,
  label: (node) => componentLayerLabel(node).detail,
  layout: (node) => node?.layout?.mode,
  canContain: (node) => window.DSComp.canContainComponentChildren(node) && !(typeof node.children === "string"
    || (Array.isArray(node.children) && node.children.length && node.children.every((child) => typeof child === "string"))),
  prepare: (doc) => { doc.meta ||= {}; doc.meta.version = Math.max(3, Number(doc.meta.version) || 0); },
  destination: (...args) => window.DSComp.componentDropDestination(...args),
  insert: (...args) => window.DSComp.insertComponentNode(...args),
  move: (...args) => window.DSComp.moveComponentNode(...args),
  validate: (doc) => {
    const validation = window.DSComp.validateComponentsDoc(doc, { tokens: state.tokens });
    if (!validation.ok) throw new Error(validation.errors.join(" "));
  },
  commit: commitComponentMutation,
  dragPath: () => state.dragPath,
  setDragPath: (path) => { state.dragPath = path; },
  moving: () => !!state.freeformDrag,
  cancelMove: cancelFreeformDrag,
  clearTreeDrop: clearDropClasses,
  suppressClick: () => { state.suppressInspectClickUntil = Date.now() + 500; },
  report: (error) => { $("#inspect-error").textContent = error.message; },
  refresh: (zoom) => {
    document.body.classList.toggle("inspect-components", state.inspectMode && state.page === "components");
    for (const surface of document.querySelectorAll("#app .ds-preview-surface")) surface.style.zoom = state.inspectMode ? String(zoom) : "";
  },
});
