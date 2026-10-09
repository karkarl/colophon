/* Prototype graph operations shared by tree and preview drops. */
(function (root) {
  const value = (doc, path) => path?.reduce((node, key) => node?.[key], doc);
  const prefix = (parent, child) => parent.length <= child.length && parent.every((part, index) => part === child[index]);
  const container = (node) => !!node && !node.shape && typeof node.layout === "string";
  function find(doc, wanted) {
    const visit = (node, path) => {
      if (node === wanted) return path;
      for (const [index, child] of (node?.children || []).entries()) {
        const found = visit(child, [...path, "children", index]);
        if (found) return found;
      }
      return null;
    };
    for (const [index, screen] of (doc.screens || []).entries()) {
      const found = visit(screen.root, ["screens", index, "root"]);
      if (found) return found;
      for (const [modalIndex, modal] of (screen.modals || []).entries()) {
        const found = visit(modal.root, ["screens", index, "modals", modalIndex, "root"]);
        if (found) return found;
      }
    }
    return null;
  }
  function destination(doc, path, placement = "inside", source = null) {
    if (!["before", "after", "inside"].includes(placement)) throw new Error("Choose inside, before, or after.");
    const target = value(doc, path);
    if (!target || JSON.stringify(find(doc, target)) !== JSON.stringify(path)) throw new Error("The target layer no longer exists.");
    if (placement !== "inside" && path.at(-2) !== "children") throw new Error("Cannot move a layer beside a root.");
    const parentPath = placement === "inside" ? path : path.slice(0, -2);
    const parent = value(doc, parentPath);
    if (!container(parent)) throw new Error("Drop layers inside a layout or beside one of its children.");
    if (parent.children != null && !Array.isArray(parent.children)) throw new Error("The destination's children must be an array.");
    if (source) {
      const node = value(doc, source);
      if (source.at(-2) !== "children" || !node || JSON.stringify(find(doc, node)) !== JSON.stringify(source)) throw new Error("Root layers cannot be moved.");
      if (source[1] !== path[1]) throw new Error("Layers can only move within the same screen.");
      if (prefix(source, path)) throw new Error("A layer cannot be moved into itself.");
    }
    return { parent, parentPath, target };
  }
  function position(node, parent) {
    if (parent.layout === "freeform") node.position ||= { mode: "absolute", x: 0, y: 0 };
    else delete node.position;
  }
  function move(doc, source, path, placement = "before") {
    const { parent, target } = destination(doc, path, placement, source);
    const node = value(doc, source), oldParent = value(doc, source.slice(0, -2));
    const children = value(doc, source.slice(0, -1));
    children.splice(children.indexOf(node), 1);
    parent.children ||= [];
    parent.children.splice(placement === "inside" ? parent.children.length : parent.children.indexOf(target) + (placement === "after" ? 1 : 0), 0, node);
    if (oldParent !== parent && parent.layout === "freeform") node.position = { mode: "absolute", x: 0, y: 0 };
    position(node, parent);
    return find(doc, node);
  }
  function insert(doc, path, template, placement = "inside") {
    const { parent, target } = destination(doc, path, placement);
    const ids = new Set();
    const collect = (node) => {
      if (!node) return;
      if (node.id) ids.add(node.id);
      for (const child of node.children || []) collect(child);
    };
    const screen = doc.screens[path[1]];
    collect(screen.root);
    for (const modal of screen.modals || []) collect(modal.root);
    const node = JSON.parse(JSON.stringify(template));
    const assign = (child) => {
      const base = child.id || child.component || "layer";
      let id = base, suffix = 2;
      while (ids.has(id)) id = `${base}-${suffix++}`;
      child.id = id;
      ids.add(id);
      for (const next of child.children || []) assign(next);
    };
    assign(node);
    position(node, parent);
    parent.children ||= [];
    parent.children.splice(placement === "inside" ? parent.children.length : parent.children.indexOf(target) + (placement === "after" ? 1 : 0), 0, node);
    return find(doc, node);
  }
  root.ProtoEditorModel = { destination, move, insert, container, find };
})(globalThis);
