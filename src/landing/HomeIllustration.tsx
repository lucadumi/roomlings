import { homeGround, orderedHomeSurfaces } from './homeGeometry.ts'
import { projectIllustration } from './illustrationDepth.ts'

export function HomeIllustration() {
  return <svg className="welcome-home-illustration" viewBox="176 76 672 600" fill="none" aria-hidden="true">
    <ellipse cx="510" cy="567" rx="318" ry="95" fill="#a9b194" opacity=".16" />
    <g>{homeGround.map((face, index) => <polygon key={index} points={face.points.map((point) => projectIllustration(point).join(',')).join(' ')} fill={face.fill} opacity={face.opacity} />)}</g>
    <g strokeWidth={0.35} strokeLinejoin="round">{orderedHomeSurfaces.map((face, index) =>
      <polygon key={index} points={face.points.map((point) => projectIllustration(point).join(',')).join(' ')} fill={face.fill} stroke={face.fill} />,
    )}</g>
  </svg>
}
