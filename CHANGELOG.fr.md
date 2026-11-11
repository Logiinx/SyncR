# Journal des modifications

Tous les changements notables de SyncR. La version la plus récente d’abord.

## [Unreleased]

**Synchronisation**
- **Ajout** d’une brève teinte verte ou rouge sur les notes et cartes du Board ajoutées ou supprimées par l’autre appareil

**Notes**
- **Changement** de « + » suivi d’une espace en début de ligne : il reste tel quel au lieu de lancer une liste à puces

## [0.66.2] - 2026-11-10

**Notes**
- **Correction** d’un problème où le curseur pouvait sauter à la fin d’une note ou d’une carte pendant la frappe

## [0.66.1] - 2026-11-10

**Vidéo**
- **Changement** des commandes du lecteur (YouTube et Twitch) : elles s’effacent 1,5 s après l’arrêt de la souris, au lieu de 2,8 s

## [0.66.0] - 2026-11-10

**Synchronisation**
- **Amélioration** de la vitesse de synchro : environ 2× plus rapide au quotidien, 3 à 4× après de gros changements
- **Amélioration** de la sécurité : un fichier copié sur un autre dans Dropbox est maintenant refusé

**Vidéo**
- **Correction** de petits problèmes : les nuits de changement d’heure, aller à une heure dans le lecteur Twitch pouvait la manquer

## [0.65.2] - 2026-11-09

**Application**
- **Correction** d’un problème où, en français avec le verrouillage par PIN, tous les comptes semblaient déconnectés après le déverrouillage
- **Correction** de petits problèmes : l’avis « déjà reporté » et les libellés des sections restaient en anglais en français

**Vidéo**
- **Correction** d’un problème où des vidéos déjà vues pouvaient réapparaître comme Nouvelles à la prochaine ouverture de l’onglet
- **Correction** d’un problème où une extension pouvait disparaître quand sa mise à jour échouait
- **Correction** de petits problèmes : la vidéo suivante d’une playlist en plein écran pouvait afficher le mauvais site sur la barre

**Synchronisation**
- **Amélioration** de la synchronisation, qui ne ralentit plus une fois par jour pendant le nettoyage des anciennes versions des notes

**Mail**
- **Correction** d’un problème où les liens commençant par // dans un e-mail ne faisaient rien au clic

## [0.65.1] - 2026-11-09

**Vidéo**
- **Ajout** du retour de l’heure réelle dans le lecteur Twitch (son réglage, la barre et la case « Aller à un moment »)

## [0.65.0] - 2026-11-09

**Vidéo**
- **Changement** du lecteur vidéo : il a son propre bouton dans la barre des tâches, avec l’icône de YouTube ou Twitch

## [0.64.0] - 2026-11-09

**Vidéo**
- **Ajout** du suivi d’une chaîne Twitch selon les jeux joués dans ses streams, pas seulement les mots du titre
- **Changement** de la page de Twitch (quand une vidéo ne passe pas dans le lecteur de SyncR) : elle s’ouvre en mode cinéma
- **Suppression** de l’heure réelle dans le lecteur Twitch (son réglage, la barre et la case « Aller à un moment »)

## [0.63.2] - 2026-11-09

**Jeux**
- **Correction** du calendrier qui oubliait les jeux sortant de l’accès anticipé, comme Path of Exile 2

## [0.63.1] - 2026-11-09

**Synchronisation**
- **Correction** de la vibration du téléphone qui arrivait environ 2 secondes après le nuage vert

## [0.63.0] - 2026-11-08

**Jeux**
- **Changement** des jeux à 100 % dans Bibliothèque : la coche verte Terminé s’affiche dans leur anneau doré

## [0.62.0] - 2026-11-07

**Synchronisation**
- **Changement** de la vibration du téléphone : une seule, une fois la synchronisation vraiment terminée

## [0.61.0] - 2026-11-07

**Vidéo**
- **Changement** des icônes d’extensions de la barre de la fenêtre vidéo en un seul menu Extensions

## [0.60.0] - 2026-11-07

**Vidéo**
- **Ajout** des playlists YouTube : la vidéo suivante démarre seule, et l’ordre peut être inversé
- **Ajout** du passage automatique d’une vidéo dans les vues près de sa fin, avec un réglage pour le désactiver

**Synchronisation**
- **Ajout** d’une petite vibration sur le téléphone après chaque synchronisation réussie

## [0.59.0] - 2026-11-07

**Vidéo**
- **Amélioration** des nouvelles vidéos : vérifiées toutes les 15 minutes, moins souvent avec beaucoup de chaînes YouTube
- **Changement** de la barre de l’onglet Vidéo : une seule ligne, les actions occasionnelles dans les menus Ajouter et Plus
- **Changement** de l’accès aux vidéos vues : elles s’ouvrent depuis le menu Plus, sans le choix À regarder/Vues
- **Correction** d’un problème où des vidéos pouvaient manquer après une longue absence, ou attendre une heure après un échec


## [0.58.0] - 2026-11-07

**Vidéo**
- **Ajout** de dossiers et sous-dossiers dans les listes de l’onglet Vidéo, aussi dans chaque chaîne avec Par chaîne
- **Ajout** d’un moyen d’ajouter une seule vidéo par son lien, qui arrive dans À regarder
- **Ajout** d’une étiquette verte Nouvelle sur les vidéos trouvées depuis la dernière ouverture de l’onglet Vidéo
- **Ajout** d’une option Par chaîne dans l’onglet Vidéo, qui replie les vidéos de chaque chaîne sur une seule ligne
- **Ajout** d’un moyen de retirer des vidéos des vues, une par une ou toutes celles de la liste
- **Ajout** d’une fenêtre vidéo qui prend la forme de la vidéo, pour faire disparaître les bandes noires
- **Ajout** d’un choix de taille du chat dans les réglages du lecteur Twitch, avec plus d’espace entre les messages
- **Ajout** de la valeur du volume à côté de son curseur dans le lecteur Twitch
- **Amélioration** de l’ajout d’un suivi : écrivez nom pour Twitch ou @nom pour YouTube, les liens collés sont raccourcis
- **Amélioration** des commandes de YouTube dans le lecteur : elles disparaissent aussi vite que dans le lecteur Twitch
- **Correction** de petits problèmes : le ⓘ de la fenêtre de suivi ne s’ouvre plus qu’au-dessus de l’icône

**Mail**
- **Changement** de Garder non lu sur un pop-up : le mail compte comme manqué dans l’onglet Mail jusqu’à sa lecture
- **Correction** de petits problèmes : le dernier compte coché dans l’onglet Mail ne paraît plus décoché

## [0.57.0] - 2026-11-06

**Vidéo**
- **Ajout** d’une qualité de départ pour YouTube : 1440p, ou la plus haute en dessous, à changer dans Paramètres
- **Ajout** de sous-titres mémorisés pour chaque chaîne YouTube, dans une langue choisie dans Paramètres

## [0.56.0] - 2026-11-06

**Vidéo**
- **Ajout** de vos extensions dans la fenêtre vidéo, comme uBlock Origin : réglées dans Paramètres, popups sur sa barre

## [0.55.0] - 2026-11-06

**Vidéo**
- **Ajout** de la reprise là où vous vous êtes arrêté, dans chaque lecteur, avec une ligne de progression sur les vidéos commencées
- **Amélioration** du lecteur Twitch : la qualité choisie est retenue pour toutes les vidéos

## [0.54.0] - 2026-11-06

**Vidéo**
- **Ajout** d'aperçus, des parties sans son avec Passer et des changements de jeu sur la barre du lecteur Twitch
- **Ajout** de l'heure réelle dans le lecteur Twitch, et d'une case pour aller à un moment en cliquant sur le temps
- **Correction** des derniers boutons du lecteur Twitch poussés hors d'une fenêtre étroite à grande échelle

## [0.53.0] - 2026-11-06

**Vidéo**
- **Ajout** du replay du chat à côté du lecteur Twitch, avec emotes BTTV, FFZ et 7TV, et par-dessus en plein écran
- **Ajout** d’options dans le lecteur Twitch pour masquer les bots et les !commandes et afficher l’heure des messages

## [0.52.0] - 2026-11-06

**Vidéo**
- **Ajout** de notre propre lecteur Twitch dans la fenêtre du lecteur, avec Twitch en secours
- **Correction** des vidéos qui ne démarraient pas seules dans la fenêtre du lecteur

## [0.51.1] - 2026-11-06

