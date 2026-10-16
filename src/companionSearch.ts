import type { RoomId } from '../shared/rooms.ts'
import { companionEntries, companionStarters } from './companionAnswers.ts'
import type { CompanionEntry } from './companionAnswers.ts'

const stopWords = new Set([
  'a', 'an', 'the', 'i', 'me', 'my', 'we', 'our', 'us', 'is', 'are', 'am', 'was', 'be', 'do', 'does', 'did', 'can', 'could',
  'should', 'would', 'will', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'it', 'its', 'this', 'that', 'what',
  'how', 'why', 'when', 'where', 'who', 'whom', 'which', 'there', 'some', 'any', 'so', 'if', 'as', 'by', 'from', 'up', 'about',
  'please', 'roomlings', 'app', 'get', 'have', 'has', 'want', 'need', 'make',
])

// Phrases are rewritten before tokenizing so two-word ideas match their one-word keyword.
const phrases: readonly [RegExp, string][] = [
  [/\bpa(?:y|ying|id) (?:\w+ )?back\b/g, 'repay'],
  [/\bran out\b|\brunning out\b|\bout of\b/g, 'restock'],
  [/\bflat ?mate|\bhouse ?mate/g, 'roommate'],
  [/\bto ?do\b/g, 'chore'],
  [/\bcolou?rs?\b/g, 'color'],
]

// Everyday words mapped onto the vocabulary the answers use, stemmed once below.
const synonymWords: Record<string, readonly string[]> = {
  owe: ['debt', 'balance'], owing: ['debt', 'balance'], debt: ['owe', 'balance'], balance: ['owe'], even: ['settle'], square: ['settle'],
  settle: ['repay'], reimburse: ['repay'], refund: ['repay'], venmo: ['transfer'], paypal: ['transfer'],
  groceries: ['expense'], food: ['groceries'], shopping: ['groceries'], bought: ['expense'], buy: ['shop'], spent: ['expense'],
  cost: ['split'], receipt: ['expense'], expense: ['receipt'], purchase: ['expense'],
  rent: ['bill'], utility: ['bill'], electricity: ['bill'], wifi: ['bill'], internet: ['bill'], subscription: ['bill'],
  task: ['chore'], cleaning: ['chore'], housework: ['chore'], rota: ['rotation'], dishes: ['chore'], vacuum: ['chore'],
  messy: ['dirty'], filthy: ['dirty'], crumbs: ['dirty'], grime: ['dirty'],
  furniture: ['object'], appliance: ['object'], thing: ['object'], decorate: ['edit'],
  friend: ['roommate'], partner: ['roommate'], member: ['roommate'],
  bell: ['notification'], alert: ['notification'], reminder: ['notification'], push: ['notification'],
  delete: ['remove'], mistake: ['remove'], wrong: ['remove'],
  zoom: ['camera'], rotate: ['camera'], night: ['evening'],
}

export function normalizeQuestion(text: string): string {
  let result = text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, '')
  for (const [pattern, replacement] of phrases) result = result.replace(pattern, replacement)
  return result.replace(/[^a-z0-9]+/g, ' ').trim()
}

// A light suffix stripper: enough to equate settle, settled and settling without a dictionary.
export function stem(word: string): string {
  if (word.length <= 3) return word
  let result = word
  if (result.endsWith('ies') && result.length > 4) result = `${result.slice(0, -3)}i`
  else if (result.endsWith('ing') && result.length > 5) result = result.slice(0, -3)
  else if (result.endsWith('ed') && result.length > 4) result = result.slice(0, -2)
  else if (result.endsWith('es') && result.length > 4) result = result.slice(0, -2)
  else if (result.endsWith('s') && !result.endsWith('ss') && result.length > 3) result = result.slice(0, -1)
  if (result.endsWith('ment') && result.length > 6) result = result.slice(0, -4)
  if (result.endsWith('y') && result.length > 4) result = `${result.slice(0, -1)}i`
  if (result.endsWith('e') && result.length > 4) result = result.slice(0, -1)
  if (/([b-df-hj-np-tv-z])\1$/.test(result) && !/(ll|ss)$/.test(result)) result = result.slice(0, -1)
  return result
}

const synonyms = new Map(Object.entries(synonymWords).map(([word, related]) => [stem(word), related.map(stem)]))

export function terms(text: string): string[] {
  return normalizeQuestion(text).split(' ').filter((word) => word && !stopWords.has(word)).map(stem)
}

function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  let before: number[] = []
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, before[j - 2] + 1)
      current[j] = value
      best = Math.min(best, value)
    }
    if (best > limit) return limit + 1
    before = previous
    previous = current
  }
  return previous[b.length]
}

type Field = 'question' | 'keywords' | 'answer'
const fieldWeights: Record<Field, number> = { question: 3, keywords: 2, answer: 1 }

