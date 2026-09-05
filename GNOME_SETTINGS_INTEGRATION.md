# Guide d'intégration GNOME Settings pour Arrera Dock

Ce document décrit en détail les clés **GSettings** du dock, leurs types, leurs valeurs possibles et comment les intégrer proprement dans l'application **Paramètres de GNOME** (`gnome-control-center`) sous forme de widgets **GTK4 / Libadwaita**.

---

## 1. Informations générales du schéma GSettings

* **ID du schéma** : `org.gnome.shell.extensions.dock`
* **Chemin (path)** : `/org/gnome/shell/extensions/dock/`
* **Fichier source XML** : `schemas/org.gnome.shell.extensions.dock.gschema.xml`
* **Installation système** : `/usr/share/glib-2.0/schemas/` ou `~/.local/share/glib-2.0/schemas/`

---

## 2. Référence complète des paramètres

### 1. Masquage automatique du dock (`autohide`)
* **Clé** : `autohide`
* **Type** : `b` (Booléen / `gboolean`)
* **Valeur par défaut** : `false`
* **Valeurs possibles** :
  * `false` : Le dock est fixé de façon permanente en bas de l'écran et réserve son espace (`affectsStruts = true`). Les fenêtres maximisées s'arrêtent au-dessus du dock.
  * `true` : Le dock se masque automatiquement dès que la souris quitte la zone ou lorsqu'une fenêtre est active. Il glisse vers le bas et laisse les fenêtres occuper tout l'écran. Il réapparaît immédiatement dès que le pointeur touche le bord inférieur de l'écran.
* **Widget Libadwaita recommandé** : `AdwSwitchRow`

---

### 2. Effet de vague / Agrandissement au survol (`enable-wave-effect`)
* **Clé** : `enable-wave-effect`
* **Type** : `b` (Booléen / `gboolean`)
* **Valeur par défaut** : `true`
* **Valeurs possibles** :
  * `true` : Les icônes s'agrandissent de manière fluide avec un effet de vague (style macOS / dock dynamique) au passage de la souris.
  * `false` : Les icônes restent à leur taille fixe. Seul le calque d'interaction (state layer) au survol s'affiche.
* **Widget Libadwaita recommandé** : `AdwSwitchRow`

---

### 3. Touche Super pour le lanceur d'applications (`super-key-opens-launcher`)
* **Clé** : `super-key-opens-launcher`
* **Type** : `b` (Booléen / `gboolean`)
* **Valeur par défaut** : `true`
* **Valeurs possibles** :
  * `true` : Appuyer sur la touche Super (touche Windows) ouvre le lanceur d'applications Arrera (style macOS).
  * `false` : Rétablit le comportement d'origine de GNOME Shell : la touche Super ouvre l'aperçu des activités (*Activities Overview* / sélectionneur de fenêtres).
* **Widget Libadwaita recommandé** : `AdwSwitchRow`

---

### 4. Taille des icônes du dock (`icon-size`)
* **Clé** : `icon-size`
* **Type** : `s` (Chaîne de caractères / `gchar*`)
* **Valeur par défaut** : `'medium'`
* **Valeurs possibles** :
  * `'small'` : Format compact (icônes de **28px**, hauteur totale du dock de **46px**). Idéal pour petits écrans.
  * `'medium'` : Format standard actuel (icônes de **36px**, hauteur totale de **56px**).
  * `'large'` : Grand format bien visible (icônes de **48px**, hauteur totale de **72px**).
* **Widget Libadwaita recommandé** : `AdwComboRow` avec un modèle de chaînes (`GtkStringList`) contenant :
  1. Petit (28 px)
  2. Moyen (36 px)
  3. Grand (48 px)

---

### 5. Style du thème de couleur (`theme-mode`)
* **Clé** : `theme-mode`
* **Type** : `s` (Chaîne de caractères / `gchar*`)
* **Valeur par défaut** : `'expressive'`
* **Valeurs possibles** :
  * `'expressive'` : Style **Android 16 QPR2 / Material 3 Expressive**. Le conteneur du dock s'imprègne de la couleur d'accentuation choisie dans GNOME (ex: surface ambrée riche si orange).
  * `'black-outline'` : Style **Fond noir avec contour couleur**. Le conteneur du dock est noir profond (`#0c0c0f`), avec une bordure nette de 2px et un halo lumineux de la couleur d'accentuation active.
### 6. Position du dock sur l'écran (`position`)
* **Clé** : `position`
* **Type** : `s` (Chaîne de caractères / `gchar*`)
* **Valeur par défaut** : `'bottom'`
* **Valeurs possibles** :
  * `'bottom'` : Le dock est positionné horizontalement en bas de l'écran (standard).
  * `'left'` : Le dock pivote à la verticale et se place le long du bord gauche de l'écran.
  * `'right'` : Le dock pivote à la verticale et se place le long du bord droit de l'écran.