**Application**
- **Amélioration** de la sécurité : chaque fenêtre de SyncR n’accède plus qu’aux fonctions dont elle a besoin

## [0.51.0] - 2026-11-06

**Vidéo**
- **Ajout** d'autres moyens d'ouvrir une vidéo YouTube quand le lecteur ne peut pas la lire
- **Ajout** d'un bouton Essayer un autre moyen à la barre du lecteur pour les vidéos YouTube

## [0.50.0] - 2026-11-06

**Vidéo**
- **Ajout** d’une barre sur le lecteur : titre, Toujours au premier plan, Vue et Ouvrir dans le navigateur
- **Ajout** d’un réglage pour fermer le lecteur quand vous marquez une vidéo comme vue

## [0.49.0] - 2026-11-06

**Vidéo**
- **Ajout** d’une fenêtre de lecture vidéo qui garde sa place, et d’un bouton pour ouvrir dans le navigateur

## [0.48.0] - 2026-11-06

**Vidéo**
- **Ajout** d’un onglet Vidéo : un fil des nouvelles vidéos des chaînes YouTube et Twitch suivies

## [0.47.0] - 2026-11-06

**Rappels**
- **Ajout** de la grille du mois sur le téléphone : un bouton à côté de la liste, qui reste la vue d’ouverture

**Application**
- **Amélioration** du texte sous Windows : il s’aligne sur les icônes voisines et se centre dans sa case

## [0.46.1] - 2026-11-05

**Application**
- **Amélioration** des Paramètres : listes, curseurs et boutons ont la même largeur et sont alignés
- **Amélioration** du champ Sites des Paramètres : toutes ses lignes s’affichent, le curseur va jusqu’au bout

## [0.46.0] - 2026-11-05

**Mail**
- **Ajout** d’une case par compte dans l’onglet Mail pour voir les 50 derniers e-mails d’un compte ou des deux

**Rappels**
- **Ajout** d’un clic ou clic droit sur un jour de la grille du mois pour y ajouter un événement

**Application**
- **Suppression** des lignes rouges du correcteur orthographique dans toutes les zones de texte
- **Correction** d’un problème où l’écran choisi pour le pop-up pouvait apparaître débranché alors qu’il était branché

## [0.45.1] - 2026-11-05

**Application**
- **Correction** de petits problèmes : noms plus clairs pour le choix système sous Police et Langue

## [0.45.0] - 2026-11-05

**Application**
- **Ajout** du français dans toute l’application : à choisir dans Paramètres → Application → Langue (suit le système par défaut)

## [0.44.0] - 2026-11-05

**Board**
- **Ajout** d’une option pour changer la couleur du texte d’une carte par le clic droit, pendant l’édition
- **Amélioration** du bouton de couleur du texte sur PC, masqué tant que la souris n’approche pas du coin
- **Amélioration** du bouton de couleur du texte, qui reste visible en faisant défiler une longue carte
- **Amélioration** des menus : « Couleur de la carte… » et « Couleur du groupe… », couleurs réunies, listes titrées
- **Correction** d’un problème où, après avoir coloré du texte dans une carte, la couleur restait bloquée

**Application**
- **Amélioration** des menus : les éléments indisponibles sont grisés au lieu de disparaître
- **Correction** d’un problème où les menus ouverts près du bord de la fenêtre pouvaient sortir de l’écran

**Notes**
- **Amélioration** du bouton de couleur du texte avec une nouvelle icône, la même dans les notes et le Board
- **Correction** de petits problèmes : couleur choisie sans sélection sur téléphone ; icônes de tableau et de copie de lien

## [0.43.0] - 2026-11-05

**Rappels**
- **Amélioration** de Reporter et Terminé : les utiliser sur un appareil compte aussi sur l’autre
- **Changement** du nom du bouton Snooze en Reporter, car il déplace vraiment l’événement
- **Correction** d’un problème où reporter sur les deux appareils déplaçait l’événement deux fois ou sonnait trop tôt

**Notes**
- **Ajout** d’un bouton sur téléphone pour aller à la fin d’une note, visible pendant le défilement
- **Amélioration** de l’Historique : barre du haut plus fine et plus claire, bouton plus près du bord droit

## [0.42.0] - 2026-11-03

**Mail**
- **Ajout** du nombre d’e-mails manqués sur l’icône de l’onglet Mail, épinglé ou non

## [0.41.1] - 2026-11-03

**Rappels**
- **Correction** d’un problème où les événements sur la journée avec l’alerte par défaut de Google n’alertaient pas
- **Correction** de petits problèmes : l’alerte de sortie d’un jeu dit « 2 jours avant à 10:00 », et non « 38 heures avant »

## [0.41.0] - 2026-11-03

**Application**
- **Ajout** d’un verrouillage par code PIN sur PC (Paramètres → Application) ; la phrase secrète ouvre un code oublié
- **Correction** de petits problèmes : le champ de la phrase secrète affichait deux boutons « œil » sur PC

**Mail**
- **Amélioration** de la confidentialité sur PC : cartes de mail chiffrées, e-mails retirés du cache

## [0.40.0] - 2026-11-03

**Application**
- **Ajout** du stockage chiffré sur PC pour les notes, cartes, jeux et rappels (Windows garde la clé)

## [0.39.0] - 2026-11-03

**Notes**
- **Ajout** de l’historique : comparer ou restaurer les anciennes versions d’une note, gardées 30 jours (barre d’outils, à droite)

## [0.38.9] - 2026-11-02

**Mail**
- **Amélioration** de la sécurité des fichiers : seuls documents, images, médias, zip et invitations courants s’ouvrent d’un clic
- **Amélioration** des fichiers d’e-mail ouverts ou enregistrés, qui ont les avertissements Windows « provenant d’Internet »
- **Correction** d’un problème où les e-mails pouvaient ouvrir des pages web, rester vides ou charger des images sans demander
- **Correction** de petits problèmes : les liens sur les images et dessins des e-mails s’ouvrent dans le navigateur

**Notes**
- **Amélioration** des cartes de lien Reddit : titre du post, subreddit, auteur, votes, commentaires et image
- **Correction** d’un problème sur téléphone où le curseur sortait de la vue dans le champ Sites des Paramètres

## [0.38.8] - 2026-11-01

**Notes**
- **Correction** des clics à côté d’une carte de lien, qui y placent le curseur ; Retour arrière retire la carte d’un coup

## [0.38.7] - 2026-11-01

**Notes**
- **Correction** d’un problème où ouvrir la liste des notes à la fin d’une note la faisait remonter un peu

## [0.38.6] - 2026-11-01

**Notes**
- **Correction** de petits problèmes : comparer une copie de conflit montre les icônes de cases et de sections comme la note

**Jeux**
- **Correction** de petits problèmes : le nom complet de la bande-annonce s’affiche au survol

**Mail**
- **Correction** de petits problèmes : un ⓘ près du titre Gmail des Paramètres explique les cases des comptes

**Synchronisation**
- **Correction** de petits problèmes : erreurs sans point final ; une connexion Dropbox échouée n’explique la cause qu’une fois

## [0.38.5] - 2026-11-01

**Mail**
- **Amélioration** de l’onglet Mail : un compte déconnecté reste listé comme « Déconnecté » jusqu’à la reconnexion
- **Correction** de petits problèmes : erreurs en rouge, « Réessayer » seulement si utile, compte sur « N nouveaux e-mails »

**Application**
- **Correction** de petits problèmes : quatre paramètres s’expliquent dans une bulle (ⓘ), pas seulement au survol

## [0.38.4] - 2026-11-01

**Jeux**
- **Ajout** du clic droit habituel sur les jeux de votre liste, dans la recherche et le calendrier
- **Amélioration** de la grille du calendrier : les jeux de votre liste montrent l’icône de leur liste au lieu d’une teinte bleue
- **Correction** de petits problèmes : icônes sur « Ajouter à À venir » et « Google Agenda », aperçus sans jaquette, conseils de À jouer

## [0.38.3] - 2026-11-01

**Notes**
- **Amélioration** des groupes de liens repliés, qui s’ouvrent et se ferment en douceur comme les sections
- **Correction** de petits problèmes : icônes étoile/j’aime des cartes de lien, ‹ Retour dans Comparer, aperçus complets au survol

## [0.38.2] - 2026-11-01

