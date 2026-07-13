(function () {
    try {
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === "GapTest_T1") { comp = app.project.item(i); break; }
        }
        if (!comp) return '{"status":"error","message":"comp not found"}';

        app.beginUndoGroup("Golden Dust v2b");

        var hasBG = false;
        for (var L = 1; L <= comp.numLayers; L++) {
            if (comp.layer(L).name === "BG") { hasBG = true; break; }
        }
        if (!hasBG) {
            var bg = comp.layers.addSolid([0.02, 0.015, 0.01], "BG", 1280, 720, 1, 6);
            bg.moveToEnd();
        }

        var fx = comp.layer("Particular Host").Effects.property(1);
        var report = [];
        var set = function (label, mn, v) {
            try {
                var p = fx.property(mn);
                p.setValue(v);
                report.push('"' + label + '":"ok=' + String(p.value).substring(0, 20) + '"');
            } catch (e) {
                report.push('"' + label + '":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 80) + '"');
            }
        };

        set("EmitterSizeMode", "tc Particular-0577", 2);
        set("EmitterSizeX", "tc Particular-0014", 1300);
        set("EmitterSizeY", "tc Particular-0015", 120);
        set("EmitterSizeZ", "tc Particular-0016", 400);
        set("Position", "tc Particular-0581", [640, 640, 0]);
        set("SizeRandom", "tc Particular-0074", 70);
        set("OpacityRandom", "tc Particular-0075", 60);
        set("Size", "tc Particular-0027", 2.0);
        set("GlowOpacity", "tc Particular-0216", 60);
        set("GlowSize", "tc Particular-0215", 200);
        set("TurbAffectPosition", "tc Particular-0711", 40);

        app.endUndoGroup();

        var f = new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t1_frame_v2.png");
        comp.saveFrameToPng(4, f);
        return '{"status":"done",' + report.join(",") + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return '{"status":"error","message":"' + String(e).replace(/"/g, "'") + '"}';
    }
})();
