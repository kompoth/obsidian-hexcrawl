## Borders

New type of object, defines the barrier between hexes. Useful for drawing borders and rivers (if user wants them to travel along edges).

Border is an array of pairs of hexes, each pair denotes the shared edge.

For each pair a **direction** may be calculated: take the first hex of a pair, imagine it rotates counter clock wise. This rotation along the edge gives you the direction of the edge — direction runs _along_ the edge (tangential), and is a separate thing from the edge offset (see Settings section below), which shifts the edge _towards_ a hex center (radial).

Pairs (not a flat hex list) are required because a border can turn a corner around a single hex: both edges meeting at that corner pivot on the same hex, so that hex is the first member of two consecutive pairs in a row. A flat list (like `path-hexes`) assumes the shared hex always alternates from "second of previous" to "first of next", which doesn't hold in that case.

Example:

```yaml
border-type: Barrier
border-hexes:
  - [[0, 0], [1, 1]]
  - [[1, 1], [0, 1]]
  - [[0, 1], [1, 2]]
```

Math validation:

1. Members of one pair must be neighbors.
2. Each subsequent pair must contain one (and only one!) member of previous pair.
3. Border is head-to-tail vector sequence, checked via the computed direction of each edge: each edge starts where the previous ended: ->.->.->, never ->.<-.->

Math validation must run each time border-hexes value is written/edited, or when the border is being rendered. If it fails, the write or render should be skipped and an error must be shown/logged.

Details:

- Borders doesn't have to be complete.
- Border may contain of one pair.

Editing existing borders:

- In edit mode highlight available edges to be added to the start and end of the border (see math validation) with a dot (same as middlepoints in path editing mode).
- Right mouse click removes an edge from either end (if it can be removed according to validation rules). Removing an edge from the middle is not possible.
- Adding intermediary edges is not possible right now.
- If the last remaining edge is removed, the whole border is deleted.

Borders must be configured via Settings the same way paths are:

- New `bordersFolder` block param, mirroring `pathsFolder`.
- New `palette.borders` map (border-type -> style: color/width/dash), configured via the palette edit modal the same way `palette.paths` is. `border-type` is matched against it the same way `path-type` is matched against `palette.paths`.
- No spline smoothing supported for them.
- Separate visibility layer, rendered right on top of terrain layer, but below paths and icons.
- Additional per-border-type palette parameter: hex edge offset. It denotes how shifted is the border segment towards the center of its rotation. Needed for building two-sided borders, each shifted a bit inside of its region. The shift is always towards the first hex of each pair (the pivot the edge is defined from), which — by construction of the edge's direction — is consistently the same side of travel for every edge in a chain, even one that turns a corner.
