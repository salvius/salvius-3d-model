const fs = require('fs');
const path = require('path');

const inch = 0.0254;
const thickness = 3 * inch;
const radius = 3 * inch;
const holeRadius = inch;
const pivotDistance = 16 * inch;
const segments = 64;
const facets = [];

function triangle(first, second, third) {
  const edge1 = second.map((value, index) => value - first[index]);
  const edge2 = third.map((value, index) => value - first[index]);
  const normal = [
    edge1[1] * edge2[2] - edge1[2] * edge2[1],
    edge1[2] * edge2[0] - edge1[0] * edge2[2],
    edge1[0] * edge2[1] - edge1[1] * edge2[0],
  ];
  const length = Math.hypot(...normal);
  if (length < 1e-14) return;
  facets.push(`  facet normal ${normal.map(value => value / length).join(' ')}\n    outer loop\n${[first, second, third].map(point => `      vertex ${point.join(' ')}`).join('\n')}\n    endloop\n  endfacet`);
}

function prism(polygon) {
  const lower = polygon.map(([x, z]) => [x, -thickness / 2, z]);
  const upper = polygon.map(([x, z]) => [x, thickness / 2, z]);
  for (let index = 1; index < polygon.length - 1; index++) {
    triangle(lower[0], lower[index], lower[index + 1]);
    triangle(upper[0], upper[index + 1], upper[index]);
  }
  for (let index = 0; index < polygon.length; index++) {
    const next = (index + 1) % polygon.length;
    triangle(lower[index], upper[index], upper[next]);
    triangle(lower[index], upper[next], lower[next]);
  }
}

function rectangle(xMin, xMax, zMin, zMax) {
  prism([[xMin, zMin], [xMax, zMin], [xMax, zMax], [xMin, zMax]]);
}

const holeCenters = [-6, -8, -10].map(value => value * inch);
const holeTop = holeCenters[0] + holeRadius;
const holeBottom = holeCenters[2] - holeRadius;
rectangle(-radius, radius, holeTop, 0);
rectangle(-radius, radius, -pivotDistance, holeBottom);
rectangle(-radius, -holeRadius, holeBottom, holeTop);
rectangle(holeRadius, radius, holeBottom, holeTop);

for (const center of holeCenters) {
  for (let index = 0; index < segments; index++) {
    const points = [index, index + 1].map(step => {
      const angle = 2 * Math.PI * step / segments;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const squareRadius = holeRadius / Math.max(Math.abs(cosine), Math.abs(sine));
      return {
        inner: [holeRadius * cosine, center + holeRadius * sine],
        outer: [squareRadius * cosine, center + squareRadius * sine],
      };
    });
    prism([points[0].inner, points[0].outer, points[1].outer, points[1].inner]);
  }
}

for (const [center, start] of [[0, 0], [-pivotDistance, Math.PI]]) {
  for (let index = 0; index < segments / 2; index++) {
    const angle = start + Math.PI * index / (segments / 2);
    const next = start + Math.PI * (index + 1) / (segments / 2);
    prism([[0, center], [radius * Math.cos(angle), center + radius * Math.sin(angle)], [radius * Math.cos(next), center + radius * Math.sin(next)]]);
  }
}

fs.writeFileSync(path.join(__dirname, 'upper-leg.stl'), `solid upper_leg\n${facets.join('\n')}\nendsolid upper_leg\n`);