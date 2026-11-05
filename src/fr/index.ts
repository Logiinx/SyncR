import { app } from './app'
import { games } from './games'

// All the French, one file per area. Only texts, so it can be read and reworded freely.
export const fr = { ...app, ...games }