**Notes**
- **Correction** d’un problème où fermer un groupe de liens replié demandait plusieurs clics avec le curseur dedans
- **Correction** d’un problème où les cartes de lien n’apparaissaient qu’après un redémarrage une fois le proxy configuré ou synchronisé
- **Correction** de petits problèmes : un champ Sites vide se réinitialise ; les cartes de lien s’ouvrent une fois et ne déplacent pas les cartes du Board

## [0.38.1] - 2026-11-01

**Notes**
- **Ajout** des groupes de liens : plusieurs cartes de lien à la suite, côte à côte, en pastilles ou repliées sur une ligne

## [0.38.0] - 2026-11-01

**Notes**
- **Ajout** des cartes de lien avec titre et image (3 styles), et une carte plus grande au survol

## [0.37.4] - 2026-10-31

**Jeux**
- **Amélioration** des jaquettes, qui apparaissent en fondu ; changer d’onglet et déplacer des jeux est plus fluide
- **Amélioration** du chargement : des zones grisées pendant le chargement des prix et du Calendrier, au lieu du vide

**Mail**
- **Amélioration** de la liste Mail, qui montre des lignes grisées pendant le chargement après le démarrage

**Application**
- **Correction** de petits problèmes : plus de flou en déplaçant une carte du Board

## [0.37.3] - 2026-10-31

**Application**
- **Amélioration** des fenêtres et du pop-up de mail, qui s’ouvrent avec un texte net : plus de flou ni de décalage à la fin

**Jeux**
- **Ajout** d’un ⓘ sur « Suivre mon compte Steam » qui explique quels jeux il déplace

## [0.37.2] - 2026-10-31

**Jeux**
- **Amélioration** des cartes En cours avec des jaquettes un peu plus grandes

**Application**
- **Amélioration** de la taille de l’application PC : téléchargements et mises à jour environ 30 % plus légers

## [0.37.1] - 2026-10-31

**Jeux**
- **Amélioration** de À jouer : Pas commencé a de plus petites jaquettes, les cartes En cours passent d’abord
- **Changement** des succès à 100 % dans Bibliothèque : un anneau doré autour de la jaquette au lieu d’un trophée
- **Correction** d’un problème où les jeux de la Bibliothèque ne pouvaient pas quitter la pause par le clic droit

## [0.37.0] - 2026-10-31

**Jeux**
- **Ajout** de « Mauvaise clé » sur une alerte de prix de clé (ex. une clé Xbox) : surveille encore, ignore ce prix
- **Amélioration** des onglets, en pleine largeur avec icônes ; À venir (ex-Prochainement), Pas commencé (ex-À suivre)
- **Amélioration** des heures et succès des jeux En cours, mis à jour toutes les 10 minutes (avant, une fois par jour)
- **Amélioration** des titres En cours et Pas commencé dans À jouer, plus grands et plus faciles à repérer
- **Amélioration** des barres de succès, qui passent du bleu au vert en se remplissant

**Mail**
- **Amélioration** de l’onglet Mail, qui s’ouvre aussitôt : sa liste se charge en arrière-plan pendant que SyncR tourne

## [0.36.0] - 2026-10-30

**Jeux**
- **Ajout** des onglets Prochainement · À acheter · À jouer · Bibliothèque ; À jouer montre En cours au-dessus de À suivre (possédés)
- **Ajout** de cartes pour les jeux en cours, avec heures de jeu et succès Steam
- **Ajout** de « Commencer à jouer » dans le menu d’un jeu ; Jeux s’ouvre sur À acheter ; vos anciens À jouer sont dans À acheter
- **Ajout** des marques Terminé, En pause et Abandonné pour la Bibliothèque ; SyncR demande quand vous arrêtez de jouer
- **Ajout** d’une ligne en haut de Jeux quand un jeu s’est déplacé tout seul, par ex. le jour de sa sortie
- **Ajout** d’une marque Précommandé pour les jeux Prochainement : pas d’alerte de prix, passe dans À jouer à sa sortie
- **Ajout** de Paramètres → Suivre mon compte Steam : les jeux achetés ou commencés sur Steam se déplacent tout seuls
- **Amélioration** de À acheter, qui liste d’abord les jeux en promo sur Steam, plus grosse remise en tête (après Prioritaire)
- **Amélioration** des lignes « Repoussé » et « Date fixée », avec la jaquette et le nom du jeu ; un clic ouvre le jeu

## [0.35.2] - 2026-10-30

**Mail**
- **Amélioration** des erreurs de Mail, en langage simple ; un e-mail qui ne s’ouvre pas propose Réessayer
- **Correction** de petits problèmes : adresse complète du compte au survol, ligne « Images web bloquées » plus nette

## [0.35.1] - 2026-10-29

**Mail**
- **Correction** d’un problème où ouvrir Mail juste après le démarrage affichait un instant « Impossible de joindre Gmail »

## [0.35.0] - 2026-10-29

**Mail**
- **Ajout** d’un bouton corbeille rouge pour supprimer un e-mail, sur les cartes du pop-up et pendant la lecture
- **Changement** du lecteur d’e-mails : un ✕ le ferme, à la place de « Ouvrir dans Gmail »

## [0.34.0] - 2026-10-29

**Mail**
- **Ajout** des pièces jointes sous chaque e-mail : un clic pour ouvrir, ⬇ pour enregistrer
- **Ajout** des images en taille réelle dans les e-mails : un clic pour voir, la molette zoome et dézoome

**Notes**
- **Amélioration** des images en taille réelle : la molette zoome autour de la souris, glisser pour déplacer

## [0.33.0] - 2026-10-29

**Application**
- **Ajout** des onglets épinglés (clic droit sur un onglet) : toujours en tête de rangée, compacts, sans ✕

**Mail**
- **Ajout** de « Toujours pour amazon.com » : les images web d’un expéditeur s’affichent seules (liste dans Gérer les comptes)
- **Ajout** d’un blocage des images de suivi cachées, même images affichées (« 2 traqueurs bloqués »)
- **Correction** d’un problème où les images intégrées aux e-mails (logos, images collées) manquaient

**Board**
- **Correction** d’un problème où le texte d’une carte se décalait au double-clic pour l’éditer

## [0.32.1] - 2026-10-29

**Application**
- **Amélioration** des Paramètres : la ligne de version de SyncR se place discrètement sous toutes les cartes

## [0.32.0] - 2026-10-29

**Notes**
- **Ajout** d’une option pour copier une image dans une note : clic droit (appui long sur téléphone)
- **Changement** de la barre d’outils du téléphone : Image y revient ; Barré passe dans la liste « ⋯ »

**Rappels**
- **Ajout** de cinq nouveaux sons doux pour les rappels et e-mails : Goutte, Verre, Bois, Montée et Bulle

**Mail**
- **Amélioration** des e-mails du pop-up, qui s’ouvrent aussitôt et s’agrandissent pour les plus larges (sans défilement horizontal)
- **Correction** d’un problème avec les e-mails blancs : ils montrent leur version sombre, ou sombre avec leurs couleurs

**Application**
- **Amélioration** des animations, plus calmes et plus douces ; les panneaux glissent, les fenêtres se posent en place

**Board**
- **Amélioration** des couleurs de texte des cartes : un petit bouton sur le texte sélectionné, plus de rangée qui surgit

## [0.31.3] - 2026-10-28

**Mail**
- **Correction** d’un problème où l’onglet Mail ne réessayait pas si Gmail était injoignable au démarrage

## [0.31.2] - 2026-10-28

**Application**
- **Correction** d’un problème où la liste des notes et le Board glissaient une seconde après le démarrage

## [0.31.1] - 2026-10-28

**Notes**
- **Correction** d’un problème où la liste des notes affichait « Demain » comme dernière modification

**Board**
- **Correction** d’un problème où « Déplacer vers un groupe… » choisissait le mauvais groupe si deux portaient le même nom

**Jeux**
- **Correction** d’un problème où, après avoir retiré un jeu, le suivant ouvert sautait à son alerte de prix

**Mail**
- **Correction** d’un problème où le mail instantané s’arrêtait après une reconnexion, ou à cause d’un mauvais compte
- **Correction** de petits problèmes : marques de lecture, mails archivés, changements de compte, rechargements horaires

**Synchronisation**
- **Correction** d’un problème sur PC : si Windows ne peut pas garder la clé de synchronisation, un message le dit (sans redemander à chaque démarrage)

## [0.31.0] - 2026-10-28

**Rappels**
- **Ajout** du clic droit habituel d’un jeu dans Rappels (déplacer, priorité, prix, épingler…)
- **Ajout** des couleurs Google Agenda des événements : un point dans la liste, une bande dans le mois

