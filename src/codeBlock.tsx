import { useState } from 'react'
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type Editor,
  type ReactNodeViewProps,
} from '@tiptap/react'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { Selection } from '@tiptap/pm/state'
import { createLowlight } from 'lowlight'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import plaintext from 'highlight.js/lib/languages/plaintext'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

// The languages you can pick in a code block's header. Only these grammars are bundled
// (all of highlight.js would add ~1 MB). The language is saved in the note (attrs.language).
const LANGUAGES = {
  bash: { name: 'Bash', grammar: bash },
  c: { name: 'C', grammar: c },
  cpp: { name: 'C++', grammar: cpp },
  csharp: { name: 'C#', grammar: csharp },
  css: { name: 'CSS', grammar: css },
  go: { name: 'Go', grammar: go },
  xml: { name: 'HTML / XML', grammar: xml },
  java: { name: 'Java', grammar: java },
  javascript: { name: 'JavaScript', grammar: javascript },
  json: { name: 'JSON', grammar: json },
  markdown: { name: 'Markdown', grammar: markdown },
  powershell: { name: 'PowerShell', grammar: powershell },
  python: { name: 'Python', grammar: python },
  rust: { name: 'Rust', grammar: rust },
  sql: { name: 'SQL', grammar: sql },
  typescript: { name: 'TypeScript', grammar: typescript },
  yaml: { name: 'YAML', grammar: yaml },
}

const lowlight = createLowlight()
for (const [id, { grammar }] of Object.entries(LANGUAGES)) lowlight.register(id, grammar)
lowlight.register('plaintext', plaintext)
// No language (or an unknown one, e.g. typed as ```foo): the extension would guess with
// highlightAuto, which often colors plain text wrongly. Show it uncolored instead.
const lowlightNoGuess = { ...lowlight, highlightAuto: (value: string) => lowlight.highlight('plaintext', value) }

// Code block with syntax highlighting (lowlight adds <span class="hljs-…"> as decorations)
// and a header like a section title: ▶ to fold it, and the language.
// Typing ``` and a space (or ```js) still makes one; Enter three times at the end leaves it.
export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },
}).configure({ lowlight: lowlightNoGuess, enableTabIndentation: true, tabSize: 2 })

function CodeBlockView({ node, editor, getPos, updateAttributes }: ReactNodeViewProps) {
  // Folded or not isn't saved (like sections); code blocks start open
  const [open, setOpen] = useState(true)
  const language: string = node.attrs.language ?? ''
  const lines = node.textContent.split('\n').length

  function toggle() {
    // Folding with the cursor inside would leave it typing into hidden text: move it out
    const pos = getPos()
    const { from } = editor.state.selection
    if (open && pos !== undefined && from > pos && from < pos + node.nodeSize) {
      editor.commands.command(({ tr }) => {
        tr.setSelection(Selection.near(tr.doc.resolve(pos + node.nodeSize)))
        return true
      })
    }
    setOpen(!open)
  }

  return (
    <NodeViewWrapper className={open ? 'code-block is-open' : 'code-block'}>
      <div className="code-header" contentEditable={false}>
        <button
          className="code-toggle"
          onClick={toggle}
          aria-label={open ? 'Fold code block' : 'Unfold code block'}
          title={open ? 'Fold' : 'Unfold'}
        >
          ▶
        </button>
        <select
          className="code-language"
          value={language in LANGUAGES ? language : ''}
          onChange={(e) => updateAttributes({ language: e.target.value || null })}
          title="Language"
        >
          <option value="">Plain text</option>
          {Object.entries(LANGUAGES).map(([id, { name }]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        {!open && (
          <span className="code-lines">
            {lines} {lines === 1 ? 'line' : 'lines'}
          </span>
        )}
      </div>
      <pre hidden={!open}>
        <NodeViewContent<'code'> as="code" />
      </pre>
    </NodeViewWrapper>
  )
}

// For the selection menu: the selected lines become one code block (setCodeBlock would make
// one block per paragraph). Inside a list item it takes the whole list, since a list item
// must start with a paragraph.
export function selectionToCodeBlock(editor: Editor) {
  return editor
    .chain()
    .focus()
    .command(({ state, tr }) => {
      const type = state.schema.nodes.codeBlock
      const { $from, $to } = state.selection
      const range = $from.blockRange($to, (parent) => parent.type.contentMatch.matchType(type) !== null)
      if (!range) return false
      const text = state.doc.textBetween(range.start, range.end, '\n')
      tr.replaceRangeWith(range.start, range.end, type.create(null, text ? state.schema.text(text) : null))
      return true
    })
    .run()
}

// The other way: each line of the code block around the cursor becomes a paragraph
export function codeBlockToParagraphs(editor: Editor) {
  return editor
    .chain()
    .focus()
    .command(({ state, tr }) => {
      const { $from } = state.selection
      if ($from.parent.type.name !== 'codeBlock') return false
      const { paragraph } = state.schema.nodes
      const lines = $from.parent.textContent.split('\n')
      const paragraphs = lines.map((line) => paragraph.create(null, line ? state.schema.text(line) : null))
      tr.replaceWith($from.before(), $from.after(), paragraphs)
      return true
    })
    .run()
}