type Document = { entry: CompanionEntry; frequencies: Map<string, number>; length: number }
export type CompanionIndex = {
  documents: Document[]
  vocabulary: Set<string>
  // Terms from questions, phrasings and keywords; answer prose alone never decides a match.
  topics: Set<string>
  documentFrequency: Map<string, number>
  averageLength: number
}

export function buildCompanionIndex(entries: readonly CompanionEntry[] = companionEntries): CompanionIndex {
  const documents = entries.map((entry) => {
    const frequencies = new Map<string, number>()
    let length = 0
    const fields: Record<Field, string> = {
      question: [entry.question, ...entry.phrasings].join(' '),
      keywords: entry.keywords.join(' '),
      answer: entry.answer,
    }
    for (const field of Object.keys(fields) as Field[]) {
      for (const term of terms(fields[field])) {
        frequencies.set(term, (frequencies.get(term) ?? 0) + fieldWeights[field])
        length += fieldWeights[field]
      }
    }
    return { entry, frequencies, length }
  })
  const topics = new Set(entries.flatMap((entry) => terms([entry.question, ...entry.phrasings, ...entry.keywords].join(' '))))
  const documentFrequency = new Map<string, number>()
  for (const document of documents) {
    for (const term of document.frequencies.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
  }
  return {
    documents,
    vocabulary: new Set(documentFrequency.keys()),
    topics,
    documentFrequency,
    averageLength: documents.reduce((sum, document) => sum + document.length, 0) / Math.max(documents.length, 1),
  }
}

type WeightedTerm = { term: string; weight: number }

// Expands what was typed with synonyms, typo corrections and, while typing, completions of the last word.
function expandQuery(text: string, index: CompanionIndex): WeightedTerm[] {
  const normalized = normalizeQuestion(text)
  const words = normalized.split(' ').filter((word) => word && !stopWords.has(word))
  const typing = words.length > 0 && !/\s$/.test(text) && normalized.endsWith(words[words.length - 1])
  const weights = new Map<string, number>()
  const add = (term: string, weight: number) => {
    if (index.vocabulary.has(term)) weights.set(term, Math.max(weights.get(term) ?? 0, weight))
  }
  words.forEach((word, position) => {
    const term = stem(word)
    add(term, 1)
    for (const synonym of synonyms.get(term) ?? []) add(synonym, 0.7)
    // Typos keep their first letter; corrections only reach topic words, never answer prose.
    if (!index.vocabulary.has(term) && word.length >= 4) {
      const limit = word.length >= 7 ? 2 : 1
      for (const candidate of index.topics) {
        if (candidate[0] === term[0] && editDistance(term, candidate, limit) <= limit) add(candidate, 0.75)
      }
    }
    if (typing && position === words.length - 1 && word.length >= 2) {
      for (const candidate of index.topics) {
        if (candidate !== term && (candidate.startsWith(word) || (candidate.length >= 4 && word.startsWith(candidate)))) add(candidate, 0.6)
      }
    }
  })
  return [...weights].map(([term, weight]) => ({ term, weight }))
}

export type CompanionMatch = { entry: CompanionEntry; score: number }

const k1 = 1.2
const b = 0.6

export function searchCompanion(text: string, roomId: RoomId, index: CompanionIndex = defaultIndex, limit = 4): CompanionMatch[] {
  const query = expandQuery(text, index)
  if (!query.some(({ term }) => index.topics.has(term))) return []
  const total = index.documents.length
  const matches = index.documents.map((document) => {
    let score = 0
    for (const { term, weight } of query) {
      const frequency = document.frequencies.get(term)
      if (!frequency) continue
      const frequencyOfDocuments = index.documentFrequency.get(term) ?? 0
      const idf = Math.log(1 + (total - frequencyOfDocuments + 0.5) / (frequencyOfDocuments + 0.5))
      score += weight * idf * frequency * (k1 + 1) / (frequency + k1 * (1 - b + b * document.length / index.averageLength))
    }
    // Room topics break ties without outranking a clearly better answer.
    if (score > 0 && document.entry.rooms?.includes(roomId)) score *= 1.08
    return { entry: document.entry, score }
  }).filter((match) => match.score > 0).sort((left, right) => right.score - left.score)
  const best = matches[0]?.score ?? 0
  return matches.filter((match) => match.score >= Math.max(1, best * 0.35)).slice(0, limit)
}

export function companionStarterEntries(roomId: RoomId): CompanionEntry[] {
  return companionStarters[roomId].map((id) => {
    const entry = companionEntries.find((candidate) => candidate.id === id)
    if (!entry) throw new Error(`Unknown companion starter ${id}.`)
    return entry
  })
}

const defaultIndex = buildCompanionIndex()
