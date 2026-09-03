// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { applyTextPatch } from '../src/output/diff.js'
import { createDomSink } from '../src/output/dom-sink.js'

describe('applyTextPatch', () => {
  it('replaces a unique find string', () => {
    const r = applyTextPatch('hello big world', 'big', 'small')
    expect(r.ok).toBe(true)
    expect(r.content).toBe('hello small world')
  })

  it('fails when find is missing', () => {
    const r = applyTextPatch('hello', 'nope', 'x')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('not-found')
  })

  it('fails closed on ambiguity', () => {
    const r = applyTextPatch('aaa aaa', 'aaa', 'b')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('ambiguous')
  })

  it('matches a multi-line LF find against a CRLF file', () => {
    const file = '<div\r\n  className="bg-white"\r\n>\r\n'
    const find = '<div\n  className="bg-white"\n>'
    const r = applyTextPatch(file, find, '<div\n  className="bg-green"\n>')
    expect(r.ok).toBe(true)
    // The replacement adopts the file's CRLF style — no mixed endings.
    expect(r.content).toBe('<div\r\n  className="bg-green"\r\n>\r\n')
  })

  it('still applies a byte-exact multi-line find', () => {
    const file = 'a\r\nb\r\nc'
    const r = applyTextPatch(file, 'a\r\nb', 'x')
    expect(r.ok).toBe(true)
    expect(r.content).toBe('x\r\nc')
  })

  it('reports ambiguity across line-ending-tolerant matches', () => {
    const file = 'x\ny\nx\ny\n'
    const r = applyTextPatch(file, 'x\ny', 'z')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('ambiguous')
  })

  it('single-line finds do not get newline tolerance (still not-found)', () => {
    const r = applyTextPatch('hello\r\nworld', 'nope', 'x')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('not-found')
  })
})

describe('dom sink', () => {
  it('applies setText/setStyle/remove ops', async () => {
    document.body.innerHTML = '<h1 id="t">old</h1><p id="p">x</p>'
    const sink = createDomSink()
    const applied = await sink.apply({
      kind: 'dom',
      description: '',
      ops: [
        { op: 'setText', selector: '#t', text: 'new' },
        { op: 'setStyle', selector: '#t', styles: { color: 'red' } },
        { op: 'remove', selector: '#p' },
      ],
    })
    expect(applied).toBe('applied')
    expect(document.getElementById('t')?.textContent).toBe('new')
    expect(document.getElementById('p')).toBeNull()
  })

  it('reports failure when a selector misses', async () => {
    document.body.innerHTML = '<h1 id="t">old</h1>'
    const sink = createDomSink()
    const r = await sink.apply({
      kind: 'dom',
      description: '',
      ops: [{ op: 'setText', selector: '#missing', text: 'x' }],
    })
    expect(r).toBe('failed')
  })
})
