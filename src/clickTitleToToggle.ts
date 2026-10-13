import { Extension } from '@tiptap/react'
import { Plugin } from '@tiptap/pm/state'

// Clicking a section title opens/closes the section, like the ▶ arrow.
// Clicks while the cursor is already in that title only move the cursor, so it can be edited.
export const ClickTitleToToggle = Extension.create({
  name: 'clickTitleToToggle',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              if (event.button !== 0) return false
              const summary = (event.target as HTMLElement).closest('summary')
              // Layout: <div data-type="details"><button>▶</button><div><summary>…
              const toggle = summary?.parentElement?.parentElement?.querySelector(':scope > button')
              if (!summary || !(toggle instanceof HTMLButtonElement)) return false

              const { $from } = view.state.selection
              const cursorInThisTitle =
                $from.parent.type.name === 'detailsSummary' && $from.start() === view.posAtDOM(summary, 0)
              if (!cursorInThisTitle) toggle.click()
              return false // let the editor place the cursor as usual
            },
          },
        },
      }),
    ]
  },
})
