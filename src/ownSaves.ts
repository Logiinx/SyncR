// An editor's own saves come back to it from the database, sometimes late: a save can still be
// on its way when you type on and sync saves the newer text. Such a late echo isn't a change from
// the other device: showing it would bring back older text and put the cursor at the end.
// Each editor keeps the versions it saved, in order, until they come back.
export function ownSaves() {
  const saved: string[] = []
  return {
    // What's being saved
    add(content: unknown) {
      saved.push(JSON.stringify(content))
      if (saved.length > 20) saved.shift()
    },
    // True if this is one of our saves coming back (it and the older ones are then forgotten)
    isOwn(content: unknown) {
      const index = saved.indexOf(JSON.stringify(content))
      if (index === -1) return false
      saved.splice(0, index + 1)
      return true
    },
  }
}
