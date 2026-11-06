import { app } from './app'
import { board } from './board'
import { games } from './games'
import { mail } from './mail'
import { notes } from './notes'
import { reminders } from './reminders'
import { settings } from './settings'
import { sync } from './sync'
import { video } from './video'

// All the French, one file per area. Only texts, so it can be read and reworded freely.
// The same words everywhere: note = note, card = carte, Board stays Board, tab = onglet, Reminders = Rappels,
// Games = Jeux, email = e-mail, Settings = Paramètres, sync = synchronisation, sign in = se connecter,
// passphrase = phrase secrète, PIN = code PIN, tray = zone de notification, calendar = agenda, Google Calendar = Google Agenda, table (in a note) = tableau.
// Game lists: To buy = À acheter, To play = À jouer, Not started = Pas commencé, Playing = En cours.
export const fr = { ...app, ...board, ...games, ...mail, ...notes, ...reminders, ...settings, ...sync, ...video }
