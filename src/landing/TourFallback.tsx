import { roomAccents, roomPresets } from '../roomStyles.ts'

const palette = roomPresets.original.colors

export function TourFallback() {
  return <svg className="welcome-illustration" viewBox="0 0 1000 820" fill="none" aria-hidden="true">
    <ellipse cx="505" cy="686" rx="389" ry="73" fill="#c6cbb5" opacity=".3" />
    <path d="m98 470 454-216 361 215-437 248z" fill="#d1ac7c" />
    <path d="m98 470 378 222 437-223v23L476 741 98 496z" fill="#bd9468" />
    <path d="M98 470V201L552 44v210z" fill="#e8d1a2" />
    <path d="m552 44 361 205v220L552 254z" fill={palette.wall} />
    <path d="m98 470 454-216 361 215-437 223z" fill={palette.floor} />
    <g stroke={palette.floorAlternate} strokeWidth="2" opacity=".65">
      <path d="m174 435 377 220m-297-260 377 220m-297-260 377 220m-297-260 377 220m-298-260 377 220" />
      <path d="m172 515 449-220M251 560l446-220M329 607l445-221M405 650l446-218" />
    </g>
    <path d="m626 155 137 76v107l-137-74z" fill="#d3ab76" />
    <path d="m637 173 115 64v83l-115-64z" fill={roomAccents.sky} />
    <path d="m695 205 0 84m-57-79 115 64" stroke="#fff4da" strokeWidth="6" />
    <path d="m548 353 227 126 92-47-225-126z" fill="#fff0d5" />
    <path d="m548 353 227 126v111L548 466z" fill={palette.cabinetPanel} />
    <path d="m775 479 92-47v113l-92 45z" fill={palette.cabinet} />
    <g stroke={palette.fridgeDoor} strokeWidth="3"><path d="M604 387v98m57-66v97m57-65v97" /></g>
    <g stroke="#f5e8cd" strokeWidth="5"><path d="m565 383 19 10m40 23 19 10m40 21 19 10m39 20 19 10" /></g>
    <path d="m197 253 126-50 122 64-129 56z" fill={palette.fridgeDoor} />
    <path d="m197 253 119 70v250l-119-72z" fill={palette.fridge} />
    <path d="m316 323 129-56v253l-129 53z" fill={palette.fridgeDoor} />
    <path d="m322 409 117-50" stroke={palette.fridgeEdge} strokeWidth="3" />
    <path d="m423 385 0 31m0 32v61" stroke="#f5efdc" strokeWidth="7" strokeLinecap="round" />
    <path d="m342 346 34-14v32l-34 14z" fill="#f8edcd" />
    <circle cx="358" cy="340" r="5" fill={roomAccents.tomato} />
    <path d="m371 509 207-100 227 126-211 113z" fill="#ddbd87" />
    <path d="m371 509 223 139 211-113v17L594 666 371 528z" fill="#ba885b" />
    <path d="m396 540 14 9v87l-14-8zm184 118 15 9v66l-15-8zm185-99 14-7v76l-14 8z" fill="#ad8058" />
    <path d="m438 470 39-18 40 24-39 21z" fill="#b88b5a" />
    <path d="m438 470 40 27v53l-40-24z" fill="#d4ad77" />
    <path d="m478 497 39-21v51l-39 23z" fill="#bf9865" />
    <path d="M455 467v-22q0-21 19-8l15 8v22" stroke="#a1794d" strokeWidth="6" />
    <path d="m502 468 9-48" stroke="#efd6a0" strokeWidth="12" strokeLinecap="round" />
    <path d="m451 474 12-25 22 6-4 24z" fill={roomAccents.leaf} />
    <path d="m559 538 47-24 50 28-47 26z" fill={roomAccents.tomato} />
    <path d="m565 536 41-18 42 24-40 21z" fill="#fff2d7" />
    <g stroke="#bd9971" strokeWidth="2"><path d="m581 535 29 15m-20-20 28 15m-20-20 28 15" /></g>
    <path d="m694 393 21-9 19 10v32q-19 17-39-4z" fill="#b2c099" />
    <ellipse cx="714" cy="393" rx="21" ry="10" fill="#c8a66e" />
    <path d="m666 387 17 9v26q-10 11-24 0v-23z" fill={roomAccents.tomato} />
    <path d="M665 391q-3-28 16-12l9 10" stroke="#b18a60" strokeWidth="5" />
    <path d="m846 380 23 10-6 41-23-4z" fill={roomAccents.terracotta} />
    <path d="m851 389-15-46 21 8 7 30m-2-6 15-48 9 27-22 31" fill={roomAccents.leafLight} />
    <path d="m219 537 30 16-6 42-24-7z" fill={roomAccents.terracotta} />
    <path d="m232 548-30-65 26 12 8 36m0 7 27-56 9 35-32 26m-2-22-7-54 22 20-12 37" fill={roomAccents.leaf} />
    <path d="m546 51 0 184" stroke="#c1a882" strokeWidth="3" />
    <path d="m515 230 24-30 21 5 33 48-52 11z" fill={roomAccents.terracotta} />
  </svg>
}
