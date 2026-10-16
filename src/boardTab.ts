// The Board's small edge tab (‹ / ›) is hidden with a mouse, and fades in when the mouse comes
// near it (any height), or is over the open Board. Phones: always visible (no hover).
// CSS: .board-toggle / .board-toggle.near

const NEAR = 40 // px left or right of the tab

let x = -1 // last mouse position (-1: outside the window)
let y = -1

function update() {
  const over = x < 0 ? null : document.elementFromPoint(x, y)
  for (const tab of document.querySelectorAll<HTMLElement>('.board-toggle')) {
    const rect = tab.getBoundingClientRect()
    const near = x >= 0 && ((x >= rect.left - NEAR && x <= rect.right + NEAR) || !!over?.closest('.board'))
    tab.classList.toggle('near', near)
  }
}

export function setUpBoardTab() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return
  document.addEventListener('mousemove', (e) => {
    x = e.clientX
    y = e.clientY
    update()
  })
  // Mouse left the window
  document.addEventListener('mouseout', (e) => {
    if (e.relatedTarget) return
    x = y = -1
    update()
  })
  // Opening/closing the Board puts a new tab elsewhere: check it once it's drawn
  document.addEventListener('click', () => window.setTimeout(update))
}
