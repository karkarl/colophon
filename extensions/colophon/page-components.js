/* Standalone preview placement. Component definitions and nested uses stay untouched. */
(function (root) {
  function snapshot(tokens, names) {
    const pages = tokens.pages ?? [];
    if (!Array.isArray(pages)) throw new Error("pages must be an array.");
    const ids = new Set();
    for (const page of pages) {
      if (!page || typeof page.id !== "string" || !page.id.trim() ||
          typeof page.name !== "string" || !page.name.trim()) {
        throw new Error("Every page needs a stable id and a non-empty name.");
      }
      if (ids.has(page.id)) throw new Error(`Duplicate page id: "${page.id}".`);
      ids.add(page.id);
      if (Object.hasOwn(page, "components") &&
          (!Array.isArray(page.components) || page.components.some((name) => typeof name !== "string" || !name.trim()) ||
           new Set(page.components).size !== page.components.length)) {
        throw new Error(`Page "${page.name}" components must be an array of unique, non-empty component names.`);
      }
    }
    const builtin = pages.find((page) => page.id === "components") || { id: "components", name: "Components" };
    const groups = [builtin, ...pages.filter((page) => page.id !== "components")].map((page) => ({
      id: page.id,
      name: page.id === "components" ? "Components" : page.name,
      components: [...(page.components ?? names)],
    }));
    const homes = new Map();
    for (const group of groups) {
      for (const name of group.components) {
        if (!homes.has(name)) homes.set(name, []);
        homes.get(name).push(group.id);
      }
    }
    return {
      groups, homes,
      unassigned: names.filter((name) => !homes.has(name)),
      duplicates: names.filter((name) => homes.get(name)?.length > 1),
    };
  }

  function ordered(list, name, before) {
    if (before !== null && !list.includes(before)) throw new Error("The destination component no longer exists.");
    // Dropping onto oneself keeps the current position.
    if (before === name) return [...list];
    const next = list.filter((item) => item !== name);
    next.splice(before === null ? next.length : next.indexOf(before), 0, name);
    return next;
  }

  function apply(tokens, groups) {
    const pages = tokens.pages ?? [];
    for (const group of groups) {
      const page = pages.find((page) => page.id === group.id);
      if (page) page.components = group.components;
      else pages.push({ id: group.id, name: group.name, components: group.components });
    }
    if (groups.length) tokens.pages = pages;
    return groups.length > 0;
  }

  function assign(tokens, names, name, targetId, before = null) {
    const { groups, homes } = snapshot(tokens, names);
    if (!names.includes(name) && !homes.has(name)) throw new Error("The component no longer exists.");
    if (targetId !== null && !groups.some((group) => group.id === targetId)) throw new Error("The destination page no longer exists.");
    const changed = [];
    for (const group of groups) {
      const components = group.id === targetId
        ? ordered(group.components, name, before)
        : group.components.filter((item) => item !== name);
      if (JSON.stringify(components) !== JSON.stringify(group.components)) changed.push({ ...group, components });
    }
    return apply(tokens, changed);
  }

  function reorder(tokens, names, name, pageId, before = null) {
    const { groups } = snapshot(tokens, names);
    const group = groups.find((group) => group.id === pageId);
    if (!group?.components.includes(name)) throw new Error("The component is no longer on this page.");
    const components = ordered(group.components, name, before);
    return apply(tokens, JSON.stringify(components) === JSON.stringify(group.components) ? [] : [{ ...group, components }]);
  }

  root.PageComponents = { snapshot, assign, reorder };
})(globalThis);
