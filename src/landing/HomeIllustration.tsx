type Point = readonly [number, number, number]
const project = ([x, y, z]: Point) => `${466 + (x - z) * 46},${285 + (x + z) * 23 - y * 60}`

function Face({ points, fill, opacity }: { points: Point[]; fill: string; opacity?: number }) {
  return <polygon points={points.map(project).join(' ')} fill={fill} opacity={opacity} />
}

function Box({ x, y = 0, z, w, h, d, top, front, side }: {
  x: number; y?: number; z: number; w: number; h: number; d: number; top: string; front: string; side: string
}) {
  return <g>
    <Face fill={side} points={[[x + w, y, z], [x + w, y, z + d], [x + w, y + h, z + d], [x + w, y + h, z]]} />
    <Face fill={front} points={[[x, y, z + d], [x + w, y, z + d], [x + w, y + h, z + d], [x, y + h, z + d]]} />
    <Face fill={top} points={[[x, y + h, z], [x + w, y + h, z], [x + w, y + h, z + d], [x, y + h, z + d]]} />
  </g>
}

function Shadow({ x, z, w, d }: { x: number; z: number; w: number; d: number }) {
  const points = Array.from({ length: 12 }, (_, index): Point => {
    const angle = index / 12 * Math.PI * 2
    return [x + Math.cos(angle) * w / 2, 0.015, z + Math.sin(angle) * d / 2]
  })
  return <Face points={points} fill="#57664a" opacity={0.13} />
}

function Plant({ x, z, size = 1 }: { x: number; z: number; size?: number }) {
  const center = [x + size * 0.22, size * 0.48, z + size * 0.22] as const
  return <g>
    <Shadow x={x + size * 0.4} z={z + size * 0.4} w={size} d={size * 0.7} />
    <Box x={x} z={z} w={size * 0.44} d={size * 0.44} h={size * 0.5} top="#765942" front="#bc7e55" side="#a16b49" />
    {[[-0.5, 1.2, 0.1], [0.4, 1.4, -0.2], [0.12, 1.75, 0.1], [-0.15, 1.25, 0.65], [0.6, 1.05, 0.35]].map(([dx, dy, dz], index) => <Face key={index} fill={['#6c865c', '#91a274', '#5b7750', '#7d935f', '#a1af82'][index]} points={[
      center, [center[0] + dx * size * 0.35, dy * size * 0.75, center[2] + dz * size * 0.2],
      [center[0] + dx * size, dy * size, center[2] + dz * size],
      [center[0] + dx * size * 0.7 + size * 0.12, dy * size * 0.6, center[2] + dz * size * 0.7],
    ]} />)}
  </g>
}

