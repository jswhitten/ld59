// Canonical toroidal math helpers — single source for all wrap-around distance/delta.

export function wrappedDelta(from, to, worldSize) {
    let d = to - from;
    if (d > worldSize * 0.5) d -= worldSize;
    if (d < -worldSize * 0.5) d += worldSize;
    return d;
}

export function wrappedDist(ax, ay, bx, by, worldSize) {
    const dx = wrappedDelta(ax, bx, worldSize);
    const dy = wrappedDelta(ay, by, worldSize);
    return Math.sqrt(dx * dx + dy * dy);
}
