jest.mock('@/lib/db', () => ({ db: {} }))

import { splitManuscriptIntoChapters, truncateManuscript, wordCount } from '@/lib/manuscript'
import { publicJobResult } from '@/lib/job-public'
import { isBookExportable } from '@/lib/utils/bookHelpers'

describe('splitManuscriptIntoChapters', () => {
  test('returns a single chapter when there are no headings', () => {
    const parts = splitManuscriptIntoChapters('Once upon a time there was a harbor.')
    expect(parts).toEqual([{ title: 'Manuscript', content: 'Once upon a time there was a harbor.' }])
  })

  test('splits on Chapter headings and keeps a prologue', () => {
    const text = [
      'A long prologue that is definitely more than two hundred characters so we keep it as its own chapter when the first heading appears later in the file. Padding padding padding padding padding padding padding padding padding.',
      '',
      'Chapter 1 The Docks',
      'Mara stood in the fog.',
      '',
      'Chapter 2 The Ledger',
      'Hale opened the book.',
    ].join('\n')
    const parts = splitManuscriptIntoChapters(text)
    expect(parts[0].title).toBe('Prologue')
    expect(parts[1].title).toMatch(/Chapter 1/)
    expect(parts[1].content).toContain('Mara stood')
    expect(parts[2].title).toMatch(/Chapter 2/)
    expect(parts[2].content).toContain('Hale opened')
  })

  test('empty input yields no chapters', () => {
    expect(splitManuscriptIntoChapters('   \n  ')).toEqual([])
  })
})

describe('truncateManuscript / wordCount', () => {
  test('strips nuls and trims', () => {
    expect(truncateManuscript('  hello\u0000  ')).toBe('hello')
  })
  test('counts words', () => {
    expect(wordCount('one two  three')).toBe(3)
  })
})

describe('publicJobResult', () => {
  test('strips manuscript text so job polls stay small', () => {
    const raw = JSON.stringify({ fileName: 'book.txt', text: 'x'.repeat(5000), nextWindow: 2 })
    expect(publicJobResult(raw)).toEqual({
      fileName: 'book.txt',
      nextWindow: 2,
      textLength: 5000,
    })
  })

  test('passes through unrelated JSON', () => {
    expect(publicJobResult('{"autoApprove":true}')).toEqual({ autoApprove: true })
  })

  test('handles empty/invalid', () => {
    expect(publicJobResult(null)).toBeNull()
    expect(publicJobResult('not-json')).toBe('not-json')
  })
})

describe('isBookExportable', () => {
  test('allows books with chapter prose even if still draft', () => {
    expect(isBookExportable({ status: 'draft', chapters: [{ content: 'Hello' }] }).ok).toBe(true)
  })
  test('rejects empty drafts', () => {
    const result = isBookExportable({ status: 'draft', chapters: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/no chapter content/i)
  })
  test('allows completed books', () => {
    expect(isBookExportable({ status: 'completed', chapters: [] }).ok).toBe(true)
  })
})

describe('extractPdfTextFromBuffer', () => {
  test('rejects with a typed PdfReadError instead of a bare 500 message', async () => {
    const { extractPdfTextFromBuffer, PdfReadError } = await import('@/lib/manuscript')
    const err = await extractPdfTextFromBuffer(Buffer.from('this is not a pdf at all')).catch((e) => e)
    expect(err).toBeInstanceOf(PdfReadError)
    // Whichever way it is classified, the user must get an actionable sentence.
    expect(err.message).toMatch(/could not read that pdf|could not start on this server/i)
  })

  test('a missing pdf.js worker is labelled a deployment problem, a bad file is not', () => {
    // This is the exact production string from the Vercel logs. It used to be
    // reported as "The PDF may be corrupted" - sending users off re-exporting a
    // perfectly good file while the real bug (worker not in the bundle) stayed.
    const { isPdfWorkerUnavailableMessage } = require('@/lib/manuscript')
    expect(
      isPdfWorkerUnavailableMessage(
        'Failed to parse PDF: Setting up fake worker failed: "Cannot find module ' +
          "'/var/task/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'" +
          '" imported from /var/task/node_modules/pdfjs-dist/legacy/build/pdf.mjs'
      )
    ).toBe(true)
    expect(isPdfWorkerUnavailableMessage('Invalid PDF structure.')).toBe(false)
  })
})

describe('bookAccessFailure', () => {
  test('maps a deleted book to 404 so a stale client id is not an incident', async () => {
    const { bookAccessFailure } = await import('@/lib/story-bible-helpers')
    expect(bookAccessFailure(new Error('Book not found'))).toEqual({
      status: 404,
      message: expect.stringMatching(/no longer exists/i),
    })
    expect(bookAccessFailure(new Error('Forbidden'))?.status).toBe(403)
    expect(bookAccessFailure(new Error('Connection terminated'))).toBeNull()
  })
})

