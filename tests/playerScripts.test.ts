import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// The Twitch player's scripts (src-tauri/player/player.html) are plain scripts in one page: they
// share one set of top-level names. A name declared in two of them stops the whole second script
// (1.1.3: player.js's `asking` stopped chat.js, so no chat and a blank chat button).
const DIR = 'src-tauri/player/'

function topNames(file: string) {
  const source = ts.createSourceFile(file, readFileSync(DIR + file, 'utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
  const names: string[] = []
  const bind = (name: ts.BindingName) => {
    if (ts.isIdentifier(name)) names.push(name.text)
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bind(element.name)
  }
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      // var can be declared again without an error, but it would still be one shared value
      for (const declaration of statement.declarationList.declarations) bind(declaration.name)
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      names.push(statement.name.text)
    }
  }
  return names
}

describe('Twitch player scripts', () => {
  it('never declare the same top-level name twice', () => {
    const page = readFileSync(DIR + 'player.html', 'utf8')
    const scripts = [...page.matchAll(/<script src="\/([^"]+)"/g)].map((match) => match[1])
    expect(scripts).toContain('chat.js')
    const owner = new Map<string, string>()
    const clashes: string[] = []
    for (const script of scripts) {
      for (const name of new Set(topNames(script))) {
        const first = owner.get(name)
        if (first) clashes.push(`${name}: ${first} and ${script}`)
        else owner.set(name, script)
      }
    }
    expect(clashes).toEqual([])
  })
})