**Board**
- **Amélioration** des groupes prioritaires, qui ont seulement un cadre bleu, comme les cartes (plus d’icône bleue)

**Jeux**
- **Amélioration** du sélecteur de statut de la fenêtre d’un jeu, qui glisse vers le statut choisi
- **Amélioration** de l’aperçu d’un jeu : date de sortie et plateformes sur une ligne

**Mail**
- **Changement** de la place de « Ouvrir dans Gmail » dans le clic droit : plus bas, juste au-dessus de Supprimer

**Application**
- **Amélioration** des textes coupés, affichés en entier au survol (sujets de mail, noms Steam, Gmail)
- **Amélioration** de plusieurs endroits avec de vraies icônes au lieu de symboles ; boutons « ‹ Retour » identiques

## [0.30.1] - 2026-10-28

**Mail**
- **Amélioration** des e-mails ouverts dans le pop-up sur PC : agrandissement fluide, avec une fine bordure
- **Changement** du bouton de retour d’un e-mail ouvert, qui dit maintenant « ‹ Retour »

## [0.30.0] - 2026-10-28

**Application**
- **Amélioration** des Paramètres, qui tiennent sur une vue : quatre cartes, détails des comptes sous « Gérer les comptes… »

## [0.29.0] - 2026-10-28

**Mail**
- **Ajout** d’un onglet Mail sur PC : vos 50 derniers e-mails, les lus atténués, avec un filtre « Non lus seulement »
- **Ajout** d’un clic droit plus clair sur les e-mails, avec icônes, expéditeur, sujet et Supprimer (Corbeille de Gmail)
- **Ajout** des e-mails sombres sur PC, comme une note ; « Afficher l’original » rend le design de l’expéditeur sur blanc

**Application**
- **Amélioration** des clics droits et de la liste « ⋯ » du téléphone : une icône devant chaque action, plus de place par ligne

## [0.28.1] - 2026-10-28

**Application**
- **Correction** d’un problème sur PC où le pop-up restait ouvert et vide après la fermeture de sa dernière carte
- **Correction** d’un problème sur PC où les panneaux latéraux glissaient tout seuls au démarrage de SyncR
- **Correction** d’un problème où les Paramètres remontaient tout en haut pendant le défilement

## [0.28.0] - 2026-10-28

**Mail**
- **Ajout** du mail instantané sur PC : les nouveaux e-mails surgissent en quelques secondes, une fois réglé dans Paramètres → Gmail

## [0.27.0] - 2026-10-28

**Mail**
- **Ajout** d’une couleur par compte Gmail sur PC : cliquez sur son point dans Paramètres → Gmail

**Application**
- **Amélioration** de la sécurité sur PC : connexions et clé de synchronisation chiffrées pour votre utilisateur Windows

## [0.26.0] - 2026-10-28

**Mail**
- **Ajout** de pop-ups pour les nouveaux e-mails Gmail sur PC (onglet Principale), avec Marquer comme lu et Garder non lu
- **Ajout** de la lecture dans le pop-up : un clic l’agrandit ; les images web restent bloquées jusqu’à « Afficher les images »
- **Ajout** d’un fondu pour les pop-ups d’e-mail, après 10 s, 30 s ou 1 min (Paramètres → Gmail) ; ils restent non lus
- **Ajout** d’un onglet Mail sur PC : les mails non lus de Principale de tous les comptes, les manqués en tête
- **Ajout** d’un choix d’écran et de coin pour les pop-ups, par ex. sur un second écran, loin d’un jeu

**Rappels**
- **Ajout** d’un choix de son de rappel dans les Paramètres : Carillon, Doux, Ping, Double ping ou Aucun

## [0.25.1] - 2026-10-28

**Application**
- **Amélioration** des onglets, notes et rappels, qui apparaissent et disparaissent en douceur comme les cartes du Board

## [0.25.0] - 2026-10-28

**Application**
- **Ajout** d’un interrupteur « Animations » dans Paramètres → Apparence (activé par défaut) pour couper glissements et fondus
- **Amélioration** de la ligne bleue sous l’onglet ouvert et sur les sélecteurs, qui glisse vers votre choix
- **Amélioration** de toute l’application : fenêtres en fondu, menus qui se déplient, panneaux qui glissent, sections et cartes qui grandissent

## [0.24.3] - 2026-10-28

**Jeux**
- **Amélioration** des vérifications d’alertes de prix : toutes les 15 min à 1 h, et au réveil du PC ou au retour dans l’application
- **Correction** des prix de clés et alertes de prix le plus bas pour les éditions vendues en lots Steam (comme Cyberpunk Ultimate)

## [0.24.2] - 2026-10-24

**Jeux**
- **Ajout** d’un prix suggéré à l’activation d’une alerte de prix, ou d’une mention si c’est déjà un bon prix

## [0.24.1] - 2026-10-24

**Jeux**
- **Amélioration** des alertes de prix dans la fenêtre d’un jeu : liste compacte, une cloche par ligne (jeu, puis éditions)
- **Amélioration** des notes et avis vides dans la fenêtre d’un jeu : repliés en une petite étiquette, un clic pour écrire

## [0.24.0] - 2026-10-24

**Jeux**
- **Ajout** d’alertes de prix pour les autres éditions Steam d’un jeu (Deluxe, Ultimate…), chacune avec son prix
- **Amélioration** du clic droit dans les groupes : déplacements, puis priorité · Surveiller le prix… · Épingler au Board, puis Retirer
- **Suppression** de « Sous le plus bas jamais vu » des alertes de prix (« Au plus bas jamais vu » le couvre déjà)

## [0.23.1] - 2026-10-24

**Board**
- **Correction** d’un problème où la ligne vide au-dessus d’une liste ne s’effaçait pas avec Retour arrière ou Suppr (notes aussi)

## [0.23.0] - 2026-10-23

**Jeux**
- **Ajout** d’un avertissement dans la fenêtre d’un jeu quand les prix sont ceux d’un autre produit (ex. un pack d’un DLC)
- **Ajout** de « Ajouter ▾ » dans la recherche, pour choisir où va un jeu sorti ; « Ajouter » seul l’ajoute toujours à À jouer
- **Amélioration** des heures et succès Steam dans la fenêtre d’un jeu : deux blocs, une barre de progression, doré à 100 %
- **Amélioration** des évaluations : « Votre évaluation » et une pastille Terminé dans la fenêtre ; « ★ 4,5 » et une marque sur tuiles et lignes
- **Amélioration** de « Voir la bande-annonce », affiché aussitôt (« Pas de bande-annonce » en gris sinon) : les boutons ne sautent plus
- **Amélioration** de la cloche de surveillance du prix : un badge sur la jaquette, vert et qui sonne une fois le prix atteint
- **Changement** du cœur de la Bibliothèque en Favori (remplace Prioritaire ici) ; les favoris passent d’abord
- **Changement** de la place de Importer depuis Steam : près du sélecteur jaquettes/liste, et un lien si votre liste est vide

## [0.22.0] - 2026-10-23

**Jeux**
- **Changement** des alertes de prix : un seul objectif pour les deux prix, atteint par Steam ou la clé la moins chère
- **Suppression** de l’onglet Surveillés : clic droit sur un jeu À jouer ou En attente → Surveiller le prix… ; cloche, et en tête de liste

## [0.21.1] - 2026-10-23

**Jeux**
- **Correction** du message quand Steam ne répond pas (pas « détails du jeu privés ») ; nouvel essai après une heure
- **Correction** d’un problème où les mises à jour Steam pouvaient écraser une modification faite sur votre autre appareil

## [0.21.0] - 2026-10-23

**Jeux**
- **Ajout** d’un lien de profil Steam (Paramètres → Jeux) : succès et heures dans les fenêtres, trophée doré à 100 %
- **Ajout** de « Importer depuis Steam… » dans Bibliothèque : vos jeux Steam pas encore dans SyncR, les plus joués d’abord

## [0.20.0] - 2026-10-23

**Jeux**
- **Ajout** des onglets Surveillés · En attente · À jouer · En cours · Bibliothèque ; les jeux finis passent en Bibliothèque comme Terminé
- **Ajout** d’alertes de prix pour les jeux Surveillés : Steam ou clé, à mon prix ou au plus bas, via Google Agenda
- **Ajout** des prix sur les jeux Surveillés, et d’un lien vers GG.deals dans leur fenêtre pour y régler une alerte

## [0.19.7] - 2026-10-23