export function HomeIllustration() {
  return <svg className="welcome-home-illustration" viewBox="140 55 750 635" fill="none" aria-hidden="true">
    <ellipse cx="510" cy="567" rx="318" ry="95" fill="#a9b194" opacity=".16" />
    <Box x={0} y={-0.26} z={0} w={8} h={0.26} d={6} top="#e0c49d" front="#c4a27b" side="#b8946d" />
    <Face fill="#eee6d2" points={[[0, 0.01, 0], [4.6, 0.01, 0], [4.6, 0.01, 6], [0, 0.01, 6]]} />
    {Array.from({ length: 7 }, (_, x) => Array.from({ length: 9 }, (_, z) => <Face key={`${x}:${z}`} fill={(x + z) % 2 ? '#d5ddc6' : '#e8ebdc'} points={[
      [x * 0.64 + 0.06, 0.02, z * 0.65 + 0.06], [x * 0.64 + 0.69, 0.02, z * 0.65 + 0.06],
      [x * 0.64 + 0.69, 0.02, z * 0.65 + 0.7], [x * 0.64 + 0.06, 0.02, z * 0.65 + 0.7],
    ]} />))}
    {Array.from({ length: 8 }, (_, index) => <Face key={index} fill={index % 2 ? '#d9b688' : '#e2c296'} points={[
      [4.6 + index * 0.42, 0.025, 2.5], [5.01 + index * 0.42, 0.025, 2.5],
      [5.01 + index * 0.42, 0.025, 6], [4.6 + index * 0.42, 0.025, 6],
    ]} />)}
    <Face fill="#dbe2d5" points={[[4.6, 0.03, 0], [8, 0.03, 0], [8, 0.03, 2.5], [4.6, 0.03, 2.5]]} />
    <Box x={0} z={0} w={8} h={3.25} d={0.16} top="#f5ecda" front="#e5dac0" side="#c9b999" />
    <Box x={0} z={0} w={0.16} h={3.25} d={6} top="#f5ecda" front="#ddcfb1" side="#ede3cc" />
    <Box x={0.16} z={0.16} w={7.84} h={0.14} d={0.07} top="#d4c6a7" front="#c6b895" side="#bfad89" />
    <Box x={0.16} z={0.16} w={0.07} h={0.14} d={5.84} top="#d4c6a7" front="#c6b895" side="#d8c9a9" />

    <Face fill="#bf9c6f" points={[[0.18, 1.35, 3.05], [0.18, 2.8, 3.05], [0.18, 2.8, 5.32], [0.18, 1.35, 5.32]]} />
    <Face fill="#b7cebf" points={[[0.19, 1.5, 3.2], [0.19, 2.66, 3.2], [0.19, 2.66, 5.17], [0.19, 1.5, 5.17]]} />
    <Face fill="#d9e2cc" points={[[0.2, 1.5, 3.2], [0.2, 1.9, 3.2], [0.2, 2.15, 4.4], [0.2, 1.65, 5.17], [0.2, 1.5, 5.17]]} />
    <Box x={0.19} y={1.45} z={4.13} w={0.055} h={1.25} d={0.06} top="#fff3d9" front="#f5ebd4" side="#f5ebd4" />
    <Box x={0.19} y={2.02} z={3.17} w={0.06} h={0.06} d={2.02} top="#fff3d9" front="#f5ebd4" side="#f5ebd4" />
    <Box x={0.18} y={1.34} z={3.02} w={0.27} h={0.08} d={2.35} top="#f4e8ce" front="#d7c6a6" side="#e6d6b6" />
    <Face fill="#fff5d7" opacity={0.48} points={[[0.35, 0.04, 3.13], [1.86, 0.04, 2.54], [2.7, 0.04, 4.35], [0.35, 0.04, 5.34]]} />

    <Shadow x={2.6} z={1.04} w={3.8} d={1.6} />
    <Box x={0.7} z={0.25} w={3.28} h={1.08} d={0.94} top="#87a084" front="#81987b" side="#697e64" />
    {[0.84, 1.87, 2.9].map((x) => <g key={x}>
      <Face fill="#98ac8d" points={[[x, 0.14, 1.2], [x + 0.9, 0.14, 1.2], [x + 0.9, 0.91, 1.2], [x, 0.91, 1.2]]} />
      <Box x={x + 0.64} y={0.74} z={1.21} w={0.16} h={0.045} d={0.04} top="#eadbbd" front="#f1e6cc" side="#d5c6a7" />
    </g>)}
    <Box x={0.63} y={1.08} z={0.2} w={3.43} h={0.12} d={1.06} top="#f4ecdb" front="#ded2b9" side="#d5c6ac" />
    <Face fill="#728577" points={[[2.7, 1.205, 0.37], [3.68, 1.205, 0.37], [3.68, 1.205, 0.96], [2.7, 1.205, 0.96]]} />
    <Face fill="#b2c0ad" points={[[2.84, 1.21, 0.47], [3.54, 1.21, 0.47], [3.54, 1.21, 0.86], [2.84, 1.21, 0.86]]} />
    <Box x={3.12} y={1.2} z={0.32} w={0.055} h={0.34} d={0.055} top="#d6d9c9" front="#99a997" side="#849a87" />
    <Box x={3.12} y={1.49} z={0.32} w={0.055} h={0.055} d={0.25} top="#e4e6d8" front="#99a997" side="#849a87" />
    <Box x={1.01} y={1.2} z={0.48} w={0.45} h={0.4} d={0.4} top="#d48759" front="#b95c3c" side="#9c4e34" />
    <Box x={1.04} y={1.59} z={0.51} w={0.38} h={0.05} d={0.34} top="#d6a779" front="#9f6e45" side="#886040" />
    <Box x={1.69} y={1.2} z={0.65} w={0.28} h={0.26} d={0.26} top="#efe3c8" front="#d5b57c" side="#b69b6a" />
    <Box x={0.32} z={1.43} w={1.11} h={2.27} d={0.96} top="#b6c5a8" front="#a6b89a" side="#8eaa8d" />
    <Box x={0.35} y={0.18} z={2.4} w={1.04} h={1.32} d={0.065} top="#b8c5a7" front="#b4c2a3" side="#879f80" />
    <Box x={0.35} y={1.55} z={2.4} w={1.04} h={0.66} d={0.065} top="#c1ceae" front="#b4c2a3" side="#879f80" />
    <Box x={1.2} y={0.94} z={2.48} w={0.065} h={0.42} d={0.065} top="#f5edd9" front="#e4dfc9" side="#b6bea7" />
    <Box x={1.2} y={1.62} z={2.48} w={0.065} h={0.31} d={0.065} top="#f5edd9" front="#e4dfc9" side="#b6bea7" />
    <Face fill="#f8eecd" points={[[0.57, 1.71, 2.475], [0.89, 1.73, 2.475], [0.9, 2.04, 2.475], [0.58, 2.02, 2.475]]} />
    <Box x={0.7} y={2.04} z={2.48} w={0.08} h={0.06} d={0.018} top="#c96344" front="#c96344" side="#a54732" />

    <Face fill="#a5b99e" points={[[5.25, 1.54, 0.17], [7.45, 1.54, 0.17], [7.45, 2.7, 0.17], [5.25, 2.7, 0.17]]} />
    <Face fill="#d1ddd0" points={[[5.39, 1.66, 0.18], [7.3, 1.66, 0.18], [7.3, 2.58, 0.18], [5.39, 2.58, 0.18]]} />
    <Face fill="#e4ebdc" points={[[5.39, 1.66, 0.185], [6.19, 1.66, 0.185], [7.12, 2.58, 0.185], [6.3, 2.58, 0.185]]} />
    <Shadow x={6.4} z={1.25} w={2.8} d={1.55} />
    <Box x={5.25} y={0.1} z={0.5} w={2.35} h={0.69} d={1.22} top="#f8f5e9" front="#e9e9db" side="#c6d1c2" />
    <Face fill="#9fbbae" points={[[5.45, 0.795, 0.7], [7.36, 0.795, 0.7], [7.36, 0.795, 1.5], [5.45, 0.795, 1.5]]} />
    <Face fill="#c8ddd0" points={[[5.56, 0.8, 0.82], [7.25, 0.8, 0.82], [7.25, 0.8, 1.38], [5.56, 0.8, 1.38]]} />
    <Box x={7.05} y={0.79} z={0.59} w={0.07} h={0.27} d={0.07} top="#eef0e7" front="#94a89b" side="#6c8779" />
    <Box x={7.05} y={1} z={0.59} w={0.07} h={0.06} d={0.26} top="#eef0e7" front="#94a89b" side="#6c8779" />
    <Box x={4.6} z={0.16} w={0.16} h={1.76} d={2.44} top="#f7ecd6" front="#d9c6a2" side="#e9ddc0" />
    <Face fill="#cb8065" points={[[4.77, 1.07, 0.69], [4.77, 1.72, 0.69], [4.77, 1.72, 1.26], [4.77, 1.02, 1.26]]} />
    <Box x={4.73} y={1.72} z={0.64} w={0.1} h={0.055} d={0.69} top="#c7a57a" front="#a88659" side="#a88659" />

    <Face fill="#ece7d2" points={[[4.72, 0.04, 3.04], [7.83, 0.04, 3.04], [7.83, 0.04, 5.68], [4.72, 0.04, 5.68]]} />
    {[3.13, 5.47].map((z) => <Face key={z} fill="#c48b65" points={[[4.84, 0.045, z], [7.7, 0.045, z], [7.7, 0.045, z + 0.085], [4.84, 0.045, z + 0.085]]} />)}
    <Plant x={7.31} z={2.05} size={0.7} />
    <Shadow x={7.09} z={4.36} w={1.75} d={2.7} />
    <Box x={6.64} y={0.15} z={3.1} w={1.1} h={0.38} d={2.35} top="#899d71" front="#73875e" side="#647b52" />
    <Box x={7.48} y={0.51} z={3.1} w={0.26} h={0.73} d={2.35} top="#a9b78d" front="#829a69" side="#76895e" />
    {[3.28, 4.29].map((z) => <Box key={z} x={6.68} y={0.53} z={z} w={0.76} h={0.19} d={0.94} top="#b1bf94" front="#9cac81" side="#809466" />)}
    {[3.09, 5.28].map((z) => <Box key={z} x={6.59} y={0.53} z={z} w={1.18} h={0.48} d={0.2} top="#a5b58a" front="#8c9f75" side="#7b9063" />)}
    <Box x={7.01} y={0.73} z={3.48} w={0.38} h={0.34} d={0.39} top="#dbab88" front="#cd9070" side="#b57658" />
    <Shadow x={5.6} z={4.5} w={1.55} d={1.3} />
    {[5.05, 6.04].map((x) => [3.98, 4.78].map((z) => <Box key={`${x}:${z}`} x={x} z={z} w={0.1} h={0.7} d={0.1} top="#b17e51" front="#ac7d52" side="#90663f" />))}
    <Box x={4.92} y={0.7} z={3.86} w={1.35} h={0.12} d={1.12} top="#d7b27c" front="#b98c56" side="#a67a4b" />
    <Box x={5.2} y={0.83} z={4.05} w={0.59} h={0.07} d={0.45} top="#c66547" front="#a94c36" side="#eee3c9" />
    <Face fill="#f5ead0" points={[[5.23, 0.905, 4.1], [5.71, 0.905, 4.1], [5.71, 0.905, 4.43], [5.23, 0.905, 4.43]]} />

    <Shadow x={2.8} z={4.3} w={2.9} d={2.15} />
    {[1.95, 3.68].map((x) => [3.25, 4.47].map((z) => <Box key={`${x}:${z}`} x={x} z={z} w={0.12} h={1.08} d={0.12} top="#c69b68" front="#af8050" side="#906741" />))}
    <Box x={1.75} y={1.08} z={3.02} w={2.25} h={0.14} d={1.65} top="#e2c496" front="#c59f70" side="#b48b5d" />
    <Box x={2.14} y={1.225} z={3.36} w={0.5} h={0.09} d={0.69} top="#f5edda" front="#dbd0b8" side="#c4b596" />
    <Face fill="#c77854" points={[[2.21, 1.32, 3.44], [2.57, 1.32, 3.44], [2.57, 1.32, 3.49], [2.21, 1.32, 3.49]]} />
    <Face fill="#b8bf9e" points={[[2.21, 1.32, 3.59], [2.57, 1.32, 3.59], [2.57, 1.32, 3.63], [2.21, 1.32, 3.63]]} />
    <Box x={3.15} y={1.22} z={3.48} w={0.27} h={0.3} d={0.27} top="#f0e9d4" front="#bb7354" side="#a05d42" />
    <Box x={2.46} y={0.12} z={5.14} w={0.54} h={0.58} d={0.13} top="#b99565" front="#b99565" side="#8e7049" />
    <Box x={2.44} y={0.7} z={4.94} w={0.72} h={0.15} d={0.67} top="#a7b492" front="#849970" side="#6e865b" />
    <Plant x={0.69} z={5.11} size={0.92} />
  </svg>
}