* **Widget Libadwaita recommandé** : `AdwComboRow` avec un modèle de chaînes (`GtkStringList`) contenant :
  1. En bas
  2. À gauche
  3. À droite

---

## 3. Exemple d'implémentation dans GNOME Settings (C / GTK4)

### Interface utilisateur en Blueprint (`.blp`) ou GTK UI (`.ui`)

```xml
<interface>
  <object class="AdwPreferencesPage" id="dock_page">
    <property name="title" translatable="yes">Dock</property>
    <property name="icon-name">view-app-grid-symbolic</property>

    <!-- Groupe 1 : Comportement -->
    <child>
      <object class="AdwPreferencesGroup">
        <property name="title" translatable="yes">Comportement</property>

        <!-- Masquage automatique -->
        <child>
          <object class="AdwSwitchRow" id="autohide_row">
            <property name="title" translatable="yes">Masquer automatiquement le dock</property>
            <property name="subtitle" translatable="yes">Révèle le dock quand la souris touche le bord inférieur</property>
          </object>
        </child>

        <!-- Effet de vague -->
        <child>
          <object class="AdwSwitchRow" id="wave_row">
            <property name="title" translatable="yes">Effet d'agrandissement en vague</property>
            <property name="subtitle" translatable="yes">Agrandit les icônes au passage du pointeur</property>
          </object>
        </child>

        <!-- Touche Super -->
        <child>
          <object class="AdwSwitchRow" id="super_key_row">
            <property name="title" translatable="yes">Ouvrir le lanceur avec la touche Super</property>
            <property name="subtitle" translatable="yes">Désactiver pour rétablir l'aperçu des activités GNOME d'origine</property>
          </object>
        </child>
      </object>
    </child>

    <!-- Groupe 2 : Apparence -->
    <child>
      <object class="AdwPreferencesGroup">
        <property name="title" translatable="yes">Apparence</property>

        <!-- Position du dock à l'écran -->
        <child>
          <object class="AdwComboRow" id="position_row">
            <property name="title" translatable="yes">Position à l'écran</property>
            <property name="model">
              <object class="GtkStringList">
                <items>
                  <item translatable="yes">En bas</item>
                  <item translatable="yes">À gauche</item>
                  <item translatable="yes">À droite</item>
                </items>
              </object>
            </property>
          </object>
        </child>

        <!-- Taille des icônes -->
        <child>
          <object class="AdwComboRow" id="size_row">
            <property name="title" translatable="yes">Taille des icônes</property>
            <property name="model">
              <object class="GtkStringList">
                <items>
                  <item translatable="yes">Petite (28 px)</item>
                  <item translatable="yes">Moyenne (36 px)</item>
                  <item translatable="yes">Grande (48 px)</item>
                </items>
              </object>
            </property>
          </object>
        </child>

        <!-- Thème visuel -->
        <child>
          <object class="AdwComboRow" id="theme_row">
            <property name="title" translatable="yes">Style visuel</property>
            <property name="model">
              <object class="GtkStringList">
                <items>
                  <item translatable="yes">Matériel Expressif (fond teinté)</item>
                  <item translatable="yes">Noir avec contour coloré</item>
                </items>
              </object>
            </property>
          </object>
        </child>
      </object>
    </child>

  </object>
</interface>
```

---

### Code C pour `gnome-control-center`

