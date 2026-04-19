// Shared rendering helpers used by both GameScene and UIScene.

export function drawBlipBrackets(g, x, y, halfSize, cornerLength, color, alpha, lineWidth = 1.3) {
    g.lineStyle(lineWidth, color, alpha);
    g.lineBetween(x - halfSize, y - halfSize, x - halfSize + cornerLength, y - halfSize);
    g.lineBetween(x - halfSize, y - halfSize, x - halfSize, y - halfSize + cornerLength);
    g.lineBetween(x + halfSize, y - halfSize, x + halfSize - cornerLength, y - halfSize);
    g.lineBetween(x + halfSize, y - halfSize, x + halfSize, y - halfSize + cornerLength);
    g.lineBetween(x - halfSize, y + halfSize, x - halfSize + cornerLength, y + halfSize);
    g.lineBetween(x - halfSize, y + halfSize, x - halfSize, y + halfSize - cornerLength);
    g.lineBetween(x + halfSize, y + halfSize, x + halfSize - cornerLength, y + halfSize);
    g.lineBetween(x + halfSize, y + halfSize, x + halfSize, y + halfSize - cornerLength);
}
