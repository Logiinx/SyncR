import { InputRule } from '@tiptap/react'
import { Typography } from '@tiptap/extension-typography'
import { loadEditing } from './editing'

// Replaces characters while typing: "--" → —, "..." → …, "->" → →, "1/2" → ½, "(c)" → ©,
// straight quotes → curly quotes. Not inside code. Backspace right after undoes it.
// Only when "Smart typography" is on in Settings. Each rule checks the setting when it
// fires (a handler returning null means "no match"), so switching takes effect right away.
export const SmartTypography = Typography.extend({
  addInputRules() {
    return (this.parent?.() ?? []).map(
      (rule) =>
        new InputRule({
          find: rule.find,
          undoable: rule.undoable,
          handler: (props) => (loadEditing().smartTypography ? rule.handler(props) : null),
        }),
    )
  },
})
