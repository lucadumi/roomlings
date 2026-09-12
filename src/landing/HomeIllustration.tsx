import { homeGround, homeViewBox, orderedHomeSurfaces } from './homeGeometry.ts'
import { projectIllustration } from './illustrationDepth.ts'

export function HomeIllustration() {
  return <svg className="welcome-home-illustration" viewBox={homeViewBox.join(' ')} fill="none" aria-hidden="true">
    <ellipse cx="565" cy="678" rx="437" ry="104" fill="#a9b194" opacity=".16" />
    <g>{homeGround.map((face, index) => <polygon key={index} points={face.points.map((point) => projectIllustration(point).join(',')).join(' ')} fill={face.fill} opacity={face.opacity} />)}</g>
    <g strokeWidth={0.35} strokeLinejoin="round">{orderedHomeSurfaces.map((face, index) =>
      <polygon key={index} points={face.points.map((point) => projectIllustration(point).join(',')).join(' ')} fill={face.fill} stroke={face.fill} />,
    )}</g>
  </svg>
}