**Notes**
- **Correction** d’un problème où taper « > » sur une ligne alignée sous « > » la transformait en citation

## [0.19.6] - 2026-10-22

**Notes**
- **Correction** d’un problème où le menu « / » s’ouvrait quand « / » suivait un mot coloré ou en gras

## [0.19.5] - 2026-10-22

**Notes**
- **Correction** de Tab sous « > » : il aligne seulement avec le curseur en début de ligne ou juste après son premier « > »
- **Correction** d’un problème où Tab faisait sortir de la note quand il n’avait rien à faire

## [0.19.4] - 2026-10-22

**Notes**
- **Ajout** de Tab pour aligner le texte sous le « > » suivant de la ligne du dessus (Maj+Tab revient), avec un bouton

## [0.19.3] - 2026-10-22

**Notes**
- **Changement** de « > », qui ne crée une citation qu’au tout début d’une ligne (pratique pour aligner du texte)
- **Changement** d’Entrée dans une section, qui ajoute toujours une ligne au lieu d’en sortir (↓ ou un clic pour sortir)

## [0.19.2] - 2026-10-22

**Notes**
- **Ajout** de listes à partir de lignes collées commençant par « - », « * » ou « • », aussi sur les cartes ; Ctrl+Maj+V les garde telles quelles

## [0.19.1] - 2026-10-22

**Application**
- **Amélioration** de Nouveautés : changements groupés par domaine, et la barre de défilement du PC montre s’il y en a d’autres

## [0.19.0] - 2026-10-22

**Jeux**
- **Ajout** de « mars 2027 » ou « À annoncer » dans la grille pour les jeux sans jour de sortie exact
- **Amélioration** de la grille À jouer : les prix sont en bas de chaque tuile et s’alignent sur la rangée
- **Amélioration** des prix : le plus cher entre Steam et clé est gris ; le logo Steam devient jaune s’il est le moins cher
- **Amélioration** des dates de sortie, identiques partout : « 29 oct. 2026 · dans 39 jours »
- **Amélioration** des plateformes dans la fenêtre et l’aperçu d’un jeu : toutes listées, PC et Android d’abord
- **Amélioration** des lignes du calendrier avec un bouton « Ajouter » comme la recherche ; un jeu de votre liste ouvre sa fenêtre
- **Changement** de Prioritaire en un fin cadre partout, aussi sur les cartes du Board ; un jeu et sa carte le partagent
- **Changement** de l’heure d’alerte dans la fenêtre d’un jeu, écrite comme dans Rappels (« Demain, 10:00 »)

**Notes**
- **Changement** des dates en « 14 oct. 2026 » (avant « 14-10-2026 »), comme dans Jeux ; copies de conflit aussi, avec l’heure

**Application**
- **Amélioration** des noms et lignes coupés, affichés en entier au survol (Jeux, Rappels, liste des notes, liens de notes)
- **Amélioration** des menus : les actions rouges (Supprimer, Retirer, Déconnecter) sont toujours en dernier, sous un filet
- **Amélioration** des fenêtres qui ne font qu’afficher, qui se ferment maintenant avec un ✕ en haut à droite
- **Amélioration** des messages d’erreur et éléments de menu rouges, tous du même rouge

## [0.18.6] - 2026-10-21

**Jeux**
- **Ajout** d’une ligne verte « Date fixée » quand la date d’un jeu En attente se précise ; les retards de date vague s’affichent aussi

## [0.18.5] - 2026-10-21

**Jeux**
- **Changement** de « Le plus bas » en simplement « Gratuit » quand un jeu a déjà été offert (avant « gratuit en boutique »)

## [0.18.4] - 2026-10-21

**Jeux**
- **Ajout** des prix pour les éditions en lot Steam, et pour les jeux qu’IGDB relie à une ancienne page Steam
- **Changement** de « Le plus bas » en « gratuit » au lieu de 0,00 € (ex. après une offre)

## [0.18.3] - 2026-10-21

**Jeux**
- **Ajout** d’une étoile jaune quand Steam ne coûte pas plus que la clé la moins chère, d’une flamme orange au prix le plus bas

## [0.18.2] - 2026-10-21

**Jeux**
- **Ajout** des prix dans la fenêtre d’un jeu, comme la liste À jouer (logo Steam, icône de clé, badge de remise vert)
- **Amélioration** de « Voir la bande-annonce », aligné à gauche comme les autres boutons de la fenêtre

## [0.18.1] - 2026-10-21

**Jeux**
- **Amélioration** des prix des jeux À jouer : logo Steam et icône de clé sur leur ligne, remise dans un badge vert

## [0.18.0] - 2026-10-21

**Jeux**
- **Ajout** des prix dans la fenêtre d’un jeu et sur les jeux À jouer : Steam, clé la moins chère pour la France, prix le plus bas

## [0.17.1] - 2026-10-21

