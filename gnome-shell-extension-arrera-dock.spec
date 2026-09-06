%global uuid dock@linux.arrera-software.fr

Name:           gnome-shell-extension-arrera-dock
Version:        1.0.0
Release:        0.1.beta1%{?dist}
Summary:        Dock moderne pour GNOME Shell (Distribution Arrera Blue)

License:        GPL-2.0-or-later
URL:            https://github.com/Arrera-linux/arrera-dock
Source0:        %{name}-%{version}.tar.gz

BuildArch:      noarch

BuildRequires:  glib2-devel
Requires:       gnome-shell >= 45
Requires:       glib2

Provides:       arrera-dock = %{version}-%{release}
Provides:       gnome-shell-extension-dock = %{version}-%{release}

%description
Arrera Dock est un dock moderne pour GNOME Shell conçu pour la distribution
Arrera Blue Linux. Il remplace le dash natif de l'aperçu par une pilule
flottante au design inspiré de Material 3 Expressive et d'Android 16 QPR2.

Fonctionnalités :
- Disposition dynamique et responsive (en bas, à gauche ou à droite de l'écran)
- Effet d'agrandissement en vague au survol des icônes
- Masquage automatique intelligent (autohide) avec bande d'activation
- Intégration dynamique des 9 couleurs d'accentuation de GNOME
- Lanceur d'applications flottant avec recherche instantanée
- Prise en charge complète du clic droit (épingler/détacher du dock)
- Raccourci touche Super personnalisable
- Clés GSettings et intégration native dans GNOME Settings

%prep
%autosetup -n %{name}-%{version}

%build
# Aucune compilation de binaire C nécessaire.
# Compilation du schéma GSettings pour l'extension
glib-compile-schemas schemas/

%install
rm -rf %{buildroot}

# Répertoires de destination
install -d -m 0755 %{buildroot}%{_datadir}/gnome-shell/extensions/%{uuid}
install -d -m 0755 %{buildroot}%{_datadir}/gnome-shell/extensions/%{uuid}/icons
install -d -m 0755 %{buildroot}%{_datadir}/gnome-shell/extensions/%{uuid}/schemas

# Fichiers JavaScript, CSS, métadonnées
install -p -m 0644 metadata.json %{buildroot}%{_datadir}/gnome-shell/extensions/%{uuid}/
install -p -m 0644 extension.js %{buildroot}%{_datadir}/gnome-shell/extensions/%{uuid}/
install -p -m 0644 dock.js %{buildroot}%{_datadir}/gnome-shell/extensions/%{uuid}/
install -p -m 0644 appLauncher.js %{buildroot}%{_datadir}/gnome-shell/extensions/%{uuid}/
install -p -m 0644 stylesheet.css %{buildroot}%{_datadir}/gnome-shell/extensions/%{uuid}/

# Icônes
install -p -m 0644 icons/* %{buildroot}%{_datadir}/gnome-shell/extensions/%{uuid}/icons/

# Schéma local de l'extension
install -p -m 0644 schemas/org.gnome.shell.extensions.dock.gschema.xml %{buildroot}%{_datadir}/gnome-shell/extensions/%{uuid}/schemas/
install -p -m 0644 schemas/gschemas.compiled %{buildroot}%{_datadir}/gnome-shell/extensions/%{uuid}/schemas/

# Schéma système pour GSettings et gnome-control-center
install -d -m 0755 %{buildroot}%{_datadir}/glib-2.0/schemas
install -p -m 0644 schemas/org.gnome.shell.extensions.dock.gschema.xml %{buildroot}%{_datadir}/glib-2.0/schemas/

%files
%doc README.md GNOME_SETTINGS_INTEGRATION.md
%{_datadir}/gnome-shell/extensions/%{uuid}/
%{_datadir}/glib-2.0/schemas/org.gnome.shell.extensions.dock.gschema.xml

%changelog
* Sun Sep 06 2026 Arrera Software <contact@arrera.org> - 1.0.0-0.1.beta1
- Première version bêta pour Arrera Blue Linux
