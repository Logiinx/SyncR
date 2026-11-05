import { app } from './app'
import { board } from './board'
import { games } from './games'
import { notes } from './notes'
import { settings } from './settings'

// All the French, one file per area. Only texts, so it can be read and reworded freely.
// The same words everywhere: note = note, card = carte, Board = Tableau, tab = onglet, Reminders = Rappels,
// Games = Jeux, email = e-mail, Settings = Paramètres, sync = synchronisation, sign in = se connecter,
// passphrase = phrase secrète, PIN = code PIN, tray = zone de notification, calendar = agenda, table (in a note) = tableau.
// Game lists: To buy = À acheter, To play = À jouer, Not started = Pas commencé, Playing = En cours.
export const fr = { ...app, ...board, ...games, ...notes, ...settings }
