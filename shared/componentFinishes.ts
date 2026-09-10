import { z } from 'zod'

export const componentFinishSchema = z.enum([
  'room', 'cream', 'sage', 'tomato', 'clay', 'walnut',
  'ocean', 'teal', 'plum', 'lilac', 'lime', 'lemon', 'berry', 'rose',
])
export type ComponentFinish = z.infer<typeof componentFinishSchema>
export const componentFinishes: Record<ComponentFinish, { name: string; color: string | null }> = {
  room: { name: 'Match room colors', color: null },
  cream: { name: 'Warm cream', color: '#fcf9f1' },
  sage: { name: 'Sage green', color: '#81b29a' },
  tomato: { name: 'Tomato red', color: '#e07a5f' },
  clay: { name: 'Terracotta', color: '#c58d71' },
  walnut: { name: 'Walnut', color: '#806044' },
  ocean: { name: 'Ocean', color: '#5f8195' },
  teal: { name: 'Teal', color: '#70968f' },
  plum: { name: 'Plum', color: '#725879' },
  lilac: { name: 'Lilac', color: '#a48faf' },
  lime: { name: 'Olive', color: '#879367' },
  lemon: { name: 'Butter yellow', color: '#d3bd85' },
  berry: { name: 'Berry', color: '#986b7a' },
  rose: { name: 'Rose', color: '#c7969b' },
}
