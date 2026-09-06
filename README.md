# Arrera Dock

Dock moderne et dynamique pour l'environnement de bureau **GNOME Shell**, conçu spécialement pour la distribution **Arrera Blue Linux**.

Il remplace le dash natif de l'aperçu par une pilule flottante au design soigné inspiré de **Material 3 Expressive** et d'**Android 16 QPR2**.

---

## Fonctionnalités

* **Disposition adaptative** : Positionnement au choix en bas (horizontal), à gauche ou à droite de l'écran (vertical).
* **Effet de vague dynamique** : Agrandissement fluide des icônes au survol du curseur.
* **Masquage automatique intelligent (Autohide)** : Rentre et sort avec une bande d'activation au bord de l'écran.
* **Harmonie des couleurs** : S'accorde automatiquement avec les 9 couleurs d'accentuation officielles de GNOME.
* **Modes de thème** :
  * *Expressif* : Surface de couleur teintée selon l'accentuation active.
  * *Contour noir* : Fond noir profond avec liseré contrasté de couleur d'accentuation.
* **Lanceur d'applications intégré** : Panneau flottant avec recherche en temps réel et catégories.
* **Gestion des favoris par clic droit** : Épingler ou détacher n'importe quelle application depuis le lanceur ou directement sur le dock.
* **Intégration GNOME Settings** : Configuration directe via `gnome-control-center` et le schéma GSettings `org.gnome.shell.extensions.dock`.

---

## Installation RPM (Fedora / Arrera Linux)

### Via le dépôt COPR officiel Arrera Blue

```bash
# Activer le dépôt COPR
sudo dnf copr enable arrera-software/arrera_blue

# Installer le paquet
sudo dnf install gnome-shell-extension-arrera-dock
```

### Activer l'extension

```bash
gnome-extensions enable dock@linux.arrera-software.fr
```

---

## Licence

Ce projet est distribué sous licence **GPL-2.0-or-later**.