```c
#include <adwaita.h>
#include <gio/gio.h>

static void
setup_dock_settings (AdwPreferencesPage *page, GtkBuilder *builder)
{
    GSettings *settings = g_settings_new ("org.gnome.shell.extensions.dock");

    GtkWidget *autohide_row  = GTK_WIDGET (gtk_builder_get_object (builder, "autohide_row"));
    GtkWidget *wave_row      = GTK_WIDGET (gtk_builder_get_object (builder, "wave_row"));
    GtkWidget *super_key_row = GTK_WIDGET (gtk_builder_get_object (builder, "super_key_row"));
    AdwComboRow *position_row = ADW_COMBO_ROW (gtk_builder_get_object (builder, "position_row"));
    AdwComboRow *size_row    = ADW_COMBO_ROW (gtk_builder_get_object (builder, "size_row"));
    AdwComboRow *theme_row   = ADW_COMBO_ROW (gtk_builder_get_object (builder, "theme_row"));

    /* 1. Lier les switchs booléens simples */
    g_settings_bind (settings, "autohide",
                     autohide_row, "active",
                     G_SETTINGS_BIND_DEFAULT);

    g_settings_bind (settings, "enable-wave-effect",
                     wave_row, "active",
                     G_SETTINGS_BIND_DEFAULT);

    g_settings_bind (settings, "super-key-opens-launcher",
                     super_key_row, "active",
                     G_SETTINGS_BIND_DEFAULT);

    /* 2. Lier la position (Index <-> Chaîne) */
    /* Valeurs : 0 = "bottom", 1 = "left", 2 = "right" */
    const gchar *current_pos = g_settings_get_string (settings, "position");
    if (g_strcmp0 (current_pos, "left") == 0)
        adw_combo_row_set_selected (position_row, 1);
    else if (g_strcmp0 (current_pos, "right") == 0)
        adw_combo_row_set_selected (position_row, 2);
    else
        adw_combo_row_set_selected (position_row, 0);

    g_signal_connect_swapped (position_row, "notify::selected",
        G_CALLBACK (+[](GSettings *s, AdwComboRow *row) {
            guint sel = adw_combo_row_get_selected (row);
            const gchar *val = (sel == 1) ? "left" : (sel == 2 ? "right" : "bottom");
            g_settings_set_string (s, "position", val);
        }), settings);

    /* 3. Lier la taille des icônes (Index <-> Chaîne) */
    /* Valeurs : 0 = "small", 1 = "medium", 2 = "large" */
    const gchar *current_size = g_settings_get_string (settings, "icon-size");
    if (g_strcmp0 (current_size, "small") == 0)
        adw_combo_row_set_selected (size_row, 0);
    else if (g_strcmp0 (current_size, "large") == 0)
        adw_combo_row_set_selected (size_row, 2);
    else
        adw_combo_row_set_selected (size_row, 1);

    g_signal_connect_swapped (size_row, "notify::selected",
        G_CALLBACK (+[](GSettings *s, AdwComboRow *row) {
            guint sel = adw_combo_row_get_selected (row);
            const gchar *val = (sel == 0) ? "small" : (sel == 2 ? "large" : "medium");
            g_settings_set_string (s, "icon-size", val);
        }), settings);

    /* 4. Lier le thème (Index <-> Chaîne) */
    /* Valeurs : 0 = "expressive", 1 = "black-outline" */
    const gchar *current_theme = g_settings_get_string (settings, "theme-mode");
    if (g_strcmp0 (current_theme, "black-outline") == 0)
        adw_combo_row_set_selected (theme_row, 1);
    else
        adw_combo_row_set_selected (theme_row, 0);

    g_signal_connect_swapped (theme_row, "notify::selected",
        G_CALLBACK (+[](GSettings *s, AdwComboRow *row) {
            guint sel = adw_combo_row_get_selected (row);
            const gchar *val = (sel == 1) ? "black-outline" : "expressive";
            g_settings_set_string (s, "theme-mode", val);
        }), settings);
}
```

---

## 4. Commandes de test et de débogage (CLI)

Pour vérifier l'état ou modifier manuellement les réglages depuis un terminal :

```bash
# Consulter toutes les valeurs actuelles
gsettings list-recursively org.gnome.shell.extensions.dock

# Modifier la position ('bottom' | 'left' | 'right')
gsettings set org.gnome.shell.extensions.dock position 'left'
gsettings set org.gnome.shell.extensions.dock position 'right'
gsettings set org.gnome.shell.extensions.dock position 'bottom'

# Modifier le masquage automatique (true / false)
gsettings set org.gnome.shell.extensions.dock autohide true

# Modifier l'effet de vague (true / false)
gsettings set org.gnome.shell.extensions.dock enable-wave-effect false

# Modifier la taille des icônes ('small' | 'medium' | 'large')
gsettings set org.gnome.shell.extensions.dock icon-size 'large'

# Modifier le thème ('expressive' | 'black-outline')
gsettings set org.gnome.shell.extensions.dock theme-mode 'black-outline'

# Modifier l'action de la touche Super (true = lanceur Arrera, false = GNOME d'origine)
gsettings set org.gnome.shell.extensions.dock super-key-opens-launcher false

# Réinitialiser toutes les options à leurs valeurs par défaut
gsettings reset org.gnome.shell.extensions.dock position
gsettings reset org.gnome.shell.extensions.dock autohide
gsettings reset org.gnome.shell.extensions.dock enable-wave-effect
gsettings reset org.gnome.shell.extensions.dock super-key-opens-launcher
gsettings reset org.gnome.shell.extensions.dock icon-size
gsettings reset org.gnome.shell.extensions.dock theme-mode
```
