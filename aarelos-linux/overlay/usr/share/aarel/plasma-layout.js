function removeExistingPanels() {
    var ps = panels();
    for (var i = ps.length - 1; i >= 0; --i)
        ps[i].remove();
}

function configureDesktop() {
    var ds = desktops();
    for (var i = 0; i < ds.length; ++i) {
        var d = ds[i];
        d.wallpaperPlugin = "org.kde.image";
        d.currentConfigGroup = ["Wallpaper", "org.kde.image", "General"];
        d.writeConfig("Image", "file:///usr/share/wallpapers/AArelMonolith/contents/images/3840x2160.svg");
        d.writeConfig("FillMode", 2);
    }
}

removeExistingPanels();
configureDesktop();

var top = new Panel;
top.location = "top";
top.height = 34;
top.floating = true;
top.alignment = "center";
var launcher = top.addWidget("org.kde.plasma.kickoff");
var title = top.addWidget("org.kde.plasma.appmenu");
top.addWidget("org.kde.plasma.panelspacer");
top.addWidget("org.kde.plasma.systemtray");
top.addWidget("org.kde.plasma.digitalclock");

var dock = new Panel;
dock.location = "bottom";
dock.height = 58;
dock.floating = true;
dock.alignment = "center";
dock.addWidget("org.kde.plasma.icontasks");

var activities = desktops();
for (var j = 0; j < activities.length; ++j)
    activities[j].writeConfig("formfactor", 0);