**Notes**
- **Changement** des titres de section : Entrée ouvre et entre ; sur PC un clic replie, le clic droit modifie le titre
- **Correction** d’un problème au-dessus de 100 % d’échelle où les menus « / » et « [[ » sortaient de la fenêtre et la note sautait

## [0.17.0] - 2026-10-21

**Rappels**
- **Amélioration** des cartes d’alerte : grand Terminé, Snooze ouvre ses choix, Tout terminer, couleur de l’événement ; un clic montre l’événement
- **Changement** des événements passés, qui s’estompent dans le mois et quittent la liste une fois commencés
- **Changement** de Snooze, qui déplace maintenant l’événement dans Google Agenda (cette date seulement ; sur la journée : l’alerte seulement)

## [0.16.6] - 2026-10-21

**Board**
- **Ajout** de « Nouvelle carte » dans le clic droit d’un groupe : ajoute une carte en bas, déplie le groupe, prend sa couleur
- **Changement** des nouvelles cartes (+), qui commencent par le titre ; Entrée, Tab ou ↓ vont au texte ; Échap annule la carte
- **Suppression** de Aligner le titre et Retirer le titre du menu de carte, et de Modifier sur PC ; tous les titres sont centrés
- **Correction** d’un problème où le menu d’une carte demandait un second clic pendant l’écriture dans la carte

## [0.16.5] - 2026-10-21

**Rappels**
- **Suppression** des anciens rappels de SyncR : l’onglet et les alertes utilisent seulement Google Agenda ; ancien dossier Dropbox retiré

## [0.16.4] - 2026-10-21

**Application**
- **Amélioration** des Paramètres sur fenêtre étroite : espacement réduit, tout tient sans défilement (PC)

## [0.16.3] - 2026-10-21

**Jeux**
- **Ajout** d’un aperçu au clic sur un résultat de recherche (détails, bande-annonce), ou de sa fenêtre s’il est dans votre liste

**Application**
- **Amélioration** des Paramètres sur fenêtre basse : une troisième colonne ou plus, tout tient sans défilement (PC)

## [0.16.2] - 2026-10-21

**Rappels**
- **Amélioration** des calendriers : les éléments des jours passés sont un peu estompés (nets au survol)

**Application**
- **Amélioration** de l’onglet de note ouvert avec un soulignement bleu plus fin, comme les onglets de statut de Jeux
- **Amélioration** de la barre de mise à jour : plus fine, progression du téléchargement et « Nouveautés » ; plus de fenêtre d’installation (PC)

## [0.16.1] - 2026-10-21

**Synchronisation**
- **Amélioration** de la vitesse et de la fiabilité : pas de seconde synchronisation inutile, plusieurs fichiers à la fois, reprise si bloquée

## [0.16.0] - 2026-10-21

**Rappels**
- **Ajout** des alertes Google Agenda dans SyncR, avec Terminé et Snooze sur cet appareil ; les manquées restent un jour
- **Ajout** d’un bouton d’actualisation, et de « Masquer les récurrents » pour la liste et la grille (elles alertent toujours)
- **Changement** de la liste des Rappels : dates écrites en toutes lettres, groupées par mois ; une petite icône sur les répétitions

**Jeux**
- **Ajout** d’un événement Google Agenda violet sur la journée de sortie des jeux en attente, avec alerte 2 jours avant
- **Ajout** du développeur, de l’éditeur, des modes de jeu et de « Voir la bande-annonce » dans les fenêtres de jeu
- **Amélioration** des fenêtres de jeu et jaquettes (plus grandes), des boutons et onglets de statut (plus clairs)
- **Amélioration** de Mes jeux sur grand écran : jaquettes plus grandes, puis plus de jeux par rangée
- **Changement** des rappels de sortie en ces événements Google Agenda ; les anciens rappels cachés sont retirés

**Application**
- **Amélioration** de « Nouveautés », plus facile à lire (texte blanc au lieu de gris)
- **Amélioration** du chargement : le même anneau bleu tournant partout

## [0.15.0] - 2026-10-20

**Rappels**
- **Ajout** de « Nouvel événement », qui ajoute un événement Google Agenda : titre, date, heure, alerte et répétition
- **Ajout** d’une vue complète d’un événement, avec Modifier et Supprimer ; clic droit ou appui long pour plus
- **Ajout** de « Tous les événements de la série » pour les répétitions ; sinon les changements valent pour cette date seule

## [0.14.0] - 2026-10-20

**Rappels**
- **Ajout** de Paramètres → Google Agenda, pour connecter votre agenda principal (le PC se connecte par le navigateur)
- **Ajout** des événements Google Agenda dans la grille et la liste pour les 12 prochains mois, aussi hors ligne

## [0.13.4] - 2026-10-20

**Application**
- **Ajout** d’une petite fenêtre après une mise à jour, montrant les nouveautés depuis votre dernière version (PC et téléphone)
- **Ajout** des notes des 5 dernières versions : cliquez sur le numéro de version dans Paramètres → À propos

## [0.13.3] - 2026-10-19

**Application**
- **Changement** des nouveaux PC : la barre latérale des notes et le Board démarrent ouverts ; sur téléphone ils restent fermés

## [0.13.2] - 2026-10-19

**Board**
- **Ajout** de « Couleur… » (groupe seul) et « Couleur avec ses cartes… » (avec ses cartes) dans le menu d’un groupe
- **Amélioration** de l’icône de pile d’un groupe, qui prend la couleur du groupe

## [0.13.1] - 2026-10-19

**Board**
- **Ajout** de couleurs de fond pour les cartes, cartes de jeu et groupes : « Couleur… » dans leur menu, 8 couleurs ou « Par défaut »
- **Changement** des cartes et groupes prioritaires : une barre sur le bord gauche, la priorité se voit aussi sur une carte colorée

## [0.13.0] - 2026-10-19

**Board**
- **Ajout** des groupes de cartes : « Déplacer vers un groupe… », les replier, y glisser des cartes ; mettez à jour PC et téléphone
- **Amélioration** des menus de carte et de groupe, triés par groupes d’actions séparés par de fins filets
- **Changement** des titres de carte : un clic replie ou déplie la carte ; « Modifier le titre » dans son menu la renomme
- **Suppression** des boutons ✕ et ✨ sur les cartes : Supprimer (ou Détacher) et la priorité sont dans le menu de la carte

## [0.12.19] - 2026-10-19

**Notes**
- **Changement** de la barre d’outils : elle reçoit les boutons de l’ancien menu de sélection, par groupes, grisés si indisponibles
- **Changement** de la barre d’outils sur téléphone : annuler, style de texte et liste à cocher restent ; le reste est dans une liste « ⋯ »
- **Suppression** du menu qui surgissait sur le texte sélectionné (il cachait le texte)

## [0.12.18] - 2026-10-19

**Notes**
- **Ajout** d’un bouton « Séparer les lignes » qui change les sauts de ligne en vraies lignes ; Ctrl+Z annule
- **Changement** de Maj+Entrée, qui crée une nouvelle ligne comme Entrée (dans les listes : un saut de ligne) ; aussi sur les cartes du Board
- **Changement** des sauts de ligne collés (depuis Notesnook, beaucoup de pages web), qui deviennent des lignes séparées
- **Correction** d’un problème où une liste tapée après un saut de ligne pouvait envoyer un lien sur la mauvaise ligne

## [0.12.17] - 2026-10-18

**Synchronisation**
- **Correction** d’un problème où une modification tapée pile pendant une synchronisation pouvait être perdue
- **Correction** d’un problème où supprimer une note pouvait supprimer une modification que l’autre appareil venait d’enregistrer
- **Correction** d’un problème où un conflit pouvait créer deux fois la même copie de conflit
- **Correction** d’un problème où un fichier illisible dans Dropbox bloquait toute la synchronisation ; il est désormais ignoré et signalé
- **Correction** d’un problème où une erreur passagère de Dropbox vous déconnectait

## [0.12.16] - 2026-10-18

**Notes**
- **Ajout** de la recherche dans toutes les notes depuis la barre latérale (Ctrl+Maj+F sur PC) ; casse et accents ignorés
- **Ajout** d’un saut vers le résultat à l’ouverture : il pulse en bleu, les sections repliées s’ouvrent
- **Correction** d’un problème sur téléphone où une nouvelle couleur de texte restait cachée jusqu’à la désélection (cartes aussi)

## [0.12.15] - 2026-10-18

**Board**
- **Changement** de l’appui long sur le texte d’une carte sur téléphone : il ouvre le menu d’Android ; le menu de la carte a un bouton « ⋯ »

## [0.12.14] - 2026-10-18

**Board**
- **Ajout** d’un bouton « Nouvelle carte » sur téléphone, en bas du panneau, à portée de pouce
- **Ajout** du texte coloré dans les cartes : sélectionnez du texte en écrivant et choisissez une couleur (comme les notes)

**Application**
- **Ajout** des balayages sur téléphone : vers la droite depuis le tiers gauche pour ouvrir la barre latérale, vers la gauche pour la fermer

## [0.12.13] - 2026-10-17

**Jeux**
- **Changement** de Mes jeux en un statut à la fois : onglets avec compteurs, grandes jaquettes ; un sélecteur revient à la liste

## [0.12.12] - 2026-10-17

**Jeux**
- **Amélioration** des résultats de recherche : les plus populaires d’abord, les noms exacts en tête
- **Correction** d’un problème où la recherche ne trouvait rien tant qu’un mot était à moitié tapé

## [0.12.11] - 2026-10-17

**Notes**
- **Correction** d’un problème où ouvrir la barre latérale ou le Board à la fin d’une note faisait sortir la fin de la vue

## [0.12.10] - 2026-10-17

**Jeux**
- **Correction** d’un problème où les boutons « Mes jeux » et « Calendrier » sautaient de côté ; ils sont maintenant centrés

## [0.12.9] - 2026-10-17

**Jeux**
- **Correction** de la fenêtre du Calendrier, de nouveau petite (jaquette à côté du nom et de la date de sortie)

## [0.12.8] - 2026-10-17

**Notes**
- **Correction** d’un problème où cliquer sur un lien dans une note ou une carte du Board l’ouvrait deux fois dans le navigateur

## [0.12.7] - 2026-10-17

**Application**
- **Changement** de la date du jour dans les calendriers : blanche sur un petit carré bleu arrondi, au lieu d’un texte bleu
- **Changement** de la ligne bleue de l’onglet ouvert : une courte barre arrondie d’un bleu discret, seulement sous le titre
- **Correction** d’un problème où une longue erreur agrandissait Paramètres → Jeux sur téléphone ; touchez-la pour la lire en entier
- **Correction** d’un problème où « En attente de connexion… » clignotait un instant dans Paramètres → Jeux

## [0.12.6] - 2026-10-17

**Application**
- **Amélioration** de la réouverture des Paramètres : « Connecté » s’affiche aussitôt, une vérification tourne discrètement
- **Correction** d’un problème où Paramètres → Jeux grandissait un peu à l’apparition de « Connecté »

## [0.12.5] - 2026-10-17

**Application**
- **Ajout** de « by Logiinx » près de la version dans Paramètres → À propos
- **Amélioration** des onglets : une vraie icône ✕, une fine ligne bleue sur l’onglet ouvert, espacement régulier, ✕ au survol
- **Amélioration** des symboles, dessinés en icônes : ☰, le ✕ de la visionneuse, ✓ des messages de synchronisation, ♥ des jeux aimés
- **Amélioration** des petits boutons à icône, qui s’éclairent tous de la même façon sous la souris
- **Changement** de « Rechercher des mises à jour » : des Paramètres vers une petite icône en bas de la barre latérale
- **Changement** de la suppression d’une règle de couleur, qui utilise l’icône corbeille, comme pour un groupe
- **Correction** de la barre d’outils sur téléphone, trop large d’1 px et qui défilait

**Notes**
- **Amélioration** des éléments de liste et titres de section (notes et cartes), dont le texte commence sur une même colonne
- **Amélioration** des flèches de section, au niveau des lettres du titre ; pareil pour ✦ et ✕ sur les cartes du Board

**Jeux**
- **Amélioration** des évaluations de jeux : étoiles en icônes, avec une vraie demi-étoile dans la liste
- **Amélioration** du ✕ de la fenêtre d’un jeu, centré sur le nom du jeu

## [0.12.4] - 2026-10-17

**Board**
- **Ajout** des titres de carte : « Ajouter un titre » dans le menu d’une carte ; gras et centré, la petite flèche replie le texte
- **Amélioration** du balayage qui ouvre le Board sur téléphone : il peut partir de n’importe où dans le tiers droit
- **Suppression** du petit point bleu sur les cartes prioritaires ; la teinte bleue et ✦ les signalent toujours

**Notes**
- **Changement** de la flèche des sections et blocs de code, le même petit chevron que les titres de carte

## [0.12.3] - 2026-10-17

**Notes**
- **Amélioration** de « - », « 1. » et « [ ] » juste après un saut de ligne Maj+Entrée, qui commencent une liste (cartes aussi)

**Board**
- **Correction** d’un problème où la nouvelle ligne vide après une liste disparaissait une demi-seconde plus tard

## [0.12.2] - 2026-10-17

**Board**
- **Ajout** des balayages sur téléphone : vers la gauche depuis le bord droit pour ouvrir le Board, vers la droite pour le fermer
- **Correction** d’un problème où une liste en fin de carte laissait une ligne vide dessous

## [0.12.1] - 2026-10-17

**Jeux**
- **Ajout** d’une nouvelle fenêtre de détails : grande jaquette, actions dessous, barre de statut, étoiles, avis et note
- **Changement** de « Marqué » en « Prioritaire » partout, avec une icône d’étincelle (jeux et cartes du Board)

**Application**
- **Amélioration** des Paramètres : plus larges, sur deux colonnes, tout s’affiche sans défilement (téléphone : une colonne)
- **Suppression** du bouton Terminé des Paramètres : fermez avec Échap ou un clic à l’extérieur
- **Correction** d’un problème où les Paramètres s’ouvraient défilés tout en bas

## [0.12.0] - 2026-10-17

**Board**
- **Ajout** des jeux épinglés : « Épingler au Board » crée une carte avec la jaquette et le nom ; un clic ouvre le jeu

**Jeux**
- **Correction** d’un problème où le bandeau de retard s’affichait quand une sortie bougeait de quelques heures le même jour

**Application**
- **Changement** du bouton Paramètres de la barre latérale : même hauteur et place d’icône que Jeux et Rappels

## [0.11.1] - 2026-10-16

**Jeux**
- **Amélioration** des réglages du proxy de recherche de jeux : synchronisés sur tous les appareils et vérifiés tout seuls
- **Suppression** du bouton Tester : les Paramètres affichent « Connecté » en vert, ou ce qui ne va pas

**Synchronisation**
- **Correction** d’un problème où un rappel, une carte ou un jeu supprimé revenait après un changement sur un autre appareil

## [0.11.0] - 2026-10-16

**Jeux**
- **Ajout** d’un onglet Jeux : recherche IGDB, jeux ajoutés à votre liste, groupés par statut, avec comptes à rebours
- **Ajout** des détails d’un jeu : plateformes, statut, marque, note, étoiles, cœur et avis ; un clic droit rapide
- **Ajout** d’une vue Calendrier : jeux PC populaires à venir sur 6 mois, en grille ou en liste ; Top 100 à 1000
- **Ajout** de mises à jour quotidiennes depuis IGDB, d’un passage à À jouer le jour de sortie et d’un bandeau de retard
- **Ajout** d’un rappel à 10:00 deux jours avant la sortie d’un jeu En attente ; il suit les retards
- **Correction** de l’adresse du proxy, qui marche sans « https:// » ; une mauvaise adresse donne un message clair

**Rappels**
- **Ajout** d’un onglet Rappels avec une grille du mois (PC) et une liste ; la liste de la barre latérale disparaît

## [0.10.7] - 2026-10-16

**Jeux**
- **Ajout** de l’adresse et du mot de passe de votre proxy de recherche de jeux dans Paramètres → Jeux, avec un bouton Tester

## [0.10.6] - 2026-10-16

**Application**
- **Correction** d’un problème sur téléphone où taper en bas d’une note poussait la barre d’outils hors de l’écran

## [0.10.5] - 2026-10-16

**Application**
- **Changement** des barres de défilement sur PC : fines, invisibles jusqu’au défilement, en fondu une seconde après l’arrêt
- **Changement** de la languette du Board sur PC : masquée jusqu’à ce que la souris s’en approche

## [0.10.4] - 2026-10-16

**Application**
- **Changement** du fond de la liste des notes et du Board : même sombre que la note, séparés par un fin filet

## [0.10.3] - 2026-10-16

**Notes**
- **Correction** d’un problème sur téléphone où maintenir un titre de section sur ses mots les sélectionnait au lieu de déplacer

## [0.10.2] - 2026-10-16

**Notes**
- **Correction** d’un problème sur téléphone où maintenir un titre de section tout juste touché sélectionnait ses mots
- **Correction** d’un problème où déplacer du texte sélectionné avec une partie d’un titre de section cassait la section

## [0.10.1] - 2026-10-16

**Notes**
- **Correction** d’un problème sur téléphone où sections et cartes du Board ne se déplaçaient pas vraiment
- **Correction** d’un problème sur PC où le curseur sautait dans le titre d’une section après son déplacement

## [0.10.0] - 2026-10-16

**Board**
- **Ajout** du Board : un panneau latéral de petites cartes, avec priorité, glisser pour déplacer, épingler depuis une note ; synchronisé

**Notes**
- **Ajout** de Comparer pour les copies de conflit : différences avec l’original ; garder l’original ou la copie
- **Changement** du déplacement des sections : appuyez sur un titre et faites-le glisser, sans la poignée ⋮⋮
- **Correction** d’une icône de section qui ressemblait à une autre : retirer une section a sa propre icône

## [0.9.5] - 2026-10-16

**Application**
- **Correction** de la version PC, pour que les changements de la 0.9.4 y arrivent (la 0.9.4 n’est jamais sortie sur PC)

## [0.9.4] - 2026-10-16

**Application**
- **Ajout** de « Démarrer masqué dans la zone de notification » dans Paramètres → Fenêtre ; sinon SyncR ouvre sa fenêtre à la connexion
- **Amélioration** du point de synchronisation sur téléphone : plus gros, avec des couleurs plus vives

**Notes**
- **Suppression** de l’espace au-dessus et au-dessous des listes à puces et numérotées

## [0.9.3] - 2026-10-15

**Rappels**
- **Correction** d’un problème où le pop-up de rappel sur PC était vide

## [0.9.2] - 2026-10-15

**Rappels**
- **Ajout** d’un pop-up de rappel sur PC, au-dessus des autres fenêtres, avec Terminé, Snooze et Ouvrir SyncR
- **Ajout** d’un court carillon à l’échéance d’un rappel, avec un interrupteur dans Paramètres → Rappels

**Application**
- **Ajout** d’une icône dans la zone de notification sur PC : un clic ouvre SyncR ; clic droit pour « Ouvrir SyncR » et « Quitter SyncR »
- **Ajout** de « ✕ masque SyncR dans la zone de notification » et « Démarrer avec Windows » dans Paramètres → Fenêtre (PC)
- **Amélioration** du lancement de SyncR déjà ouvert, qui affiche maintenant celui en cours

## [0.9.1] - 2026-10-15

**Rappels**
- **Ajout** des rappels dans la liste des notes : texte, date et heure, note ; synchronisés et chiffrés ; Google Agenda en option
- **Ajout** d’une carte à l’échéance d’un rappel, avec Terminé ou Snooze ; les manqués s’affichent à l’ouverture de SyncR

## [0.9.0] - 2026-10-15

**Notes**
- **Ajout** de « Typographie intelligente » dans les Paramètres (désactivée par défaut) : --, ->, ..., 1/2, (c) et guillemets courbes
- **Ajout** des blocs de code avec coloration syntaxique, une flèche de repli et un menu de langue
- **Ajout** du déplacement des sections avec une poignée ⋮⋮ et une ligne bleue ; Ctrl+Z les remet en place
- **Ajout** d’un menu « / » pour insérer sections, blocs de code, listes, tableaux, titres, citations et séparateurs
- **Ajout** de liens vers un endroit précis d’une note, affichés « Titre de la note › début du texte »
- **Ajout** de « [[ » pour créer un lien vers une note, ou l’un de ses titres et sections
- **Changement** de la création d’une note : un « + » après les onglets, toujours visible ; « Nouvelle note » sur une page vide

## [0.8.2] - 2026-10-15

**Application**
- **Amélioration** du temps de compilation de la version PC, d’environ 6 minutes à environ 3
- **Changement** du nom du programme en SyncR.exe (avant syncr.exe)

## [0.8.1] - 2026-10-15

**Notes**
- **Amélioration** des listes, dont les puces s’alignent sur le texte
- **Amélioration** du menu de sélection : boutons gras, italique et souligné, même allure que la barre d’outils
- **Changement** d’Entrée sur le premier élément vide d’une liste, qui ajoute un second élément
- **Changement** de « 1. » ou « - » suivi d’Entrée, qui crée la liste et passe à l’élément suivant
- **Changement** du bouton de couleur en palette, pour ne plus le confondre avec le souligné
- **Correction** d’un problème où ouvrir la liste des notes en bas d’une longue note faisait sortir la fin de la vue

**Application**
- **Amélioration** des Paramètres, groupés en sections, chacune disant si elle vaut pour cet appareil ou tous
- **Amélioration** des curseurs de taille du texte et d’échelle de l’application, avec une poignée fine et une règle

## [0.8.0] - 2026-10-15

**Notes**
- **Ajout** des couleurs de texte et d’un surligneur (8 couleurs chacun), depuis le menu de sélection ou la barre d’outils
- **Ajout** des tableaux : bouton de la barre d’outils ; clic droit sur une cellule pour lignes, colonnes, en-tête, couleur ; Tab ; glisser pour redimensionner
- **Ajout** des règles de couleur (Paramètres) : des mots comme « Feu » ont une couleur dans toutes les notes ; groupes désactivables ; synchronisées
- **Changement** du menu de sélection, qui apparaît sous la sélection pour ne pas cacher le texte
- **Changement** du texte sélectionné, qui garde sa couleur (il devenait blanc)

## [0.7.0] - 2026-10-15

**Notes**
- **Ajout** d’une option dans les Paramètres pour masquer les dates dans la liste des notes
- **Amélioration** de la liste des notes : dernière modification, titre en gras, début du texte, barre bleue sur la note ouverte
- **Changement** des liens : soulignés seulement au survol (téléphone : toujours) ; le survol montre l’adresse dans une petite bulle

**Synchronisation**
- **Changement** du bouton de synchronisation : un simple nuage avec un point de statut coloré ; le survol montre la dernière synchronisation
- **Changement** du message après une synchronisation : plus court, sous le bouton, en fondu après 3 secondes

**Application**
- **Ajout** du déplacement des onglets pour changer leur ordre (téléphone : maintenir, puis glisser)

## [0.6.7] - 2026-10-14

**Synchronisation**
- **Amélioration** de la synchronisation, qui se rétablit toute seule quand Dropbox termine une session trop tôt
- **Amélioration** du nettoyage : les traces de suppression dans Dropbox sont retirées après 90 jours
- **Correction** d’un problème où une modification faite à l’arrivée d’une version plus récente pouvait être remplacée ; c’est désormais une copie de conflit

**Application**
- **Ajout** de « Rechercher des mises à jour » en bas de la liste des notes (PC et téléphone)
- **Correction** d’un problème où une mise à jour échouée ne disait pas pourquoi ; elle propose maintenant « Réessayer »
- **Correction** d’un problème où les clics droits s’ouvraient loin de la souris quand l’échelle de l’application n’était pas à 100 %
- **Correction** d’un problème sur PC où la fenêtre s’affichait d’abord au centre, puis sautait à sa place

## [0.6.6] - 2026-10-14

**Application**
- **Correction** d’un problème sur PC où la fenêtre ne rouvrait pas avec sa taille et sa position

## [0.6.5] - 2026-10-14

**Application**
- **Ajout** de la mémorisation de la taille et de la position de la fenêtre sur PC, aussi sur un second écran
- **Ajout** dans les Paramètres : police des notes, taille du texte (12–24 px) et échelle de l’application (80–150 %), par appareil

**Notes**
- **Suppression** des lignes rouges d’orthographe sous les mots

## [0.6.0] - 2026-10-14

**Notes**
- **Ajout** de boutons dans la barre d’outils : Annuler, Rétablir, Gras, Italique, Souligné et Barré
- **Ajout** des listes à cocher : un bouton ou « [ ] » ; les éléments cochés sont atténués ; Tab met en retrait
- **Ajout** des liens : collez une adresse, ou collez-la sur du texte sélectionné ; un clic ouvre le navigateur

## [0.5.2] - 2026-10-14

**Application**
- **Correction** d’un problème sur téléphone où une mise à jour juste après une autre pouvait laisser un écran noir

## [0.5.1] - 2026-10-14

**Notes**
- **Ajout** de « Supprimer l’image » : clic droit sur une image (appui long sur téléphone)

**Synchronisation**
- **Amélioration** du moment de synchronisation : elle démarre 1 seconde après la fin de la frappe (avant 1,5 seconde)

## [0.5.0] - 2026-10-14

**Notes**
- **Ajout** des images dans les notes : collez, glissez un fichier ou utilisez le nouveau bouton image de la barre d’outils
- **Ajout** de la réduction des grandes images pour gagner de la place ; les captures d’écran restent nettes
- **Ajout** des images en plein écran : un clic ; un autre pour la taille réelle
- **Ajout** de la synchronisation des images, chiffrées comme les notes ; « Chargement de l’image… » s’affiche jusqu’à son arrivée
- **Ajout** de la suppression automatique des images retirées après une semaine

**Application**
- **Changement** des couleurs : fond et gris plus sombres, pour un rendu plus calme et plus contrasté

## [0.4.0] - 2026-10-14

**Synchronisation**
- **Ajout** de la synchronisation entre vos appareils via votre propre Dropbox, avec un bouton nuage dans la barre de titre
- **Ajout** d’une phrase secrète qui chiffre vos notes avant leur envoi à Dropbox
- **Ajout** de la synchronisation automatique : à l’ouverture, après la frappe, en quittant une note, et quand un autre appareil change
- **Ajout** du statut de synchronisation sur le bouton nuage ; un clic synchronise, clic droit pour « Déconnecter Dropbox »
- **Ajout** des copies de conflit, pour ne rien perdre quand une note change sur les deux appareils
- **Ajout** d’une dernière synchronisation avant de fermer ou d’installer une mise à jour (5 secondes au plus)

**Application**
- **Ajout** de la version téléphone : installez-la depuis le site ; elle marche hors ligne et propose les nouvelles versions
- **Correction** du flash blanc au démarrage : la fenêtre est sombre dès le premier instant

## [0.3.2] - 2026-10-13

**Application**
- **Changement** du fond de l’icône : plus sombre, pour un meilleur contraste dans la barre des tâches

## [0.3.1] - 2026-10-13

**Application**
- **Correction** des boutons de fenêtre : même épaisseur de trait, et le carré d’agrandissement n’est plus coupé

## [0.3.0] - 2026-10-13

**Application**
- **Ajout** d’une barre de titre personnalisée sur PC, fondue avec les onglets : glisser pour déplacer, double-clic pour agrandir
- **Changement** de l’icône en une page de note entre deux flèches, blanche sur fond sombre
- **Changement** de la place du bandeau de mise à jour : sous la barre

## [0.2.0] - 2026-10-13

**Notes**
- **Ajout** des notes, enregistrées automatiquement sur votre appareil
- **Ajout** d’une barre latérale masquée (☰) avec la liste des notes, dernières modifiées d’abord, et un bouton « Nouvelle note »
- **Ajout** des onglets : ouvrir plusieurs notes, changer, fermer avec × ou un clic milieu, créer avec « + »
- **Ajout** de la restauration des onglets et positions de défilement après un redémarrage
- **Ajout** des sections repliables, imbricables ; « Retirer la section » l’enlève et garde son texte
- **Ajout** du renommage d’une note (clic droit, ou double-clic sur un onglet) et de sa suppression (clic droit, puis confirmer)
- **Changement** du texte des notes : commence à gauche, utilise toute la largeur, sans espace en plus après Entrée

## [0.1.1] - 2026-10-13

**Application**
- **Ajout** du numéro de version dans l’application

## [0.1.0] - 2026-10-13

**Application**
- **Ajout** de la première version Windows : installateur et mises à jour automatiques depuis GitHub Releases
