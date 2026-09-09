import type { FramingArea } from '../camera.ts'

export function gardenContentMask(width: number, height: number, areas: readonly FramingArea[]): string {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)
    || areas.some((area) => ![area.x, area.y, area.width, area.height].every(Number.isFinite) || area.width <= 0 || area.height <= 0)) {
    throw new Error('The garden mask needs positive page dimensions and finite content areas.')
  }
  const rectangles = (padding: number) => areas.map((area) =>
    `<rect x="${area.x - padding}" y="${area.y - padding}" width="${area.width + padding * 2}" height="${area.height + padding * 2}" rx="8"/>`,
  ).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><filter id="soft" x="0" y="0" width="${width}" height="${height}" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="8"/></filter><mask id="clear" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="white"/><g fill="black" filter="url(#soft)">${rectangles(16)}</g><g fill="black">${rectangles(4)}</g></mask></defs><rect width="${width}" height="${height}" fill="white" mask="url(#clear)"/></svg>`
}
